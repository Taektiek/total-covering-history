// Unit tests for the daily puzzles + leaderboard (src/daily.js). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES } from "../src/lib.js";
import { WELL_KNOWN } from "../src/data/wellknown.js";
import {
  dateKeyOf, dailyPuzzles, dailyDef, nextDaily, CATEGORY_DIFFICULTY,
  eraOf, wellKnownPool, minBridgers,
  loadBoard, submitResult, boardFor, bestFor, fmtMs,
} from "../src/daily.js";

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

const PRESENT = 2026;
const byId = new Map(WELL_KNOWN.map(p => [p.id, p]));

// ------------------------------------------------------------ generation

test("dailyPuzzles is deterministic per date", () => {
  assert.deepEqual(dailyPuzzles("2026-11-03", PRESENT), dailyPuzzles("2026-11-03", PRESENT));
});

test("dailyPuzzles varies across dates", () => {
  const seen = new Set();
  for (let d = 1; d <= 20; d++) {
    const key = `2026-02-${String(d).padStart(2, "0")}`;
    seen.add(JSON.stringify(dailyPuzzles(key, PRESENT).map(p => [p.anchorId, p.endId])));
  }
  assert.ok(seen.size >= 5, `expected diverse puzzles across dates, got ${seen.size}`);
});

test("three life-pair puzzles per day: structure, gap, modes, bridgeability", () => {
  const half = Math.floor(CATEGORY_DIFFICULTY.length / 2);
  for (let d = 1; d <= 24; d++) {
    const key = `2026-03-${String(d % 28 + 1).padStart(2, "0")}-x${d}`;
    const puzzles = dailyPuzzles(key, PRESENT);
    assert.equal(puzzles.length, 3);
    assert.deepEqual(puzzles.map(p => p.n), [1, 2, 3]);
    const pool = wellKnownPool(PRESENT);
    for (const p of puzzles) {
      // endpoints are well-known people from the table
      const anchor = byId.get(p.anchorId), end = byId.get(p.endId);
      assert.ok(anchor && end, `unknown endpoint ${p.anchorId}/${p.endId}`);
      assert.ok(anchor.label && end.label);
      assert.equal(p.startYear, anchor.birth);
      assert.equal(p.endYear, end.death ?? PRESENT);
      // the anchor must be dead and the end born after the anchor died: a real gap
      assert.ok(anchor.death !== null && anchor.death !== undefined, `${anchor.label} must be dead`);
      const gap = end.birth - anchor.death;
      assert.ok(gap > 0, `no gap between ${anchor.label} and ${end.label}`);
      // the gap between the two lives is the challenge: substantial by design
      // (40-160y strict; only relaxed fallbacks on thin tables go lower)
      if (WELL_KNOWN.length >= 200) assert.ok(gap >= 10, `${key} #${p.n}: gap only ${gap}y`);
      // window is bounded (sanity cap; tiny placeholder tables may fall back further)
      const maxSpan = WELL_KNOWN.length >= 200 ? 500 : 1500;
      assert.ok(p.span > 0 && p.span <= maxSpan, `span ${p.span}`);
      // the gap must be bridgeable with table people of the puzzle's category
      // (guaranteed by construction on a full table; best-effort on tiny ones)
      const need = minBridgers(anchor.death, end.birth, pool, p.mode);
      if (WELL_KNOWN.length >= 200) {
        assert.ok(need <= 12, `${key} #${p.n}: gap needs ${need} bridgers`);
      }
      // both endpoints respect the category restriction when there is one
      if (p.mode) {
        assert.ok(anchor.cats?.includes(p.mode), `${anchor.label} not ${p.mode}`);
        assert.ok(end.cats?.includes(p.mode), `${end.label} not ${p.mode}`);
      }
    }
    // category ladder: #1 open, #2 from the easier half, #3 from the harder half
    assert.equal(puzzles[0].mode, null);
    assert.ok(CATEGORY_DIFFICULTY.slice(0, half).includes(puzzles[1].mode), `p2 cat ${puzzles[1].mode}`);
    assert.ok(CATEGORY_DIFFICULTY.slice(half).includes(puzzles[2].mode), `p3 cat ${puzzles[2].mode}`);
    assert.ok(CATEGORIES[puzzles[1].mode] && CATEGORIES[puzzles[2].mode]);
  }
});

test("era ladder holds on a full table (recent → mid → old anchor)", () => {
  if (WELL_KNOWN.length < 500) return; // placeholder table: bands are best-effort
  for (let d = 1; d <= 24; d++) {
    const key = `2026-04-${String(d % 28 + 1).padStart(2, "0")}-x${d}`;
    const [p1, p2, p3] = dailyPuzzles(key, PRESENT);
    assert.ok(p1.startYear >= 1750, `p1 anchor birth ${p1.startYear}`);
    assert.ok(p2.startYear >= 1000 && p2.startYear < 1750, `p2 anchor birth ${p2.startYear}`);
    assert.ok(p3.startYear < 1000, `p3 anchor birth ${p3.startYear}`);
  }
});

test("dailyDef builds a life-pair challenge def", () => {
  const [p1] = dailyPuzzles("2026-11-03", PRESENT);
  const def = dailyDef("2026-11-03", p1);
  assert.equal(def.anchorId, p1.anchorId);
  assert.equal(def.endId, p1.endId);
  assert.equal(def.mode, p1.mode);
  assert.deepEqual(def.daily, { dateKey: "2026-11-03", n: 1 });
  assert.equal(def.key, "daily-2026-11-03-1");
});

test("nextDaily walks the chain and ends after #3", () => {
  const puzzles = dailyPuzzles("2026-11-03", PRESENT);
  assert.equal(nextDaily(puzzles, 1)?.n, 2);
  assert.equal(nextDaily(puzzles, 2)?.n, 3);
  assert.equal(nextDaily(puzzles, 3), null);
});

test("dateKeyOf formats local date", () => {
  assert.equal(dateKeyOf(new Date(2026, 10, 3)), "2026-11-03");
  assert.equal(dateKeyOf(new Date(2026, 0, 5)), "2026-01-05");
});

// ------------------------------------------------------------ helpers

test("eraOf buckets", () => {
  assert.equal(eraOf(-470), "ancient");
  assert.equal(eraOf(1200), "medieval");
  assert.equal(eraOf(1650), "earlyModern");
  assert.equal(eraOf(1900), "modern");
  assert.equal(eraOf(1990), "contemporary");
});

test("minBridgers: greedy cover is optimal, respects category, Infinity when stuck", () => {
  const pool = wellKnownPool(PRESENT);
  // empty gap needs nobody
  assert.equal(minBridgers(100, 100, pool), 0);
  // one person spanning the gap
  assert.equal(minBridgers(50, 150, [{ id: "x", label: "X", birth: 0, death: 200, cats: [] }]), 1);
  // two needed when nobody reaches from the gap start
  const two = [
    { id: "a", label: "A", birth: 0, death: 60, cats: ["writers"] },
    { id: "b", label: "B", birth: 55, death: 200, cats: ["writers"] },
  ];
  assert.equal(minBridgers(50, 150, two), 2);
  // greedy picks the furthest reach first: C[40,120] then B[55,200] -> still 2
  assert.equal(minBridgers(50, 150, [...two, { id: "c", label: "C", birth: 40, death: 120, cats: [] }]), 2);
  // unbridgeable
  assert.equal(minBridgers(50, 150, [{ id: "d", label: "D", birth: 200, death: 300, cats: [] }]), Infinity);
  // category filter: only writers eligible
  assert.equal(minBridgers(50, 150, two, "writers"), 2);
  assert.equal(minBridgers(50, 150, [{ ...two[0], cats: [] }], "writers"), Infinity);
});

// ------------------------------------------------------------ leaderboard

test("board: best-only upsert, ranked by people then time", () => {
  const s = memStorage();
  let board = loadBoard(s);
  assert.deepEqual(board, { entries: [] });

  let r = submitResult(board, { dateKey: "2026-11-03", n: 1, name: "Ada", people: 9, ms: 60000 }, s);
  assert.equal(r.improved, true);
  board = r.board;

  // worse (more people) -> ignored
  r = submitResult(board, { dateKey: "2026-11-03", n: 1, name: "Ada", people: 12, ms: 10000 }, s);
  assert.equal(r.improved, false);
  assert.equal(boardFor(r.board, "2026-11-03", 1).length, 1);

  // better (fewer people) -> replaces
  r = submitResult(board, { dateKey: "2026-11-03", n: 1, name: "Ada", people: 7, ms: 90000 }, s);
  assert.equal(r.improved, true);
  board = r.board;
  assert.equal(bestFor(board, "2026-11-03", 1).people, 7);

  // equal people but faster -> replaces (time tiebreak)
  r = submitResult(board, { dateKey: "2026-11-03", n: 1, name: "Ada", people: 7, ms: 45000 }, s);
  assert.equal(r.improved, true);
  assert.equal(bestFor(r.board, "2026-11-03", 1).ms, 45000);

  // equal people, slower -> ignored
  r = submitResult(r.board, { dateKey: "2026-11-03", n: 1, name: "Ada", people: 7, ms: 99999 }, s);
  assert.equal(r.improved, false);
  assert.equal(bestFor(r.board, "2026-11-03", 1).ms, 45000);

  // other puzzle / other day are separate entries
  r = submitResult(r.board, { dateKey: "2026-11-03", n: 2, name: "Ada", people: 5, ms: 1000 }, s);
  r = submitResult(r.board, { dateKey: "2026-11-04", n: 1, name: "Ada", people: 8, ms: 1000 }, s);
  board = r.board;
  assert.equal(board.entries.length, 3);
  assert.equal(bestFor(board, "2026-11-03", 2).people, 5);
  assert.equal(bestFor(board, "2026-11-04", 1).people, 8);
  assert.equal(bestFor(board, "2026-11-05", 1), null);

  // persisted
  assert.deepEqual(loadBoard(s).entries.length, 3);
});

test("boardFor returns only the best entry (fewest people, then fastest)", () => {
  const board = { entries: [
    { id: "a", dateKey: "d", n: 1, people: 8, ms: 100 },
    { id: "b", dateKey: "d", n: 1, people: 6, ms: 500 },
    { id: "c", dateKey: "d", n: 1, people: 6, ms: 200 },
    { id: "e", dateKey: "d", n: 2, people: 3, ms: 100 },
  ] };
  assert.deepEqual(boardFor(board, "d", 1).map(e => e.id), ["c"]);
  assert.deepEqual(boardFor(board, "d", 2).map(e => e.id), ["e"]);
  assert.deepEqual(boardFor(board, "d", 3), []);
});

test("loadBoard survives corrupt storage", () => {
  const s = memStorage();
  s.setItem("ttc-daily-board-v1", "{nope");
  assert.deepEqual(loadBoard(s), { entries: [] });
});

test("fmtMs", () => {
  assert.equal(fmtMs(0), "0s");
  assert.equal(fmtMs(45000), "45s");
  assert.equal(fmtMs(125000), "2m 5s");
});
