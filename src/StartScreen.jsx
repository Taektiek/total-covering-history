// Start screen: choose a pre-configured challenge (with pictures of the
// anchor and, where set, the ending person), build a custom challenge, or
// load a saved game.
import { useState, useEffect } from "react";
import {
  PRESETS, CATEGORIES, yearLabel, searchPeople, fetchPersonDates, fetchPersonDetails,
} from "./lib";

// Loads display info (label, years, Wikipedia thumbnail) for one person.
function usePersonInfo(qid) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!qid) return;
    let cancelled = false;
    (async () => {
      const [dates, details] = await Promise.all([
        fetchPersonDates(qid, false), // anchors may be semi-legendary (e.g. Homer)
        fetchPersonDetails(qid),
      ]);
      if (!cancelled) setInfo({
        qid,
        label: dates?.label || details?.wikiTitle || qid,
        birth: dates?.birth ?? null,
        death: dates?.death ?? null,
        image: details?.image || null,
      });
    })();
    return () => { cancelled = true; };
  }, [qid]);
  return info;
}

function PersonChip({ info, T, role }) {
  if (!info) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
      <div style={{ width: 46, height: 56, borderRadius: 6, background: T.border }} />
      <div style={{ fontSize: 12, color: T.muted }}>Loading…</div>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
      {info.image
        ? <img src={info.image} alt={info.label} style={{ width: 46, height: 56, objectFit: "cover", borderRadius: 6, border: `2px solid ${T.border2}` }} />
        : <div style={{ width: 46, height: 56, borderRadius: 6, background: T.surface2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👤</div>}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>{info.label}</div>
        <div style={{ fontSize: 10, color: T.muted }}>
          {role === "end"
            ? `d. ${info.birth !== null ? yearLabel(info.death ?? info.birth) : ""}`
            : info.birth !== null ? `b. ${yearLabel(info.birth)}` : ""}
        </div>
      </div>
    </div>
  );
}

function PresetCard({ preset, T, onPick, busy }) {
  const anchor = usePersonInfo(preset.anchorId);
  const end = usePersonInfo(preset.endId || null);
  return (
    <div
      onClick={() => !busy && onPick({ ...preset, custom: false })}
      style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px",
        cursor: busy ? "wait" : "pointer", display: "flex", flexDirection: "column", gap: 10,
        transition: "transform 0.1s, border-color 0.1s", opacity: busy ? 0.6 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = T.accentBorder; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = T.border; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{preset.name}</div>
          {preset.mode && (
            <div style={{ display: "inline-block", marginTop: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
              background: T.accentBg, color: T.accent, border: `1px solid ${T.accentBorder}`, borderRadius: 12 }}>
              {CATEGORIES[preset.mode].label}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PersonChip info={anchor} T={T} role="start" />
        {end && <div style={{ color: T.faint, fontSize: 18 }}>→</div>}
        {end
          ? <PersonChip info={end} T={T} role="end" />
          : <div style={{ fontSize: 11, color: T.faint, alignSelf: "center" }}>→ present</div>}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>{preset.desc}</div>
    </div>
  );
}

// Search box used inside the custom-challenge form.
function PersonPicker({ placeholder, value, onChange, T }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const onInput = (val) => {
    setQuery(val);
    if (val.length < 2) { setSuggestions([]); return; }
    setLoading(true);
    searchPeople(val).then(res => { setSuggestions(res); setLoading(false); });
  };

  const pick = (item) => {
    onChange({ id: item.id, label: item.label, desc: item.desc });
    setQuery(item.label);
    setOpen(false); setSuggestions([]);
  };

  return (
    <div style={{ position: "relative" }}>
      <input value={query} onChange={e => { onInput(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 13,
          background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 8, color: T.text, outline: "none" }} />
      {loading && <span style={{ position: "absolute", right: 10, top: 8, fontSize: 10, color: T.muted }}>…</span>}
      {value && query !== value.label && <div style={{ fontSize: 10, color: "#5bb86a", marginTop: 2 }}>Selected: {value.label}</div>}
      {open && suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, marginTop: 2,
          background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden" }}>
          {suggestions.map(s => (
            <div key={s.id} onMouseDown={e => { e.preventDefault(); pick(s); }}
              style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12, color: T.text }}>
              <strong>{s.label}</strong>{s.desc && <span style={{ color: T.muted }}> — {s.desc.slice(0, 60)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomForm({ T, onStart, busy }) {
  const [anchor, setAnchor] = useState(null);
  const [end, setEnd] = useState(null);
  const [endYear, setEndYear] = useState("");
  const [mode, setMode] = useState(null);
  const [error, setError] = useState("");

  const start = async () => {
    setError("");
    if (!anchor) { setError("Pick a starting person — their birth year opens the timeline."); return; }
    if (end && endYear.trim()) { setError("Choose either an ending person or an end year, not both."); return; }
    const y = parseInt(endYear, 10);
    if (endYear.trim() && (isNaN(y) || y <= 0)) { setError("End year must be a positive number (AD), e.g. 180."); return; }
    onStart({ custom: true, key: "custom", name: "Custom Challenge", mode, anchorId: anchor.id, endId: end?.id ?? null, endYear: endYear.trim() ? y : null });
  };

  const chipStyle = (active) => ({
    padding: "3px 10px", fontSize: 11.5, fontWeight: active ? 700 : 500, cursor: "pointer",
    background: active ? T.accent : T.surface2, color: active ? T.bg : T.accent,
    border: `1px solid ${T.accentBorder}`, borderRadius: 6,
  });

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 2 }}>⚙️ Custom Challenge</div>
      <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 12 }}>Pick the starting person (their birth opens the timeline), optionally an ending person (their death closes it) or a fixed end year, and who is allowed to join.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>Start (anchor) person *</div>
          <PersonPicker placeholder="e.g. Socrates…" value={anchor} onChange={setAnchor} T={T} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>Ending person (optional)</div>
          <PersonPicker placeholder="e.g. Marcus Aurelius…" value={end} onChange={setEnd} T={T} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>…or end year (AD)</div>
          <input value={endYear} onChange={e => setEndYear(e.target.value)} placeholder="e.g. 180"
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 13,
              background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 8, color: T.text, outline: "none" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => setMode(null)} style={chipStyle(!mode)}>Open</button>
        {Object.entries(CATEGORIES).map(([key, c]) => (
          <button key={key} onClick={() => setMode(mode === key ? null : key)} title={c.description} style={chipStyle(mode === key)}>{c.label}</button>
        ))}
      </div>
      {error && <div style={{ color: "#e07b54", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <button onClick={start} disabled={busy}
        style={{ padding: "8px 20px", background: T.accent, border: "none", borderRadius: 8, color: T.bg, fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
        {busy ? "Loading…" : "Start challenge →"}
      </button>
    </div>
  );
}

export default function StartScreen({ T, dark, setDark, onStart, onLoadFile, loadError, busy }) {
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -0.5 }}>🕰️ Timeline Total Cover</div>
            <div style={{ color: T.muted, fontSize: 14, marginTop: 6 }}>
              Cover all of history with the lifespans of as few people as possible. Pick a challenge:
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <label style={{ padding: "6px 12px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, color: T.accent, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              📂 Load saved game
              <input type="file" accept=".json" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onLoadFile(f); } }} />
            </label>
            <button onClick={() => setDark(d => !d)} style={{ padding: "6px 10px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{dark ? "☀️" : "🌙"}</button>
          </div>
        </div>
        {loadError && <div style={{ color: "#e07b54", fontSize: 13, marginTop: 12 }}>{loadError}</div>}

        <CustomForm T={T} onStart={onStart} busy={busy} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 14 }}>
          {PRESETS.map(p => <PresetCard key={p.key} preset={p} T={T} onPick={onStart} busy={busy} />)}
        </div>

        <div style={{ marginTop: 28, fontSize: 10, color: T.faint2 }}>
          Data from <a href="https://www.wikidata.org" target="_blank" rel="noreferrer" style={{ color: T.faint }}>Wikidata</a> & <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer" style={{ color: T.faint }}>Wikipedia</a>
        </div>
      </div>
    </div>
  );
}
