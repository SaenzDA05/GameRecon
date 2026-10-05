// GameRecon — every game, where to watch it, and live play-by-play.
// Data comes from our server (/api/*), which wraps ESPN's public feeds.

// ---------- config (filled at boot from /api/config) ----------
let SPORTS = [], LEAGUES = [], SPORT_BY_ID = {}, LEAGUE_BY_ID = {};
const SPORT_ICON = {
  nfl: "🏈", cfb: "🏈", nba: "🏀", wnba: "🏀", cbb: "🏀", mlb: "⚾", cbase: "⚾", nhl: "🏒",
  soccer: "⚽", ufc: "🥊", f1: "🏎️", nascar: "🏁", tennis: "🎾", golf: "⛳",
};
const SESSION_NAME = { FP1: "Practice 1", FP2: "Practice 2", FP3: "Practice 3", Qual: "Qualifying", SS: "Sprint Qualifying", SR: "Sprint", Race: "Race" };

// ---------- state ----------
const state = {
  view: "today",
  sport: "all",
  search: "",
  selectedDate: startOfDay(new Date()),
  calMonth: startOfMonth(new Date()),
  user: null,
  prefs: loadGuestPrefs(),
};

// ---------- date helpers ----------
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }
function sameDay(a, b) { return a && b && ymd(a) === ymd(b); }
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
const fmtShortDay = (d) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

// ---------- tiny utils ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ---------- preferences ----------
// Guests keep prefs in localStorage; signed-in users keep them on their account.
function blankPrefs() { return { favorites: new Set(), favNames: {}, sportOrder: null, area: "" }; }
function prefsFromJSON(p) {
  return { favorites: new Set(p?.favorites || []), favNames: p?.favNames || {}, sportOrder: p?.sportOrder || null, area: p?.area || "" };
}
function prefsToJSON(p) {
  return { favorites: [...p.favorites], favNames: p.favNames, sportOrder: p.sportOrder, area: p.area };
}
function loadGuestPrefs() {
  try {
    const raw = localStorage.getItem("gt:prefs");
    if (raw) return prefsFromJSON(JSON.parse(raw));
    const legacy = JSON.parse(localStorage.getItem("gt:favorites") || "[]"); // v1 format
    return prefsFromJSON({ favorites: legacy });
  } catch { return blankPrefs(); }
}
let saveTimer;
function savePrefs() {
  if (!state.user) {
    try { localStorage.setItem("gt:prefs", JSON.stringify(prefsToJSON(state.prefs))); } catch {}
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api("/api/me", { method: "PUT", body: { prefs: prefsToJSON(state.prefs) } }).catch(() => {}), 300);
}

const teamKey = (league, id) => `${league}:${id}`;
const playerKey = (sport, id) => `${sport}:p${id}`;
const isFav = (k) => state.prefs.favorites.has(k);
function toggleFav(k, name) {
  const f = state.prefs.favorites;
  if (f.has(k)) { f.delete(k); delete state.prefs.favNames[k]; }
  else { f.add(k); if (name) state.prefs.favNames[k] = name; }
  savePrefs();
}

function sportOrder() {
  const pop = popularOrder(state.prefs.area).filter((s) => SPORT_BY_ID[s]);
  const rest = SPORTS.map((s) => s.id).filter((s) => !pop.includes(s));
  const base = [...pop, ...rest];
  const custom = (state.prefs.sportOrder || []).filter((s) => SPORT_BY_ID[s]);
  return custom.length ? [...custom, ...base.filter((s) => !custom.includes(s))] : base;
}

// ---------- data ----------
const dayCache = new Map();

function hydrate(ev) {
  ev.date = ev.date ? new Date(ev.date) : null;
  for (const list of [ev.matches, ev.fights, ev.sessions]) for (const x of list || []) x.date = x.date ? new Date(x.date) : null;
  return ev;
}

function fetchDay(date, { fresh = false } = {}) {
  const k = ymd(date);
  const hit = dayCache.get(k);
  if (hit && !fresh && Date.now() - hit.t < 60_000) return hit.p;
  const p = api(`/api/day?date=${k}`).then((d) => d.events.map(hydrate)).catch(() => (hit ? hit.p : []));
  dayCache.set(k, { t: Date.now(), p });
  return p;
}

function rollup(parts) {
  const s = parts.map((p) => p.state);
  return s.includes("in") ? "in" : s.length && s.every((x) => x === "post") ? "post" : "pre";
}
const minDate = (xs) => xs.reduce((m, x) => (x.date && (!m || x.date < m) ? x.date : m), null);

// Multi-day events (tennis tournaments, race weekends) only show the parts on that day.
function forDay(events, d) {
  const out = [];
  for (const ev of events) {
    if (ev.kind === "tennis") {
      const ms = ev.matches.filter((m) => sameDay(m.date, d));
      if (ms.length) out.push({ ...ev, matches: ms, start: minDate(ms), state: rollup(ms) });
    } else if (ev.kind === "fights") {
      if (ev.fights.some((f) => sameDay(f.date, d))) out.push({ ...ev, start: minDate(ev.fights) });
    } else if (ev.kind === "race") {
      const ss = ev.sessions.filter((s) => sameDay(s.date, d));
      if (ss.length) out.push({ ...ev, today: ss.map((s) => s.id), start: minDate(ss), state: rollup(ss) });
    } else {
      out.push({ ...ev, start: ev.date });
    }
  }
  return out;
}

function applyFilters(events) {
  const q = state.search.trim().toLowerCase();
  const hit = (s) => s && s.toLowerCase().includes(q);
  const res = [];
  for (const ev of events) {
    if (state.sport !== "all" && ev.sport !== state.sport) continue;
    if (!q) { res.push(ev); continue; }
    if (hit(ev.name) || [ev.home, ev.away].some((t) => t && (hit(t.name) || hit(t.abbr)))) { res.push(ev); continue; }
    if (ev.matches) {
      const ms = ev.matches.filter((m) => m.players.some((p) => hit(p.name)));
      if (ms.length) res.push({ ...ev, matches: ms });
    } else if (ev.fights?.some((f) => f.fighters.some((p) => hit(p.name)))) res.push(ev);
  }
  return res;
}

// ---------- teams index (names/logos for the picker & profile) ----------
let teamsPromise;
const teamIndex = new Map();
function loadTeams() {
  teamsPromise ??= fetch("teams.json").then((r) => r.json()).catch(() => ({})).then((all) => {
    for (const [lid, teams] of Object.entries(all)) for (const t of teams) teamIndex.set(teamKey(lid, t.id), t);
    return all;
  });
  return teamsPromise;
}

// ---------- where to watch ----------
function watchOptions(ev) {
  const groups = ev.nets.map((n) => {
    const where =
      n.market === "Home" && ev.home ? `Local · ${ev.home.short} area` :
      n.market === "Away" && ev.away ? `Local · ${ev.away.short} area` : "National";
    return { network: n.name, where, local: n.market === "Home" || n.market === "Away", options: servicesForNetwork(n.name) };
  });
  const oom = OUT_OF_MARKET[ev.league];
  if (oom && groups.length && groups.every((g) => g.local)) {
    groups.push({ network: "Outside the local area", where: "Out-of-market", options: [{ key: oom, ...SERVICES[oom] }] });
  }
  const priced = groups.flatMap((g) => g.options).filter((o) => o.price != null);
  const cheapest = [...priced].sort((a, b) => a.price - b.price)[0];
  const shown = new Set();
  for (const g of groups) {
    g.repeats = g.options.filter((o) => shown.has(o.key)).map((o) => o.name);
    g.options = g.options.filter((o) => !shown.has(o.key));
    g.options.forEach((o) => shown.add(o.key));
  }
  return { groups, cheapest };
}

function watchBox(ev) {
  const { groups, cheapest } = watchOptions(ev);
  if (!groups.length) {
    return `<div class="watch-box"><div class="box-title">Where To Watch</div>
      <div class="watch-empty">Broadcast not announced yet. Check back closer to game time.</div></div>`;
  }
  const cheapestTxt = cheapest ? (cheapest.price === 0 ? "Free option" : `From ~$${cheapest.price.toFixed(2)}/mo`) : "";
  return `
    <div class="watch-box">
      <div class="box-title"><span>Where To Watch</span><span class="cheapest">${cheapestTxt}</span></div>
      ${ev.netsGuess ? `<div class="guess-note">Usual broadcaster — confirm closer to the event</div>` : ""}
      ${groups.map((g) => `
        <div class="net">
          <div class="net-head"><span class="net-name">${esc(g.network)}</span><span class="net-market">${esc(g.where)}</span></div>
          ${g.options.map((o) => `
            <a class="opt" href="${esc(o.url)}" target="_blank" rel="noopener">
              <span class="opt-name">${esc(o.name)}</span>
              <span class="opt-price ${o.kind === "free" ? "free" : ""}">${esc(priceLabel(o))}</span>
              <span class="opt-sub"><span class="kind ${o.kind}">${KIND_LABEL[o.kind]}</span>${esc(o.note || "")}</span>
            </a>`).join("")}
          ${g.repeats.length ? `<div class="opt-sub">Also on ${esc(g.repeats.join(", "))} (above)</div>` : ""}
        </div>`).join("")}
    </div>`;
}

// ---------- play-by-play ----------
const playsCache = new Map();   // "league:id" -> { t, plays }
const pbpEvents = new Map();    // "league:id" -> event (for team abbreviations / live state)
const pbpOpen = new Set();      // expanded boxes
const pbpInflight = new Set();

function pbpBox(ev) {
  const key = `${ev.league}:${ev.id}`;
  pbpEvents.set(key, ev);
  return `<div class="pbp" data-pbp="${esc(key)}">${pbpInner(key)}</div>`;
}

function pbpInner(key) {
  const ev = pbpEvents.get(key);
  const live = ev?.state === "in" ? `<span class="live-dot">● Live</span>` : "";
  const head = `<div class="box-title"><span>Play-by-Play</span>${live}</div>`;
  const c = playsCache.get(key);
  if (!c) return `${head}<div class="muted small">Loading plays…</div>`;
  if (!c.plays.length) return `${head}<div class="muted small">No plays posted yet.</div>`;
  const open = pbpOpen.has(key);
  const shown = open ? c.plays : c.plays.slice(0, 3);
  return `${head}
    <ol class="pbp-list ${open ? "open" : ""}" ${open ? "" : `data-pbp-toggle="${esc(key)}" title="See all plays"`}>
      ${shown.map((p) => playRow(p, ev)).join("")}
    </ol>
    ${c.plays.length > 3 ? `<button type="button" class="pbp-toggle" data-pbp-toggle="${esc(key)}">
      ${open ? "Show less ▴" : `See all ${c.plays.length} plays ▾`}</button>` : ""}`;
}

function playRow(p, ev) {
  const score = p.away != null && p.home != null && ev?.home
    ? `<span class="pscore">${esc(ev.away.abbr || "AWY")} ${p.away} – ${p.home} ${esc(ev.home.abbr || "HOM")}</span>` : "";
  return `<li class="play ${p.scoring ? "scoring" : ""}">
    <span class="when">${esc(p.when)}</span>
    <span class="ptext">${esc(p.text.trim())}</span>${score}</li>`;
}

async function loadPlays(key, { force = false } = {}) {
  const ev = pbpEvents.get(key);
  const c = playsCache.get(key);
  const maxAge = ev?.state === "in" ? 25_000 : Infinity;
  if (c && !force && Date.now() - c.t < maxAge) return paintPbp(key);
  if (pbpInflight.has(key)) return;
  pbpInflight.add(key);
  try {
    const [league, id] = key.split(":");
    const d = await api(`/api/plays?league=${league}&id=${id}`);
    playsCache.set(key, { t: Date.now(), plays: d.plays });
  } catch {
    if (!c) playsCache.set(key, { t: Date.now(), plays: [] });
  } finally {
    pbpInflight.delete(key);
  }
  paintPbp(key);
}

function paintPbp(key) {
  document.querySelectorAll(`.pbp[data-pbp="${CSS.escape(key)}"]`).forEach((el) => {
    const scroll = el.querySelector(".pbp-list")?.scrollTop;
    el.innerHTML = pbpInner(key);
    const list = el.querySelector(".pbp-list");
    if (list && scroll) list.scrollTop = scroll;
  });
}

// Live refreshes re-render cards; keep any open play list where the reader left it.
function keepPbpScroll(fn) {
  const saved = [...document.querySelectorAll(".pbp")].map((el) => [el.dataset.pbp, el.querySelector(".pbp-list.open")?.scrollTop]).filter(([, s]) => s);
  fn();
  for (const [k, s] of saved) {
    document.querySelectorAll(`.pbp[data-pbp="${CSS.escape(k)}"] .pbp-list.open`).forEach((l) => { l.scrollTop = s; });
  }
}

// Only fetch plays for boxes that scroll into view.
const pbpObserver = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) loadPlays(en.target.dataset.pbp);
}, { rootMargin: "300px" });
function observePbp() {
  pbpObserver.disconnect();
  document.querySelectorAll(".pbp").forEach((el) => pbpObserver.observe(el));
}

// ---------- cards ----------
function timeLabel(ev, { showDate = false } = {}) {
  const when = ev.start || ev.date;
  if (ev.state === "in") return `<span class="badge live">Live</span>${ev.statusText ? ` <span class="time">${esc(ev.statusText)}</span>` : ""}`;
  if (ev.state === "post") return `<span class="badge">${esc(ev.statusText || "Final")}</span>`;
  if (!when) return "";
  return `<span class="time">${showDate ? fmtShortDay(when) + " · " : ""}${ev.timeTBD ? "TBD" : fmtTime(when)}</span>`;
}

function star(k, name) {
  const on = isFav(k);
  return `<button type="button" class="star-btn ${on ? "on" : ""}" title="${on ? "Unpin" : "Pin"} ${esc(name)}" data-fav="${esc(k)}" data-name="${esc(name)}">★</button>`;
}

function cardShell(ev, main, opts = {}) {
  const favGame = opts.pinned;
  return `
    <article class="game ${favGame ? "is-pinned" : ""} ${ev.state === "in" ? "is-live" : ""}">
      <div class="game-main">
        <div class="game-meta">
          ${timeLabel(ev, opts)}
          <span class="badge">${esc(LEAGUE_BY_ID[ev.league]?.name || "")}</span>
          ${ev.note ? `<span class="badge note">${esc(ev.note)}</span>` : ""}
        </div>
        ${main}
        <div class="venue muted">${esc(ev.venue)}${ev.link ? `${ev.venue ? " · " : ""}<a class="game-link" href="${esc(ev.link)}" target="_blank" rel="noopener">Details</a>` : ""}</div>
      </div>
      <aside class="side">
        ${watchBox(ev)}
        ${ev.plays ? pbpBox(ev) : ""}
      </aside>
    </article>`;
}

function matchCard(ev, opts) {
  const row = (t) => {
    const showScore = ev.state !== "pre" && t.score != null;
    const loser = ev.completed && t.winner === false;
    const other = t === ev.home ? ev.away : ev.home;
    const trailing = ev.state === "in" && Number(t.score) < Number(other.score);
    return `
      <div class="team ${loser ? "loser" : ""} ${trailing ? "trailing" : ""}">
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="logo-ph"></span>`}
        <span class="team-name">${esc(t.name)}</span>
        <span class="team-rec">${esc(t.record)}</span>
        ${star(teamKey(ev.league, t.id), t.name)}
        ${showScore ? `<span class="team-score">${esc(t.score)}</span>` : ""}
      </div>`;
  };
  return cardShell(ev, `<div class="teams">${row(ev.away)}${row(ev.home)}</div>`, opts);
}

function sideBySide(players, sport, { sets = false } = {}) {
  return players.map((p) => `
    <div class="mplayer ${p.winner ? "win" : ""}">
      ${p.flag ? `<img src="${esc(p.flag)}" alt="" loading="lazy">` : `<span class="logo-ph sm"></span>`}
      <span class="pname">${esc(p.name)}</span>
      ${p.record ? `<span class="team-rec">${esc(p.record)}</span>` : ""}
      ${p.id ? star(playerKey(sport, p.id), p.name) : ""}
      ${sets && p.sets.length ? `<span class="sets">${p.sets.map((s) => `<b>${s}</b>`).join("")}</span>` : ""}
    </div>`).join("");
}

function subStatus(x) {
  if (x.state === "in") return `<span class="badge live">Live</span>`;
  if (x.state === "post") return `<span class="badge">${esc(x.statusText || "Final")}</span>`;
  return `<span class="time">${x.date ? fmtTime(x.date) : "TBD"}</span>`;
}

const stateRank = { in: 0, pre: 1, post: 2 };
function collapsible(uid, rows, limit, noun) {
  if (rows.length <= limit) return rows.join("");
  const open = pbpOpen.has(uid);
  return `<div class="more-wrap ${open ? "open" : ""}">${rows.map((r, i) => (i < limit ? r : `<div class="more-item">${r}</div>`)).join("")}</div>
    <button type="button" class="more-btn" data-more="${esc(uid)}" data-label="Show all ${rows.length} ${noun} ▾">${open ? "Show fewer ▴" : `Show all ${rows.length} ${noun} ▾`}</button>`;
}

function tennisCard(ev, opts) {
  const ms = [...ev.matches].sort((a, b) => stateRank[a.state] - stateRank[b.state] || (a.date || 0) - (b.date || 0));
  const rows = ms.map((m) => `
    <div class="mrow">
      <div class="mmeta">${subStatus(m)} <span class="muted">${esc([m.draw, m.round].filter(Boolean).join(" · "))}</span></div>
      ${sideBySide(m.players, "tennis", { sets: true })}
    </div>`);
  return cardShell(ev, `<h3 class="ev-title">${esc(ev.name)}</h3>${collapsible(ev.uid + ymd(ev.start || new Date()), rows, opts.pinned ? 3 : 5, "matches")}`, opts);
}

function fightsCard(ev, opts) {
  const rows = ev.fights.map((f, i) => `
    <div class="mrow">
      <div class="mmeta">${i === 0 && !opts.pinned ? `<span class="badge note">Main Event</span>` : ""}${subStatus(f)} <span class="muted">${esc(f.weight)}</span></div>
      ${sideBySide(f.fighters, "ufc")}
    </div>`);
  return cardShell(ev, `<h3 class="ev-title">${esc(ev.name)}</h3>${collapsible(ev.uid, rows, opts.pinned ? 3 : 4, "fights")}`, opts);
}

function raceCard(ev, opts) {
  const rows = ev.sessions.map((s) => `
    <div class="srow ${ev.today?.includes(s.id) ? "today" : ""}">
      <span class="sname">${esc(SESSION_NAME[s.name] || s.name)}</span>
      <span class="muted">${s.date ? `${fmtShortDay(s.date)} · ${fmtTime(s.date)}` : ""}</span>
      ${s.state !== "pre" ? subStatus(s) : ""}
      ${s.top.length && s.state === "post" ? `<span class="podium">${s.top.map((t, i) => `<span>${i + 1}. ${esc(t.name)}</span>`).join("")}</span>` : ""}
    </div>`).join("");
  return cardShell(ev, `<h3 class="ev-title">${esc(ev.name)}</h3><div class="sessions">${rows}</div>`, opts);
}

function golfCard(ev, opts) {
  const rows = ev.leaders.length ? `<div class="leaders">${ev.leaders.map((l, i) => `
    <div class="lrow"><span class="pos">${i + 1}</span>${l.flag ? `<img src="${esc(l.flag)}" alt="">` : ""}<span class="pname">${esc(l.name)}</span><b>${esc(l.score)}</b></div>`).join("")}</div>`
    : `<div class="muted small">Leaderboard appears once play starts.</div>`;
  return cardShell(ev, `<h3 class="ev-title">${esc(ev.name)}</h3>${rows}`, opts);
}

const CARD = { match: matchCard, tennis: tennisCard, fights: fightsCard, race: raceCard, golf: golfCard };
const card = (ev, opts = {}) => CARD[ev.kind](ev, opts);
const byStart = (a, b) => (a.start || 0) - (b.start || 0);
// Live games float to the top, then upcoming, then finished.
const byLiveThenStart = (a, b) => stateRank[a.state] - stateRank[b.state] || byStart(a, b);

function renderSections(events) {
  return sportOrder().map((sid) => {
    const evs = events.filter((e) => e.sport === sid).sort(byLiveThenStart);    if (!evs.length) return "";
    const sp = SPORT_BY_ID[sid];
    let body;
    if (sid === "soccer" || sid === "golf") {
      body = LEAGUES.filter((l) => l.sport === sid).map((l) => {
        const le = evs.filter((e) => e.league === l.id);
        return le.length ? `<div class="sub-head">${esc(l.name)} <span class="muted small">${le.length}</span></div>
          <div class="game-list">${le.map((e) => card(e)).join("")}</div>` : "";
      }).join("");
    } else {
      body = `<div class="game-list">${evs.map((e) => card(e)).join("")}</div>`;
    }
    return `<section class="sport-sec">
      <div class="league-head"><span class="sport-icon">${SPORT_ICON[sid] || "•"}</span>${esc(sp.name)}
        <span class="muted small">${plural(evs.length, sid === "tennis" || sid === "golf" ? "event" : sid === "f1" || sid === "nascar" ? "race weekend" : "game")}</span></div>
      ${body}</section>`;
  }).join("");
}

const emptyMsg = () => `<div class="empty">No games found${state.sport !== "all" ? ` for ${esc(SPORT_BY_ID[state.sport].name)}` : ""}${state.search ? ` matching “${esc(state.search)}”` : ""}.</div>`;

// ---------- views ----------
let renderToken = 0;
async function render({ fresh = false } = {}) {
  const token = ++renderToken;
  const el = $("#games");
  $("#calendarPanel").hidden = state.view !== "calendar";
  if (state.view === "calendar") renderCalendar();
  const today = startOfDay(new Date());
  if (!fresh) el.innerHTML = `<div class="loading">Loading games…</div>`;

  let html;
  if (state.view === "week") {
    $("#viewTitle").textContent = "This Week";
    $("#viewSub").textContent = `${fmtShortDay(today)} – ${fmtShortDay(addDays(today, 6))}`;
    const days = await Promise.all(Array.from({ length: 7 }, (_, i) => fetchDay(addDays(today, i), { fresh: fresh && i < 2 })));
    if (token !== renderToken) return;
    html = days.map((evs, i) => {
      const d = addDays(today, i);
      const list = applyFilters(forDay(evs, d));
      if (!list.length) return "";
      return `<div class="day-head">${i === 0 ? "Today · " : i === 1 ? "Tomorrow · " : ""}${fmtDay(d)}</div>${renderSections(list)}`;
    }).join("");
  } else {
    const d = state.view === "today" ? today : state.selectedDate;
    const list = applyFilters(forDay(await fetchDay(d, { fresh }), d));
    if (token !== renderToken) return;
    $("#viewTitle").textContent = sameDay(d, today) ? "Today" : fmtDay(d);
    $("#viewSub").textContent = `${sameDay(d, today) ? fmtDay(d) + " · " : ""}${plural(list.length, "event")}`;
    html = renderSections(list);
  }
  keepPbpScroll(() => { el.innerHTML = html || emptyMsg(); });
  observePbp();
}

async function renderPinned({ fresh = false } = {}) {
  const section = $("#pinned");
  const favs = state.prefs.favorites;
  if (!favs.size) { section.hidden = true; return; }
  section.hidden = false;
  const today = startOfDay(new Date());
  const days = await Promise.all(Array.from({ length: 7 }, (_, i) => fetchDay(addDays(today, i), { fresh: fresh && i < 2 })));

  const picked = new Set();
  const items = new Map(); // event uid+day -> item
  days.forEach((evs, i) => {
    const d = addDays(today, i);
    for (const ev of forDay(evs, d).sort(byStart)) {
      if (ev.state === "post" && i > 0) continue;
      const take = (k) => favs.has(k) && !picked.has(k) && picked.add(k);
      if (ev.kind === "match") {
        if ([ev.home, ev.away].map((t) => take(teamKey(ev.league, t.id))).some(Boolean)) items.set(ev.uid, ev);
      } else if (ev.kind === "tennis" || ev.kind === "fights") {
        const list = ev.kind === "tennis" ? ev.matches : ev.fights;
        const people = ev.kind === "tennis" ? "players" : "fighters";
        const mine = list.filter((m) => m.state !== "post" || i === 0)
          .filter((m) => m[people].map((p) => take(playerKey(ev.sport, p.id))).some(Boolean));
        if (mine.length) {
          const key = ev.uid + i;
          const prev = items.get(key);
          const merged = [...(prev ? prev[ev.kind === "tennis" ? "matches" : "fights"] : []), ...mine];
          items.set(key, { ...ev, [ev.kind === "tennis" ? "matches" : "fights"]: merged, start: minDate(merged) });
        }
      }
    }
  });
  const list = [...items.values()].sort(byStart);
  keepPbpScroll(() => {
    $("#pinnedList").innerHTML = list.length
      ? list.map((ev) => card(ev, { showDate: true, pinned: true })).join("")
      : `<div class="empty">None of your pinned teams or players are scheduled in the next 7 days.</div>`;
  });
  observePbp();
}

function renderChips() {
  const items = [{ id: "all", name: "All" }, ...sportOrder().map((id) => SPORT_BY_ID[id])];
  $("#sportChips").innerHTML = items.map((s) =>
    `<button class="chip ${state.sport === s.id ? "active" : ""}" data-sport="${s.id}">${s.id === "all" ? "" : SPORT_ICON[s.id] + " "}${esc(s.name)}</button>`).join("");
  const { region, guessed } = regionFor(state.prefs.area);
  $("#orderHint").innerHTML = state.prefs.sportOrder
    ? `Showing sports in <b>your order</b>.`
    : `Sports ordered by what's popular in <b>${REGION_LABEL[region]}</b>${guessed ? " (from your time zone)" : ""} · <a href="#" data-open-order>change</a>`;
}

function renderCalendar() {
  const m = state.calMonth;
  $("#calTitle").textContent = m.toLocaleDateString([], { month: "long", year: "numeric" });
  const start = addDays(m, -m.getDay());
  const today = startOfDay(new Date());
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = addDays(start, i);
    const cls = ["cal-day", d.getMonth() !== m.getMonth() && "other", sameDay(d, today) && "today", sameDay(d, state.selectedDate) && "selected"].filter(Boolean).join(" ");
    return `<button class="${cls}" data-date="${d.toISOString()}">${d.getDate()}</button>`;
  }).join("");
  $("#calGrid").innerHTML = dows + days;
}

function rerenderAll(opts) { renderChips(); render(opts); renderPinned(opts); }

// ---------- team picker ----------
let pickerLeague = "mlb";
async function renderTeamPicker() {
  const all = await loadTeams();
  const leagues = LEAGUES.filter((l) => all[l.id]?.length);
  $("#teamLeagueChips").innerHTML = leagues.map((l) =>
    `<button type="button" class="chip ${pickerLeague === l.id ? "active" : ""}" data-pick-league="${l.id}">${esc(l.name)}</button>`).join("");
  const q = $("#teamSearch").value.trim().toLowerCase();
  const teams = (all[pickerLeague] || []).filter((t) => !q || t.name.toLowerCase().includes(q)).slice(0, 400);
  $("#teamGrid").innerHTML = teams.map((t) => {
    const k = teamKey(pickerLeague, t.id);
    return `<button type="button" class="team-pick ${isFav(k) ? "on" : ""}" data-fav="${esc(k)}" data-name="${esc(t.name)}">
      ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ""}${esc(t.name)}<span class="s">★</span></button>`;
  }).join("") || `<div class="muted">No teams found.</div>`;
  $("#teamsSaveNote").textContent = state.user ? "Saved to your account" : "Saved on this device · sign in to sync";
}

// ---------- accounts ----------
// Modes: login | signup | forgot (email me a link) | reset (arrived from the emailed link)
let authMode = "login";
let resetToken = null;
const AUTH_COPY = {
  login:  { submit: "Sign in",          blurb: "Sign in to sync your teams and sport order on every device." },
  signup: { submit: "Create account",   blurb: "Create an account to keep your pinned teams and sport order on every device." },
  forgot: { submit: "Send reset link",  blurb: "Enter your account email and we'll send you a link to choose a new password." },
  reset:  { submit: "Save new password", blurb: "Choose a new password. You'll be signed out on your other devices." },
};
function setAuthMode(mode) {
  authMode = mode;
  const f = $("#authForm");
  document.querySelectorAll(".seg [data-auth-mode]").forEach((b) => b.classList.toggle("active", b.dataset.authMode === mode));
  $(".seg").hidden = mode === "reset";
  $("#nameField").hidden = mode !== "signup";
  $("#emailField").hidden = mode === "reset";
  $("#pwField").hidden = mode === "forgot";
  $("#pw2Field").hidden = mode !== "reset";
  $("#pwHint").hidden = !(mode === "signup" || mode === "reset");
  $("#pwLabel").textContent = mode === "reset" ? "New password" : "Password";
  f.password.autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#forgotLink").hidden = mode !== "login";
  $("#backToLogin").hidden = mode !== "forgot";
  $("#authSubmit").hidden = false;
  $("#authSubmit").textContent = AUTH_COPY[mode].submit;
  $("#authBlurb").textContent = AUTH_COPY[mode].blurb;
  $("#authError").textContent = "";
  $("#authOk").hidden = true;
}
function openAuth(mode = "login") {
  setAuthMode(mode);
  if (!$("#authDialog").open) $("#authDialog").showModal();
  (mode === "reset" ? $("#authForm").password : $("#authForm").email).focus();
}

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = (m) => { $("#authError").textContent = m; };
  const email = f.email.value.trim();
  const pw = f.password.value;
  let path, body;
  if (authMode === "forgot") {
    if (!email) return err("Enter your email.");
    path = "forgot"; body = { email };
  } else if (authMode === "reset") {
    if (pw.length < 8) return err("Password must be at least 8 characters.");
    if (pw !== f.password2.value) return err("Passwords don't match.");
    path = "reset"; body = { token: resetToken, password: pw };
  } else {
    if (!email || !pw) return err("Enter your email and password.");
    if (authMode === "signup" && pw.length < 8) return err("Password must be at least 8 characters.");
    path = authMode; body = { email, password: pw, prefs: prefsToJSON(state.prefs) };
    if (authMode === "signup") body.name = f.name.value.trim();
  }
  err("");
  $("#authSubmit").disabled = true;
  try {
    const data = await api(`/api/auth/${path}`, { method: "POST", body });
    if (authMode === "forgot") {
      $("#authOk").textContent = `If an account exists for ${email}, a reset link is on its way. Check your inbox (and spam) — it expires in 1 hour.`;
      $("#authOk").hidden = false;
      $("#authSubmit").hidden = true;
      return;
    }
    resetToken = null;
    setUser(data.user);
    f.reset();
    $("#authDialog").close();
  } catch (ex) {
    err(ex.message);
  } finally {
    $("#authSubmit").disabled = false;
  }
});

function setUser(user) {
  state.user = user;
  state.prefs = user ? prefsFromJSON(user.prefs) : loadGuestPrefs();
  updateAuthBtn();
  rerenderAll();
}

function initials(u) {
  const src = (u.name || u.email).trim();
  return src.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function updateAuthBtn() {
  const b = $("#authBtn");
  if (state.user) b.innerHTML = `<span class="avatar">${esc(initials(state.user))}</span><span class="hide-sm">${esc(state.user.name || "Profile")}</span>`;
  else b.textContent = "Sign in";
}

async function signOut() {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  $("#profileDialog").close();
  setUser(null);
}

// ---------- profile ----------
function renderProfile() {
  const u = state.user;
  $("#pfAccount").innerHTML = u ? `
    <div class="pf-user">
      <span class="avatar lg">${esc(initials(u))}</span>
      <div class="pf-user-info">
        <label class="field compact"><span>Name</span><input id="pfName" value="${esc(u.name)}" maxlength="60"></label>
        <div class="muted small">${esc(u.email)}</div>
      </div>
      <button type="button" class="btn" id="signOut">Sign out</button>
    </div>` : `
    <div class="pf-guest">
      <div><b>You're browsing as a guest.</b><div class="muted small">Your picks are saved on this device. Create an account to keep them everywhere.</div></div>
      <div class="pf-guest-btns">
        <button type="button" class="btn btn-primary" data-auth-open="signup">Create account</button>
        <button type="button" class="btn" data-auth-open="login">Sign in</button>
      </div>
    </div>`;

  const { region } = regionFor("");
  const opts = [`<option value="">Automatic — ${esc(REGION_LABEL[region])} (time zone)</option>`,
    ...STATES.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`),
    `<option value="CAN">Canada</option>`, `<option value="INTL">Outside North America</option>`];
  $("#areaSelect").innerHTML = opts.join("");
  $("#areaSelect").value = state.prefs.area || "";

  renderOrderList();
  renderFavChips();
}

function renderOrderList() {
  const order = sportOrder();
  const { region } = regionFor(state.prefs.area);
  $("#orderMode").textContent = state.prefs.sportOrder
    ? "Your custom order. Use the arrows to move a sport up or down."
    : `No preference set — using what's popular in ${REGION_LABEL[region]}. Move anything to make it yours.`;
  $("#resetOrder").hidden = !state.prefs.sportOrder;
  $("#orderList").innerHTML = order.map((id, i) => `
    <li class="order-item">
      <span class="order-num">${i + 1}</span>
      <span class="order-name">${SPORT_ICON[id] || ""} ${esc(SPORT_BY_ID[id].name)}</span>
      <button type="button" class="icon-btn" data-move="${id}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(SPORT_BY_ID[id].name)} up">▲</button>
      <button type="button" class="icon-btn" data-move="${id}" data-dir="1" ${i === order.length - 1 ? "disabled" : ""} aria-label="Move ${esc(SPORT_BY_ID[id].name)} down">▼</button>
    </li>`).join("");
}

function favLabel(k) {
  const [lid, rest] = k.split(":");
  const t = teamIndex.get(k);
  const name = state.prefs.favNames[k] || t?.name || k;
  const where = rest.startsWith("p") ? SPORT_BY_ID[lid]?.name : LEAGUE_BY_ID[lid]?.name;
  return { name, where, logo: t?.logo };
}
function renderFavChips() {
  const favs = [...state.prefs.favorites];
  $("#favChips").innerHTML = favs.length ? favs.map((k) => {
    const f = favLabel(k);
    return `<span class="fav-chip">${f.logo ? `<img src="${esc(f.logo)}" alt="">` : ""}${esc(f.name)}<span class="muted small">${esc(f.where || "")}</span>
      <button type="button" class="x" data-unfav="${esc(k)}" aria-label="Unpin ${esc(f.name)}">✕</button></span>`;
  }).join("") : `<div class="muted small">Nothing pinned yet. Use ★ My Teams or tap ★ on any team or player.</div>`;
}

async function openProfile(scrollToOrder = false) {
  await loadTeams();
  renderProfile();
  $("#profileDialog").showModal();
  if (scrollToOrder) $("#orderList").scrollIntoView({ block: "center" });
}

$("#areaSelect").addEventListener("change", (e) => { state.prefs.area = e.target.value; savePrefs(); renderOrderList(); rerenderAll(); });
$("#resetOrder").onclick = () => { state.prefs.sportOrder = null; savePrefs(); renderOrderList(); rerenderAll(); };
$("#profileDialog").addEventListener("change", (e) => {
  if (e.target.id === "pfName" && state.user) {
    const name = e.target.value.trim();
    api("/api/me", { method: "PUT", body: { name } }).then(({ user }) => { state.user = user; updateAuthBtn(); }).catch(() => {});
  }
});

// ---------- events ----------
document.addEventListener("click", (e) => {
  const t = e.target;
  const fav = t.closest("[data-fav]");
  if (fav) {
    e.preventDefault();
    toggleFav(fav.dataset.fav, fav.dataset.name);
    if (fav.classList.contains("team-pick")) fav.classList.toggle("on");
    else rerenderAll({ fresh: false });
    return;
  }
  const unfav = t.closest("[data-unfav]");
  if (unfav) { toggleFav(unfav.dataset.unfav); renderFavChips(); rerenderAll(); return; }

  const pbp = t.closest("[data-pbp-toggle]");
  if (pbp) {
    const k = pbp.dataset.pbpToggle;
    pbpOpen.has(k) ? pbpOpen.delete(k) : pbpOpen.add(k);
    paintPbp(k);
    return;
  }
  const more = t.closest("[data-more]");
  if (more) {
    const k = more.dataset.more;
    const wrap = more.previousElementSibling;
    const open = !pbpOpen.has(k);
    open ? pbpOpen.add(k) : pbpOpen.delete(k);
    wrap.classList.toggle("open", open);
    more.textContent = open ? "Show fewer ▴" : more.dataset.label;
    return;
  }

  const tab = t.closest(".tab");
  if (tab) {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === tab));
    state.view = tab.dataset.view;
    render();
    return;
  }
  const chip = t.closest("[data-sport]");
  if (chip) { state.sport = chip.dataset.sport; renderChips(); render(); return; }
  const day = t.closest("[data-date]");
  if (day) { state.selectedDate = startOfDay(new Date(day.dataset.date)); state.calMonth = startOfMonth(state.selectedDate); render(); return; }
  const pl = t.closest("[data-pick-league]");
  if (pl) { pickerLeague = pl.dataset.pickLeague; renderTeamPicker(); return; }

  const move = t.closest("[data-move]");
  if (move) {
    const order = sportOrder();
    const i = order.indexOf(move.dataset.move);
    const j = i + Number(move.dataset.dir);
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    state.prefs.sportOrder = order;
    savePrefs();
    renderOrderList();
    rerenderAll();
    return;
  }
  if (t.closest("[data-open-order]")) { e.preventDefault(); openProfile(true); return; }
  const ao = t.closest("[data-auth-open]");
  if (ao) { $("#profileDialog").close(); openAuth(ao.dataset.authOpen); return; }
  if (t.closest("[data-auth-mode]")) { setAuthMode(t.closest("[data-auth-mode]").dataset.authMode); return; }
  if (t.closest("[data-close]")) { t.closest("dialog").close(); return; }
  if (t.id === "signOut") { signOut(); return; }
});

$("#calPrev").onclick = () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); renderCalendar(); };
$("#calNext").onclick = () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); renderCalendar(); };

let searchTimer;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 150);
});

$("#openTeams").onclick = () => { $("#teamsDialog").showModal(); renderTeamPicker(); };
$("#teamSearch").addEventListener("input", renderTeamPicker);
$("#teamsDialog").addEventListener("close", () => { $("#teamSearch").value = ""; rerenderAll(); });
$("#authBtn").onclick = () => (state.user ? openProfile() : openAuth("login"));
$("#openOrder").onclick = () => openProfile(true);

// ---------- boot ----------
(async function boot() {
  const [cfg, me] = await Promise.all([
    api("/api/config"),
    api("/api/me").catch(() => ({ user: null })),
  ]);
  SPORTS = cfg.sports;
  LEAGUES = cfg.leagues;
  SPORT_BY_ID = Object.fromEntries(SPORTS.map((s) => [s.id, s]));
  LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));
  loadTeams();
  if (me.user) { state.user = me.user; state.prefs = prefsFromJSON(me.user.prefs); }
  updateAuthBtn();
  $("#pricesChecked").textContent = PRICES_CHECKED;
  rerenderAll();

  // Arrived from an emailed reset link: take the token, then strip it from the address bar.
  const params = new URLSearchParams(location.search);
  if (params.has("reset")) {
    resetToken = params.get("reset");
    history.replaceState(null, "", location.pathname);  // keep the token out of history/bookmarks
    openAuth("reset");
  }

  // Live updates: while any game on screen is live, scores + plays refresh every 30s;
  // otherwise check every 2 minutes so games flip to live on their own.
  let tick = 0;
  setInterval(() => {
    tick++;
    const live = !!document.querySelector(".game.is-live");
    const showingToday = state.view !== "calendar" || sameDay(state.selectedDate, new Date());
    if (showingToday && (live || tick % 4 === 0)) { render({ fresh: true }); renderPinned({ fresh: true }); }
  }, 30_000);
  setInterval(() => {
    for (const [k, ev] of pbpEvents) if (ev.state === "in" && document.querySelector(`.pbp[data-pbp="${CSS.escape(k)}"]`)) loadPlays(k);
  }, 30_000);
})();
