// Labs — individually toggleable experiments. See docs/fun-techniques.md.
//
// Pure logic lives here so it can be unit-tested headlessly (node --test).
// The UI layer (App.jsx) loads/persists the flags via loadLabs/saveLabs and
// passes them in; nothing here touches the DOM or network.

import { computeCoverage } from "./lib.js";

// ------------------------------------------------------------------ lab defs
// ui: "live" = applies immediately; "core" = affects add legality (applies to
// every add from the moment it is switched on / next run).
export const LAB_DEFS = [
  { id: "deltaPreview", name: "Δ-coverage preview", ui: "live",
    desc: "Each search suggestion shows the years it would add (+N y) and whether it completes the active 🎯 range." },
  { id: "nearMiss", name: "Near-miss callouts", ui: "live",
    desc: "When an add leaves a gap/range ≥80% covered, say how many years are still missing." },
  { id: "undo", name: "Undo (Ctrl+Z / ↩)", ui: "live",
    desc: "Snapshot people+range before every add/remove; revert the last one." },
  { id: "holdsYears", name: "“Holds N years alone”", ui: "live",
    desc: "Show each person's unique coverage on list rows and in the detail card." },
  { id: "bridgers", name: "💡 Bridger suggestions", ui: "live",
    desc: "Offer notable people who lived inside the largest gap (live Wikidata query), one click to add." },
  { id: "gapChain", name: "Gap chaining", ui: "live",
    desc: "Auto-start the next-largest gap when one is bridged; show a chain ×k counter." },
  { id: "records", name: "Local records", ui: "live",
    desc: "Remember your fewest-people best per challenge and per gap range (localStorage)." },
  { id: "shareLink", name: "Share links", ui: "live",
    desc: "Encode the current game in the URL hash (#c=…); auto-loads when opened." },
  { id: "parMedals", name: "Par & medals", ui: "live",
    desc: "Show par (approx. minimum people) in the HUD; award 🥇/🥈/🏅 on the win banner." },
  { id: "mysteryGaps", name: "Mystery gaps", ui: "live",
    desc: "Hide the red gap regions on the timeline — only the gap count is shown." },
  { id: "maxOverlap", name: "Frontier-only (max overlap)", ui: "core",
    desc: "Each added person's lifespan may sit inside already-covered years by at most `maxOverlapYears` years (default 60) — blocks mostly-redundant long overlaps, forces frontier-ish play." },
  { id: "budget", name: "Budget cap", ui: "core",
    desc: "Limit the total number of people (set `budget` in the Labs panel; 0 = unlimited)." },
];

export const DEFAULT_LABS = Object.fromEntries(LAB_DEFS.map(d => [d.id, false]));
export const DEFAULT_OPTS = { maxOverlapYears: 60, budget: 0 };

// Curated one-click combinations. "hard" deliberately contains only depth
// levers; "chill" only feedback/safety levers.
export const PLAYSETS = {
  "🧘 chill": ["deltaPreview", "nearMiss", "undo", "holdsYears", "records"],
  "🔭 discovery": ["bridgers", "gapChain", "parMedals", "shareLink", "deltaPreview"],
  "⚔️ hard": ["maxOverlap", "budget", "mysteryGaps"],
};

// Approximate minimal covers (people count incl. anchor/end) per preset key,
// ballpark of the greedy minimum from solver/solve.py — refine with
// `python3 solver/solve.py --offline`. Custom challenges have no par.
export const PARS = {
  classic: 80, classical: 12, women: 90, scientists: 85,
  philosophers: 80, writers: 90, artists: 85, rulers: 95,
};

export function medalFor(count, par) {
  if (!par) return null;
  if (count <= par) return "🥇";
  if (count <= par + 2) return "🥈";
  return "🏅";
}

// ------------------------------------------------------------- persistence
const LABS_KEY = "ttc-labs-v1";
const REC_KEY = "ttc-records-v1";

function defaultStore() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

export function loadLabs(storage) {
  const s = storage ?? defaultStore();
  const fallback = { labs: { ...DEFAULT_LABS }, opts: { ...DEFAULT_OPTS } };
  if (!s) return fallback;
  try {
    const raw = s.getItem(LABS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      labs: { ...DEFAULT_LABS, ...(p.labs || {}) },
      opts: { ...DEFAULT_OPTS, ...(p.opts || {}) },
    };
  } catch { return fallback; }
}

export function saveLabs(labs, opts, storage) {
  const s = storage ?? defaultStore();
  if (!s) return;
  try { s.setItem(LABS_KEY, JSON.stringify({ labs, opts })); } catch { /* private mode */ }
}

export function loadRecords(storage) {
  const s = storage ?? defaultStore();
  if (!s) return {};
  try { return JSON.parse(s.getItem(REC_KEY) || "{}") || {}; } catch { return {}; }
}

// Returns { records, isRecord } — records updated with the better (lower) count.
export function recordResult(records, key, count, storage) {
  const prev = records[key];
  const isRecord = prev === undefined || count < prev;
  const next = { ...records, [key]: isRecord ? count : prev };
  const s = storage ?? defaultStore();
  if (s) { try { s.setItem(REC_KEY, JSON.stringify(next)); } catch { /* ignore */ } }
  return { records: next, isRecord };
}

// ------------------------------------------------------------ pure helpers

// Merged covered intervals within bounds (same merge as computeCoverage).
export function coveredIntervals(people, bounds) {
  const [rs, re] = bounds;
  const intervals = people
    .map(p => [Math.max(p.birth, rs), Math.min(p.death, re)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of intervals) {
    if (!merged.length || s > merged[merged.length - 1][1]) merged.push([s, e]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
  }
  return merged;
}

// Years of `cand`'s lifespan that lie inside already-covered time.
export function overlapYears(cand, people, bounds) {
  let ov = 0;
  for (const [s, e] of coveredIntervals(people, bounds)) {
    ov += Math.max(0, Math.min(cand.death, e) - Math.max(cand.birth, s));
  }
  return ov;
}

// Lab-specific add legality. With all labs off this always returns ok — the
// base-game validations live in App.jsx and are unchanged.
// cand: { id, label, birth, death }; bounds: challenge [start, end].
export function canAddPerson(cand, people, labs, opts = {}, bounds = null) {
  if (labs.maxOverlap && bounds) {
    const k = opts.maxOverlapYears ?? DEFAULT_OPTS.maxOverlapYears;
    const ov = overlapYears(cand, people, bounds);
    if (ov > k) {
      return { ok: false, reason: `“${cand.label ?? cand.id}” sits inside already-covered years for ${Math.round(ov)}y — frontier-only allows at most ${k}y of overlap.` };
    }
  }
  if (labs.budget) {
    const cap = opts.budget ?? 0;
    if (cap > 0 && people.length >= cap) {
      return { ok: false, reason: `Budget reached — this challenge allows at most ${cap} people (currently ${people.length}).` };
    }
  }
  return { ok: true };
}

// Years of `bounds` covered only by `person` (lost if they were removed).
export function marginalYears(person, people, bounds) {
  const withAll = computeCoverage(people, bounds).total;
  const without = computeCoverage(people.filter(p => p.id !== person.id), bounds).total;
  return Math.max(0, Math.round(withAll - without));
}

// Largest gap excluding `exclude` ([s,e]) — used for gap chaining.
export function nextLargestGap(gaps, exclude = null) {
  const rest = exclude
    ? gaps.filter(([s, e]) => !(Math.abs(s - exclude[0]) < 1 && Math.abs(e - exclude[1]) < 1))
    : gaps;
  if (!rest.length) return null;
  return [...rest].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
}

// Years of `range` still uncovered if `cand` were added on top of `people`.
export function rangeYearsLeft(cand, range, people, bounds) {
  const span = range[1] - range[0];
  if (span <= 0) return 0;
  const total = computeCoverage([...people, cand], bounds, range).total;
  return Math.max(0, Math.round(span - total));
}

// Near-miss: candidate covers ≥ thresh of `range` but not all of it.
export function nearMiss(cand, range, people, bounds, thresh = 0.8) {
  const span = range[1] - range[0];
  if (span <= 0) return null;
  const left = rangeYearsLeft(cand, range, people, bounds);
  const frac = 1 - left / span;
  return frac >= thresh && left > 0 ? { left, frac } : null;
}

// ------------------------------------------------------------ share links

export function encodeShare(payload) {
  const json = JSON.stringify(payload);
  const b64 = typeof btoa === "function"
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(str) {
  let b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const json = typeof atob === "function"
    ? decodeURIComponent(escape(atob(b64)))
    : Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}
