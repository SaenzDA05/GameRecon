---
version: 1
name: GameRecon
description: |
  A dark, dense sports-app UI where the games are the color. Near-black canvas and a flat
  three-step surface ladder; team logos and team colors supply nearly all saturation.
  Exactly four signal colors, each with one job: blue = act, red = live, green = free/cheapest,
  gold = pinned. Inter at heavy weights for UI, Barlow Condensed for scoreboard numbers and
  section titles.
sources: |
  Synthesized from awesome-design-md (MIT): 1win (sportsbook density, surface ladder, rails,
  sport sidebar), Spotify (content supplies the color, achromatic chrome), Al Jazeera
  (live-red reserved for live), Linear (hairline + surface hierarchy, no shadows),
  Nike / The Verge (condensed uppercase display for scores and titles).

colors:
  # dark (default)
  canvas: "#121315"      # page, top bar, sport rail
  surface: "#1b1d21"     # cards, rail tiles, dialogs
  surface-2: "#23262b"   # card side panel (watch + play-by-play), inputs
  surface-3: "#2d3036"   # hover, chips, pressed
  hairline: "#2a2d33"    # 1px borders and dividers
  ink: "#f0f2f5"         # primary text
  muted: "#9aa1b1"       # secondary text, inactive nav
  faint: "#5d626c"       # placeholders, disabled, empty stars
  accent: "#2f8cff"      # ACT: buttons, links, active tab/sport, focus ring
  live: "#ff3b47"        # LIVE ONLY: badges, live rail, live card edge
  free: "#1fc76a"        # FREE/CHEAPEST ONLY: antenna option, "From $" line, scoring plays
  gold: "#f5b70a"        # PINNED ONLY: stars, pinned card edge
  kind-stream: "#a88bfa" # subscription-type pills (data, not chrome)
  kind-live-tv: "#f5a35c"
  # light (opt-in via theme toggle)
  light-canvas: "#f3f4f6"
  light-surface: "#ffffff"
  light-surface-2: "#f6f7f9"
  light-ink: "#111318"
  light-accent: "#0a6cff"

typography:
  ui:      { fontFamily: Inter, weights: [500, 600, 800] }
  display: { fontFamily: Barlow Condensed, weights: [700, 800], textTransform: uppercase }
  scale:
    score-live: 30px Barlow Condensed 800, tabular
    score:      24px Barlow Condensed 800, tabular
    page-title: 26px Barlow Condensed 800 uppercase, letter-spacing .01em
    sport-head: 18px Barlow Condensed 800 uppercase, letter-spacing .03em
    team:       15px Inter 600
    body:       14px Inter 500
    meta:       12–13px Inter 600
    eyebrow:    11–12px Inter 800 uppercase, letter-spacing .08em

rounded: { sm: 6px, md: 8px, lg: 10px, card: 16px, full: 999px }
spacing: { base: 8px, scale: [2, 4, 8, 12, 16, 20, 24, 32] }

components:
  game-card:    surface, 1px hairline, rounded.card, no shadow; 3px team-color bar on top (away | home)
  card-side:    surface-2 panel on the right (stacks below on mobile): Where To Watch, then Play-by-Play
  live-tile:    surface, rounded.card, live-red top bar + pulsing dot, condensed scores; horizontal rail
  sport-rail:   desktop ≥1100px sticky left column of sport buttons; mobile = horizontal scroll strip
  button-primary: accent fill, white text, rounded.lg, 8×14px
  chip:         surface-3 pill; active = accent fill
  badge-live:   live fill, white, pill, pulsing (reduced-motion: static)
---

## Rules

### Do
- Keep the chrome achromatic. Color comes from team logos, the team-color bar, and the four signals.
- Use each signal for its one job only: **blue acts, red is live, green is free/cheapest, gold is pinned.**
- Build depth with the surface ladder (canvas → surface → surface-2 → surface-3) and hairlines.
- Set scores, times on live tiles, page titles and sport headings in Barlow Condensed, uppercase where it's a label.
- Keep it dense: this is an app for scanning dozens of games, not a landing page.
- Horizontal scrolling strips (live rail, sport strip on mobile) instead of wrapping rows.

### Don't
- Don't use red for anything that isn't live (errors use a muted red text, never a red fill).
- Don't use green for buttons — "free" is information, not an action.
- Don't add drop shadows to cards; only floating layers (dialogs) get a shadow.
- Don't introduce new accent hues. Team colors are content and only appear in the team bar / tiles.
- Don't put more than one primary (blue-filled) button in a view.
