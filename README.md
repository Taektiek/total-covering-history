# 🕰️ Timeline Total Cover

A game where you try to cover all of recorded history — from Socrates' birth (470 BC) to today — with the lifespans of as few historical people as possible. Every year of the timeline must be covered by someone alive.

Data comes live from [Wikidata](https://www.wikidata.org) and [Wikipedia](https://en.wikipedia.org).

## Features

- **Search & add** any historical person (fetched live from Wikidata, with birth/death years).
- **Coverage tracking** — the coverage bar, gaps and the win state are computed from your current list.
- **Timeline controls**
  - **Pan** by dragging the timeline left/right (and vertically through the rows when the list is long).
  - **Zoom** with the slider (or the ＋ / － buttons); **shift+drag** selects a region to zoom into.
  - **Date labels** appear on the bars when zoomed in far enough, and **names** appear when zoomed in further.
- **Person details** — click a bar or a list entry for the Wikipedia summary, image, and direct links to the person's **Wikipedia article** and Wikidata item. List entries also have a `W↗` link to the Wikipedia article.
- **Category challenges** — restrict additions to ♀ women, 🔬 scientists, 🤔 philosophers, 🎨 artists, ✍️ writers or 👑 rulers. The restriction is enforced when adding (checked live against the person's Wikidata entity), not just in search.
- **Gap challenges** — cover a smaller interval with as few people as possible:
  - click any red gap on the timeline (or the "largest gap" button) to play a focused challenge on it, or
  - enter a custom start/end year in the Challenges panel.
  - Coverage %, completion and person count are shown specifically for that range, and only people overlapping the range can be added while it's active.
- **Save / load** your progress as a JSON file (`{ "version": 1, "ids": [...] }`), including the active challenge mode and gap range.
- Light/dark theme.
- **🧪 Labs** — optional toggleable experiments (all OFF by default, persisted in `localStorage`), opened via the 🧪 Labs button in game. See `docs/fun-techniques.md` for the full brainstorm. Included labs:
  - *Δ-coverage preview* — search suggestions show `+N y` and whether they complete the active gap challenge.
  - *Near-miss callouts* — when an add leaves a gap ≥80% covered, it says how many years are left.
  - *Undo* — ↩ button / Ctrl+Z reverts the last add/remove.
  - *"Holds N years alone"* — each person's unique coverage on list rows and in the detail card.
  - *💡 Bridger suggestions* — one click to list notable people who lived inside the largest/active gap (live Wikidata query).
  - *Gap chaining* — bridging a gap auto-starts the next-largest one, with a chain counter.
  - *Local records* — fewest-people best per challenge/gap range (shown on the start screen and win banner).
  - *Share links* — 🔗 copies a URL (`#c=…`) that loads the exact game.
  - *Par & medals* — approximate par per preset, 🥇/🥈/🏅 on the win banner.
  - *Mystery gaps* — hides the red gap regions on the timeline (count only).
  - *Frontier-only* (core) — a new person's lifespan may overlap already-covered years by at most 60 (configurable).
  - *Budget cap* (core) — limit the total number of people.
  - Playsets: 🧘 chill / 🔭 discovery / ⚔️ hard one-click combinations.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173
```

## Solver (separate from the website)

`solver/solve.py` computes a **minimum-person, gap-free** cover of the timeline using a broad Wikidata dataset (humans with recorded birth dates and at least `--min-sitelinks` sitelinks — no hand-picked candidate list) and exports the website-compatible format:

```json
{
  "version": 1,
  "ids": []
}
```

```sh
cd solver
python3 solve.py                  # fetch (cached, resumable) + solve + verify + export
python3 solve.py --offline       # solve again from the cached dataset
python3 solve.py --start 1500 --end 1800   # solve a custom interval
```

Notes:

- The minimum interval cover is found greedily, which is provably optimal for this problem, and the result is verified to be gap-free before export.
- The website always preloads Socrates, so the solver anchors at his death and only picks people the website would accept.
- Fetching queries Wikidata's SPARQL endpoint in small, resumable birth-year windows (results cached under `solver/cache/`), so it survives interruptions and the 60-second query timeout. If a gap can't be bridged at the requested notability threshold, it automatically retries that range with a lower one.

Note: `solve.py`, `solver/cache/` and `fetch.log` are gitignored in this repo; adjust `.gitignore` if you want to track the solver.
