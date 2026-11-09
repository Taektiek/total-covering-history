# Fun techniques — Timeline Total Cover

Brainstorm for making **this** game more fun. Every entry names the concrete
mechanic of this game it mutates and where it hooks in (`src/lib.js`,
`src/App.jsx`, `src/Timeline.jsx`, `src/StartScreen.jsx`, `src/PersonCard.jsx`,
`src/labs.js`, `src/LabsPanel.jsx`).
Novelty column: `original` = invented for this game's mechanics, `adapted` =
known technique from the skill's reference catalogs, reinvented around this
game (kept to a minority per the skill's novelty audit).

## Phase 1 findings (mechanic list — raw material for invention)

- **Verbs:** add person (search → suggestion → Wikidata date fetch → validations
  → push to `people`), remove person (list `×`, anchor/end locked), gap
  challenge (click red gap / "largest gap" / custom years → `challengeRange`),
  pan/zoom timeline (drag, slider, ＋/－, shift-drag), inspect person
  (PersonCard modal), save/load JSON v2, theme toggle.
- **Resources:** `people` count (the score — fewer is better), coverage
  `total`/`gaps` from `computeCoverage(people, bounds)`, `coverPct`.
- **Constraints:** `bounds = [anchor.birth, end]`; win = `gaps.length===0 &&
  people.length>1`; add validations: not duplicate, category SPARQL check,
  gap-range overlap, `death > anchor.death`, `after > before` coverage.
- **Not present:** timers, RNG, economies, spawners, undo, hints,
  any candidate discovery. (Records and share links are standard features now,
  not labs — `src/features.js`.)

**Friction (not yet fun):** no candidate-quality feedback before adding
(binary "adds nothing" rejection); no discovery aid despite Wikidata being the
data source; no par/target to beat; no undo; win is a dead end; gap challenge
is one-at-a-time with no memory; almost no juice; person contribution invisible;
category mode only rejects *after* the fetch; same challenge plays identically
every run.

## The list

| # | Idea | Mutates / hooks into | Novelty | Status |
|---|------|----------------------|---------|--------|
| 1 | **Δ-coverage preview on suggestions**: each dropdown entry shows the years it would add (+N y) | `handleSelect` + suggestion dropdown in `App.jsx`, batched `fetchPeopleDates()` in `lib.js` | adapted (what-if previews) | **implemented** (`deltaPreview`) |
| 2 | **Gap annotation on suggestions**: badge says whether a candidate *completes* the active 🎯 range | suggestion dropdown + `challengeRange` in `App.jsx` | original | **implemented** (part of `deltaPreview`: "✓ completes 🎯") |
| 3 | **💡 Bridger suggestions**: notable people who lived inside the largest/active gap (live Wikidata SPARQL), one click to add | `suggestBridgers()` in `lib.js`, 💡 row beside the largest-gap button in `App.jsx` | original | **implemented** (`bridgers`) |
| 4 | **Par + medals**: approximate minimal-cover par per preset; HUD chip "par N"; win banner 🥇/🥈/🏅 | `PARS`/`medalFor` in `labs.js`, HUD + win banner in `App.jsx` | original | **implemented** (`parMedals`; pars are ballparks — refine via `solver/solve.py`) |
| 5 | **Undo**: ↩ button + Ctrl+Z; snapshots `{people, challengeRange}` before every add/remove | `undoRef`/`doUndo` in `App.jsx` | adapted (undo) | **implemented** (`undo`) |
| 6 | **Frontier-only mode**: an added person's lifespan may sit inside already-covered years by at most K years (default 60) — blocks mostly-redundant adds (depth lever) | `canAddPerson()`/`overlapYears()` in `labs.js`, checked in `handleSelect` | original | **implemented** (`maxOverlap`, core lab) |
| 7 | **"Holds N years alone" badge**: marginal coverage per person on list rows and in PersonCard | `marginalYears()` in `labs.js`, row badge in `App.jsx`, `marginal` prop in `PersonCard.jsx` | original | **implemented** (`holdsYears`) |
| 8 | **Gap chaining**: bridging the active gap auto-advances to the next-largest gap; chain ×k chip (requires the `gapChallenge` lab) | `nextLargestGap()` in `labs.js`, advance logic in `handleSelect`, chip in HUD | original | **implemented** (`gapChain`) |
| 9 | **Local records**: fewest-people best per challenge key and per gap range, in localStorage; shown on preset cards and win banner | `loadRecords`/`recordResult` in `features.js`, recording in `handleSelect`, `records` prop in `StartScreen.jsx` | original | **standard feature** (was lab `records`) |
| 10 | **Share links**: challenge def + ids + range encoded base64url into `#c=…`; auto-loads on open; 🔗 button copies URL | `encodeShare`/`decodeShare` in `features.js`, mount effect + `handleShare` in `App.jsx` | adapted (shareable codes) | **standard feature** (was lab `shareLink`) |
| 11 | **Mystery gaps mutator**: timeline hides red gap regions (count only), gap-click disabled | `hideGaps` prop in `Timeline.jsx`, guard in `App.jsx` | original | **implemented** (`mysteryGaps`) |
| 12 | **Budget cap mutator**: max total people (set in Labs panel); HUD counter; adds beyond cap rejected; 🏆 on win within budget | `canAddPerson()` in `labs.js`, HUD + win banner in `App.jsx` | original | **implemented** (`budget`, core lab) |
| 13 | **Near-miss callout**: when an add leaves a gap/range ≥80% covered, say how many years are left | `nearMiss()`/`rangeYearsLeft()` in `labs.js`, notice in `handleSelect` | original | **implemented** (`nearMiss`) |
| 14 | **Plan-3 draft**: stage up to 3 candidates, combined Δ, commit all at once | suggestion dropdown staging in `App.jsx` | original | idea-only |
| 15 | **Synth sound pips**: WebAudio blip on add (pitch with coverPct), low tone on reject, arpeggio on win | tiny synth in `lib.js`, calls in `App.jsx` | adapted (juice/sfx) | idea-only |
| 16 | **Category pre-check**: in category mode, suggestions ASK-checked as the dropdown renders, ✗ greyed | suggestion dropdown + `checkCategory` in `lib.js` | original | idea-only |
| 17 | **Shrink-the-team (post-win)**: removal puzzle — keep full coverage with fewest people, live ✓/✗ feedback | `removePerson` + win banner in `App.jsx` | original | idea-only |
| 18 | **Daily puzzles**: 3 date-seeded puzzles/day, each bridging the LIVES of two well-known people drawn from `src/data/wellknown.js` (≥1000 people, era × category diverse, generated by `scripts/fetch-wellknown.mjs`); gap between the lives 40–160y, era ladder (≥1800 easy / 1000–1799 medium / <1000 hard) + easier categories on easier puzzles, every pair verified bridgeable (`minBridgers`); **chained**: finishing one auto-starts the next; best-only timed local leaderboard (`src/daily.js`, `src/Leaderboard.jsx`); percentile graph deferred until a server board exists | `src/daily.js` + `src/data/wellknown.js` + `StartScreen.jsx` + `App.jsx` | adapted (daily challenges) | **implemented** (percentile graph deferred) |
| 19 | **Blitz timer**: optional countdown; HUD timer; records store time as tiebreak | `App.jsx` HUD + records | adapted (blitz modes) | idea-only |
| 20 | **Era backdrop**: timeline background tinted by era with legend when zoomed out | `Timeline.jsx` background layer | original | idea-only |
| 21 | **Rotating quests**: 3 quest chips per run from templates ("add someone born before 500 BC", "bridge a ≥300y gap with ≤2 people", "reach 50%"); ⭐ counter | quest generator + check in `handleSelect` | adapted (quests) | idea-only |
| 22 | **Anchor swap**: replace the challenge anchor mid-run; bounds recompute — redefines the goal mid-game | `startChallenge`/`bounds` in `App.jsx` | original | sketch (big core change) |
| 23 | **Gap challenges as a lab**: clicking red gaps / custom ranges / largest-gap button moved behind the `gapChallenge` lab (off by default) | `labs.gapChallenge` gates `onGapClick`, the 🎯 panel and the largest-gap button in `App.jsx` | original | **implemented** (`gapChallenge`) |
| 24 | **Tutorial**: one very easy puzzle bridging two recent lives (Lennon → Styles, gap 1980–1994, solvable with one add) with a coach banner; done-flag in localStorage | `TUTORIAL` in `lib.js`, banner in `App.jsx`, CTA on the home screen | original | **implemented** |

**Novelty audit:** 22 entries — 15 original (#2,3,4,6,7,8,9,11,12,13,14,16,17,20,22),
7 adapted (#1,5,10,15,18,19,21). 15/22 ≈ 68% original ≥ ⅔ required. ✅

**Ease/depth balance:** ease levers: #1,#2,#3,#5,#7,#9,#13,#16. Depth levers:
#6 (constrains adds), #11 (hides information), #12 (scarce budget), #17, #22.
The "⚔️ hard" playset contains only depth levers and is never mixed into
"🧘 chill".

## Progress log

- 2026-11-03: Phase 1 done (core loop mapped, branch `fun-experiments/20261103`
  created). Phase 2 brainstorm written; novelty audit passed (68% original).
- 2026-11-03: Phase 3 done — 13 labs implemented, all toggleable via the 🧪 Labs
  panel, persisted in localStorage, default OFF. Core labs (`maxOverlap`,
  `budget`) are enforced through pure `canAddPerson()` in `src/labs.js`.
- 2026-11-03: Phase 4 done — 16 unit tests (`npm test`), headless bot sim
  (`npm run sim`: base 100% win / 32.5 people; budget cap 30 → 10.5% win, so
  the depth lever bites; frontier-only stays 100% winnable), `npm run lint`
  0 warnings, `npm run build` OK. Browser playtesting not done in sandbox —
  try `npm run dev` manually.
- 2026-11-09: gap/bar click fix + hover (verified in headless Chromium),
  mobile responsive UI + pinch zoom (390×844 touch e2e green), and the daily
  puzzles feature (3/day, ≤200y spans, era+category difficulty ladder, local
  best-only leaderboard; 24 unit tests, daily e2e incl. full win→submit→board
  loop with mocked Wikidata green).
