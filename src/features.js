// Standard features (always on — not labs): local records and share links.
//
// Pure logic lives here so it can be unit-tested headlessly (node --test,
// tests/features.test.mjs). The UI layer (App.jsx) loads/persists via these
// helpers; nothing here touches the DOM or network.

// ------------------------------------------------------------- local records
const REC_KEY = "ttc-records-v1";

function defaultStore() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
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

// ------------------------------------------------------------ autosave
// The in-progress game (challenge + people + gap range) is continuously saved
// to localStorage and restored when the page is opened again.
const AUTOSAVE_KEY = "ttc-autosave-v2";

export function loadAutosave(storage) {
  const s = storage ?? defaultStore();
  if (!s) return null;
  try {
    const raw = s.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.challenge && Array.isArray(p.ids) ? p : null;
  } catch { return null; }
}

export function saveAutosave(payload, storage) {
  const s = storage ?? defaultStore();
  if (!s) return;
  try { s.setItem(AUTOSAVE_KEY, JSON.stringify(payload)); } catch { /* private mode / quota */ }
}

export function clearAutosave(storage) {
  const s = storage ?? defaultStore();
  if (!s) return;
  try { s.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
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
