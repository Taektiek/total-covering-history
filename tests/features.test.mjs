// Unit tests for the standard (always-on) features: local records + share
// links (src/features.js). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { loadRecords, recordResult, encodeShare, decodeShare, loadAutosave, saveAutosave, clearAutosave } from "../src/features.js";

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _m: m,
  };
}

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

test("loadRecords: no storage / corrupt all safe", () => {
  assert.deepEqual(loadRecords(null), {});
  const s = memStorage();
  s.setItem("ttc-records-v1", "{nope");
  assert.deepEqual(loadRecords(s), {});
});

test("autosave: round-trip, corrupt-safe, clearable", () => {
  const s = memStorage();
  assert.equal(loadAutosave(s), null);
  const payload = { version: 2, challenge: { key: "daily-2026-11-09-1", anchorId: "Q1203", endId: "Q3626966" }, ids: ["Q1744"], range: [1980, 1994] };
  saveAutosave(payload, s);
  assert.deepEqual(loadAutosave(s), payload);
  s.setItem("ttc-autosave-v2", "{nope");
  assert.equal(loadAutosave(s), null);
  saveAutosave(payload, s);
  clearAutosave(s);
  assert.equal(loadAutosave(s), null);
  // malformed shapes rejected
  saveAutosave({ version: 2 }, s);
  assert.equal(loadAutosave(s), null);
});

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
