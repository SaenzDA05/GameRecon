"""Rebuild teams.json (the favorites picker list) from ESPN.

ESPN's /teams endpoint doesn't send CORS headers, so the browser can't call it
directly; we snapshot it here instead. Re-run when leagues add/rename teams:

    python scripts/update_teams.py
"""
import json
import pathlib
import urllib.request

LEAGUES = {
    "mlb": "baseball/mlb",
    "nfl": "football/nfl",
    "nba": "basketball/nba",
    "nhl": "hockey/nhl",
    "wnba": "basketball/wnba",
    "mls": "soccer/usa.1",
    "epl": "soccer/eng.1",
    "cfb": "football/college-football",
    "cbb": "basketball/mens-college-basketball",
    "cbase": "baseball/college-baseball",
    "ucl": "soccer/uefa.champions",
    "laliga": "soccer/esp.1",
    "ligamx": "soccer/mex.1",
    "seriea": "soccer/ita.1",
    "bundesliga": "soccer/ger.1",
    "ligue1": "soccer/fra.1",
    "nwsl": "soccer/usa.nwsl",
}
EXTRA = {"cfb": "&groups=80"}  # FBS only

out = {}
for lid, path in LEAGUES.items():
    url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/teams?limit=1000{EXTRA.get(lid, '')}"
    data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})))
    teams = data["sports"][0]["leagues"][0]["teams"]
    out[lid] = sorted(
        ({"id": t["team"]["id"], "name": t["team"]["displayName"], "logo": (t["team"].get("logos") or [{}])[0].get("href", "")} for t in teams),
        key=lambda t: t["name"],
    )
    print(f"{lid}: {len(out[lid])} teams")

dest = pathlib.Path(__file__).resolve().parent.parent / "public" / "teams.json"
dest.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print("wrote", dest)
