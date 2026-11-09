# Future ideas / remaining work

Written 2026-11-09. The game is in a good state; these are the things still
worth doing, roughly prioritized.

## Data (well-known table)

- **Fill the remaining scan holes, then regenerate.** Current accepted table:
  3,950 entries (ancient 1002 / medieval 1472 / early modern 234 / modern 395 /
  contemporary 847), but famous painters whose windows fell into unsplit holes
  are absent (Leonardo Q762, Michelangelo Q5588, Raphael Q5597, Monet Q296,
  van Gogh Q7724, Picasso Q33999). A background scan of 1400–2027 (adaptive
  windows, sl 25–35) appends to `scripts/cache-wellknown/windows.jsonl`; when it
  logs DONE, verify every jsonl line parses, then re-run
  `SKIP_SCAN=1 node --max-old-space-size=6144 scripts/fetch-wellknown.mjs`
  (the generator now streams the entity cache — the old version OOM'd on it).
  The generator also supports `HOLE_SL=n` to retry missing split-leaves.
- **Re-check the era × category matrix** after regenerating: contemporary
  (birth ≥ 1950) currently has almost no scientists/writers/rulers; the scan
  above should fix that.
- **Category overlap is Wikidata semantics, not a bug**: writer → artist and
  philosopher → scientist chains exist, so e.g. Socrates counts as
  "artists"+"writers"+"scientists"+"philosophers". Decide whether to document
  this or tighten (e.g. exclude writer-ancestors from the artists pattern).
- The artists fix (visual artist Q3391743 alongside artist Q483501) is applied
  in both `src/lib.js` CATEGORIES and the generator's CAT_ROOTS — keep them in
  sync if either changes.

## Leaderboard / social

- **Server-backed leaderboard** so the board is shared across browsers; the
  store is isolated in `src/daily.js` (`loadBoard`/`submitResult`), and the
  percentile graph is deferred until then (see `src/Leaderboard.jsx`).
- Refine `PARS` in `src/labs.js` with real solver output (`python3 solver/solve.py --offline`).

## Chained dailies

- Autosave stores the single in-progress challenge; after reopening, the home
  screen's "▶ Play today's puzzles" resumes at the first unsolved puzzle, but
  the chain itself isn't persisted mid-way. Could store `{dateKey, n}` chain
  position in the autosave.

## Tutorial

- Currently one coach banner. Could become 2–3 step coachmarks (search → add →
  win) with a highlight ring.

## Idea-only labs (from docs/fun-techniques.md)

- #14 plan-3 draft (stage candidates), #15 synth sound pips, #16 category
  pre-check in the suggestion dropdown, #17 shrink-the-team post-win, #19 blitz
  timer, #20 era-tinted timeline backdrop, #21 rotating quests, #22 anchor swap.

## Performance / polish

- `dailyPuzzles` is memoized per date but a cold date with fallback attempts
  costs ~0.5s; precomputing or caching more would smooth the home screen.
- Verify the new ☰ menu, status strip and bigger timeline on a real phone
  (small screens, pinch zoom).
- Accessibility pass: aria-labels on icon-only buttons, visible focus rings,
  sufficient contrast of gap-red on both themes.
