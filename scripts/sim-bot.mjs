/**
 * sim-bot.mjs — headless bot simulations for the labs (game-fun-experiments
 * Phase 4). Adapted from the skill's references/sim-bot-template.mjs.
 *
 * Synthetic world: a seeded pool of notable lifespans over [-800, 2026]; the
 * anchor covers [-470, -399]; a greedy bot adds the person with the largest
 * coverage gain until the timeline [-470, 2026] is covered or no legal add
 * remains. Core labs (frontier-only max-overlap, budget cap) change add
 * legality via canAddPerson, so we can A/B them on identical seeds.
 *
 * Run: node scripts/sim-bot.mjs   (or: npm run sim)
 */
import { computeCoverage } from "../src/lib.js";
import { canAddPerson, DEFAULT_LABS, DEFAULT_OPTS } from "../src/labs.js";

const BOUNDS = [-470, 2026];
const ANCHOR = { id: "anchor", label: "Anchor", birth: -470, death: -399 };

function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorld(seed) {
  const rng = seededRng(seed);
  const pool = [];
  for (let i = 0; i < 1200; i++) {
    const birth = Math.floor(-800 + rng() * 2810); // -800 .. 2009 (some reach 2026)
    const death = Math.min(2026, birth + 30 + Math.floor(rng() * 90)); // 30-119 y lifespan
    if (death - birth >= 20) pool.push({ id: `p${i}`, label: `P${i}`, birth, death });
  }
  return pool;
}

function legalAdds(people, pool, labs, opts) {
  const base = computeCoverage(people, BOUNDS).total;
  return pool
    .filter(p => !people.some(q => q.id === p.id))
    .map(p => ({ p, gain: computeCoverage([...people, p], BOUNDS).total - base }))
    .filter(x => x.gain > 0 && canAddPerson(x.p, people, labs, opts, BOUNDS).ok);
}

function playOneGame(seed, labs, opts) {
  const pool = makeWorld(seed);
  const people = [{ ...ANCHOR }];
  let turns = 0;
  let prevTotal = computeCoverage(people, BOUNDS).total;
  while (turns < 500) {
    const acts = legalAdds(people, pool, labs, opts);
    if (!acts.length) break;
    acts.sort((a, b) => b.gain - a.gain || (a.p.id < b.p.id ? -1 : 1));
    people.push(acts[0].p);
    turns++;
    // invariants every turn
    const ids = new Set(people.map(p => p.id));
    if (ids.size !== people.length) throw new Error("duplicate ids");
    const { total, gaps } = computeCoverage(people, BOUNDS);
    if (total < prevTotal) throw new Error("coverage regressed");
    if (people.some(p => p.birth >= p.death)) throw new Error("invalid lifespan");
    prevTotal = total;
    if (gaps.length === 0) break;
  }
  const { gaps } = computeCoverage(people, BOUNDS);
  return { won: gaps.length === 0, people: people.length, turns };
}

function runBatch(label, labs, opts, seeds = 200) {
  let wins = 0, peopleSum = 0, turnSum = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = playOneGame(seed * 7919, labs, opts);
    if (r.won) wins++;
    peopleSum += r.people;
    turnSum += r.turns;
  }
  const n = seeds;
  console.log(
    `${label.padEnd(34)} win ${(100 * wins / n).toFixed(1).padStart(5)}%  avg people ${(peopleSum / n).toFixed(1).padStart(5)}  avg adds ${(turnSum / n).toFixed(1)}`
  );
  return { winRate: wins / n, avgPeople: peopleSum / n };
}

const base = runBatch("base (all labs off)", { ...DEFAULT_LABS }, { ...DEFAULT_OPTS });
const frontier = runBatch("+frontier-only (maxOverlap=60)", { ...DEFAULT_LABS, maxOverlap: true }, { ...DEFAULT_OPTS, maxOverlapYears: 60 });
const budget = runBatch("+budget cap (30 people)", { ...DEFAULT_LABS, budget: true }, { ...DEFAULT_OPTS, budget: 30 });
const all = runBatch("all core labs (frontier+budget)", { ...DEFAULT_LABS, maxOverlap: true, budget: true }, { ...DEFAULT_OPTS, maxOverlapYears: 60, budget: 30 });

// A/B assertions: the depth levers must actually bite, stay winnable, never crash.
if (base.winRate < 0.95) throw new Error(`base bot should (nearly) always win, got ${base.winRate}`);
if (frontier.winRate < 0.9) throw new Error("frontier-only should stay winnable, got " + frontier.winRate);
if (frontier.avgPeople < base.avgPeople - 0.5) throw new Error("frontier-only must not make the game easier");
if (!(budget.winRate < base.winRate)) throw new Error("budget cap should lower the win rate");
if (all.winRate > base.winRate) throw new Error("all core labs should not raise the win rate");

console.log("SIM OK");
