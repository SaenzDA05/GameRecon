// Maps the network names ESPN reports (e.g. "ESPN", "TBS", "NBC Sports Phil")
// to the ways a viewer can actually watch that channel.
//
// Prices: US list price, monthly, base tier that carries the sport, before
// promos and taxes. Each was checked against published pricing on PRICES_CHECKED;
// `src` is where to re-check. Update here when a service changes its price.

const PRICES_CHECKED = "Oct 5, 2026";

const SERVICES = {
  antenna:     { name: "Free with an antenna",       kind: "free",   price: 0,     url: "https://www.antennaweb.org/", note: "Local broadcast channel — free over the air" },
  espnUnl:     { name: "ESPN Unlimited",             kind: "stream", price: 31.99, url: "https://www.espn.com/watch/", note: "ESPN, ESPN2, ESPNU, SEC/ACC Network, ABC + ESPN Select", src: "https://www.antennaland.com/espn-unlimited-price-increase/" },
  espnSelect:  { name: "ESPN Select",                kind: "stream", price: 13.99, url: "https://plus.espn.com/", note: "Formerly ESPN+ — streaming-only games", src: "https://www.antennaland.com/espn-unlimited-price-increase/" },
  foxOne:      { name: "Fox One",                    kind: "stream", price: 19.99, url: "https://www.foxone.com/", note: "FOX, FS1, FS2, Big Ten Network", src: "https://help.fox.com/s/article/FOX-One-Plans" },
  peacock:     { name: "Peacock Premium",            kind: "stream", price: 12.99, url: "https://www.peacocktv.com/", note: "NBC & USA sports, Golf Channel events, Peacock exclusives", src: "https://www.rsinc.com/streaming-price-increases-2026.php" },
  paramount:   { name: "Paramount+ Essential",       kind: "stream", price: 8.99,  url: "https://www.paramountplus.com/", note: "Live CBS sports, UFC, Champions League", src: "https://www.rsinc.com/streaming-price-increases-2026.php" },
  prime:       { name: "Prime Video",                kind: "stream", price: 8.99,  url: "https://www.amazon.com/primevideo", note: "Standalone — or included with Prime ($14.99/mo)", src: "https://fortune.com/2026/09/09/streaming-service-prices-2026-cord-cutting-cable/" },
  netflix:     { name: "Netflix",                    kind: "stream", price: 8.99,  url: "https://www.netflix.com/", note: "Standard with ads", src: "https://www.rsinc.com/streaming-price-increases-2026.php" },
  appletv:     { name: "Apple TV",                   kind: "stream", price: 14.99, url: "https://tv.apple.com/", note: "Includes F1, MLS & Friday Night Baseball", src: "https://www.rsinc.com/streaming-price-increases-2026.php" },
  tennisCh:    { name: "Tennis Channel",             kind: "stream", price: 11.99, url: "https://www.tennischannel.com/", note: "Tennis Channel's own streaming app ($109.99/yr)", src: "https://tennischannel.freshdesk.com/support/solutions/articles/153000250411-price-increase" },
  disney:      { name: "Disney+",                    kind: "stream", price: 12.49, url: "https://www.disneyplus.com/", note: "Select ESPN games stream on Disney+ (with ads)", src: "https://www.rsinc.com/streaming-price-increases-2026.php" },
  hbomax:      { name: "HBO Max",                    kind: "stream", price: 10.99, url: "https://www.hbomax.com/", note: "TNT, TBS & truTV sports (Basic with ads)", src: "https://www.rsinc.com/streaming-price-increases-2026.php" },
  youtubetv:   { name: "YouTube TV",                 kind: "live",   price: 82.99, url: "https://tv.youtube.com/", note: "Live TV — most national sports channels", src: "https://www.rsinc.com/streaming-price-increases-2026.php" },
  sling:       { name: "Sling Orange",               kind: "live",   price: 45.99, url: "https://www.sling.com/", note: "Cheapest live TV with ESPN & TNT — check lineup", src: "https://cordcuttersnews.com/youtube-tv-vs-directv-vs-fubo-vs-hulu-vs-sling-tv-vs-philo-which-streaming-service-is-best-for-2026/" },
  fubo:        { name: "Fubo Pro",                   kind: "live",   price: 73.99, priceText: "~$74–90/mo", url: "https://www.fubo.tv/", note: "$73.99 + a regional sports fee in many areas", src: "https://www.cabletv.com/fubotv" },
  directv:     { name: "DirecTV MySports",           kind: "live",   price: 64.99, url: "https://www.directv.com/stream/", note: "Sports pack with most regional sports networks", src: "https://www.cabletv.com/directv/sports/mysports-review" },
  fanduelSN:   { name: "FanDuel Sports Network",     kind: "stream", price: 19.99, url: "https://www.fanduelsportsnetwork.com/", note: "Direct regional stream, in-market only (also on Prime Video)", src: "https://thestreamable.com/video-streaming/fanduel-sports-network" },
  mlbLocal:    { name: "Team pass on MLB.TV",        kind: "stream", price: 19.99, url: "https://www.mlb.com/tv", note: "In-market local broadcast (e.g. Padres.TV); season passes discount late in the year", src: "https://www.mlb.com/news/padres-tv-2026-season" },
  mlbtv:       { name: "MLB.TV",                     kind: "stream", price: 29.99, url: "https://www.mlb.com/tv", note: "Out-of-market games (local games blacked out)", src: "https://www.mlb.com/live-stream-games/subscribe/allpackages" },
  nbaLP:       { name: "NBA League Pass",            kind: "stream", price: 16.99, url: "https://www.nba.com/watch/league-pass-stream", note: "Out-of-market games; $109.99/season", src: "https://www.basket-mag.com/us/nba-league-pass-price-subscription-student-options-and-tips/" },
  nhlOOM:      { name: "ESPN Select (NHL Power Play)", kind: "stream", price: 13.99, url: "https://plus.espn.com/", note: "Out-of-market NHL games", src: "https://www.antennaland.com/espn-unlimited-price-increase/" },
  sundayTicket:{ name: "NFL Sunday Ticket",          kind: "stream", price: null,  priceText: "$378–480/season", url: "https://tv.youtube.com/nfl-sunday-ticket/", note: "Out-of-market Sunday games ($378 with YouTube TV, $480 standalone)", src: "https://sports.yahoo.com/articles/2026-nfl-sunday-ticket-pricing-130002057.html" },
  nflPlus:     { name: "NFL+",                       kind: "stream", price: 6.99,  url: "https://www.nfl.com/plus/", note: "Local & primetime games on phone/tablet only", src: "https://support.nfl.com/hc/en-us/articles/35869739723028-How-much-does-NFL-cost" },
};

// Exact-name rules first, then regex rules for regional networks.
const NETWORK_RULES = [
  [/^ABC$/i,                               ["antenna", "espnUnl", "youtubetv"]],
  [/^CBS$/i,                               ["antenna", "paramount", "youtubetv"]],
  [/^NBC$/i,                               ["antenna", "peacock", "youtubetv"]],
  [/^FOX$/i,                               ["antenna", "foxOne", "youtubetv"]],
  [/^ESPN\+$/i,                            ["espnSelect"]],
  [/^(ESPN|ESPN2|ESPNU|ESPNEWS|SEC ?Network|SECN|ACC ?Network|ACCN|ESPN Deportes)$/i, ["espnUnl", "youtubetv", "sling"]],
  [/^(FS1|FS2|Big Ten Network|BTN|FOX Deportes)$/i, ["foxOne", "youtubetv", "fubo"]],
  [/^(TNT|TBS|truTV|TruTV)$/i,             ["hbomax", "youtubetv", "sling"]],
  [/^(HBO Max|Max)$/i,                     ["hbomax"]],
  [/^(USA ?Net|USA|Telemundo|Tele|Universo)$/i, ["peacock", "youtubetv", "sling"]],
  [/^(The CW|CW|ION)$/i,                   ["antenna", "youtubetv"]],
  [/^Tennis (Channel|Chnl)$/i,             ["tennisCh", "fubo", "sling"]],
  [/^Golf (Channel|Chnl)$/i,               ["peacock", "youtubetv", "sling"]],
  [/^Disney\+$/i,                         ["disney", "espnUnl"]],
  [/^Peacock$/i,                           ["peacock"]],
  [/^Paramount\+$/i,                       ["paramount"]],
  [/^CBSSN|CBS Sports Network$/i,          ["youtubetv", "fubo"]],
  [/^Prime Video/i,                        ["prime"]],
  [/^Netflix$/i,                           ["netflix"]],
  [/^(Apple TV|AppleTV|MLS Season Pass)/i, ["appletv"]],
  [/^(NBA TV|NHL Net|NHL Network|MLB Net|MLB Network|NFL Net|NFL Network|Golf Channel|Tennis Channel)$/i, ["youtubetv", "sling", "fubo"]],
  [/^(MLB\.TV|MLB TV)$/i,                  ["mlbtv"]],
  [/^(NBA League Pass)$/i,                 ["nbaLP"]],
  // Regional sports networks
  [/FanDuel|FDSN|^FD SN|Bally/i,           ["fanduelSN", "directv"]],
  [/\.TV$|MLB Local|MLB\.TV Local/i,       ["mlbLocal"]],
  [/./,                                    ["directv", "fubo"]], // unknown → treat as regional/cable
];

// Package that unlocks a regional-only game for fans who live outside the market.
const OUT_OF_MARKET = { mlb: "mlbtv", nba: "nbaLP", nhl: "nhlOOM", nfl: "sundayTicket" };

function servicesForNetwork(network) {
  for (const [re, keys] of NETWORK_RULES) {
    if (re.test(network.trim())) return keys.map((k) => ({ key: k, ...SERVICES[k] }));
  }
  return [];
}

function priceLabel(s) {
  if (s.kind === "free") return "Free";
  if (s.priceText) return s.priceText;
  return `~$${s.price.toFixed(2)}/mo`;
}

const KIND_LABEL = { free: "Free", stream: "Streaming", live: "Live TV service" };
