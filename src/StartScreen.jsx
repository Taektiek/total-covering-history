// Home screen, designed around one question: "what do I do now?"
// Hero states the goal and offers the two obvious next actions (play today's
// chained puzzles / quick tutorial), a 3-step how-to removes the rules
// upfront, then progressive disclosure: daily chain → classic challenges →
// custom builder (collapsed) → load a save.
import { useState, useEffect } from "react";
import {
  PRESETS, CATEGORIES, TUTORIAL, TUTORIAL_DONE_KEY, yearLabel, searchPeople, fetchPersonDates, fetchPersonDetails,
} from "./lib";
import { useIsMobile } from "./useIsMobile";
import { dateKeyOf, dailyPuzzles, dailyDef, bestFor, fmtMs } from "./daily.js";

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
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
      <div style={{ width: 44, height: 54, borderRadius: 6, background: T.border }} />
      <div style={{ fontSize: 12, color: T.muted }}>Loading…</div>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
      {info.image
        ? <img src={info.image} alt={info.label} style={{ width: 44, height: 54, objectFit: "cover", borderRadius: 6, border: `2px solid ${T.border2}` }} />
        : <div style={{ width: 44, height: 54, borderRadius: 6, background: T.surface2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👤</div>}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>{info.label}</div>
        <div style={{ fontSize: 10, color: T.muted }}>
          {role === "end"
            ? `b. ${info.birth !== null ? yearLabel(info.birth) : ""}`
            : info.birth !== null ? `b. ${yearLabel(info.birth)}` : ""}
        </div>
      </div>
    </div>
  );
}

function PresetCard({ preset, T, onPick, busy, records }) {
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
          {records?.[preset.key] !== undefined && (
            <div style={{ fontSize: 10, color: "#d4a843", marginTop: 2 }}>🏅 your best: {records[preset.key]} people</div>
          )}
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

// One daily puzzle card: two famous people whose lives you must bridge.
function DailyCard({ puzzle, dateKey, best, solved, T, onPick, busy, isNext }) {
  const anchor = usePersonInfo(puzzle.anchorId);
  const end = usePersonInfo(puzzle.endId);
  const diffLabel = puzzle.n === 1 ? "easy" : puzzle.n === 2 ? "medium" : "hard";
  return (
    <button onClick={() => !busy && onPick(dailyDef(dateKey, puzzle))} disabled={busy}
      style={{
        textAlign: "left", background: solved ? T.surface : T.surface2,
        border: `2px solid ${isNext ? T.accentBorder : T.border2}`, borderRadius: 12, padding: "12px 14px",
        cursor: busy ? "wait" : "pointer", color: T.text, fontFamily: "inherit", position: "relative",
        opacity: busy ? 0.6 : 1, transition: "border-color 0.1s, transform 0.1s",
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>
          #{puzzle.n} · {diffLabel}
          {solved && <span style={{ color: "#5bb86a", marginLeft: 6 }}>✓ solved</span>}
          {isNext && !solved && <span style={{ color: T.accent, marginLeft: 6, fontSize: 11 }}>▶ next</span>}
        </span>
        <span style={{ fontSize: 10, color: T.faint }}>{puzzle.span}y window</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <PersonChip info={anchor} T={T} role="start" />
        <div style={{ color: T.faint, fontSize: 16 }}>→</div>
        <PersonChip info={end} T={T} role="end" />
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>
        {yearLabel(puzzle.startYear)} – {yearLabel(puzzle.endYear)}
        {puzzle.mode && <> · <span style={{ color: T.accent, fontWeight: 700 }}>{CATEGORIES[puzzle.mode].label}</span> only</>}
      </div>
      <div style={{ fontSize: 11, color: best ? "#d4a843" : T.faint, marginTop: 3 }}>
        {best ? `🏆 your best: ${best.people} people · ${fmtMs(best.ms)}` : "unsolved — bridge their lives!"}
      </div>
    </button>
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

function CustomForm({ T, onStart, busy, mobile }) {
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
    <div>
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 120px", gap: 12, marginBottom: 12 }}>
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

const STEPS = [
  ["🎯", "Pick a challenge", "Today's 3 puzzles chain automatically — finish one, the next starts."],
  ["🔎", "Search & add people", "Type any name from history and click to add their lifespan to the timeline."],
  ["🕳️", "Fill every red gap", "Every year must be covered by someone alive. Fewest people wins — your best is saved. 🏆"],
];

export default function StartScreen({ T, dark, setDark, onStart, onContinue, continueGame, onLoadFile, loadError, busy, records, board, mobile: mobileProp }) {
  const detectedMobile = useIsMobile();
  const mobile = mobileProp ?? detectedMobile;
  const todayKey = dateKeyOf();
  const puzzles = dailyPuzzles(todayKey, new Date().getFullYear());
  const solvedCount = puzzles.filter(p => bestFor(board, todayKey, p.n)).length;
  const firstUnsolved = puzzles.find(p => !bestFor(board, todayKey, p.n)) ?? puzzles[0];
  const [tutorialDone, setTutorialDone] = useState(() => {
    try { return !!localStorage.getItem(TUTORIAL_DONE_KEY); } catch { return false; }
  });

  const primaryBtn = {
    padding: mobile ? "12px 18px" : "13px 26px", background: T.accent, color: T.bg, border: "none",
    borderRadius: 10, fontWeight: 800, fontSize: mobile ? 14 : 15, cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
  };
  const secondaryBtn = {
    padding: mobile ? "12px 18px" : "13px 22px", background: T.accentBg, color: T.accent,
    border: `1px solid ${T.accentBorder}`, borderRadius: 10, fontWeight: 700, fontSize: mobile ? 14 : 15,
    cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap",
  };

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: "system-ui,sans-serif", touchAction: "manipulation" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: mobile ? "16px 14px 40px" : "32px 20px 60px" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: mobile ? 16 : 24 }}>
          <div style={{ fontSize: mobile ? 18 : 21, fontWeight: 900, letterSpacing: -0.5 }}>🕰️ Timeline Total Cover</div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <label style={{ padding: "6px 12px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, color: T.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              📂 {mobile ? "Load" : "Load saved game"}
              <input type="file" accept=".json" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onLoadFile(f); } }} />
            </label>
            <button onClick={() => setDark(d => !d)} style={{ padding: "6px 10px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{dark ? "☀️" : "🌙"}</button>
          </div>
        </div>
        {loadError && <div style={{ color: "#e07b54", fontSize: 13, marginBottom: 12 }}>{loadError}</div>}

        {/* continue autosaved game — the most likely next action if one exists */}
        {continueGame?.challenge && (
          <button onClick={() => !busy && onContinue()} disabled={busy}
            style={{ display: "block", width: "100%", textAlign: "left", background: T.accentBg, border: `2px solid ${T.accentBorder}`, borderRadius: 14, padding: mobile ? "14px 16px" : "16px 20px", marginBottom: 14, cursor: busy ? "wait" : "pointer", color: T.text, fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "none"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: mobile ? 15 : 17, fontWeight: 800, color: T.accent }}>▶ Continue where you left off</div>
              <div style={{ fontSize: 12, color: T.muted }}>
                {continueGame.progress
                  ? `${continueGame.progress.people} ${continueGame.progress.people === 1 ? "person" : "people"} added · ${continueGame.progress.coverPct}% covered`
                  : "saved game"}
              </div>
            </div>
            <div style={{ fontSize: 13, color: T.text, marginTop: 4, fontWeight: 600 }}>
              🕰️ {continueGame.challenge.name}
              {continueGame.challenge.daily && <> · 📅 puzzle #{continueGame.challenge.daily.n}/3</>}
            </div>
          </button>
        )}

        {/* hero */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: mobile ? "18px 16px" : "28px 30px", marginBottom: 14 }}>
          <h1 style={{ fontSize: mobile ? 24 : 32, fontWeight: 900, letterSpacing: -0.8, margin: "0 0 10px", lineHeight: 1.15 }}>
            Cover all of history with as few lives as possible.
          </h1>
          <p style={{ fontSize: mobile ? 13.5 : 15, color: T.muted, lineHeight: 1.55, margin: "0 0 18px", maxWidth: 640 }}>
            Every year on the timeline must be covered by someone who was alive. Bridge the gap between
            two famous lives — search anyone in history, add their lifespan, and win with the fewest people.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <button onClick={() => !busy && onStart(dailyDef(todayKey, firstUnsolved))} disabled={busy} style={primaryBtn}>
              ▶ Play today's puzzles {solvedCount > 0 && `(${solvedCount}/3 done)`}
            </button>
            <button onClick={() => { if (!busy) { setTutorialDone(true); onStart({ ...TUTORIAL, custom: false }); } }} disabled={busy} style={secondaryBtn}
              title={TUTORIAL.desc}>
              👋 Quick tutorial {tutorialDone ? "✓" : "(1 min)"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: T.faint, margin: "-8px 0 16px" }}>
            💾 Your game autosaves in this browser — close the tab and reopen anytime to continue where you left off.
          </div>
          {/* how it works */}
          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
            {STEPS.map(([icon, title, desc]) => (
              <div key={title} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 3 }}>{icon} {title}</div>
                <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.45 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* daily chain */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 10px" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>📅 Today's puzzles — {todayKey}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: solvedCount === 3 ? "#5bb86a" : T.accent, background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 12, padding: "2px 10px" }}>
            {solvedCount}/3 solved
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 12 }}>
          Three fresh pairs of famous lives each day, easiest first. Finish one and the next starts automatically —
          your best (fewest people, then fastest) is saved locally and shareable via 🔗.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3, 1fr)", gap: 12, marginBottom: 8 }}>
          {puzzles.map((p, i) => (
            <div key={p.n} style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
              <div style={{ flex: 1 }}>
                <DailyCard
                  puzzle={p} dateKey={todayKey} T={T} busy={busy}
                  best={bestFor(board, todayKey, p.n)} solved={!!bestFor(board, todayKey, p.n)}
                  isNext={p.n === firstUnsolved.n} onPick={onStart}
                />
              </div>
              {i < puzzles.length - 1 && !mobile && <div style={{ alignSelf: "center", color: T.faint, fontSize: 16, margin: "0 2px" }}>→</div>}
            </div>
          ))}
        </div>

        {/* classic challenges */}
        <div style={{ fontSize: 16, fontWeight: 800, margin: "26px 0 10px" }}>🏛️ Classic challenges</div>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(auto-fill, minmax(380px, 1fr))", gap: 14 }}>
          {PRESETS.map(p => <PresetCard key={p.key} preset={p} T={T} onPick={onStart} busy={busy} records={records} />)}
        </div>

        {/* custom builder — progressive disclosure */}
        <details style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 18px", marginTop: 22 }}>
          <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 800, color: T.text }}>
            ⚙️ Build a custom challenge
          </summary>
          <div style={{ fontSize: 11.5, color: T.muted, margin: "6px 0 14px" }}>
            Pick the starting person (their birth opens the timeline), optionally an ending person (their death
            closes it) or a fixed end year, and who is allowed to join.
          </div>
          <CustomForm T={T} onStart={onStart} busy={busy} mobile={mobile} />
        </details>

        <div style={{ marginTop: 28, fontSize: 10, color: T.faint2 }}>
          Data from <a href="https://www.wikidata.org" target="_blank" rel="noreferrer" style={{ color: T.faint }}>Wikidata</a> & <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer" style={{ color: T.faint }}>Wikipedia</a>
          {" · "}
          <a href="https://0rwx.com/" target="_blank" rel="noreferrer" title="0rwx AI usage label: AI made — I curate" style={{ color: T.faint }}>AI:X</a>
        </div>
      </div>
    </div>
  );
}
