// Shared constants, theme, utilities and Wikidata/Wikipedia access.

export const PRESENT = new Date().getFullYear();
export const MIN_SPAN = 20; // most you can zoom in, in years

export const COLORS = ["#4f86c6","#e07b54","#5bb86a","#c97dc8","#d4a843","#5bc4c4","#e05470","#8c7ae6","#a0c45a","#e08c54"];

export const DARK = {
  bg:"#0f1117",surface:"#1a1d27",surface2:"#1e2130",border:"#2a2d3a",border2:"#333",
  text:"#e8e8e8",muted:"#888",faint:"#555",faint2:"#444",
  accent:"#a0a8e0",accentBg:"#252840",accentBorder:"#4a4e6a",
  gap:"rgba(224,84,84,0.15)",gapDash:"#e05454",
  win:"linear-gradient(135deg,#1a2e1a,#1e2e1e)",winBorder:"#3a6a3a",
  overlay:"rgba(0,0,0,0.7)",card:"#1a1d27",cardBorder:"#3a3d5a",
};
export const LIGHT = {
  bg:"#f5f6fa",surface:"#ffffff",surface2:"#f0f1f8",border:"#d0d4e8",border2:"#c0c4d8",
  text:"#1a1d2e",muted:"#666",faint:"#888",faint2:"#aaa",
  accent:"#4a5aaa",accentBg:"#e8eaf8",accentBorder:"#9aa0d0",
  gap:"rgba(200,50,50,0.10)",gapDash:"#cc3333",
  win:"linear-gradient(135deg,#e8f5e8,#f0faf0)",winBorder:"#5aaa5a",
  overlay:"rgba(0,0,0,0.45)",card:"#ffffff",cardBorder:"#c0c8e8",
};

export function yearLabel(y) { return y < 0 ? `${Math.abs(y)} BC` : `${y} AD`; }

// Compact year for labels inside narrow bars, e.g. "470BC" / "44"
export function compactYear(y) { return y < 0 ? `${Math.abs(y)}BC` : `${y}`; }

export function wikiUrl(title) { return `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}`; }

export function assignRows(people) {
  const sorted = [...people].sort((a,b) => a.birth - b.birth);
  const rows = [];
  const result = {};
  for (const p of sorted) {
    let placed = false;
    for (let r = 0; r < rows.length; r++) {
      if (p.birth >= rows[r]) { rows[r] = p.death; result[p.id] = r; placed = true; break; }
    }
    if (!placed) { result[p.id] = rows.length; rows.push(p.death); }
  }
  return { rowMap: result, numRows: rows.length };
}

// Coverage of [bounds[0], bounds[1]] (or of `range` clipped to the bounds).
// Returns { gaps: [[s,e],...], total: coveredYears } computed within the scope.
export function computeCoverage(people, bounds, range = null) {
  const rs = range ? Math.max(range[0], bounds[0]) : bounds[0];
  const re = range ? Math.min(range[1], bounds[1]) : bounds[1];
  const intervals = people
    .map(p => [Math.max(p.birth, rs), Math.min(p.death, re)])
    .filter(([s,e]) => e > s)
    .sort((a,b) => a[0]-b[0]);
  const merged = [];
  for (const [s,e] of intervals) {
    if (!merged.length || s > merged[merged.length-1][1]) merged.push([s,e]);
    else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], e);
  }
  const gaps = [];
  let prev = rs;
  for (const [s,e] of merged) { if (s > prev) gaps.push([prev,s]); prev = e; }
  if (prev < re) gaps.push([prev,re]);
  return { gaps, total: merged.reduce((a,[s,e]) => a+e-s, 0) };
}

// ------------------------------------------------------------- challenges

// SPARQL ASK patterns checking whether a person belongs to a category.
export const CATEGORIES = {
  women:      { label: "♀ Women",      description: "only people recorded as female on Wikidata",
                ask: qid => `ASK { wd:${qid} wdt:P21 wd:Q6581072 }` },
  scientists: { label: "🔬 Scientists", description: "only people whose occupation is a kind of scientist",
                ask: qid => `ASK { wd:${qid} wdt:P106/wdt:P279* wd:Q901 }` },
  philosophers:{ label: "🤔 Philosophers", description: "only people whose occupation is a kind of philosopher",
                ask: qid => `ASK { wd:${qid} wdt:P106/wdt:P279* wd:Q4964182 }` },
  artists:    { label: "🎨 Artists",    description: "only people whose occupation is a kind of artist",
                ask: qid => `ASK { wd:${qid} wdt:P106/wdt:P279* wd:Q483501 }` },
  writers:    { label: "✍️ Writers",    description: "only people whose occupation is a kind of writer",
                ask: qid => `ASK { wd:${qid} wdt:P106/wdt:P279* wd:Q36180 }` },
  rulers:     { label: "👑 Rulers",     description: "only people whose occupation is a kind of monarch",
                ask: qid => `ASK { wd:${qid} wdt:P106/wdt:P279* wd:Q116 }` },
};

// Pre-configured challenges. The anchor person's birth is the timeline start;
// if an endId is given, that person's death is the timeline end and they are
// preloaded alongside the anchor.
export const PRESETS = [
  { key: "classic", name: "The Classic", mode: null, anchorId: "Q913",
    desc: "Socrates → present. The original challenge: cover everything since Socrates' birth with as few people as possible." },
  { key: "classical", name: "The Classical World", mode: null, anchorId: "Q913", endId: "Q1430",
    desc: "Socrates → the death of Marcus Aurelius. Bridge the whole of classical antiquity, from Athenian philosophy to the last of the Five Good Emperors." },
  { key: "women", name: "Women of History", mode: "women", anchorId: "Q17892",
    desc: "Sappho → present. Only women can be added — from the ancient poets and pharaohs to today." },
  { key: "scientists", name: "Science Through the Ages", mode: "scientists", anchorId: "Q36303",
    desc: "Thales of Miletus, the first scientist → present. Only scientists may be added." },
  { key: "philosophers", name: "Philosophers' Chain", mode: "philosophers", anchorId: "Q10261",
    desc: "Pythagoras → present. Only philosophers may be added — keep the great chain of thought unbroken." },
  { key: "writers", name: "Words Through Time", mode: "writers", anchorId: "Q6691",
    desc: "Homer → present. Only writers may be added — the longest timeline of all, nearly three millennia." },
  { key: "artists", name: "Art Across the Ages", mode: "artists", anchorId: "Q177302",
    desc: "Phidias, sculptor of the Parthenon → present. Only artists may be added." },
  { key: "rulers", name: "Rulers of the World", mode: "rulers", anchorId: "Q36359",
    desc: "Hammurabi, lawgiver of Babylon → present. Only monarchs may be added — nearly four millennia of history." },
];

// ------------------------------------------------------------- Wikidata

const WD_API = "https://www.wikidata.org/w/api.php";

export async function searchPeople(query) {
  if (!query || query.length < 2) return [];
  const url = `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=20&format=json&origin=*&type=item`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rx = /\b(politician|president|king|queen|emperor|empress|writer|author|poet|philosopher|scientist|mathematician|physicist|chemist|biologist|historian|artist|painter|sculptor|composer|musician|singer|actor|actress|director|general|admiral|pope|bishop|saint|explorer|inventor|architect|economist|lawyer|judge|revolutionary|activist|athlete|footballer|monarch|prince|princess|duke|duchess|pharaoh|sultan|caliph|tsar|chancellor|minister|senator|leader|founder|reformer|theologian|astronomer|engineer|physician|doctor|soldier|officer|commander|ruler|dictator|statesman|diplomat|journalist|novelist|playwright|scholar|professor|rabbi|imam|monk|nun|warrior|knight|baron|count|earl|lord|born|died|\d{3,4})/i;
    return (data.search||[]).filter(e=>e.description&&rx.test(e.description)).slice(0,8).map(e=>({id:e.id,label:e.label,desc:e.description||""}));
  } catch { return []; }
}

// Birth/death years for a Wikidata entity. requireHuman=false also accepts
// semi-legendary figures (Homer) that Wikidata does not class as humans —
// used only for pre-configured challenge anchors.
export async function fetchPersonDates(qid, requireHuman = true) {
  const url = `${WD_API}?action=wbgetentities&ids=${qid}&props=claims|labels&languages=en&format=json&origin=*`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const entity = data.entities?.[qid];
    if (!entity) return null;
    const label = entity.labels?.en?.value || qid;
    const claims = entity.claims || {};
    function extractYear(prop) {
      for (const v of (claims[prop]||[])) {
        const tv = v.mainsnak?.datavalue?.value?.time;
        if (tv) { const m = tv.match(/^[+-]?(\d+)-/); if (m) { let y=parseInt(m[1],10); if(tv.startsWith("-"))y=-y; return y; } }
      }
      return null;
    }
    if (requireHuman) {
      const isHuman = (claims["P31"]||[]).some(v=>v.mainsnak?.datavalue?.value?.id==="Q5");
      if (!isHuman) return null;
    }
    const birth = extractYear("P569");
    let death = extractYear("P570");
    if (birth===null) return null;
    if (death===null) death = PRESENT;
    return { label, birth, death };
  } catch { return null; }
}

export async function fetchDescription(qid) {
  try {
    const res = await fetch(`${WD_API}?action=wbgetentities&ids=${qid}&props=descriptions&languages=en&format=json&origin=*`);
    const data = await res.json();
    return data.entities?.[qid]?.descriptions?.en?.value || "";
  } catch { return ""; }
}

// Full person object for the game (anchor / loaded ids).
export async function fetchPersonFull(qid, requireHuman = true) {
  const dates = await fetchPersonDates(qid, requireHuman);
  if (!dates) return null;
  const desc = await fetchDescription(qid);
  return { id: qid, label: dates.label, desc, birth: dates.birth, death: dates.death };
}

// English-Wikipedia article titles for a list of QIDs (batched).
export async function fetchWikiTitles(ids) {
  const titles = {};
  for (let j = 0; j < ids.length; j += 50) {
    const batch = ids.slice(j, j+50).join("|");
    const url = `${WD_API}?action=wbgetentities&ids=${batch}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      for (const [qid, ent] of Object.entries(data.entities||{})) {
        const title = ent?.sitelinks?.enwiki?.title;
        if (title) titles[qid] = title;
      }
    } catch { /* best-effort */ }
  }
  return titles;
}

// Summary + image + article title for one person.
export async function fetchPersonDetails(qid) {
  const fallback = { extract: null, image: null, wikiTitle: null };
  try {
    const titles = await fetchWikiTitles([qid]);
    const title = titles[qid];
    if (!title) return fallback;
    const wpRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts|pageimages&exintro=true&explaintext=true&exsentences=3&piprop=thumbnail&pithumbsize=300&format=json&origin=*`);
    const wpData = await wpRes.json();
    const page = Object.values(wpData.query?.pages||{})[0];
    return { extract: page?.extract||null, image: page?.thumbnail?.source||null, wikiTitle: title };
  } catch { return fallback; }
}

const categoryCache = new Map();

// Check a person against the active challenge category via the Wikidata
// SPARQL endpoint. Results are cached per person+category.
export async function checkCategory(qid, mode) {
  const key = `${qid}|${mode}`;
  if (categoryCache.has(key)) return categoryCache.get(key);
  const query = CATEGORIES[mode].ask(qid);
  try {
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&origin=*&query=${encodeURIComponent(query)}`);
    const data = await res.json();
    const ok = data?.boolean === true;
    categoryCache.set(key, ok);
    return ok;
  } catch {
    return false;
  }
}
