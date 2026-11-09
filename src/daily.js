// Daily puzzles + local leaderboard ("board").
//
// Pure logic lives here and is unit-tested (tests/daily.test.mjs). Storage is
// injectable everywhere, so the localStorage board can later be swapped for a
// server-backed one without touching the UI. Players can compare solutions
// across browsers via the share links (labs).

export function dateKeyOf(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Categories ordered easiest → hardest (denser notable-people data first).
// Puzzle 2 draws from the easier half, puzzle 3 from the harder half.
export const CATEGORY_DIFFICULTY = ["writers", "artists", "women", "scientists", "philosophers", "rulers"];

// Three puzzles per day, easiest first. Every span is 100-200 years — never
// more than 200. Difficulty levers: era (windows ending after ~1800 are easy,
// 1400-1800 medium, before 1400 hard — recent data is much denser) and a
// category restriction on #2/#3. Puzzle 1 has no category restriction.
export function dailyPuzzles(dateKey, presentYear) {
  const rng = mulberry32(hashStr(dateKey));
  const span = () => 100 + Math.floor(rng() * 101); // 100..200
  const end1 = 1850 + Math.floor(rng() * Math.max(1, presentYear - 5 - 1850)); // easy era
  const end2 = 1450 + Math.floor(rng() * 301); // 1450..1750, medium era
  const end3 = 900 + Math.floor(rng() * 451);  // 900..1350, hard era
  const half = Math.floor(CATEGORY_DIFFICULTY.length / 2);
  const cat2 = CATEGORY_DIFFICULTY[Math.floor(rng() * half)];
  const cat3 = CATEGORY_DIFFICULTY[half + Math.floor(rng() * (CATEGORY_DIFFICULTY.length - half))];
  return [
    { n: 1, startYear: end1 - span(), endYear: end1, mode: null },
    { n: 2, startYear: end2 - span(), endYear: end2, mode: cat2 },
    { n: 3, startYear: end3 - span(), endYear: end3, mode: cat3 },
  ];
}

// Challenge def for starting one daily puzzle from the start screen.
export function dailyDef(dateKey, p) {
  return {
    custom: true,
    key: `daily-${dateKey}-${p.n}`,
    name: `Daily ${dateKey} #${p.n}`,
    mode: p.mode,
    startYear: p.startYear,
    endYear: p.endYear,
    daily: { dateKey, n: p.n },
  };
}

// ------------------------------------------------------------- leaderboard
// Best-only board: one entry per (dateKey, n) — fewest people wins, ties
// broken by solve time.

const BOARD_KEY = "ttc-daily-board-v1";
const NAME_KEY = "ttc-player-name";

function defaultStorage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

export function loadBoard(storage) {
  const s = storage ?? defaultStorage();
  if (!s) return { entries: [] };
  try {
    const b = JSON.parse(s.getItem(BOARD_KEY) || "{}");
    return { entries: Array.isArray(b.entries) ? b.entries : [] };
  } catch { return { entries: [] }; }
}

// Submit one finished run. Returns { board, improved } — improved=true when
// this run beat the stored best (or there was none).
export function submitResult(board, entry, storage) {
  const e = {
    id: `r${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    at: Date.now(),
    name: "Player",
    ...entry,
  };
  const idx = board.entries.findIndex(x => x.dateKey === e.dateKey && x.n === e.n);
  let entries, improved;
  if (idx >= 0) {
    const old = board.entries[idx];
    improved = e.people < old.people || (e.people === old.people && e.ms < old.ms);
    entries = improved ? board.entries.map((x, i) => (i === idx ? e : x)) : board.entries;
  } else {
    entries = [...board.entries, e];
    improved = true;
  }
  const next = { entries };
  const s = storage ?? defaultStorage();
  if (s) { try { s.setItem(BOARD_KEY, JSON.stringify(next)); } catch { /* private mode */ } }
  return { board: next, improved };
}

// Best entry for one daily puzzle (fewest people, then fastest). The store
// upserts, so there is normally at most one; this keeps best-only an invariant
// of the read path too.
export function boardFor(board, dateKey, n) {
  const es = board.entries.filter(e => e.dateKey === dateKey && e.n === n);
  if (!es.length) return [];
  const best = es.reduce((a, b) => (b.people < a.people || (b.people === a.people && b.ms < a.ms) ? b : a));
  return [best];
}

export function bestFor(board, dateKey, n) {
  return boardFor(board, dateKey, n)[0] ?? null;
}

// Player display name for the board; asks once, then persists.
export function playerName(storage) {
  const s = storage ?? defaultStorage();
  if (!s) return "Player";
  let n = null;
  try { n = s.getItem(NAME_KEY); } catch { /* ignore */ }
  if (!n && typeof window !== "undefined" && typeof window.prompt === "function") {
    n = window.prompt("Name for the daily leaderboard?", "Player") || "Player";
    try { s.setItem(NAME_KEY, n); } catch { /* ignore */ }
  }
  return n || "Player";
}

export function fmtMs(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
