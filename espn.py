"""ESPN data layer: fetch + cache + normalize every sport into one event shape.

Event kinds:
  match  — two teams (MLB, NFL, NBA, NHL, soccer, college...)
  tennis — a tournament containing many matches
  fights — a UFC card containing many bouts
  race   — an F1 / NASCAR weekend containing sessions
  golf   — a tournament with a leaderboard
"""
import json
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://site.api.espn.com/apis/site/v2/sports"

SPORTS = [
    ("nfl", "NFL"), ("nba", "NBA"), ("mlb", "MLB"), ("nhl", "NHL"),
    ("cfb", "College Football"), ("cbb", "College Basketball"), ("cbase", "College Baseball"),
    ("soccer", "Soccer"), ("ufc", "UFC"), ("f1", "F1"), ("tennis", "Tennis"),
    ("golf", "Golf"), ("nascar", "NASCAR"), ("wnba", "WNBA"),
]

def _L(id, name, sport, path, kind="match", query=""):
    return {"id": id, "name": name, "sport": sport, "path": path, "kind": kind, "query": query}

LEAGUES = [
    _L("mlb", "MLB", "mlb", "baseball/mlb"),
    _L("nfl", "NFL", "nfl", "football/nfl"),
    _L("nba", "NBA", "nba", "basketball/nba"),
    _L("nhl", "NHL", "nhl", "hockey/nhl"),
    _L("wnba", "WNBA", "wnba", "basketball/wnba"),
    _L("cfb", "College Football", "cfb", "football/college-football", query="&groups=80&limit=300"),
    _L("cbb", "College Basketball", "cbb", "basketball/mens-college-basketball", query="&groups=50&limit=400"),
    _L("cbase", "College Baseball", "cbase", "baseball/college-baseball", query="&limit=400"),
    _L("epl", "Premier League", "soccer", "soccer/eng.1"),
    _L("mls", "MLS", "soccer", "soccer/usa.1"),
    _L("ucl", "Champions League", "soccer", "soccer/uefa.champions"),
    _L("laliga", "La Liga", "soccer", "soccer/esp.1"),
    _L("ligamx", "Liga MX", "soccer", "soccer/mex.1"),
    _L("seriea", "Serie A", "soccer", "soccer/ita.1"),
    _L("bundesliga", "Bundesliga", "soccer", "soccer/ger.1"),
    _L("ligue1", "Ligue 1", "soccer", "soccer/fra.1"),
    _L("nwsl", "NWSL", "soccer", "soccer/usa.nwsl"),
    _L("atp", "ATP", "tennis", "tennis/atp", kind="tennis"),
    _L("wta", "WTA", "tennis", "tennis/wta", kind="tennis"),
    _L("ufc", "UFC", "ufc", "mma/ufc", kind="fights"),
    _L("f1", "Formula 1", "f1", "racing/f1", kind="race"),
    _L("nascar", "NASCAR Cup", "nascar", "racing/nascar-premier", kind="race"),
    _L("pga", "PGA Tour", "golf", "golf/pga", kind="golf"),
    _L("lpga", "LPGA", "golf", "golf/lpga", kind="golf"),
]
LEAGUE_BY_ID = {l["id"]: l for l in LEAGUES}

# Sports where ESPN publishes play-by-play we can show.
PLAYS_SPORTS = {"mlb", "nfl", "nba", "nhl", "wnba", "cfb", "cbb", "cbase", "soccer"}

# When ESPN lists no broadcaster for these, show the usual rights holder.
DEFAULT_NETS = {
    "tennis": ["Tennis Channel", "ESPN+"],
    "ufc": ["Paramount+"],
    "f1": ["Apple TV"],
    "golf": ["Golf Chnl"],
}

# ---------- fetching + cache ----------
_cache = {}
_cache_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=24)


def fetch_json(url, ttl):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(url)
        if hit and hit[0] > now:
            return hit[1]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 GameRecon"})
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.load(r)
    except Exception:
        data, ttl = {}, min(ttl, 30)  # don't hammer a failing endpoint, but retry soon
    with _cache_lock:
        _cache[url] = (now + ttl, data)
        if len(_cache) > 5000:  # crude eviction
            for k in [k for k, v in _cache.items() if v[0] < now]:
                _cache.pop(k, None)
    return data


# Logos for teams ESPN omits on some future games (filled from teams.json).
_logos = {}
try:
    for lid, teams in json.loads((Path(__file__).parent / "public" / "teams.json").read_text("utf-8")).items():
        for t in teams:
            _logos[f"{lid}:{t['id']}"] = t.get("logo")
except Exception:
    pass


# ---------- normalize helpers ----------
def _status(c):
    st = (c.get("status") or {}).get("type") or {}
    return {"state": st.get("state", "pre"), "statusText": st.get("shortDetail") or st.get("detail") or "",
            "completed": bool(st.get("completed"))}


def _nets(c):
    out, seen = [], set()
    for g in c.get("geoBroadcasts") or []:
        if (g.get("type") or {}).get("shortName") == "Radio":
            continue
        n = (g.get("media") or {}).get("shortName")
        if n and n not in seen:
            seen.add(n)
            out.append({"name": n, "market": (g.get("market") or {}).get("type") or "National"})
    if not out:
        for b in c.get("broadcasts") or []:
            for n in b.get("names") or []:
                if n and n not in seen:
                    seen.add(n)
                    out.append({"name": n, "market": (b.get("market") or "national").capitalize()})
    return out


def _flag(a):
    return (a.get("flag") or {}).get("href") or ""


def _record(x):
    rec = ((x.get("records") or [{}])[0] or {}).get("summary") or ""
    return "" if rec in ("0-0", "0-0-0") else rec


def _rollup_state(parts):
    states = [p["state"] for p in parts]
    if "in" in states:
        return "in"
    if states and all(s == "post" for s in states):
        return "post"
    return "pre"


def _base(league, e, c=None):
    c = c or {}
    return {
        "uid": e.get("uid") or e.get("id"),
        "id": e.get("id"),
        "league": league["id"],
        "sport": league["sport"],
        "kind": league["kind"],
        "name": e.get("name") or "",
        "date": e.get("date"),
        "endDate": e.get("endDate"),
        "note": ((c.get("notes") or [{}])[0] or {}).get("headline") or "",
        "venue": ((c.get("venue") or e.get("venue") or {}).get("fullName")) or (e.get("circuit") or {}).get("fullName") or "",
        "link": next((l.get("href") for l in e.get("links") or [] if "summary" in (l.get("rel") or [])), None)
                or ((e.get("links") or [{}])[0] or {}).get("href") or "",
    }


def _side(league_id, c, side, idx):
    comps = c.get("competitors") or []
    x = next((t for t in comps if t.get("homeAway") == side), comps[idx] if len(comps) > idx else {})
    t = x.get("team") or {}
    a = x.get("athlete") or {}
    tid = t.get("id") or a.get("id") or ""
    return {
        "id": tid,
        "name": t.get("displayName") or a.get("displayName") or "TBD",
        "short": t.get("shortDisplayName") or t.get("displayName") or a.get("shortName") or "TBD",
        "abbr": t.get("abbreviation") or "",
        "logo": t.get("logo") or _logos.get(f"{league_id}:{tid}") or _flag(a),
        "score": x.get("score"),
        "winner": x.get("winner"),
        "record": _record(x),
    }


def _match(league, e):
    c = (e.get("competitions") or [{}])[0]
    ev = _base(league, e, c)
    st = _status(c)
    ev.update(st)
    ev.update({
        "home": _side(league["id"], c, "home", 0),
        "away": _side(league["id"], c, "away", 1),
        "timeTBD": c.get("timeValid") is False,
        "nets": _nets(c),
        "plays": league["sport"] in PLAYS_SPORTS and st["state"] != "pre",
    })
    return ev


def _player(x):
    a = x.get("athlete") or {}
    name = a.get("displayName")
    if not name and x.get("roster"):  # doubles
        name = x["roster"].get("displayName") or x["roster"].get("shortDisplayName")
    return {
        "id": a.get("id") or x.get("id") or "",
        "name": name or (x.get("team") or {}).get("displayName") or "TBD",
        "flag": _flag(a),
        "sets": [int(l["value"]) for l in x.get("linescores") or [] if l.get("value") is not None],
        "winner": x.get("winner"),
        "record": _record(x),
    }


def _tennis(league, e):
    ev = _base(league, e)
    matches, nets = [], []
    for g in e.get("groupings") or []:
        draw = (g.get("grouping") or {}).get("displayName") or ""
        for c in g.get("competitions") or []:
            m = {"id": c.get("id"), "date": c.get("date") or c.get("startDate"), "draw": draw,
                 "round": (c.get("round") or {}).get("displayName") or "",
                 "players": [_player(x) for x in c.get("competitors") or []]}
            m.update(_status(c))
            matches.append(m)
            nets += _nets(c)
    ev.update({"matches": matches, "state": _rollup_state(matches), "statusText": "", "completed": False})
    ev.update(_with_default_nets(league, nets))
    return ev


def _fights(league, e):
    c0 = (e.get("competitions") or [{}])[0]
    ev = _base(league, e, c0)
    fights, nets = [], []
    for c in e.get("competitions") or []:
        f = {"id": c.get("id"), "date": c.get("date"), "weight": (c.get("type") or {}).get("abbreviation") or "",
             "fighters": [_player(x) for x in c.get("competitors") or []]}
        f.update(_status(c))
        fights.append(f)
        nets += _nets(c)
    fights.reverse()  # ESPN lists prelims first; main event first reads better
    ev.update({"fights": fights, "state": _rollup_state(fights), "statusText": "", "completed": False})
    ev.update(_with_default_nets(league, nets))
    return ev


def _race(league, e):
    ev = _base(league, e)
    sessions, nets = [], []
    for c in e.get("competitions") or []:
        comps = sorted(c.get("competitors") or [], key=lambda x: x.get("order") or 999)
        s = {"id": c.get("id"), "date": c.get("date"),
             "name": (c.get("type") or {}).get("abbreviation") or (c.get("type") or {}).get("text") or "Race",
             "top": [{"name": (x.get("athlete") or {}).get("displayName") or "", "flag": _flag(x.get("athlete") or {})}
                     for x in comps[:3]]}
        s.update(_status(c))
        sessions.append(s)
        nets += _nets(c)
    ev.update({"sessions": sessions, "state": _rollup_state(sessions), "statusText": "", "completed": False})
    ev.update(_with_default_nets(league, nets))
    return ev


def _golf(league, e):
    c = (e.get("competitions") or [{}])[0]
    ev = _base(league, e, c)
    comps = sorted(c.get("competitors") or [], key=lambda x: x.get("order") or 999)
    leaders = []
    for x in comps[:5]:
        a, t = x.get("athlete") or {}, x.get("team") or {}
        leaders.append({"name": a.get("displayName") or t.get("displayName") or "",
                        "flag": _flag(a) or t.get("logo") or "", "score": x.get("score") or ""})
    ev.update(_status(c))
    ev.update({"leaders": leaders})
    ev.update(_with_default_nets(league, _nets(c)))
    return ev


def _with_default_nets(league, nets):
    seen, out = set(), []
    for n in nets:
        if n["name"] not in seen:
            seen.add(n["name"])
            out.append(n)
    if out:
        return {"nets": out, "netsGuess": False}
    return {"nets": [{"name": n, "market": "National"} for n in DEFAULT_NETS.get(league["sport"], [])],
            "netsGuess": True}


NORMALIZERS = {"match": _match, "tennis": _tennis, "fights": _fights, "race": _race, "golf": _golf}


# ---------- public API ----------
def _ttl_for(date_str):
    d = datetime.strptime(date_str, "%Y%m%d").date()
    today = datetime.now(timezone.utc).date()
    if abs((d - today).days) <= 1:
        return 30
    return 3600 if d < today else 600


def league_day(league, date_str):
    url = f"{API}/{league['path']}/scoreboard?dates={date_str}{league['query']}"
    data = fetch_json(url, _ttl_for(date_str))
    out = []
    for e in data.get("events") or []:
        try:
            out.append(NORMALIZERS[league["kind"]](league, e))
        except Exception:
            continue  # one malformed event shouldn't sink the day
    return out


def day(date_str):
    results = list(_pool.map(lambda l: league_day(l, date_str), LEAGUES))
    seen, events = set(), []
    for ev in (e for r in results for e in r):
        # ATP and WTA feeds both return combined tournaments — keep one copy.
        key = ev["uid"] if ev["kind"] != "tennis" else f"tennis:{ev['id']}"
        if key in seen:
            continue
        seen.add(key)
        events.append(ev)
    return events


def _ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _when(sport, p):
    per = p.get("period") or {}
    n = per.get("number") or 0
    clock = (p.get("clock") or {}).get("displayValue") or ""
    if sport in ("mlb", "cbase"):
        return f"{'Top' if per.get('type') == 'Top' else 'Bot'} {_ordinal(n)}" if n else ""
    if sport == "nhl":
        label = f"P{n}" if n <= 3 else ("OT" if n == 4 else "SO")
    elif sport == "cbb":
        label = f"H{n}" if n <= 2 else f"OT{n - 2 if n > 3 else ''}"
    else:  # nba, wnba, nfl, cfb
        label = f"Q{n}" if n <= 4 else "OT"
    return f"{label} {clock}".strip()


def plays(league_id, event_id):
    league = LEAGUE_BY_ID.get(league_id)
    if not league or league["sport"] not in PLAYS_SPORTS:
        return []
    d = fetch_json(f"{API}/{league['path']}/summary?event={event_id}", 20)
    sport = league["sport"]
    out = []
    if sport == "soccer":
        for k in d.get("commentary") or d.get("keyEvents") or []:
            text = k.get("text") or ""
            when = (k.get("time") or k.get("clock") or {}).get("displayValue") or ""
            if text:
                out.append({"text": text, "when": when, "scoring": text.startswith("Goal")})
        return out[::-1]

    raw = d.get("plays") or []
    if sport in ("nfl", "cfb"):
        drives = d.get("drives") or {}
        seq = list(drives.get("previous") or [])
        if drives.get("current"):
            seq.append(drives["current"])
        ids, raw = set(), []
        for dr in seq:
            for p in dr.get("plays") or []:
                if p.get("id") not in ids:
                    ids.add(p.get("id"))
                    raw.append(p)

    for p in raw:
        text = p.get("text") or ""
        ptype = (p.get("type") or {}).get("type") or ""
        if not text:
            continue
        if sport in ("mlb", "cbase") and (text.startswith("Pitch ") or ptype in ("start-batterpitcher", "end-batterpitcher")):
            continue  # pitch-by-pitch is noise; keep at-bat results
        out.append({"text": text, "when": _when(sport, p), "scoring": bool(p.get("scoringPlay")),
                    "away": p.get("awayScore"), "home": p.get("homeScore"),
                    "team": (p.get("team") or {}).get("id")})
    return out[::-1][:600]  # newest first


def config():
    return {
        "sports": [{"id": s, "name": n} for s, n in SPORTS],
        "leagues": [{"id": l["id"], "name": l["name"], "sport": l["sport"], "kind": l["kind"]} for l in LEAGUES],
    }
