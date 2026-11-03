// Unit tests for the labs (toggleable experiments) and the pure helpers they
// rely on. Run: npm test  (node --test tests/)
import test from "node:test";
import assert from "node:assert/strict";
import { computeCoverage } from "../src/lib.js";
import {
  LAB_DEFS, DEFAULT_LABS, DEFAULT_OPTS, PLAYSETS, PARS, medalFor,
  loadLabs, saveLabs, loadRecords, recordResult,
  canAddPerson, marginalYears, nextLargestGap, rangeYearsLeft, nearMiss,
  coveredIntervals, overlapYears, encodeShare, decodeShare,
} from "../src/labs.js";

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _m: m,
  };
}

// ---------------------------------------------------------------- defs

test("all labs default OFF (base game unchanged)", () => {
  assert.ok(LAB_DEFS.length >= 10);
  assert.equal(new Set(LAB_DEFS.map(d => d.id)).size, LAB_DEFS.length);
  for (const d of LAB_DEFS) assert.equal(DEFAULT_LABS[d.id], false, `${d.id} must default off`);
  assert.deepEqual(DEFAULT_OPTS, { maxOverlapYears: 60, budget: 0 });
});

test("playsets reference only known lab ids", () => {
  const ids = new Set(LAB_DEFS.map(d => d.id));
  for (const [name, list] of Object.entries(PLAYSETS)) {
    assert.ok(list.length > 0, name);
    for (const id of list) assert.ok(ids.has(id), `${name}: unknown lab ${id}`);
  }
  // the "hard" playset must not contain ease levers
  const ease = ["undo", "deltaPreview", "nearMiss", "holdsYears", "bridgers"];
  for (const id of PLAYSETS["⚔️ hard"]) assert.ok(!ease.includes(id));
});

test("every preset with a par has a positive number", () => {
  for (const [k, v] of Object.entries(PARS)) assert.ok(Number.isInteger(v) && v > 0, k);
});

test("medalFor tiers", () => {
  assert.equal(medalFor(80, 80), "🥇");
  assert.equal(medalFor(82, 80), "🥈");
  assert.equal(medalFor(99, 80), "🏅");
  assert.equal(medalFor(5, null), null);
});

// ------------------------------------------------------------ persistence

test("loadLabs: no storage / corrupt / partial all safe, defaults off", () => {
  assert.deepEqual(loadLabs(null).labs, DEFAULT_LABS);
  const s = memStorage();
  s.setItem("ttc-labs-v1", "{not json");
  assert.deepEqual(loadLabs(s).labs, DEFAULT_LABS);
  s.setItem("ttc-labs-v1", JSON.stringify({ labs: { undo: true } }));
  const { labs, opts } = loadLabs(s);
  assert.equal(labs.undo, true);
  assert.equal(labs.budget, false);
  assert.deepEqual(opts, DEFAULT_OPTS);
});

test("saveLabs + loadLabs round-trip", () => {
  const s = memStorage();
  saveLabs({ ...DEFAULT_LABS, mysteryGaps: true }, { maxOverlapYears: 5, budget: 12 }, s);
  const { labs, opts } = loadLabs(s);
  assert.equal(labs.mysteryGaps, true);
  assert.equal(opts.maxOverlapYears, 5);
  assert.equal(opts.budget, 12);
});

test("recordResult keeps the lower count and reports records", () => {
  const s = memStorage();
  let r = recordResult({}, "classic", 10, s);
  assert.equal(r.isRecord, true);
  r = recordResult(r.records, "classic", 8, s);
  assert.equal(r.isRecord, true);
  assert.equal(r.records.classic, 8);
  r = recordResult(r.records, "classic", 12, s);
  assert.equal(r.isRecord, false);
  assert.equal(r.records.classic, 8);
  assert.deepEqual(loadRecords(s), { classic: 8 });
});

// ------------------------------------------------------------ canAddPerson

const BOUNDS = [-470, 2026];
const anchor = { id: "a", label: "Anchor", birth: -470, death: -399 };

test("canAddPerson: labs off = old behavior (anything ok)", () => {
  const cand = { id: "x", label: "X", birth: -450, death: -100 }; // overlaps covered time heavily
  assert.deepEqual(canAddPerson(cand, [anchor], { ...DEFAULT_LABS }, DEFAULT_OPTS, BOUNDS), { ok: true });
});

test("coveredIntervals / overlapYears merge and measure covered overlap", () => {
  const people = [anchor, { id: "b", birth: -410, death: 100 }];
  assert.deepEqual(coveredIntervals(people, BOUNDS), [[-470, 100]]);
  // candidate [-460,-100] intersects covered [-470,100] in [-460,-100] = 360y
  assert.equal(overlapYears({ birth: -460, death: -100 }, people, BOUNDS), 360);
  // candidate born inside a gap adds no overlap
  const gapped = [anchor, { id: "b", birth: 0, death: 100 }];
  assert.deepEqual(coveredIntervals(gapped, BOUNDS), [[-470, -399], [0, 100]]);
  assert.equal(overlapYears({ birth: -300, death: -10 }, gapped, BOUNDS), 0);
});

test("canAddPerson: frontier-only rejects overlap > k, accepts <= k", () => {
  const labs = { ...DEFAULT_LABS, maxOverlap: true };
  const far = { id: "x", label: "X", birth: -460, death: -100 }; // 61y inside anchor's covered [-470,-399]
  const r1 = canAddPerson(far, [anchor], labs, { ...DEFAULT_OPTS, maxOverlapYears: 10 }, BOUNDS);
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /61y/);
  const near = { id: "y", label: "Y", birth: -405, death: -100 }; // 6y overlap
  assert.equal(canAddPerson(near, [anchor], labs, { ...DEFAULT_OPTS, maxOverlapYears: 10 }, BOUNDS).ok, true);
  // a gap filler born inside the gap has zero covered-overlap -> allowed
  const filler = { id: "z", label: "Z", birth: -390, death: -380 };
  assert.equal(canAddPerson(filler, [anchor], labs, { ...DEFAULT_OPTS, maxOverlapYears: 10 }, BOUNDS).ok, true);
});

test("canAddPerson: budget cap rejects at the cap, 0 = unlimited", () => {
  const labs = { ...DEFAULT_LABS, budget: true };
  const people = [anchor, { id: "b" }, { id: "c" }];
  const cand = { id: "x", label: "X", birth: -300, death: 100 };
  assert.equal(canAddPerson(cand, people, labs, { ...DEFAULT_OPTS, budget: 3 }, BOUNDS).ok, false);
  assert.equal(canAddPerson(cand, people, labs, { ...DEFAULT_OPTS, budget: 4 }, BOUNDS).ok, true);
  assert.equal(canAddPerson(cand, people, labs, { ...DEFAULT_OPTS, budget: 0 }, BOUNDS).ok, true);
});

// ------------------------------------------------------------ coverage helpers

test("computeCoverage sanity: single anchor leaves one big gap", () => {
  const { gaps, total } = computeCoverage([anchor], BOUNDS);
  assert.deepEqual(gaps, [[-399, 2026]]);
  assert.equal(total, 71);
});

test("marginalYears: redundant person holds 0, bridger holds the bridge", () => {
  const A = { id: "A", birth: 0, death: 50 };
  const B = { id: "B", birth: 40, death: 100 };
  const C = { id: "C", birth: 45, death: 55 }; // fully inside A∪B
  const bounds = [0, 100];
  assert.equal(marginalYears(C, [A, B, C], bounds), 0);   // fully redundant
  assert.equal(marginalYears(A, [A, B, C], bounds), 40);  // without A, [0,40) is lost
  assert.equal(marginalYears(B, [A, B, C], bounds), 45);  // without B, coverage stops at 55 (A+C)
});

test("nextLargestGap picks largest and can exclude the current one", () => {
  const gaps = [[0, 10], [20, 80], [90, 100]];
  assert.deepEqual(nextLargestGap(gaps), [20, 80]);
  const ng = nextLargestGap(gaps, [20, 80]);
  assert.ok(ng[1] - ng[0] === 10); // one of the two 10-year gaps
  assert.equal(nextLargestGap([], null), null);
});

test("nearMiss: >=80% but incomplete is a near-miss, complete is not", () => {
  const people = [{ id: "a", birth: 0, death: 500 }];
  const range = [500, 1000];
  const close = nearMiss({ birth: 500, death: 950 }, range, people, [0, 1000]);
  assert.deepEqual(close, { left: 50, frac: 0.9 });
  assert.equal(nearMiss({ birth: 500, death: 1000 }, range, people, [0, 1000]), null);
  assert.equal(nearMiss({ birth: 500, death: 700 }, range, people, [0, 1000]), null);
  assert.equal(rangeYearsLeft({ birth: 500, death: 950 }, range, people, [0, 1000]), 50);
});

// ------------------------------------------------------------ share links

test("share encode/decode round-trips (incl. unicode and BC years)", () => {
  const payload = {
    v: 1,
    challenge: { key: "women", name: "Women of History", mode: "women", anchorId: "Q17892", endId: null, endYear: null, custom: false },
    ids: ["Q1", "Q2"],
    range: [-470, 180],
  };
  const s = encodeShare(payload);
  assert.ok(!/[+/=]/.test(s), "url-safe alphabet");
  assert.deepEqual(decodeShare(s), payload);
});
