// Default sport order = popularity where the viewer lives.
// The viewer can pick their state/area in their profile; otherwise we guess a
// broad region from the browser's time zone (no location permission needed).
//
// Rankings are judgment calls informed by national fan surveys plus regional
// strengths (SEC country loves college football, the north loves hockey...).

const POPULARITY = {
  national:     ["nfl", "nba", "mlb", "cfb", "soccer", "nhl", "cbb", "ufc", "golf", "f1", "tennis", "nascar", "wnba", "cbase"],
  northeast:    ["nfl", "mlb", "nba", "nhl", "cfb", "soccer", "cbb", "ufc", "golf", "tennis", "f1", "wnba", "nascar", "cbase"],
  east:         ["nfl", "mlb", "nba", "cfb", "nhl", "cbb", "soccer", "ufc", "golf", "nascar", "tennis", "f1", "wnba", "cbase"],
  southeast:    ["nfl", "cfb", "mlb", "nba", "cbb", "nascar", "golf", "soccer", "ufc", "cbase", "nhl", "f1", "tennis", "wnba"],
  midwest:      ["nfl", "cfb", "mlb", "nba", "nhl", "cbb", "golf", "ufc", "soccer", "nascar", "wnba", "f1", "tennis", "cbase"],
  central:      ["nfl", "cfb", "mlb", "nba", "nhl", "cbb", "soccer", "ufc", "golf", "nascar", "cbase", "f1", "wnba", "tennis"],
  southcentral: ["nfl", "cfb", "mlb", "nba", "soccer", "cbase", "cbb", "ufc", "nhl", "golf", "f1", "nascar", "wnba", "tennis"],
  mountain:     ["nfl", "nba", "mlb", "cfb", "nhl", "soccer", "ufc", "cbb", "golf", "f1", "wnba", "tennis", "nascar", "cbase"],
  west:         ["nfl", "nba", "mlb", "soccer", "cfb", "nhl", "ufc", "f1", "cbb", "golf", "tennis", "wnba", "cbase", "nascar"],
  canada:       ["nhl", "nba", "mlb", "nfl", "soccer", "f1", "ufc", "tennis", "golf", "wnba", "cfb", "cbb", "nascar", "cbase"],
  intl:         ["soccer", "f1", "tennis", "nba", "ufc", "nfl", "golf", "mlb", "nhl", "wnba", "cfb", "cbb", "nascar", "cbase"],
};

const REGION_LABEL = {
  national: "the US", northeast: "the Northeast", east: "the East", southeast: "the Southeast",
  midwest: "the Midwest", central: "the Central US", southcentral: "Texas & the South Central US",
  mountain: "the Mountain West", west: "the West Coast", canada: "Canada", intl: "outside North America",
};

const STATES = [
  ["AL", "Alabama", "southeast"], ["AK", "Alaska", "west"], ["AZ", "Arizona", "mountain"], ["AR", "Arkansas", "southeast"],
  ["CA", "California", "west"], ["CO", "Colorado", "mountain"], ["CT", "Connecticut", "northeast"], ["DE", "Delaware", "northeast"],
  ["DC", "District of Columbia", "east"], ["FL", "Florida", "southeast"], ["GA", "Georgia", "southeast"], ["HI", "Hawaii", "west"],
  ["ID", "Idaho", "mountain"], ["IL", "Illinois", "midwest"], ["IN", "Indiana", "midwest"], ["IA", "Iowa", "midwest"],
  ["KS", "Kansas", "midwest"], ["KY", "Kentucky", "southeast"], ["LA", "Louisiana", "southeast"], ["ME", "Maine", "northeast"],
  ["MD", "Maryland", "east"], ["MA", "Massachusetts", "northeast"], ["MI", "Michigan", "midwest"], ["MN", "Minnesota", "midwest"],
  ["MS", "Mississippi", "southeast"], ["MO", "Missouri", "midwest"], ["MT", "Montana", "mountain"], ["NE", "Nebraska", "midwest"],
  ["NV", "Nevada", "mountain"], ["NH", "New Hampshire", "northeast"], ["NJ", "New Jersey", "northeast"], ["NM", "New Mexico", "mountain"],
  ["NY", "New York", "northeast"], ["NC", "North Carolina", "southeast"], ["ND", "North Dakota", "midwest"], ["OH", "Ohio", "midwest"],
  ["OK", "Oklahoma", "southcentral"], ["OR", "Oregon", "west"], ["PA", "Pennsylvania", "northeast"], ["RI", "Rhode Island", "northeast"],
  ["SC", "South Carolina", "southeast"], ["SD", "South Dakota", "midwest"], ["TN", "Tennessee", "southeast"], ["TX", "Texas", "southcentral"],
  ["UT", "Utah", "mountain"], ["VT", "Vermont", "northeast"], ["VA", "Virginia", "east"], ["WA", "Washington", "west"],
  ["WV", "West Virginia", "east"], ["WI", "Wisconsin", "midwest"], ["WY", "Wyoming", "mountain"],
];
const AREA_REGION = Object.fromEntries(STATES.map(([code, , region]) => [code, region]));
AREA_REGION.CAN = "canada";
AREA_REGION.INTL = "intl";

const CANADA_TZ = /^America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Regina|Halifax|St_Johns|Moncton|Whitehorse|Yellowknife|Iqaluit)/;

function guessRegionFromTimeZone() {
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
  if (CANADA_TZ.test(tz)) return "canada";
  if (/^America\/(New_York|Detroit|Indiana|Kentucky)/.test(tz)) return "east";
  if (/^America\/(Chicago|Menominee|North_Dakota)/.test(tz)) return "central";
  if (/^America\/(Denver|Phoenix|Boise)/.test(tz)) return "mountain";
  if (/^(America\/(Los_Angeles|Anchorage|Juneau)|Pacific\/Honolulu)/.test(tz)) return "west";
  if (/^America\//.test(tz)) return "national";
  return tz ? "intl" : "national";
}

// Returns { region, label, guessed }.
function regionFor(area) {
  if (area && AREA_REGION[area]) return { region: AREA_REGION[area], guessed: false };
  return { region: guessRegionFromTimeZone(), guessed: true };
}

function popularOrder(area) {
  return POPULARITY[regionFor(area).region] || POPULARITY.national;
}
