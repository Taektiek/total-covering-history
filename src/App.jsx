import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  PRESENT, MIN_SPAN, COLORS, DARK, LIGHT,
  yearLabel, wikiUrl, computeCoverage, searchPeople, fetchPersonDates, fetchPersonFull,
  fetchWikiTitles, CATEGORIES, checkCategory,
} from "./lib";
import Timeline from "./Timeline";
import PersonCard from "./PersonCard";
import StartScreen from "./StartScreen";

export default function App() {
  const [screen, setScreen] = useState("start"); // "start" | "game"
  const [dark, setDark] = useState(false);
  const T = dark ? DARK : LIGHT;

  // the active challenge: { key, name, desc, mode, anchorId, endId, endYear, custom, anchor, end, bounds }
  const [challenge, setChallenge] = useState(null);

  const [people, setPeople] = useState([]);
  const [inputVal, setInputVal] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchingId, setFetchingId] = useState(null);
  const [error, setError] = useState("");
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [view, setView] = useState(null); // [start, end] of the visible window
  const [loadError, setLoadError] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [starting, setStarting] = useState(false);
  const [wikiTitles, setWikiTitles] = useState({});
  const [wonDismissed, setWonDismissed] = useState(false);

  const [challengeRange, setChallengeRange] = useState(null); // gap-challenge range
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const debounceRef = useRef(null);

  // ------------------------------------------------------ challenge loading
  // def: { key, name, mode, anchorId, endId?, endYear?, custom? } — optionally
  // with `extraPeople` (QIDs) to preload, and `range` to restore a save.
  const startChallenge = useCallback(async (def, extraPeople = [], restoreRange = null) => {
    setStarting(true); setLoadError("");
    try {
      const anchor = await fetchPersonFull(def.anchorId, false); // anchors may be non-human (Homer)
      if (!anchor || anchor.birth === null) {
        setLoadError(`Couldn't load the starting person (${def.anchorId}). Try another challenge.`);
        setStarting(false);
        return false;
      }
      let end = null;
      if (def.endId) {
        end = await fetchPersonFull(def.endId, false);
        if (!end || end.death === null || end.death <= anchor.death) {
          setLoadError(`The ending person (${def.endId}) has no usable death date after ${anchor.label}'s death.`);
          setStarting(false);
          return false;
        }
      }
      const bounds = [anchor.birth, end ? end.death : (def.endYear ?? PRESENT)];
      if (bounds[1] <= bounds[0]) {
        setLoadError("The challenge timeline is empty — pick a different start/end.");
        setStarting(false);
        return false;
      }

      anchor.color = COLORS[0];
      const preloaded = [anchor];
      if (end) { end.color = COLORS[1]; preloaded.push(end); }

      // extra people (from a save file); anchors are never duplicated
      const failed = [];
      let nextColor = preloaded.length;
      for (const qid of extraPeople) {
        if (qid === anchor.id || (end && qid === end.id)) continue;
        const person = await fetchPersonFull(qid);
        if (!person) { failed.push(qid); continue; }
        person.color = COLORS[nextColor % COLORS.length];
        nextColor += 1;
        preloaded.push(person);
      }

      setChallenge({
        key: def.key, name: def.name, mode: def.mode ?? null, custom: !!def.custom,
        anchorId: def.anchorId, endId: def.endId ?? null, endYear: def.endYear ?? null,
        anchor, end, bounds,
      });
      setPeople(preloaded);
      setView([bounds[0], bounds[1]]);
      setChallengeRange(restoreRange || null);
      setCustomStart(restoreRange ? String(Math.round(restoreRange[0])) : "");
      setCustomEnd(restoreRange ? String(Math.round(restoreRange[1])) : "");
      setInputVal(""); setSuggestions([]); setError(""); setWonDismissed(false); setSelectedPerson(null);
      setScreen("game");
      if (failed.length) setLoadError(`Loaded with ${failed.length} unresolved ID(s): ${failed.join(", ")}`);
      setStarting(false);
      return true;
    } catch (err) {
      setLoadError("Failed to start challenge: " + err.message);
      setStarting(false);
      return false;
    }
  }, []);

  // ------------------------------------------------------------ game state
  const bounds = challenge?.bounds ?? null;
  const SPAN = bounds ? bounds[1] - bounds[0] : 1;
  const { gaps, total } = useMemo(
    () => (bounds ? computeCoverage(people, bounds) : { gaps: [], total: 0 }),
    [people, bounds]
  );
  const fullyCovered = gaps.length === 0;
  const coverPct = Math.min(100, (total / SPAN) * 100).toFixed(1);

  // the game is won once the whole timeline is covered (the anchor alone never counts)
  const won = !!challenge && fullyCovered && people.length > 1 && !wonDismissed;

  const rangeStats = challengeRange ? computeCoverage(people, bounds, challengeRange) : null;
  const rangeFullyCovered = rangeStats ? rangeStats.gaps.length === 0 : false;
  const rangeSpan = challengeRange ? challengeRange[1] - challengeRange[0] : 0;
  const rangeCoverPct = rangeStats ? Math.min(100, (rangeStats.total / rangeSpan) * 100).toFixed(1) : 0;
  const rangePeople = challengeRange
    ? people.filter(p => p.death > challengeRange[0] && p.birth < challengeRange[1])
    : [];

  const sortedPeople = [...people].sort((a, b) => a.birth - b.birth);

  // fetch Wikipedia article titles for everyone in the list (for list links)
  const idsKey = useMemo(() => people.map(p => p.id).join("|"), [people]);
  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split("|") : [];
    fetchWikiTitles(ids).then(titles => { if (!cancelled) setWikiTitles(prev => ({ ...prev, ...titles })); });
    return () => { cancelled = true; };
  }, [idsKey]);

  // ------------------------------------------------------------ zoom slider
  const viewSpan = view ? view[1] - view[0] : SPAN;
  const sliderMax = 1000;
  const sliderVal = Math.round(sliderMax * Math.log(SPAN / viewSpan) / Math.log(SPAN / MIN_SPAN));
  const setZoomSpan = (newSpan) => {
    const center = (view[0] + view[1]) / 2;
    let s = center - newSpan / 2;
    s = Math.max(bounds[0], Math.min(s, bounds[1] - newSpan));
    setView([s, s + newSpan]);
  };
  const onSlider = (e) => {
    const v = Number(e.target.value);
    setZoomSpan(SPAN * Math.pow(MIN_SPAN / SPAN, v / sliderMax));
  };

  // ------------------------------------------------------------ add / remove
  const handleInput = (val) => {
    setInputVal(val); setError("");
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setSuggestions([]); return; }
    setLoading(true);
    searchPeople(val).then(res => { setSuggestions(res); setLoading(false); });
  };

  const handleSelect = useCallback(async (item) => {
    setSuggestions([]); setInputVal(item.label);
    if (people.find(p => p.id === item.id)) { setError("Already added."); setInputVal(""); return; }
    setFetchingId(item.id);
    const dates = await fetchPersonDates(item.id);
    if (!dates) { setFetchingId(null); setError(`No dates found for "${item.label}".`); setInputVal(""); return; }

    const anchor = challenge.anchor;

    // challenge category enforcement (live SPARQL check against the entity)
    if (challenge.mode && !(await checkCategory(item.id, challenge.mode))) {
      setFetchingId(null);
      setError(`✋ "${item.label}" doesn't match the ${CATEGORIES[challenge.mode].label} restriction of this challenge (${CATEGORIES[challenge.mode].description}).`);
      setInputVal(""); return;
    }

    // gap-challenge enforcement: the person must touch the challenge range
    if (challengeRange && !(dates.death > challengeRange[0] && dates.birth < challengeRange[1])) {
      setFetchingId(null);
      setError(`✋ "${item.label}" (${yearLabel(dates.birth)}–${yearLabel(dates.death)}) doesn't overlap the gap challenge ${yearLabel(challengeRange[0])}–${yearLabel(challengeRange[1])}.`);
      setInputVal(""); return;
    }

    if (dates.death <= anchor.death) {
      setFetchingId(null);
      setError(`"${item.label}" died before ${anchor.label}'s death — can't help cover the timeline.`);
      setInputVal(""); return;
    }
    const before = computeCoverage(people, bounds).total;
    const after = computeCoverage([...people, { ...dates, id: item.id, color: "#fff" }], bounds).total;
    setFetchingId(null);
    if (after <= before) { setError(`"${item.label}" (${yearLabel(dates.birth)}–${yearLabel(dates.death)}) is already fully covered — adds nothing new.`); setInputVal(""); return; }
    const color = COLORS[people.length % COLORS.length];
    setPeople(prev => [...prev, { ...dates, id: item.id, color, desc: item.desc || "" }]);
    setInputVal(""); inputRef.current?.focus();
  }, [people, challenge, challengeRange, bounds]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && suggestions.length > 0) handleSelect(suggestions[0]);
    if (e.key === "Escape") setSuggestions([]);
  };

  const isChallengePerson = (id) =>
    id === challenge?.anchorId || id === challenge?.endId;

  const removePerson = (id) => {
    if (isChallengePerson(id)) return;
    setPeople(prev => prev.filter(p => p.id !== id));
  };

  const backToMenu = () => {
    if (people.length > 1 && !window.confirm("Leave this challenge? Unsaved progress will be lost.")) return;
    setScreen("start"); setChallenge(null); setPeople([]); setLoadError("");
  };

  // ------------------------------------------------------------ save / load
  // v2 format: { version: 2, challenge: {...}, ids: [...], range?: [...] }
  const handleSave = () => {
    const payload = {
      version: 2,
      challenge: {
        key: challenge.key, name: challenge.name, mode: challenge.mode,
        anchorId: challenge.anchorId, endId: challenge.endId, endYear: challenge.endYear,
        custom: challenge.custom,
      },
      ids: people.filter(p => !isChallengePerson(p.id)).map(p => p.id),
    };
    if (challengeRange) payload.range = [Math.round(challengeRange[0]), Math.round(challengeRange[1])];
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "timeline-cover.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const loadFile = async (file) => {
    setLoadingFile(true); setLoadError("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const ids = parsed.ids;
      if (!Array.isArray(ids)) throw new Error("Invalid file format.");

      let def;
      let restoreRange = null;
      if (parsed.version >= 2 && parsed.challenge) {
        def = {
          key: parsed.challenge.key || "custom",
          name: parsed.challenge.name || "Loaded Challenge",
          mode: parsed.challenge.mode ?? null,
          anchorId: parsed.challenge.anchorId,
          endId: parsed.challenge.endId ?? null,
          endYear: parsed.challenge.endYear ?? null,
          custom: !!parsed.challenge.custom,
        };
        if (Array.isArray(parsed.range) && parsed.range.length === 2) {
          restoreRange = [Number(parsed.range[0]), Number(parsed.range[1])];
        }
      } else {
        // v1 files are the original challenge: Socrates → present, no restriction
        def = { key: "classic", name: "The Classic", mode: null, anchorId: "Q913", endId: null, endYear: null, custom: false };
      }
      if (!def.anchorId) throw new Error("The file has no starting person.");
      await startChallenge(def, ids, restoreRange);
    } catch (err) {
      setLoadError("Failed to load file: " + err.message);
      setStarting(false);
    }
    setLoadingFile(false);
  };

  // ------------------------------------------------------------ gap challenge
  const startGapChallenge = (s, e) => {
    const rs = Math.max(Math.round(s), bounds[0]);
    const re = Math.min(Math.round(e), bounds[1]);
    if (re - rs < 10) { setError("That gap is too small to challenge."); return; }
    setChallengeRange([rs, re]);
    setCustomStart(String(rs)); setCustomEnd(String(re));
  };

  const applyCustomRange = () => {
    const a = parseInt(customStart, 10), b = parseInt(customEnd, 10);
    if (isNaN(a) || isNaN(b)) { setError("Enter two years (negative = BC, e.g. -470)."); return; }
    if (a >= b) { setError("Start year must be before end year."); return; }
    if (a < bounds[0] || b > bounds[1]) { setError(`Keep the range between ${yearLabel(bounds[0])} and ${yearLabel(bounds[1])}.`); return; }
    setError("");
    setChallengeRange([a, b]);
  };

  const clearChallengeRange = () => { setChallengeRange(null); setCustomStart(""); setCustomEnd(""); };

  const btnStyle = (extra = {}) => ({
    padding: "4px 10px", background: T.accentBg, border: `1px solid ${T.accentBorder}`,
    borderRadius: 6, color: T.accent, cursor: "pointer", fontSize: 12, ...extra
  });

  // ------------------------------------------------------------ start screen
  if (screen === "start" || !challenge) {
    return (
      <StartScreen
        T={T} dark={dark} setDark={setDark}
        onStart={(def) => startChallenge(def)}
        onLoadFile={loadFile}
        loadError={loadError}
        busy={starting || loadingFile}
      />
    );
  }

  // ------------------------------------------------------------ game screen
  return (
    <div style={{ fontFamily: "system-ui,sans-serif", background: T.bg, minHeight: "100vh", color: T.text, display: "flex", flexDirection: "column" }}>
      {/* Sticky top */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: T.bg, borderBottom: `1px solid ${T.border}`, padding: "14px 20px 10px" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                🕰️ {challenge.name}
              </h1>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                {challenge.anchor.label} ({yearLabel(bounds[0])}) → {challenge.end ? `${challenge.end.label} (${yearLabel(bounds[1])})` : `present (${yearLabel(bounds[1])})`}
                {challenge.mode && <> · <strong style={{ color: T.accent }}>{CATEGORIES[challenge.mode].label}</strong> only</>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button style={btnStyle()} onClick={backToMenu} title="Back to challenge selection">⏏ Menu</button>
              {(view[0] !== bounds[0] || view[1] !== bounds[1]) &&
                <button style={btnStyle()} onClick={() => setView([bounds[0], bounds[1]])}>↺ Reset zoom</button>}
              <button style={btnStyle()} onClick={handleSave} title="Save progress to file">💾 Save</button>
              <button style={btnStyle({ opacity: loadingFile ? 0.6 : 1 })} onClick={() => fileInputRef.current?.click()} disabled={loadingFile} title="Load progress from file">
                {loadingFile ? "⏳ Loading…" : "📂 Load"}
              </button>
              <button style={btnStyle()} onClick={() => setDark(d => !d)}>{dark ? "☀️" : "🌙"}</button>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; loadFile(f); } }} />
            </div>
          </div>

          {/* Input */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input ref={inputRef} value={inputVal} onChange={e => handleInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={challenge.mode ? `Search for a person — ${CATEGORIES[challenge.mode].label} only…` : "Search for a historical person…"}
              disabled={!!fetchingId || won} autoComplete="off"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 14px", fontSize: 14, background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 8, color: T.text, outline: "none" }}
            />
            {(loading || fetchingId) && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: T.muted, fontSize: 12 }}>{fetchingId ? "Loading…" : "Searching…"}</span>}
            {suggestions.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden", marginTop: 3 }}>
                {suggestions.map((s, i) => (
                  <div key={s.id} onClick={() => handleSelect(s)}
                    style={{ padding: "8px 14px", cursor: "pointer", borderBottom: i < suggestions.length - 1 ? `1px solid ${T.border}` : "none", background: i === 0 ? T.accentBg : "transparent" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.accentBg}
                    onMouseLeave={e => e.currentTarget.style.background = i === 0 ? T.accentBg : "transparent"}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14, color: T.text }}>{s.label}</span>
                    {s.desc && <span style={{ color: T.muted, fontSize: 12, marginLeft: 8 }}>{s.desc.slice(0, 70)}{s.desc.length > 70 ? "…" : ""}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <div style={{ color: "#e07b54", fontSize: 12, marginBottom: 4 }}>{error}</div>}
          {loadError && <div style={{ color: "#e07b54", fontSize: 12, marginBottom: 4 }}>{loadError}</div>}

          {/* Timeline */}
          <Timeline
            people={people} view={view} setView={setView} bounds={bounds} gaps={gaps}
            range={challengeRange} onGapClick={startGapChallenge}
            wikiTitles={wikiTitles} onSelectPerson={setSelectedPerson} T={T}
          />

          {/* Zoom slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 8px" }}>
            <span style={{ fontSize: 10, color: T.faint }}>Zoom</span>
            <button style={btnStyle({ padding: "2px 8px" })} onClick={() => setZoomSpan(Math.max(MIN_SPAN, viewSpan / 1.6))} title="Zoom in">＋</button>
            <input type="range" min={0} max={sliderMax} value={sliderVal} onChange={onSlider}
              style={{ flex: 1, accentColor: T.accent, cursor: "pointer" }}
              title={`Visible span: ${Math.round(viewSpan)} years`} />
            <button style={btnStyle({ padding: "2px 8px" })} onClick={() => setZoomSpan(Math.min(SPAN, viewSpan * 1.6))} title="Zoom out">－</button>
            <span style={{ fontSize: 10, color: T.faint, minWidth: 70, textAlign: "right" }}>{viewSpan >= SPAN ? "full timeline" : `${Math.round(viewSpan)}y span`}</span>
          </div>

          {/* Coverage bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 6, background: T.border, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${coverPct}%`, background: fullyCovered ? "#5bb86a" : "#4f86c6", borderRadius: 3, transition: "width 0.4s" }} />
            </div>
            <span style={{ fontSize: 12, color: fullyCovered ? "#5bb86a" : T.muted, minWidth: 44 }}>{coverPct}%</span>
            {gaps.length > 0 && !fullyCovered && (() => {
              const g = [...gaps].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
              return (
                <button onClick={() => startGapChallenge(g[0], g[1])} style={{ ...btnStyle({ padding: "2px 8px" }), fontSize: 10 }} title="Start a gap challenge on the largest gap">
                  🎯 largest gap: {yearLabel(Math.round(g[0]))}–{yearLabel(Math.round(g[1]))}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px 24px" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>

          {/* gap challenge */}
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: T.muted, textTransform: "uppercase" }}>🎯 Gap challenge</span>
              <input value={customStart} onChange={e => setCustomStart(e.target.value)} placeholder="start year"
                style={{ width: 80, padding: "3px 8px", fontSize: 12, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 6, color: T.text, outline: "none" }} />
              <span style={{ color: T.faint }}>→</span>
              <input value={customEnd} onChange={e => setCustomEnd(e.target.value)} placeholder="end year"
                style={{ width: 80, padding: "3px 8px", fontSize: 12, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 6, color: T.text, outline: "none" }} />
              <button onClick={applyCustomRange} style={btnStyle({ padding: "3px 10px" })}>Set range</button>
              {challengeRange && <button onClick={clearChallengeRange} style={btnStyle({ padding: "3px 10px" })}>Clear</button>}
              {!challengeRange && <span style={{ fontSize: 11, color: T.faint }}>…or click any red gap on the timeline to bridge it with as few people as possible.</span>}
            </div>
            {challengeRange && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 160, height: 6, background: T.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${rangeCoverPct}%`, background: rangeFullyCovered ? "#5bb86a" : "#d4a843", borderRadius: 3, transition: "width 0.4s" }} />
                </div>
                <span style={{ fontSize: 12, color: rangeFullyCovered ? "#5bb86a" : T.muted }}>
                  {yearLabel(challengeRange[0])}–{yearLabel(challengeRange[1])}: {rangeCoverPct}% covered
                </span>
                <span style={{ fontSize: 12, color: T.muted }}>{rangePeople.length} {rangePeople.length === 1 ? "person" : "people"}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: rangeFullyCovered ? "#5bb86a" : T.faint }}>{rangeFullyCovered ? "complete ✓" : "incomplete"}</span>
              </div>
            )}
          </div>

          {won && (
            <div style={{ background: T.win, border: `1px solid ${T.winBorder}`, borderRadius: 12, padding: "16px 20px", textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🎉</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#5bb86a" }}>{challenge.name} covered!</div>
              <div style={{ color: T.muted, fontSize: 13, marginTop: 4 }}>
                Covered {yearLabel(bounds[0])}–{yearLabel(bounds[1])} with <strong style={{ color: T.text }}>{people.length} people</strong>.
                {people.length <= 6 && " Incredible!"}
                {people.length > 6 && people.length <= 12 && " Great job!"}
                {people.length > 12 && " Can you do it with fewer?"}
              </div>
              <button onClick={() => setWonDismissed(true)} style={{ marginTop: 10, padding: "7px 18px", background: "#5bb86a", border: "none", borderRadius: 6, color: "#0f1117", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Keep playing</button>
              <button onClick={backToMenu} style={{ marginTop: 10, marginLeft: 6, padding: "7px 18px", background: "transparent", border: `1px solid ${T.winBorder}`, borderRadius: 6, color: T.text, cursor: "pointer", fontSize: 13 }}>New challenge</button>
            </div>
          )}

          {challengeRange && rangeFullyCovered && !fullyCovered && (
            <div style={{ background: T.win, border: `1px solid ${T.winBorder}`, borderRadius: 12, padding: "12px 20px", textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 20, marginBottom: 2 }}>🎯</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#5bb86a" }}>Gap bridged!</div>
              <div style={{ color: T.muted, fontSize: 12, marginTop: 4 }}>
                {yearLabel(challengeRange[0])}–{yearLabel(challengeRange[1])} fully covered with <strong style={{ color: T.text }}>{rangePeople.length} {rangePeople.length === 1 ? "person" : "people"}</strong>. Can you bridge it with fewer?
              </div>
              <button onClick={clearChallengeRange} style={{ marginTop: 8, padding: "5px 14px", background: "#5bb86a", border: "none", borderRadius: 6, color: "#0f1117", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Done — clear challenge</button>
            </div>
          )}

          <div style={{ fontSize: 12, color: T.faint, marginBottom: 8 }}>
            <strong style={{ color: T.text }}>{people.length}</strong> {people.length === 1 ? "person" : "people"} — sorted by birth year — click to inspect
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {sortedPeople.map(p => (
              <div key={p.id} onClick={() => setSelectedPerson(p)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: T.surface, border: `1px solid ${p.color}33`, borderLeft: `3px solid ${p.color}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, cursor: "pointer", transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = T.surface2}
                onMouseLeave={e => e.currentTarget.style.background = T.surface}
              >
                <span style={{ color: p.color, fontWeight: 700, minWidth: 130 }}>{p.label}</span>
                <span style={{ color: T.faint, fontSize: 11, minWidth: 140 }}>{yearLabel(p.birth)} – {yearLabel(p.death)}</span>
                {p.desc && <span style={{ color: T.muted, fontSize: 12, flex: 1 }}>{p.desc.slice(0, 90)}{p.desc.length > 90 ? "…" : ""}</span>}
                {wikiTitles[p.id] && (
                  <a href={wikiUrl(wikiTitles[p.id])} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                    title={`Wikipedia article: ${wikiTitles[p.id]}`}
                    style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 4, textDecoration: "none", flexShrink: 0 }}>
                    W↗
                  </a>
                )}
                {p.id === challenge.anchorId && (
                  <span title="Challenge anchor — can't be removed" style={{ fontSize: 13, flexShrink: 0 }}>⚓</span>
                )}
                {p.id === challenge.endId && (
                  <span title="Challenge end — can't be removed" style={{ fontSize: 13, flexShrink: 0 }}>🏁</span>
                )}
                {!isChallengePerson(p.id) && (
                  <button onClick={e => { e.stopPropagation(); removePerson(p.id); }}
                    style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1, marginLeft: "auto", flexShrink: 0 }}>×</button>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, fontSize: 10, color: T.faint2 }}>
            Data from <a href="https://www.wikidata.org" target="_blank" rel="noreferrer" style={{ color: T.faint }}>Wikidata</a> & <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer" style={{ color: T.faint }}>Wikipedia</a>
          </div>
        </div>
      </div>

      {selectedPerson && (
        <PersonCard person={selectedPerson} allPeople={people} onClose={() => setSelectedPerson(null)} onSelectPerson={p => setSelectedPerson(p)} T={T} />
      )}
    </div>
  );
}
