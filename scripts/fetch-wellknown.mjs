#!/usr/bin/env node
/**
 * fetch-wellknown.mjs — build src/data/wellknown.js from Wikidata.
 *
 * Downloads a static dataset of well-known historical people (humans with a
 * birth date and enough Wikipedia sitelinks) and writes it as an ES module
 * that the app imports (`WELL_KNOWN` from src/data/wellknown.js).
 *
 *   node scripts/fetch-wellknown.mjs            # fetch (cached) + write file
 *   node scripts/fetch-wellknown.mjs --refresh  # ignore cached windows/entities
 *
 * Selection rules:
 *   - humans (P31 = Q5) with a birth date (P569); people without P570 are
 *     kept with death: null (still alive)
 *   - notability via wikibase:sitelinks with per-era thresholds so ancient
 *     eras stay well represented: birth < 1500 -> sl >= 12, 1500..1799 -> 20,
 *     >= 1800 -> 30
 *   - categories (cats) mirror src/lib.js CATEGORIES exactly:
 *     women = P21 = Q6581072; scientists/philosophers/artists/writers/rulers
 *     = occupation P106 with wdt:P279* wd:Q901 / Q4964182 / Q483501+Q3391743
 *     (visual artist — painters live there, a sibling of "artist") / Q36180 / Q116
 *
 * Network behaviour (WDQS is rate-limited, 60s query limit):
 *   - narrow birth-year windows, no ORDER BY, LIMIT ~400 per window; a window
 *     that hits the LIMIT is split in half and retried (never truncated)
 *   - SPARQL only for the window scans and for batched subclass-ancestor
 *     lookups of the distinct occupation QIDs (VALUES chunks <= 250)
 *   - labels + claims (P21/P106) via the Wikidata API wbgetentities,
 *     50 ids per call
 *   - retries with exponential backoff (429s happen), ~400ms between calls
 *   - everything is cached under scripts/cache-wellknown/ (gitignored), so
 *     re-runs resume where they left off
 */
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CACHE_DIR = path.join(HERE, "cache-wellknown");
const OUT_FILE = path.join(ROOT, "src", "data", "wellknown.js");

const WDQS = "https://query.wikidata.org/sparql";
const WDAPI = "https://www.wikidata.org/w/api.php";
const UA =
  "total-covering-history-fetch-wellknown/1.0 (https://github.com/Taektiek/total-covering-history)";

// ---------------------------------------------------------------- config

const LO = -3000; // oldest birth year to scan (spec: go back to at least -3000)
const HI = new Date().getFullYear() + 1; // youngest birth year to scan
const LIMIT = 600; // max people per window query; hit -> split the window
const CONCURRENCY = 3; // parallel window scans (WDQS tolerates a few; retries handle 429s)
const MAX_TOTAL = 4000; // cap on final dataset size (file stays app-friendly)
const MIN_PER_ERA = 200; // keep at least this many entries per era bucket

const CATS = ["women", "scientists", "philosophers", "artists", "writers", "rulers"];
const CAT_ROOTS = {
  Q901: "scientists",
  Q4964182: "philosophers",
  Q483501: "artists",
  Q3391743: "artists", // visual artist — painters/sculptors sit here, a SIBLING of Q483501
  Q36180: "writers",
  Q116: "rulers",
};
const FEMALE = "Q6581072";

// era buckets the app cares about (computed from birth year)
const ERAS = [
  ["ancient", -Infinity, 500],
  ["medieval", 500, 1500],
  ["early modern", 1500, 1800],
  ["modern", 1800, 1950],
  ["contemporary", 1950, Infinity],
];

const REFRESH = process.argv.includes("--refresh");
// SKIP_SCAN=1: ingest the cached window scans only, skip any remaining scans
// (the cache already holds far more people than MAX_TOTAL, so extra scans are
// wasted rate-limit budget)
const SKIP_SCAN = !!process.env.SKIP_SCAN;
// HOLE_SL>0: fill only the window "holes" an interrupted scan left behind
// (split children that were never fetched), at a raised sitelink threshold —
// fast, and enough to capture the famous people those holes are missing.
const HOLE_SL = Number(process.env.HOLE_SL || 0);

// per-era notability threshold
function slThreshold(birthYear) {
  if (birthYear < 1500) return 12;
  if (birthYear < 1800) return 20;
  return 30;
}

// window width (years) per birth era: sparse eras get wide windows, dense
// modern decades narrow ones, so no query comes close to the 60s limit
function windowWidth(y) {
  if (y < -1000) return 250;
  if (y < 0) return 100;
  if (y < 500) return 50;
  if (y < 1500) return 25;
  if (y < 1800) return 25;
  if (y < 1900) return 10;
  return 5;
}

function* planWindows(lo, hi) {
  let y = lo;
  while (y < hi) {
    const w = windowWidth(y);
    yield [y, Math.min(y + w, hi)];
    y += w;
  }
}

// ---------------------------------------------------------------- helpers

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function yf(y) {
  // xsd:dateTime year, at least 4 digits, negative for BC
  return y < 0 ? `-${String(-y).padStart(4, "0")}` : String(y).padStart(4, "0");
}

const YEAR_RE = /^([+-]?\d{4,})/;
function yearOf(dt) {
  if (!dt) return null;
  const m = YEAR_RE.exec(dt);
  return m ? parseInt(m[1], 10) : null;
}

// Mirror src/lib.js extractYear exactly: the first claim with a time value
// wins ("+1969-…" → 1969, "-0470-…" → -470). SPARQL literals shift BC years by
// 1-2 vs the API time values, so the file must take years from the API claims
// (the same source the app uses) to stay consistent with it.
function apiYear(claims, prop) {
  for (const v of (claims?.[prop] || [])) {
    const tv = v.mainsnak?.datavalue?.value?.time;
    if (tv) {
      const m = /^[+-]?(\d+)-/.exec(tv);
      if (m) {
        let y = parseInt(m[1], 10);
        if (tv.startsWith("-")) y = -y;
        return y;
      }
    }
  }
  return null;
}

// fetch JSON with retries + exponential backoff (endpoint rate-limits: 429s)
async function fetchJson(url, { retries = 6, timeoutMs = 90000, what = "" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json, application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (resp.status === 429) {
        const ra = Number(resp.headers.get("retry-after")) || 0;
        const wait = Math.max(ra * 1000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        log(`  ! 429 on ${what}, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${what}`);
      return await resp.json();
    } catch (err) {
      lastErr = err;
      const wait = Math.min(60000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      log(`  ! ${what} failed (${err.message || err}); retry in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  throw lastErr || new Error(`fetch failed: ${what}`);
}

async function sparql(query, what, opts = {}) {
  const url = `${WDQS}?format=json&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { what: `SPARQL ${what}`, ...opts });
  return data.results.bindings;
}

// ---------------------------------------------------------------- cache

// Stream-parse a jsonl cache: one record at a time, skipping corrupt lines
// (two processes may append concurrently). Holding the whole file parsed OOMs
// on the entity cache (~250MB raw).
async function* readJsonl(file) {
  let txt;
  try { txt = await readFile(file, "utf8"); } catch { return; }
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* skip corrupt line */ }
  }
}

async function loadJsonl(file) {
  const out = [];
  for await (const rec of readJsonl(file)) out.push(rec);
  return out;
}

// Only the key of each record is needed for cache-hit detection — stream it.
async function loadJsonlKeys(file, keyFn) {
  const out = new Set();
  for await (const rec of readJsonl(file)) { const k = keyFn(rec); if (k) out.add(k); }
  return out;
}

// serialize cache writes so parallel workers can't interleave lines
let writeLock = Promise.resolve();
async function appendJsonl(file, rec) {
  const line = JSON.stringify(rec) + "\n";
  writeLock = writeLock.then(() => appendFile(file, line, "utf8"));
  await writeLock;
}

// ---------------------------------------------------------------- phase 1: window scans

const WINDOW_QUERY = (w0, w1, sl) => `SELECT ?item ?birth ?death ?sl WHERE {
  ?item wdt:P31 wd:Q5 .
  ?item wdt:P569 ?birth .
  ?item wikibase:sitelinks ?sl .
  OPTIONAL { ?item wdt:P570 ?death . }
  FILTER(?sl >= ${sl})
  FILTER(?birth >= "${yf(w0)}-01-01T00:00:00Z"^^xsd:dateTime &&
          ?birth <  "${yf(w1)}-01-01T00:00:00Z"^^xsd:dateTime)
} LIMIT ${LIMIT}`;

async function fetchWindow(w0, w1, done, queue, depth = 0, slOverride = null) {
  const sl = slOverride ?? slThreshold(w0);
  const key = `${w0}:${w1}:${sl}`;
  if (done.has(key)) return 0;
  const label = `window ${w0}..${w1} (sl>=${sl})`;
  let rows;
  try {
    // WDQS kills queries at 60s; fail fast and split the window instead
    rows = await sparql(WINDOW_QUERY(w0, w1, sl), label, { retries: 2, timeoutMs: 45000 });
  } catch (err) {
    // timeout / persistent error: split the window in half (like solve.py)
    if (w1 - w0 > 1 && depth < 14) {
      log(`  splitting ${label} after failure`);
      await appendJsonl(path.join(CACHE_DIR, "windows.jsonl"), { w: [w0, w1], sl, split: true });
      done.add(key);
      const mid = w0 + Math.floor((w1 - w0) / 2);
      queue.push([w0, mid, slOverride], [mid, w1, slOverride]);
      return 0;
    }
    throw err;
  }
  if (rows.length >= LIMIT && w1 - w0 > 1 && depth < 14) {
    // window denser than LIMIT: split so nothing is lost
    log(`  ${label} hit LIMIT ${LIMIT} -> splitting`);
    await appendJsonl(path.join(CACHE_DIR, "windows.jsonl"), { w: [w0, w1], sl, split: true });
    done.add(key);
    const mid = w0 + Math.floor((w1 - w0) / 2);
    queue.push([w0, mid, slOverride], [mid, w1, slOverride]);
    return 0;
  }
  await appendJsonl(path.join(CACHE_DIR, "windows.jsonl"), { w: [w0, w1], sl, rows });
  done.add(key);
  log(`  ${label}: ${rows.length} rows`);
  return rows.length;
}

function ingestRows(rows, people) {
  for (const r of rows) {
    const qid = r.item.value.split("/").pop();
    const birth = yearOf(r.birth?.value);
    if (birth === null) continue;
    const death = r.death ? yearOf(r.death.value) : null;
    const sl = parseInt(r.sl.value, 10);
    const cur = people.get(qid);
    if (!cur) people.set(qid, { birth, death, sl });
    else {
      cur.birth = Math.min(cur.birth, birth);
      if (death !== null) cur.death = cur.death === null ? death : Math.max(cur.death, death);
      cur.sl = Math.max(cur.sl, sl);
    }
  }
}

// ---------------------------------------------------------------- phase 2: entities (labels, sex, occupations)

// truthy statement values (what wdt: sees in SPARQL): preferred rank, else normal
function truthyEntityIds(claims, prop) {
  const out = new Set();
  const list = claims?.[prop] || [];
  for (const c of list) if (c.rank === "preferred" && c.mainsnak?.datavalue?.value?.id) out.add(c.mainsnak.datavalue.value.id);
  if (out.size === 0)
    for (const c of list) if (c.rank === "normal" && c.mainsnak?.datavalue?.value?.id) out.add(c.mainsnak.datavalue.value.id);
  return out;
}

async function fetchEntities(qids, done) {
  const file = path.join(CACHE_DIR, "entities.jsonl");
  const out = new Map();
  const todo = [];
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const key = batch.join("|");
    if (done.has(key)) continue;
    todo.push({ batch, key });
  }
  log(`entities: ${todo.length} batches of <=50 to fetch (${qids.length - todo.length} already cached)`);
  for (const { batch, key } of todo) {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels|claims",
      languages: "en",
      format: "json",
      origin: "*",
    });
    const data = await fetchJson(`${WDAPI}?${params}`, { what: `wbgetentities ${batch[0]}..${batch[batch.length - 1]}` });
    await appendJsonl(file, { ids: key, entities: data.entities });
    done.add(key);
    for (const [qid, ent] of Object.entries(data.entities || {})) out.set(qid, ent);
    await sleep(400);
  }
  // load cached batches for the ones we skipped — only keep selected qids so
  // the entity cache (hundreds of MB) doesn't have to fit in memory whole
  const wanted = new Set(qids);
  for await (const rec of readJsonl(file)) {
    for (const [qid, ent] of Object.entries(rec.entities || {})) if (wanted.has(qid) && !out.has(qid)) out.set(qid, ent);
  }
  return out;
}

// ---------------------------------------------------------------- phase 3: occupation ancestors

const OCCANC_QUERY = occs => `SELECT DISTINCT ?occ ?root WHERE {
  VALUES ?occ { ${occs.map(q => `wd:${q}`).join(" ")} }
  ?occ wdt:P279* ?root .
  FILTER(?root IN (wd:Q901, wd:Q4964182, wd:Q483501, wd:Q3391743, wd:Q36180, wd:Q116))
}`;

async function fetchOccAncestors(occs, done) {
  const file = path.join(CACHE_DIR, "occanc.jsonl");
  const roots = new Map(); // occ -> Set(root)
  for (const rec of await loadJsonl(file)) {
    for (const [occ, root] of rec.pairs) {
      if (!roots.has(occ)) roots.set(occ, new Set());
      roots.get(occ).add(root);
    }
  }
  const todo = [];
  for (let i = 0; i < occs.length; i += 250) {
    const chunk = occs.slice(i, i + 250).sort();
    const key = chunk.join("|");
    if (done.has(key)) continue;
    todo.push({ chunk, key });
  }
  log(`occupation ancestors: ${todo.length} chunks of <=250 to fetch (${occs.length - todo.length} occs cached)`);
  for (const { chunk, key } of todo) {
    const rows = await sparql(OCCANC_QUERY(chunk), `occ-ancestors ${chunk.length} occs`);
    const pairs = rows.map(r => [r.occ.value.split("/").pop(), r.root.value.split("/").pop()]);
    await appendJsonl(file, { occs: key, pairs });
    done.add(key);
    for (const [occ, root] of pairs) {
      if (!roots.has(occ)) roots.set(occ, new Set());
      roots.get(occ).add(root);
    }
    await sleep(400);
  }
  return roots;
}

// ---------------------------------------------------------------- downsampling

function eraOf(birth) {
  for (const [name, lo, hi] of ERAS) if (birth >= lo && birth < hi) return name;
  return "ancient";
}

// keep the most notable people per era, at least MIN_PER_ERA each, at most
// MAX_TOTAL overall, so the generated file stays diverse but app-sized
function downsample(people) {
  const buckets = new Map(ERAS.map(([n]) => [n, []]));
  for (const [qid, p] of people) buckets.get(eraOf(p.birth)).push([qid, p]);
  const total = people.size;
  if (total <= MAX_TOTAL) return new Map([...people].sort((a, b) => b[1].sl - a[1].sl || (a[0] < b[0] ? -1 : 1)));
  const counts = Object.fromEntries([...buckets].map(([n, arr]) => [n, arr.length]));
  // allocate MAX_TOTAL slots proportionally, guaranteeing MIN_PER_ERA each
  const alloc = {};
  let remaining = MAX_TOTAL - ERAS.length * MIN_PER_ERA;
  const pool = total - ERAS.length * MIN_PER_ERA;
  for (const [name] of ERAS) alloc[name] = MIN_PER_ERA + Math.floor((remaining * Math.max(0, counts[name] - MIN_PER_ERA)) / Math.max(1, pool));
  let sum = Object.values(alloc).reduce((a, b) => a + b, 0);
  while (sum > MAX_TOTAL) {
    const biggest = Object.entries(alloc).sort((a, b) => b[1] - a[1])[0][0];
    if (alloc[biggest] <= MIN_PER_ERA) break;
    alloc[biggest]--; sum--;
  }
  const kept = new Map();
  for (const [name, arr] of buckets) {
    arr.sort((a, b) => b[1].sl - a[1].sl || (a[0] < b[0] ? -1 : 1));
    for (const [qid, p] of arr.slice(0, alloc[name])) kept.set(qid, p);
  }
  log(`downsampled ${total} -> ${kept.size} (per-era alloc: ${ERAS.map(([n]) => `${n}=${alloc[n]}`).join(" ")})`);
  return kept;
}

// ---------------------------------------------------------------- main

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const windowsFile = path.join(CACHE_DIR, "windows.jsonl");
  const entitiesFile = path.join(CACHE_DIR, "entities.jsonl");
  const occancFile = path.join(CACHE_DIR, "occanc.jsonl");

  // ---- phase 1: cached window scans
  const doneWindows = new Set();
  const splitMap = new Map(); // key -> [w0,w1] for records that were split
  const people = new Map();
  for (const rec of REFRESH ? [] : await loadJsonl(windowsFile)) {
    const key = `${rec.w[0]}:${rec.w[1]}:${rec.sl}`;
    doneWindows.add(key);
    if (rec.split) splitMap.set(key, rec.w);
    if (rec.rows) ingestRows(rec.rows, people);
  }
  log(`cache: ${people.size} people from ${doneWindows.size} window records`);
  // Walk the plan plus any recorded splits to find leaf windows not yet
  // cached (fixes resume: children of split windows are re-queued, not lost).
  const collectMissing = (w0, w1, sl, out) => {
    const key = `${w0}:${w1}:${sl}`;
    if (doneWindows.has(key)) {
      if (splitMap.has(key) && w1 - w0 > 1) {
        const mid = w0 + Math.floor((w1 - w0) / 2);
        collectMissing(w0, mid, sl, out);
        collectMissing(mid, w1, sl, out);
      }
      return;
    }
    // a hole filled at the raised HOLE_SL threshold counts as done too
    if (HOLE_SL > 0 && doneWindows.has(`${w0}:${w1}:${Math.max(sl, HOLE_SL)}`)) return;
    out.push([w0, w1, null]);
  };
  let queue = [];
  for (const [w0, w1] of planWindows(LO, HI)) collectMissing(w0, w1, slThreshold(w0), queue);
  if (SKIP_SCAN) {
    log(`SKIP_SCAN=1: skipping ${queue.length} remaining window scans, using cache only`);
    queue = [];
  } else if (HOLE_SL > 0) {
    queue = queue.map(([w0, w1]) => [w0, w1, Math.max(slThreshold(w0), HOLE_SL)]);
    log(`HOLE_SL=${HOLE_SL}: filling ${queue.length} uncached leaf windows at raised sitelink threshold`);
  } else {
    log(`phase 1: ${queue.length} leaf windows still to scan`);
  }
  let n = 0;
  const failures = [];
  const worker = async () => {
    while (queue.length) {
      const [w0, w1, slOv] = queue.shift();
      try {
        n += await fetchWindow(w0, w1, doneWindows, queue, 0, slOv);
      } catch (err) {
        failures.push([w0, w1]);
        log(`  !! window ${w0}..${w1} failed permanently: ${err.message || err}`);
      }
      await sleep(350);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`phase 1 done: ${n} rows this run, ${people.size} people total in cache, ${failures.length} failed windows`);
  if (failures.length) {
    log(`WARNING: ${failures.length} windows failed (re-run to retry): ${failures.map(f => `${f[0]}..${f[1]}`).join(", ")}`);
    process.exitCode = 1;
  }

  // ---- downsample to the final selection (by sl within each era)
  const selected = downsample(people);
  const qids = [...selected.keys()];

  // ---- phase 2: labels + claims (sex, occupations) for selected people only
  const doneEntities = REFRESH ? new Set() : await loadJsonlKeys(entitiesFile, r => r.ids);
  const entities = await fetchEntities(qids, doneEntities);

  const entries = [];
  const occs = new Set();
  let noLabel = 0;
  for (const qid of qids) {
    const ent = entities.get(qid);
    const label = ent?.labels?.en?.value;
    if (!label) {
      noLabel++;
      continue;
    }
    const p = selected.get(qid);
    const sex = ent ? truthyEntityIds(ent.claims, "P21") : new Set();
    const occSet = ent ? truthyEntityIds(ent.claims, "P106") : new Set();
    for (const o of occSet) occs.add(o);
    // years from the API claims (same source & parsing as the app), so the
    // file is consistent with what the app shows for the same person
    const bYear = ent ? apiYear(ent.claims, "P569") : null;
    const dYear = ent ? apiYear(ent.claims, "P570") : null;
    entries.push({
      id: qid,
      label,
      birth: ent ? (bYear ?? p.birth) : p.birth,
      death: ent ? dYear : p.death, // no P570 claim -> null = still alive
      sl: p.sl,
      _sex: sex,
      _occs: occSet,
    });
  }
  log(`phase 2 done: ${entries.length} entries with en label (${noLabel} dropped, no en label), ${occs.size} distinct occupations`);

  // ---- phase 3: resolve occupation -> category roots in chunks
  const doneOcc = REFRESH ? new Set() : await loadJsonlKeys(occancFile, r => r.occs);
  const occRoots = await fetchOccAncestors([...occs], doneOcc);

  // ---- build cats and final entries
  const CATS_ORDER = Object.fromEntries(CATS.map((c, i) => [c, i]));
  const final = entries.map(e => {
    const cats = new Set();
    if (e._sex.has(FEMALE)) cats.add("women");
    for (const occ of e._occs) {
      for (const root of occRoots.get(occ) || []) {
        const cat = CAT_ROOTS[root];
        if (cat) cats.add(cat);
      }
    }
    const ordered = [...cats].sort((a, b) => CATS_ORDER[a] - CATS_ORDER[b]);
    return { id: e.id, label: e.label, birth: e.birth, death: e.death, sl: e.sl, cats: ordered };
  });
  // dedupe by id (paranoia), sort by sl desc
  const seen = new Set();
  const sorted = final
    .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.sl - a.sl || a.birth - b.birth || (a.id < b.id ? -1 : 1));

  // ---- write the data file (exact format the app imports)
  const header = `// Generated by scripts/fetch-wellknown.mjs — do not edit by hand.
// entry: id = Wikidata QID, label = English label, birth/death = years (BC negative; death null = still alive),
//        sl = Wikipedia sitelink count (notability), cats = subset of ["women","scientists","philosophers","artists","writers","rulers"]
export const WELL_KNOWN = [
`;
  const lines = sorted.map(
    e =>
      `  { id: ${JSON.stringify(e.id)}, label: ${JSON.stringify(e.label)}, birth: ${e.birth}, death: ${e.death === null ? "null" : e.death}, sl: ${e.sl}, cats: [${e.cats.map(c => JSON.stringify(c)).join(", ")}] }`
  );
  await writeFile(OUT_FILE, header + lines.join(",\n") + "\n];\n", { encoding: "utf8", mode: 0o644 });
  log(`wrote ${OUT_FILE}: ${sorted.length} entries`);

  // ---- report: era x category matrix
  const matrix = {};
  for (const [name] of ERAS) {
    matrix[name] = Object.fromEntries(CATS.map(c => [c, 0]));
    matrix[name].total = 0;
  }
  for (const e of sorted) {
    const era = eraOf(e.birth);
    matrix[era].total++;
    for (const c of e.cats) matrix[era][c]++;
  }
  console.log("\n=== era x category matrix ===");
  console.log(["era", ...CATS, "total"].join("\t"));
  for (const [name] of ERAS) console.log([name, ...CATS.map(c => matrix[name][c]), matrix[name].total].join("\t"));
  const catTotals = Object.fromEntries(CATS.map(c => [c, sorted.filter(e => e.cats.includes(c)).length]));
  console.log(["TOTAL", ...CATS.map(c => catTotals[c]), sorted.length].join("\t"));
  const alive = sorted.filter(e => e.death === null).length;
  console.log(`\nalive (death null): ${alive}; birth range: ${Math.min(...sorted.map(e => e.birth))} .. ${Math.max(...sorted.map(e => e.birth))}`);
}

main().catch(err => {
  console.error("FAILED:", err);
  process.exit(1);
});
