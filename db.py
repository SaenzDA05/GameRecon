"""Accounts: users, password hashing, sessions. Stdlib only.

Two storage backends, same SQL:
  * local SQLite file (default)       — DATA_DIR/gametime.db
  * Turso (hosted libSQL) over HTTPS  — when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN are set.
    Free hosts (e.g. Render's free tier) wipe their disk on every restart, so accounts must
    live in an outside database there.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
from contextlib import closing
from pathlib import Path

# DATA_DIR points at a persistent volume in production (e.g. /data on Railway).
DB_PATH = Path(os.environ.get("DATA_DIR") or Path(__file__).parent / "data") / "gametime.db"
TURSO_URL = os.environ.get("TURSO_DATABASE_URL", "").strip()
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
PBKDF2_ITERATIONS = 310_000
SESSION_DAYS = 30
RESET_MINUTES = 60


class IntegrityError(Exception):
    """A constraint failed (e.g. duplicate email), whichever backend raised it."""


# ---------- backends ----------
# _run(stmts) executes [(sql, args), ...] as one all-or-nothing transaction and returns one
# result per statement: {"rows": [dict, ...], "lastrowid": int | None}.

def _run_local(stmts):
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with closing(sqlite3.connect(DB_PATH, timeout=10)) as c, c:
            c.row_factory = sqlite3.Row
            out = []
            for sql, args in stmts:
                cur = c.execute(sql, args)
                out.append({"rows": [dict(r) for r in cur.fetchall()], "lastrowid": cur.lastrowid})
            return out
    except sqlite3.IntegrityError as e:
        raise IntegrityError(str(e)) from e


def _turso_endpoint():
    # Turso shows the URL as libsql://<db>-<org>.turso.io; its HTTP API lives at https://same-host.
    url = TURSO_URL.replace("libsql://", "https://", 1).rstrip("/")
    return f"{url}/v2/pipeline"


def _turso_arg(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, bool):
        return {"type": "integer", "value": str(int(v))}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    if isinstance(v, (bytes, bytearray)):
        return {"type": "blob", "base64": base64.b64encode(v).decode().rstrip("=")}
    return {"type": "text", "value": str(v)}


def _turso_value(v):
    t = v.get("type")
    if t == "null":
        return None
    if t == "integer":
        return int(v["value"])
    if t == "blob":
        b = v.get("base64", "")
        return base64.b64decode(b + "=" * (-len(b) % 4))
    return v.get("value")


def _turso_result(res):
    cols = [c.get("name") for c in res.get("cols") or []]
    rows = [{cols[i]: _turso_value(cell) for i, cell in enumerate(r)} for r in res.get("rows") or []]
    rid = res.get("last_insert_rowid")
    return {"rows": rows, "lastrowid": int(rid) if rid is not None else None}


def _turso_exec(sql, args=()):
    return {"type": "execute", "stmt": {"sql": sql, "args": [_turso_arg(a) for a in args]}}


def _turso_post(requests, baton=None, base_url=None):
    body = {"requests": requests}
    if baton:
        body["baton"] = baton
    url = f"{base_url.rstrip('/')}/v2/pipeline" if base_url else _turso_endpoint()
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {TURSO_TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Turso HTTP {e.code}: {e.read()[:200]!r}") from e


def _turso_error(results):
    for r in results:
        if r.get("type") == "error":
            msg = (r.get("error") or {}).get("message", "unknown error")
            return IntegrityError(msg) if "constraint" in msg.lower() else RuntimeError(f"Turso error: {msg}")
    return None


def _run_turso(stmts):
    if len(stmts) == 1:  # a single statement is atomic on its own
        data = _turso_post([_turso_exec(*stmts[0]), {"type": "close"}])
        err = _turso_error(data["results"][:1])
        if err:
            raise err
        return [_turso_result(data["results"][0]["response"]["result"])]

    # Several statements: open a transaction, run them, keep the stream open (baton), then
    # COMMIT — or ROLLBACK if any failed — so the write is all-or-nothing.
    data = _turso_post([_turso_exec("BEGIN")] + [_turso_exec(*st) for st in stmts])
    results = data["results"]
    err = _turso_error(results)
    _turso_post([_turso_exec("ROLLBACK" if err else "COMMIT"), {"type": "close"}],
                baton=data.get("baton"), base_url=data.get("base_url"))
    if err:
        raise err
    return [_turso_result(results[i]["response"]["result"]) for i in range(1, len(stmts) + 1)]


USING_TURSO = bool(TURSO_URL and TURSO_TOKEN)
_run = _run_turso if USING_TURSO else _run_local


def _one(sql, args=()):
    rows = _run([(sql, args)])[0]["rows"]
    return rows[0] if rows else None


def describe():
    return "Turso" if USING_TURSO else str(DB_PATH)


# ---------- schema ----------
def init():
    _run([
        ("""CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY,
                email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name       TEXT NOT NULL DEFAULT '',
                pw_hash    BLOB NOT NULL,
                salt       BLOB NOT NULL,
                prefs      TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            )""", ()),
        ("""CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            )""", ()),
        ("""CREATE TABLE IF NOT EXISTS password_resets (
                token_hash TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            )""", ()),
    ])


# ---------- hashing ----------
def _hash_pw(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)


def _as_bytes(v):
    """Hashes are stored as hex text (portable across backends); older local rows are raw bytes."""
    return bytes(v) if isinstance(v, (bytes, bytearray, memoryview)) else bytes.fromhex(v)


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- users ----------
class EmailTaken(Exception):
    pass


def create_user(email, name, password, prefs):
    salt = secrets.token_bytes(16)
    try:
        res = _run([("INSERT INTO users (email, name, pw_hash, salt, prefs, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                     (email, name, _hash_pw(password, salt).hex(), salt.hex(), json.dumps(prefs), int(time.time())))])
    except IntegrityError:
        raise EmailTaken()
    return res[0]["lastrowid"]


_DUMMY_SALT = secrets.token_bytes(16)


def verify_login(email, password):
    row = _one("SELECT * FROM users WHERE email = ?", (email,))
    if not row:
        _hash_pw(password, _DUMMY_SALT)  # same work either way, so timing doesn't reveal which emails exist
        return None
    ok = hmac.compare_digest(_hash_pw(password, _as_bytes(row["salt"])), _as_bytes(row["pw_hash"]))
    return row if ok else None


def get_user_by_email(email):
    return _one("SELECT * FROM users WHERE email = ?", (email,))


def get_user(user_id):
    return _one("SELECT * FROM users WHERE id = ?", (user_id,))


def update_user(user_id, name=None, prefs=None):
    stmts = []
    if name is not None:
        stmts.append(("UPDATE users SET name = ? WHERE id = ?", (name, user_id)))
    if prefs is not None:
        stmts.append(("UPDATE users SET prefs = ? WHERE id = ?", (json.dumps(prefs), user_id)))
    if stmts:
        _run(stmts)


def public_user(row):
    return {"id": row["id"], "email": row["email"], "name": row["name"], "prefs": json.loads(row["prefs"] or "{}")}


# ---------- sessions ----------
def create_session(user_id):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    _run([("DELETE FROM sessions WHERE expires_at < ?", (now,)),
          ("INSERT INTO sessions VALUES (?, ?, ?)", (_token_hash(token), user_id, now + SESSION_DAYS * 86400))])
    return token


def user_for_session(token):
    if not token:
        return None
    return _one("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_hash = ? AND s.expires_at > ?", (_token_hash(token), int(time.time())))


def delete_session(token):
    if token:
        _run([("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))])


# ---------- password reset ----------
def create_reset(user_id):
    """One live reset link per user: issuing a new one invalidates older ones."""
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    _run([("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?", (user_id, now)),
          ("INSERT INTO password_resets VALUES (?, ?, ?)", (_token_hash(token), user_id, now + RESET_MINUTES * 60))])
    return token


def consume_reset(token):
    """Returns the user id if the token is valid, and burns it either way."""
    if not token:
        return None
    th = _token_hash(token)
    res = _run([("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?", (th,)),
                ("DELETE FROM password_resets WHERE token_hash = ?", (th,))])
    rows = res[0]["rows"]
    if not rows or rows[0]["expires_at"] < time.time():
        return None
    return rows[0]["user_id"]


def set_password(user_id, password):
    """New password + sign out every existing session for this user."""
    salt = secrets.token_bytes(16)
    _run([("UPDATE users SET pw_hash = ?, salt = ? WHERE id = ?", (_hash_pw(password, salt).hex(), salt.hex(), user_id)),
          ("DELETE FROM sessions WHERE user_id = ?", (user_id,)),
          ("DELETE FROM password_resets WHERE user_id = ?", (user_id,))])
