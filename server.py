"""GameRecon server: static site + JSON API (accounts, games, play-by-play).

    python server.py            # http://localhost:5173
    PORT=8080 python server.py

Stdlib only. Production env vars:
    SECURE_COOKIES=1   serving over HTTPS (Secure cookies + HSTS)
    TRUST_PROXY=1      behind a load balancer; use X-Forwarded-For for client IPs
    DATA_DIR=/data     where the SQLite database lives (a persistent volume)
    PUBLIC_URL=https://gamerecon.app   base URL used in emailed links (never taken from the Host header)
    RESEND_API_KEY / EMAIL_FROM        see mailer.py
"""
import json
import os
import re
import threading
import time
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import db
import espn
import mailer

PUBLIC = Path(__file__).parent / "public"
COOKIE = "gt_session"
SECURE = os.environ.get("SECURE_COOKIES") == "1"
TRUST_PROXY = os.environ.get("TRUST_PROXY") == "1"
PORT = int(os.environ.get("PORT", 5173))
PUBLIC_URL = (os.environ.get("PUBLIC_URL") or f"http://localhost:{PORT}").rstrip("/")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
FAV_RE = re.compile(r"^[a-z0-9]{1,12}:p?[0-9]{1,12}$")
SPORT_IDS = {s for s, _ in espn.SPORTS}
AREA_RE = re.compile(r"^([A-Z]{2}|CAN|INTL)?$")


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


# ---------- throttling (in memory, keyed by IP or email) ----------
_fails, _fails_lock = {}, threading.Lock()
MAX_FAILS, FAIL_WINDOW = 10, 15 * 60


def _throttled(key, limit=MAX_FAILS, window=FAIL_WINDOW):
    with _fails_lock:
        recent = [t for t in _fails.get(key, []) if t > time.time() - window]
        _fails[key] = recent
        return len(recent) >= limit


def _record_fail(key):
    with _fails_lock:
        _fails.setdefault(key, []).append(time.time())


# ---------- prefs validation ----------
def clean_prefs(p, base=None):
    """Accept only well-formed preference fields; merge onto `base`."""
    out = {"favorites": [], "sportOrder": None, "area": "", "favNames": {}}
    out.update(base or {})
    if not isinstance(p, dict):
        return out
    if isinstance(p.get("favorites"), list):
        out["favorites"] = list(dict.fromkeys(f for f in p["favorites"] if isinstance(f, str) and FAV_RE.match(f)))[:300]
    if "sportOrder" in p:
        so = p["sportOrder"]
        out["sportOrder"] = [s for s in dict.fromkeys(so) if s in SPORT_IDS] if isinstance(so, list) else None
    if isinstance(p.get("area"), str) and AREA_RE.match(p["area"]):
        out["area"] = p["area"]
    names = p.get("favNames") if isinstance(p.get("favNames"), dict) else out.get("favNames") or {}
    out["favNames"] = {k: str(v)[:60] for k, v in names.items() if k in out["favorites"] and isinstance(v, str)}
    return out


def merge_guest_prefs(stored, guest):
    """On sign-in, keep the account's settings but add any teams starred while signed out."""
    guest = clean_prefs(guest)
    merged = clean_prefs(stored)
    merged["favorites"] = list(dict.fromkeys(merged["favorites"] + guest["favorites"]))[:300]
    merged["favNames"] = {**guest["favNames"], **merged["favNames"]}
    if merged.get("sportOrder") is None and guest.get("sportOrder"):
        merged["sportOrder"] = guest["sportOrder"]
    if not merged.get("area") and guest.get("area"):
        merged["area"] = guest["area"]
    return merged


# ---------- handler ----------
class Handler(SimpleHTTPRequestHandler):
    server_version = "GameRecon/1.0"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        if SECURE:
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):  # API calls only; static files are noise
            super().log_message(fmt, *args)

    def log_error(self, fmt, *args):
        super().log_message(fmt, *args)  # always log errors

    # --- plumbing ---
    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        return super().do_GET()

    def do_POST(self):
        self._api("POST")

    def do_PUT(self):
        self._api("PUT")

    def _json(self, status, body, set_cookie=None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if set_cookie is not None:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            raise ApiError(415, "Expected JSON")  # also blocks cross-site form posts
        n = int(self.headers.get("Content-Length") or 0)
        if n > 64 * 1024:
            raise ApiError(413, "Request too large")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON")

    def _token(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        return c[COOKIE].value if COOKIE in c else None

    def _session_cookie(self, token, max_age):
        parts = [f"{COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={max_age}"]
        if SECURE:
            parts.append("Secure")
        return "; ".join(parts)

    def _client_ip(self):
        if TRUST_PROXY and self.headers.get("X-Forwarded-For"):
            return self.headers["X-Forwarded-For"].split(",")[0].strip()
        return self.client_address[0]

    def _user(self, required=True):
        u = db.user_for_session(self._token())
        if not u and required:
            raise ApiError(401, "Please sign in")
        return u

    def _api(self, method):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        route = ROUTES.get((method, url.path))
        try:
            if not route:
                raise ApiError(404, "Not found")
            route(self, q)
        except ApiError as e:
            self._json(e.status, {"error": e.message})
        except Exception as e:  # pragma: no cover
            self.log_error("API error: %r", e)
            self._json(500, {"error": "Server error"})

    # --- routes: data ---
    def r_health(self, q):
        self._json(200, {"ok": True})

    def r_config(self, q):
        self._json(200, espn.config())

    def r_day(self, q):
        d = q.get("date", "")
        if not re.fullmatch(r"\d{8}", d):
            raise ApiError(400, "date must be YYYYMMDD")
        self._json(200, {"date": d, "events": espn.day(d)})

    def r_plays(self, q):
        league, eid = q.get("league", ""), q.get("id", "")
        if league not in espn.LEAGUE_BY_ID or not eid.isdigit():
            raise ApiError(400, "Bad league or id")
        self._json(200, {"plays": espn.plays(league, eid)})

    # --- routes: accounts ---
    def r_signup(self, q):
        b = self._body()
        email = str(b.get("email", "")).strip().lower()
        name = str(b.get("name", "")).strip()[:60]
        pw = str(b.get("password", ""))
        if not EMAIL_RE.match(email):
            raise ApiError(400, "Enter a valid email address")
        if len(pw) < 8:
            raise ApiError(400, "Password must be at least 8 characters")
        if len(pw) > 200:
            raise ApiError(400, "Password is too long")
        try:
            uid = db.create_user(email, name or email.split("@")[0], pw, clean_prefs(b.get("prefs")))
        except db.EmailTaken:
            raise ApiError(409, "An account with that email already exists — sign in instead")
        token = db.create_session(uid)
        self._json(200, {"user": db.public_user(db.get_user(uid))},
                   set_cookie=self._session_cookie(token, db.SESSION_DAYS * 86400))

    def r_login(self, q):
        ip = self._client_ip()
        if _throttled(ip):
            raise ApiError(429, "Too many attempts — try again in a few minutes")
        b = self._body()
        row = db.verify_login(str(b.get("email", "")).strip().lower(), str(b.get("password", "")))
        if not row:
            _record_fail(ip)
            raise ApiError(401, "Wrong email or password")
        prefs = merge_guest_prefs(json.loads(row["prefs"] or "{}"), b.get("prefs"))
        db.update_user(row["id"], prefs=prefs)
        token = db.create_session(row["id"])
        self._json(200, {"user": db.public_user(db.get_user(row["id"]))},
                   set_cookie=self._session_cookie(token, db.SESSION_DAYS * 86400))

    def r_forgot(self, q):
        b = self._body()
        email = str(b.get("email", "")).strip().lower()
        ip = self._client_ip()
        # Same answer whether or not the account exists, so this can't be used to discover emails.
        ok = {"ok": True}
        if not EMAIL_RE.match(email):
            raise ApiError(400, "Enter a valid email address")
        if _throttled(f"forgot-ip:{ip}", 5) or _throttled(f"forgot-email:{email}", 3, 60 * 60):
            raise ApiError(429, "Too many reset requests — try again later")
        _record_fail(f"forgot-ip:{ip}")
        _record_fail(f"forgot-email:{email}")
        user = db.get_user_by_email(email)
        if user:
            token = db.create_reset(user["id"])
            mailer.send_password_reset(user["email"], user["name"], f"{PUBLIC_URL}/?reset={token}", db.RESET_MINUTES)
        self._json(200, ok)

    def r_reset(self, q):
        b = self._body()
        pw = str(b.get("password", ""))
        if len(pw) < 8:
            raise ApiError(400, "Password must be at least 8 characters")
        if len(pw) > 200:
            raise ApiError(400, "Password is too long")
        uid = db.consume_reset(str(b.get("token", "")))
        if not uid:
            raise ApiError(400, "This reset link is invalid or has expired — request a new one")
        db.set_password(uid, pw)  # also signs out every other device
        token = db.create_session(uid)
        self._json(200, {"user": db.public_user(db.get_user(uid))},
                   set_cookie=self._session_cookie(token, db.SESSION_DAYS * 86400))

    def r_logout(self, q):
        db.delete_session(self._token())
        self._json(200, {"ok": True}, set_cookie=self._session_cookie("", 0))

    def r_me(self, q):
        u = self._user(required=False)
        self._json(200, {"user": db.public_user(u) if u else None})

    def r_update_me(self, q):
        u = self._user()
        b = self._body()
        name = str(b["name"]).strip()[:60] if "name" in b else None
        prefs = clean_prefs(b["prefs"], json.loads(u["prefs"] or "{}")) if "prefs" in b else None
        db.update_user(u["id"], name=name, prefs=prefs)
        self._json(200, {"user": db.public_user(db.get_user(u["id"]))})


ROUTES = {
    ("GET", "/api/health"): Handler.r_health,
    ("GET", "/api/config"): Handler.r_config,
    ("GET", "/api/day"): Handler.r_day,
    ("GET", "/api/plays"): Handler.r_plays,
    ("POST", "/api/auth/signup"): Handler.r_signup,
    ("POST", "/api/auth/login"): Handler.r_login,
    ("POST", "/api/auth/logout"): Handler.r_logout,
    ("POST", "/api/auth/forgot"): Handler.r_forgot,
    ("POST", "/api/auth/reset"): Handler.r_reset,
    ("GET", "/api/me"): Handler.r_me,
    ("PUT", "/api/me"): Handler.r_update_me,
}


if __name__ == "__main__":
    db.init()
    print(f"GameRecon running at http://localhost:{PORT} (db: {db.DB_PATH}, "
          f"email: {'Resend' if mailer.API_KEY else 'console (dev)'})", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
