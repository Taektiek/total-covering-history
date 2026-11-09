// Unit tests for the daily puzzles + leaderboard (src/daily.js). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES } from "../src/lib.js";
import {
  dateKeyOf, dailyPuzzles, dailyDef, CATEGORY_DIFFICULTY,
  loadBoard, submitResult, boardFor, bestFor, fmtMs,
} from "../src/daily.js";

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

const PRESENT = 2026;

// ------------------------------------------------------------ generation

test("dailyPuzzles is deterministic per date", () => {
  assert.deepEqual(dailyPuzzles("2026-11-03", PRESENT), dailyPuzzles("2026-11-03", PRESENT));
  assert.notDeepEqual(dailyPuzzles("2026-11-03", PRESENT), dailyPuzzles("2026-11-04", PRESENT));
});

test("three puzzles, easiest first: era ladder, spans, categories", () => {
  const half = Math.floor(CATEGORY_DIFFICULTY.length / 2);
  for (let d = 1; d <= 400; d++) {
    const key = `2026-01-${String(d % 28 + 1).padStart(2, "0")}`; // sample dates
    const [p1, p2, p3] = dailyPuzzles(`${key}-x${d}`, PRESENT);
    // spans: never more than 200 years, always positive
    for (const p of [p1, p2, p3]) {
      const span = p.endYear - p.startYear;
      assert.ok(span > 0 && span <= 200, `${key}: span ${span}`);
      assert.ok(p.startYear < p.endYear);
    }
    // era ladder: easy (>=1850 end) > medium (1450..1750) > hard (900..1350)
    assert.ok(p1.endYear >= 1850 && p1.endYear <= PRESENT - 5, `p1 end ${p1.endYear}`);
    assert.ok(p2.endYear >= 1450 && p2.endYear <= 1750, `p2 end ${p2.endYear}`);
    assert.ok(p3.endYear >= 900 && p3.endYear <= 1350, `p3 end ${p3.endYear}`);
    assert.ok(p1.endYear > p2.endYear && p2.endYear > p3.endYear, "recency ordering");
    // categories: #1 open, #2 from easier half, #3 from harder half, both valid
    assert.equal(p1.mode, null);
    assert.ok(CATEGORY_DIFFICULTY.slice(0, half).includes(p2.mode), `p2 cat ${p2.mode}`);
    assert.ok(CATEGORY_DIFFICULTY.slice(half).includes(p3.mode), `p3 cat ${p3.mode}`);
    assert.ok(CATEGORIES[p2.mode] && CATEGORIES[p3.mode]);
  }
});

test("dailyDef builds a range-only challenge def", () => {
  const [p1] = dailyPuzzles("2026-11-03", PRESENT);
  const def = dailyDef("2026-11-03", p1);
  assert.equal(def.anchorId, undefined);
  assert.equal(def.startYear, p1.startYear);
  assert.equal(def.endYear, p1.endYear);
  assert.deepEqual(def.daily, { dateKey: "2026-11-03", n: 1 });
  assert.equal(def.key, "daily-2026-11-03-1");
});

test("dateKeyOf formats local date", () => {
  assert.equal(dateKeyOf(new Date(2026, 10, 3)), "2026-11-03");
  assert.equal(dateKeyOf(new Date(2026, 0, 5)), "2026-01-05");
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
