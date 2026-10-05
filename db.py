"""Accounts: users, password hashing, sessions. SQLite, stdlib only."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import closing
from pathlib import Path

# DATA_DIR points at a persistent volume in production (e.g. /data on Railway).
DB_PATH = Path(os.environ.get("DATA_DIR") or Path(__file__).parent / "data") / "gametime.db"
PBKDF2_ITERATIONS = 310_000
SESSION_DAYS = 30
RESET_MINUTES = 60


def _connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init():
    with closing(_connect()) as c, c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY,
                email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name       TEXT NOT NULL DEFAULT '',
                pw_hash    BLOB NOT NULL,
                salt       BLOB NOT NULL,
                prefs      TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS password_resets (
                token_hash TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
        """)


def _hash_pw(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class EmailTaken(Exception):
    pass


def create_user(email, name, password, prefs):
    salt = secrets.token_bytes(16)
    try:
        with closing(_connect()) as c, c:
            cur = c.execute(
                "INSERT INTO users (email, name, pw_hash, salt, prefs, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (email, name, _hash_pw(password, salt), salt, json.dumps(prefs), int(time.time())))
            return cur.lastrowid
    except sqlite3.IntegrityError:
        raise EmailTaken()


_DUMMY_SALT = secrets.token_bytes(16)


def verify_login(email, password):
    with closing(_connect()) as c:
        row = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        _hash_pw(password, _DUMMY_SALT)  # same work either way, so timing doesn't reveal which emails exist
        return None
    return row if hmac.compare_digest(_hash_pw(password, row["salt"]), row["pw_hash"]) else None


def get_user_by_email(email):
    with closing(_connect()) as c:
        return c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def get_user(user_id):
    with closing(_connect()) as c:
        return c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def update_user(user_id, name=None, prefs=None):
    with closing(_connect()) as c, c:
        if name is not None:
            c.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
        if prefs is not None:
            c.execute("UPDATE users SET prefs = ? WHERE id = ?", (json.dumps(prefs), user_id))


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    with closing(_connect()) as c, c:
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        c.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                  (_token_hash(token), user_id, int(time.time()) + SESSION_DAYS * 86400))
    return token


def user_for_session(token):
    if not token:
        return None
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
            (_token_hash(token), int(time.time()))).fetchone()
    return row


def delete_session(token):
    if token:
        with closing(_connect()) as c, c:
            c.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def public_user(row):
    return {"id": row["id"], "email": row["email"], "name": row["name"], "prefs": json.loads(row["prefs"] or "{}")}


# ---------- password reset ----------
def create_reset(user_id):
    """One live reset link per user: issuing a new one invalidates older ones."""
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with closing(_connect()) as c, c:
        c.execute("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?", (user_id, now))
        c.execute("INSERT INTO password_resets VALUES (?, ?, ?)",
                  (_token_hash(token), user_id, now + RESET_MINUTES * 60))
    return token


def consume_reset(token):
    """Returns the user id if the token is valid, and burns it either way."""
    if not token:
        return None
    with closing(_connect()) as c, c:
        row = c.execute("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?",
                        (_token_hash(token),)).fetchone()
        c.execute("DELETE FROM password_resets WHERE token_hash = ?", (_token_hash(token),))
    if not row or row["expires_at"] < time.time():
        return None
    return row["user_id"]


def set_password(user_id, password):
    """New password + sign out every existing session for this user."""
    salt = secrets.token_bytes(16)
    with closing(_connect()) as c, c:
        c.execute("UPDATE users SET pw_hash = ?, salt = ? WHERE id = ?", (_hash_pw(password, salt), salt, user_id))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        c.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
