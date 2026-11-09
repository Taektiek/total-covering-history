import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  PRESENT, MIN_SPAN, COLORS, DARK, LIGHT, TUTORIAL_DONE_KEY,
  yearLabel, wikiUrl, computeCoverage, searchPeople, fetchPersonDates, fetchPersonFull,
  fetchWikiTitles, fetchPeopleDates, suggestBridgers, CATEGORIES, checkCategory,
} from "./lib";
import {
  DEFAULT_LABS, DEFAULT_OPTS,
  canAddPerson, marginalYears, nextLargestGap, nearMiss,
  PARS, medalFor,
} from "./labs.js";
import { loadRecords, recordResult, encodeShare, decodeShare, loadAutosave, saveAutosave, clearAutosave } from "./features.js";
import Timeline from "./Timeline";
import PersonCard from "./PersonCard";
import StartScreen from "./StartScreen";
import Leaderboard from "./Leaderboard";
import { useIsMobile } from "./useIsMobile";
import {
  loadBoard, submitResult, boardFor, playerName, fmtMs, dailyPuzzles, dailyDef, nextDaily,
} from "./daily.js";

// ☰ dropdown with the secondary actions (save/load/share/labs/…), kept out of
// the main view so the primary interactions stay uncluttered.
function GameMenu({ T, items, loadingFile, onAction, onClose, fileInput }) {
  const itemStyle = {
    display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13,
    background: "none", border: "none", borderRadius: 6, color: T.text, cursor: "pointer", whiteSpace: "nowrap",
  };
  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={onClose} />
      <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 100, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", padding: 6, display: "flex", flexDirection: "column", minWidth: 190 }}>
        {items.map(it => (
          <button key={it.key} onClick={() => onAction(it.key)}
            style={itemStyle}
            onMouseEnter={e => { e.currentTarget.style.background = T.accentBg; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
            {it.label}
          </button>
        ))}
        <label style={{ ...itemStyle, color: loadingFile ? T.faint : T.text, cursor: loadingFile ? "wait" : "pointer" }}
          onMouseEnter={e => { if (!loadingFile) e.currentTarget.style.background = T.accentBg; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
          {loadingFile ? "⏳ Loading…" : "📂 Load from file"}
          {fileInput}
        </label>
      </div>
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState("start"); // "start" | "game"
  const [dark, setDark] = useState(false);
  const T = dark ? DARK : LIGHT;
  const mobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false); // mobile ☰ menu

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

  // labs are compiled out of this build: flags stay at their defaults (all
  // OFF), so the base game is what ships
  const labs = DEFAULT_LABS;
  const opts = DEFAULT_OPTS;
  const [records, setRecords] = useState(() => loadRecords());
  const [chain, setChain] = useState(0);
  const [notice, setNotice] = useState("");
  const [sugDates, setSugDates] = useState({});   // qid -> dates, for the Δ-preview lab
  const [bridgers, setBridgers] = useState([]);   // 💡 candidates for the target gap
  const [bridgersLoading, setBridgersLoading] = useState(false);
  const undoRef = useRef([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const shareLoadedRef = useRef(false);

  // daily puzzles + local leaderboard
  const [daily, setDaily] = useState(null); // { dateKey, n } while in a daily
  const dailyStartRef = useRef(0);
  const [board, setBoard] = useState(() => loadBoard());
  const [boardForModal, setBoardForModal] = useState(null); // { dateKey, n }
  const [lastResultId, setLastResultId] = useState(null);

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
      let anchor = null, end = null, bounds = null;
      if (def.anchorId) {
        anchor = await fetchPersonFull(def.anchorId, false); // anchors may be non-human (Homer)
        if (!anchor || anchor.birth === null) {
          setLoadError(`Couldn't load the starting person (${def.anchorId}). Try another challenge.`);
          setStarting(false);
          return false;
        }
        if (def.endId) {
          end = await fetchPersonFull(def.endId, false);
          if (!end || end.death === null || end.death <= anchor.death) {
            setLoadError(`The ending person (${def.endId}) has no usable death date after ${anchor.label}'s death.`);
            setStarting(false);
            return false;
          }
        }
        bounds = [anchor.birth, end ? end.death : (def.endYear ?? PRESENT)];
      } else if (def.startYear != null && def.endYear != null) {
        // range-only challenge (daily puzzles): pure year window, no anchor person
        bounds = [def.startYear, def.endYear];
      } else {
        setLoadError("The challenge needs a starting person or a year range.");
        setStarting(false);
        return false;
      }
      if (bounds[1] <= bounds[0]) {
        setLoadError("The challenge timeline is empty — pick a different start/end.");
        setStarting(false);
        return false;
      }

      const preloaded = [];
      if (anchor) { anchor.color = COLORS[0]; preloaded.push(anchor); }
      if (end) { end.color = COLORS[1]; preloaded.push(end); }

      // extra people (from a save file); anchors are never duplicated
      const failed = [];
      let nextColor = preloaded.length;
      for (const qid of extraPeople) {
        if (anchor && qid === anchor.id) continue;
        if (end && qid === end.id) continue;
        const person = await fetchPersonFull(qid);
        if (!person) { failed.push(qid); continue; }
        person.color = COLORS[nextColor % COLORS.length];
        nextColor += 1;
        preloaded.push(person);
      }

      setChallenge({
        key: def.key, name: def.name, mode: def.mode ?? null, custom: !!def.custom,
        anchorId: def.anchorId ?? null, endId: def.endId ?? null, endYear: def.endYear ?? null,
        startYear: def.startYear ?? null, anchor, end, bounds, daily: def.daily ?? null,
        tutorial: !!def.tutorial,
      });
      setDaily(def.daily ?? null);
      dailyStartRef.current = Date.now();
      setPeople(preloaded);
      setView([bounds[0], bounds[1]]);
      setChallengeRange(restoreRange || null);
      setCustomStart(restoreRange ? String(Math.round(restoreRange[0])) : "");
      setCustomEnd(restoreRange ? String(Math.round(restoreRange[1])) : "");
      setInputVal(""); setSuggestions([]); setError(""); setWonDismissed(false); setSelectedPerson(null);
      setScreen("game");
      if (failed.length) setLoadError(`Loaded with ${failed.length} unresolved ID(s): ${failed.join(", ")}`);
      setStarting(false);
      return preloaded;
    } catch (err) {
      setLoadError("Failed to start challenge: " + err.message);
      setStarting(false);
      return false;
    }
  }, []);

  // submit a finished daily run to the local leaderboard (best only, timed)
  const submitDaily = useCallback((d, count) => {
    const ms = Date.now() - dailyStartRef.current;
    const { board: nextBoard, improved } = submitResult(board, {
      dateKey: d.dateKey, n: d.n, name: playerName(), people: count, ms,
    });
    setBoard(nextBoard);
    setLastResultId(nextBoard.entries.find(x => x.dateKey === d.dateKey && x.n === d.n)?.id ?? null);
    setNotice(improved
      ? `📅 Daily submitted — ${count} people in ${fmtMs(ms)}! 🏆 Open the leaderboard to see your rank.`
      : `📅 Daily finished — ${count} people in ${fmtMs(ms)} (best stays on the board).`);
  }, [board]);

  // ------------------------------------------------------------ labs
  // share links (standard feature): auto-load a game encoded in the URL hash
  useEffect(() => {
    if (shareLoadedRef.current) return;
    const h = window.location.hash;
    if (!h.startsWith("#c=")) return;
    shareLoadedRef.current = true;
    const t = setTimeout(() => {
      try {
        const payload = decodeShare(h.slice(3));
        if (payload?.challenge?.anchorId && Array.isArray(payload.ids)) {
          startChallenge(payload.challenge, payload.ids, Array.isArray(payload.range) ? payload.range : null);
        }
      } catch { /* bad hash — ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, [startChallenge]);

  const handleShare = () => {
    const payload = {
      v: 1,
      challenge: {
        key: challenge.key, name: challenge.name, mode: challenge.mode,
        anchorId: challenge.anchorId, endId: challenge.endId, endYear: challenge.endYear,
        startYear: challenge.startYear, custom: challenge.custom, daily: challenge.daily,
      },
      ids: people.filter(p => !isChallengePerson(p.id)).map(p => p.id),
      ...(challengeRange ? { range: [Math.round(challengeRange[0]), Math.round(challengeRange[1])] } : {}),
    };
    const url = `${window.location.origin}${window.location.pathname}#c=${encodeShare(payload)}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => setNotice("🔗 Link copied — opening it loads this exact game."),
        () => setNotice(url));
    } else setNotice(url);
  };

  // undo lab: Ctrl+Z / ↩ button reverts the last add/remove
  const doUndo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    setUndoDepth(d => Math.max(0, d - 1));
    setPeople(snap.people);
    setChallengeRange(snap.challengeRange);
    setNotice("↩ Undone.");
  }, []);
  useEffect(() => {
    if (!labs.undo) return;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [labs.undo, doUndo]);

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
  const won = !!challenge && fullyCovered && people.length > (challenge.anchor ? 1 : 0) && !wonDismissed;

  // daily chain: when a daily puzzle is won, the next one of the day starts
  // automatically after a short countdown (the win banner can jump ahead too)
  const todayPuzzles = useMemo(() => (daily ? dailyPuzzles(daily.dateKey, PRESENT) : []), [daily]);
  const nextPuzzle = daily ? nextDaily(todayPuzzles, daily.n) : null;
  const [autoCount, setAutoCount] = useState(null);
  useEffect(() => {
    if (!won || !nextPuzzle || wonDismissed) return;
    const deadline = Date.now() + 4000;
    const iv = setInterval(() => setAutoCount(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 500);
    const t = setTimeout(() => { setAutoCount(null); startChallenge(dailyDef(daily.dateKey, nextPuzzle)); }, 4000);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [won, nextPuzzle, wonDismissed, daily, startChallenge]);

  const rangeStats = challengeRange ? computeCoverage(people, bounds, challengeRange) : null;
  const rangeFullyCovered = rangeStats ? rangeStats.gaps.length === 0 : false;
  const rangeSpan = challengeRange ? challengeRange[1] - challengeRange[0] : 0;
  const rangeCoverPct = rangeStats ? Math.min(100, (rangeStats.total / rangeSpan) * 100).toFixed(1) : 0;
  const rangePeople = challengeRange
    ? people.filter(p => p.death > challengeRange[0] && p.birth < challengeRange[1])
    : [];

  const sortedPeople = [...people].sort((a, b) => a.birth - b.birth);

  // labs-derived state
  const par = labs.parMedals && challenge ? (PARS[challenge.key] ?? null) : null;
  const largestGap = gaps.length ? [...gaps].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] : null;
  const targetGap = challengeRange ?? largestGap;
  const marginal = useMemo(() => {
    if (!labs.holdsYears || !bounds) return {};
    return Object.fromEntries(people.map(p => [p.id, marginalYears(p, people, bounds)]));
  }, [labs.holdsYears, people, bounds]);

  // Δ-preview lab: batch-fetch dates for the visible suggestions
  useEffect(() => {
    if (!labs.deltaPreview || suggestions.length === 0) return;
    let cancelled = false;
    fetchPeopleDates(suggestions.map(s => s.id)).then(d => { if (!cancelled) setSugDates(d); });
    return () => { cancelled = true; };
  }, [suggestions, labs.deltaPreview]);

  // 💡 bridger suggestions for the target gap
  const loadBridgers = async () => {
    if (!targetGap) return;
    setBridgersLoading(true); setBridgers([]);
    const cands = await suggestBridgers(targetGap[0], targetGap[1], challenge?.mode ?? null, 6);
    setBridgers(cands.filter(c => !people.find(p => p.id === c.id)));
    setBridgersLoading(false);
  };

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
    setInputVal(val); setError(""); setNotice("");
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

    if (anchor && dates.death <= anchor.death) {
      setFetchingId(null);
      setError(`"${item.label}" died before ${anchor.label}'s death — can't help cover the timeline.`);
      setInputVal(""); return;
    }

    // labs: core-level legality (frontier-only overlap cap, budget cap)
    const labCheck = canAddPerson({ ...dates, id: item.id, label: item.label }, people, labs, opts, bounds);
    if (!labCheck.ok) {
      setFetchingId(null);
      setError(`🧪 ${labCheck.reason}`);
      setInputVal(""); return;
    }

    const before = computeCoverage(people, bounds).total;
    const after = computeCoverage([...people, { ...dates, id: item.id, color: "#fff" }], bounds).total;
    setFetchingId(null);
    if (after <= before) { setError(`"${item.label}" (${yearLabel(dates.birth)}–${yearLabel(dates.death)}) is already fully covered — adds nothing new.`); setInputVal(""); return; }
    if (labs.undo) {
      undoRef.current.push({ people, challengeRange });
      if (undoRef.current.length > 50) undoRef.current.shift();
      setUndoDepth(d => d + 1);
    }
    const color = COLORS[people.length % COLORS.length];
    const cand = { ...dates, id: item.id, color, desc: item.desc || "" };
    const withNew = [...people, cand];
    setPeople(withNew);
    if (labs.deltaPreview) setNotice(`Added ${item.label} — +${Math.round(after - before)} years covered.`);
    if (labs.nearMiss) {
      const target = challengeRange ?? largestGap;
      if (target) {
        const nm = nearMiss({ birth: dates.birth, death: dates.death }, target, people, bounds);
        if (nm) setNotice(`So close — only ${nm.left} years left in ${yearLabel(Math.round(target[0]))}–${yearLabel(Math.round(target[1]))}!`);
      }
    }
    // gap-chain lab: advance to the next-largest gap when the active one is bridged
    if (labs.gapChain && challengeRange && !won) {
      const rangeHadGaps = computeCoverage(people, bounds, challengeRange).gaps.length > 0;
      const gapsAfter = computeCoverage(withNew, bounds).gaps;
      const rangeDone = computeCoverage(withNew, bounds, challengeRange).gaps.length === 0;
      if (rangeHadGaps && rangeDone && gapsAfter.length > 0) {
        const ng = nextLargestGap(gapsAfter, challengeRange);
        if (ng && ng[1] - ng[0] >= 10) {
          setChain(c => c + 1);
          setChallengeRange(ng);
          setCustomStart(String(Math.round(ng[0])));
          setCustomEnd(String(Math.round(ng[1])));
        }
      }
    }
    const wonAfter = computeCoverage(withNew, bounds).gaps.length === 0 && withNew.length > (challenge.anchor ? 1 : 0) && !wonDismissed;

    // daily puzzle: submit the finished run to the local leaderboard (best only)
    if (daily && wonAfter && !won) submitDaily(daily, withNew.length);

    // standard feature: persist fewest-people bests per challenge / gap range
    if (challenge) {
      let recs = records;
      let changed = false;
      if (wonAfter && !won) {
        const r = recordResult(recs, challenge.key, withNew.length);
        recs = r.records; changed = true;
        if (r.isRecord) setNotice(`🏅 New record (${challenge.name}): ${withNew.length} people!`);
        if (challenge.tutorial) {
          try { localStorage.setItem(TUTORIAL_DONE_KEY, "1"); } catch { /* private mode */ }
        }
      }
      if (challengeRange) {
        const rangeHadGaps = computeCoverage(people, bounds, challengeRange).gaps.length > 0;
        const rangeDone = computeCoverage(withNew, bounds, challengeRange).gaps.length === 0;
        if (rangeHadGaps && rangeDone) {
          const rk = `${challenge.key}|${Math.round(challengeRange[0])}-${Math.round(challengeRange[1])}`;
          const cnt = withNew.filter(p => p.death > challengeRange[0] && p.birth < challengeRange[1]).length;
          const r = recordResult(recs, rk, cnt);
          recs = r.records;
          if (r.isRecord) changed = true;
        }
      }
      if (changed) setRecords(recs);
    }
    setInputVal(""); inputRef.current?.focus();
  }, [people, challenge, challengeRange, bounds, labs, opts, largestGap, won, wonDismissed, records, daily, submitDaily]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && suggestions.length > 0) handleSelect(suggestions[0]);
    if (e.key === "Escape") setSuggestions([]);
  };

  const isChallengePerson = (id) =>
    id === challenge?.anchorId || id === challenge?.endId;

  const removePerson = (id) => {
    if (isChallengePerson(id)) return;
    if (labs.undo) {
      undoRef.current.push({ people, challengeRange });
      if (undoRef.current.length > 50) undoRef.current.shift();
      setUndoDepth(d => d + 1);
    }
    setPeople(prev => prev.filter(p => p.id !== id));
  };

  const backToMenu = () => {
    if (people.length > (challenge?.anchor ? 1 : 0) && !window.confirm("Leave this challenge? Your progress is autosaved — you can continue from the home screen.")) return;
    setScreen("start"); setChallenge(null); setPeople([]); setLoadError("");
  };

  // ------------------------------------------------------------ save / load
  // v2 format: { version: 2, challenge: {...}, ids: [...], range?: [...] }
  // Shared by the manual Save/Load file, the 🔗 share link and the autosave.
  const serializeGame = () => {
    if (!challenge) return null;
    const payload = {
      version: 2,
      challenge: {
        key: challenge.key, name: challenge.name, mode: challenge.mode,
        anchorId: challenge.anchorId, endId: challenge.endId, endYear: challenge.endYear,
        startYear: challenge.startYear, custom: challenge.custom, daily: challenge.daily,
        tutorial: challenge.tutorial || undefined,
      },
      ids: people.filter(p => !isChallengePerson(p.id)).map(p => p.id),
    };
    if (challengeRange) payload.range = [Math.round(challengeRange[0]), Math.round(challengeRange[1])];
    // small progress summary so the home screen can show "continue: N people, X%"
    if (challenge.bounds) {
      const { total } = computeCoverage(people, challenge.bounds);
      const span = challenge.bounds[1] - challenge.bounds[0];
      payload.progress = {
        people: payload.ids.length,
        coverPct: span > 0 ? Math.min(100, (total / span) * 100).toFixed(1) : "0.0",
      };
    }
    return payload;
  };

  // parse a v2 (or legacy v1) payload into { def, ids, restoreRange }
  const defFromPayload = (parsed) => {
    if (!Array.isArray(parsed.ids)) throw new Error("Invalid format: no ids.");
    let def, restoreRange = null;
    if (parsed.version >= 2 && parsed.challenge) {
      def = {
        key: parsed.challenge.key || "custom",
        name: parsed.challenge.name || "Loaded Challenge",
        mode: parsed.challenge.mode ?? null,
        anchorId: parsed.challenge.anchorId ?? null,
        endId: parsed.challenge.endId ?? null,
        endYear: parsed.challenge.endYear ?? null,
        startYear: parsed.challenge.startYear ?? null,
        custom: !!parsed.challenge.custom,
        daily: parsed.challenge.daily ?? null,
        tutorial: !!parsed.challenge.tutorial,
      };
      if (Array.isArray(parsed.range) && parsed.range.length === 2) {
        restoreRange = [Number(parsed.range[0]), Number(parsed.range[1])];
      }
    } else {
      // v1 files are the original challenge: Socrates → present, no restriction
      def = { key: "classic", name: "The Classic", mode: null, anchorId: "Q913", endId: null, endYear: null, custom: false };
    }
    if (!def.anchorId && def.startYear == null) throw new Error("No starting person or year range.");
    return { def, ids: parsed.ids, restoreRange };
  };

  const handleSave = () => {
    const payload = serializeGame();
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "timeline-cover.json"; a.click();
    URL.revokeObjectURL(url);
  };

  // autosave: persist the in-progress game to localStorage on every change, so
  // reopening the page — or going back to the home screen — can continue it
  useEffect(() => {
    if (screen !== "game" || !challenge) return;
    const payload = serializeGame();
    if (payload) saveAutosave(payload);
  }, [screen, challenge, people, challengeRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // continue the autosaved game from the home screen
  const continueSavedGame = useCallback(() => {
    const saved = loadAutosave();
    if (!saved) return;
    setLoadError("");
    try {
      const { def, ids, restoreRange } = defFromPayload(saved);
      startChallenge(def, ids, restoreRange).then(ok => {
        if (ok) setNotice("👋 Continued your saved game.");
      });
    } catch (err) {
      setLoadError("Could not restore the saved game: " + err.message);
    }
  }, [startChallenge]);

  // restore the autosaved game on open (a #c= share link takes priority)
  const autosaveRestoredRef = useRef(false);
  useEffect(() => {
    if (autosaveRestoredRef.current) return;
    if (typeof window !== "undefined" && window.location.hash.startsWith("#c=")) return;
    autosaveRestoredRef.current = true;
    const saved = loadAutosave();
    if (!saved) return;
    const t = setTimeout(() => {
      try {
        const { def, ids, restoreRange } = defFromPayload(saved);
        startChallenge(def, ids, restoreRange).then(ok => {
          if (ok) setNotice("👋 Continued your saved game.");
        });
      } catch { /* bad autosave — ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, [startChallenge]);

  const loadFile = async (file) => {
    setLoadingFile(true); setLoadError("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const { def, ids, restoreRange } = defFromPayload(parsed);
      const preloaded = await startChallenge(def, ids, restoreRange);
      // a loaded daily that is already fully covered counts as a finished run
      if (def.daily && Array.isArray(preloaded) && preloaded.length > (def.anchorId ? 1 : 0) &&
          def.startYear != null && computeCoverage(preloaded, [def.startYear, def.endYear]).gaps.length === 0) {
        submitDaily(def.daily, preloaded.length);
      }
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

  // ☰ menu entries (secondary actions) — plain descriptors; GameMenu maps keys
  // to handlers, so no closures/ref access happen during render
  const menuItems = [{ key: "back", label: "⏏ Back to menu" }];
  if (view && bounds && (view[0] !== bounds[0] || view[1] !== bounds[1])) menuItems.push({ key: "resetZoom", label: "↺ Reset zoom" });
  menuItems.push({ key: "save", label: "💾 Save to file" });
  menuItems.push({ key: "share", label: "🔗 Copy share link" });
  if (labs.undo) menuItems.push({ key: "undo", label: `↩ Undo${undoDepth > 0 ? ` (${undoDepth})` : ""}` });
  if (challenge?.daily) menuItems.push({ key: "board", label: "🏆 Daily leaderboard" });
  menuItems.push({ key: "clearSave", label: "🗑 Forget saved game" });

  const onMenuAction = (key) => {
    setMenuOpen(false);
    if (key === "back") backToMenu();
    else if (key === "resetZoom") setView([bounds[0], bounds[1]]);
    else if (key === "save") handleSave();
    else if (key === "share") handleShare();
    else if (key === "undo") doUndo();
    else if (key === "board") setBoardForModal(challenge.daily);
    else if (key === "clearSave") { clearAutosave(); setNotice("🗑 Saved game forgotten — reopening the page starts fresh."); }
  };

  // ------------------------------------------------------------ start screen
  if (screen === "start" || !challenge) {
    // read the autosave here (read-only) so the home screen can offer "continue"
    const savedGame = loadAutosave();
    return (
      <StartScreen
        T={T} dark={dark} setDark={setDark} mobile={mobile}
        onStart={(def) => startChallenge(def)}
        onContinue={continueSavedGame}
        continueGame={savedGame}
        onLoadFile={loadFile}
        loadError={loadError}
        busy={starting || loadingFile}
        records={records}
        board={board}
      />
    );
  }

  // ------------------------------------------------------------ game screen
  return (
    <div style={{ fontFamily: "system-ui,sans-serif", background: T.bg, minHeight: "100dvh", color: T.text, display: "flex", flexDirection: "column", touchAction: "manipulation" }}>
      {/* Sticky top */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: T.bg, borderBottom: `1px solid ${T.border}`, padding: mobile ? "10px 12px 8px" : "14px 20px 10px" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto" }}>
          {/* header: what this is (left) + theme & one menu (right) */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: mobile ? 15 : 17, fontWeight: 700, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                🕰️ {challenge.name}
              </h1>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                {challenge.anchor
                  ? <>{challenge.anchor.label} ({yearLabel(bounds[0])}) → {challenge.end ? `${challenge.end.label} (${yearLabel(bounds[1])})` : `present (${yearLabel(bounds[1])})`}</>
                  : <>{yearLabel(bounds[0])} → {yearLabel(bounds[1])}</>}
                {challenge.mode && <> · <strong style={{ color: T.accent }}>{CATEGORIES[challenge.mode].label}</strong> only</>}
                {challenge.daily && <> · 📅 {challenge.daily.dateKey} · puzzle #{challenge.daily.n}/3</>}
                {" · "}
                <a href="https://0rwx.com/" target="_blank" rel="noreferrer" title="0rwx AI usage label: AI made — I curate" style={{ color: T.faint, textDecoration: "none" }}>AI:X</a>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, position: "relative" }}>
              <button style={btnStyle()} onClick={() => setDark(d => !d)} title="Toggle light/dark">{dark ? "☀️" : "🌙"}</button>
              <button style={btnStyle({ fontWeight: 700 })} onClick={() => setMenuOpen(o => !o)} title="Menu — save/load/share/labs/…" aria-label="Menu">☰</button>
              {menuOpen && (
                <GameMenu
                  T={T} items={menuItems} loadingFile={loadingFile}
                  onAction={onMenuAction} onClose={() => setMenuOpen(false)}
                  fileInput={<input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; setMenuOpen(false); loadFile(f); } }} />}
                />
              )}
            </div>
          </div>

          {/* status strip: what is happening right now */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 10px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140, height: 8, background: T.border, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${coverPct}%`, background: fullyCovered ? "#5bb86a" : "#4f86c6", borderRadius: 4, transition: "width 0.4s" }} />
            </div>
            <strong style={{ fontSize: mobile ? 15 : 17, color: fullyCovered ? "#5bb86a" : T.text, minWidth: 52 }}>{coverPct}%</strong>
            <span style={{ fontSize: 12, color: T.muted }}>
              {fullyCovered
                ? <span style={{ color: "#5bb86a", fontWeight: 700 }}>fully covered 🎉</span>
                : <>{gaps.length} {gaps.length === 1 ? "gap" : "gaps"} left{largestGap && <> — biggest {Math.round(largestGap[1] - largestGap[0])}y ({yearLabel(Math.round(largestGap[0]))}–{yearLabel(Math.round(largestGap[1]))})</>}</>}
              {" · "}{people.length} {people.length === 1 ? "person" : "people"}
            </span>
            {par && <span style={{ fontSize: 10, color: T.faint, border: `1px solid ${T.border2}`, borderRadius: 8, padding: "1px 6px" }} title="Approximate minimum people for this challenge (labs)">par {par}</span>}
            {labs.budget && opts.budget > 0 && <span style={{ fontSize: 10, color: T.muted, border: `1px solid ${T.border2}`, borderRadius: 8, padding: "1px 6px" }} title="Budget cap (labs)">{people.length}/{opts.budget} 👥</span>}
            {labs.gapChain && chain > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, border: `1px solid ${T.accentBorder}`, borderRadius: 8, padding: "1px 6px" }} title="Consecutive gaps bridged (labs)">⛓ chain ×{chain}</span>}
            {labs.gapChallenge && gaps.length > 0 && !fullyCovered && !labs.mysteryGaps && largestGap && (
              <button onClick={() => startGapChallenge(largestGap[0], largestGap[1])} style={{ ...btnStyle({ padding: "2px 8px" }), fontSize: 10 }} title="Start a gap challenge on the largest gap">
                🎯 challenge this gap
              </button>
            )}
            {labs.mysteryGaps && gaps.length > 0 && !fullyCovered && (
              <span style={{ fontSize: 10, color: T.gapDash }} title="Gap regions hidden by the mystery-gaps lab">❓ {gaps.length} {gaps.length === 1 ? "gap" : "gaps"}</span>
            )}
          </div>

          {/* Input — the main action: add a person to cover the timeline */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input ref={inputRef} value={inputVal} onChange={e => handleInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={won
                ? "Timeline covered 🎉"
                : largestGap
                  ? `Add someone who was alive in ${yearLabel(Math.round(largestGap[0]))}–${yearLabel(Math.round(largestGap[1]))}…`
                  : challenge.mode
                    ? `Search for a person — ${CATEGORIES[challenge.mode].label} only…`
                    : "🔍 Search for a historical person to add…"}
              disabled={!!fetchingId || won} autoComplete="off"
              style={{ width: "100%", boxSizing: "border-box", padding: mobile ? "10px 14px" : "11px 16px", fontSize: mobile ? 15 : 16, background: T.surface, border: `2px solid ${T.accentBorder}`, borderRadius: 10, color: T.text, outline: "none" }}
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
                    {labs.deltaPreview && sugDates[s.id] && (() => {
                      const cand = { id: s.id, birth: sugDates[s.id].birth, death: sugDates[s.id].death };
                      const d = Math.round(computeCoverage([...people, cand], bounds).total - computeCoverage(people, bounds).total);
                      const completes = challengeRange && rangeStats && rangeStats.gaps.length > 0 &&
                        computeCoverage([...people, cand], bounds, challengeRange).gaps.length === 0;
                      return (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: d > 0 ? "#5bb86a" : T.faint, flexShrink: 0 }}>
                          {d > 0 ? `+${d} y` : "no gain"}{completes ? " · ✓ completes 🎯" : ""}
                        </span>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <div style={{ color: "#e07b54", fontSize: 12, marginBottom: 4 }}>{error}</div>}
          {loadError && <div style={{ color: "#e07b54", fontSize: 12, marginBottom: 4 }}>{loadError}</div>}
          {notice && <div style={{ color: "#5bb86a", fontSize: 12, marginBottom: 4 }}>{notice}</div>}

          {/* Timeline */}
          <Timeline
            people={people} view={view} setView={setView} bounds={bounds} gaps={gaps}
            range={challengeRange}
            onGapClick={labs.gapChallenge && !labs.mysteryGaps ? startGapChallenge : () => {}}
            gapsClickable={!!labs.gapChallenge && !labs.mysteryGaps}
            hideGaps={labs.mysteryGaps} mobile={mobile}
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

          {/* 💡 bridger suggestions (labs) */}
          {labs.bridgers && targetGap && !fullyCovered && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "6px 0 8px" }}>
              <button onClick={loadBridgers} disabled={bridgersLoading} style={btnStyle({ padding: "2px 8px", fontSize: 10 })}>
                {bridgersLoading ? "💡 searching…" : `💡 who lived in ${yearLabel(Math.round(targetGap[0]))}–${yearLabel(Math.round(targetGap[1]))}?`}
              </button>
              {bridgers.map(b => (
                <button key={b.id} onClick={() => { setBridgers([]); handleSelect({ id: b.id, label: b.label, desc: "" }); }}
                  style={{ padding: "2px 8px", fontSize: 10, background: T.surface2, color: T.text, border: `1px solid ${T.border2}`, borderRadius: 12, cursor: "pointer" }}
                  title={`${yearLabel(b.birth)}–${yearLabel(b.death)} — click to add`}>
                  {b.label}
                </button>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto", padding: mobile ? "10px 12px 20px" : "14px 20px 24px" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto" }}>

          {/* gap challenge (🧪 lab) */}
          {labs.gapChallenge && (
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
          )}

          {/* tutorial coach banner */}
          {challenge.tutorial && !won && (
            <div style={{ background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: T.text }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>👋 Tutorial — bridge two lives</div>
              <div style={{ color: T.muted, lineHeight: 1.5 }}>
                The timeline runs from <strong style={{ color: T.text }}>{challenge.anchor?.label}'s birth ({yearLabel(bounds[0])})</strong> to{" "}
                <strong style={{ color: T.text }}>{challenge.end?.label}'s life ({yearLabel(challenge.end?.birth ?? bounds[1])}–{yearLabel(bounds[1])})</strong>.
                Every single year in between must be covered by someone who was alive — the <span style={{ color: "#e05454", fontWeight: 700 }}>red stretch</span> is the gap between their lives.
                Search for a person who lived across it (try <em>“Madonna”</em>) and click them to add their lifespan. Cover everything to win!
              </div>
            </div>
          )}

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
              {(par || records[challenge.key] !== undefined || (labs.budget && opts.budget > 0)) && (
                <div style={{ fontSize: 12, marginTop: 4, color: T.muted }}>
                  {par && <span style={{ marginRight: 10 }}>{medalFor(people.length, par)} par {par} · you: {people.length}</span>}
                  {records[challenge.key] !== undefined && <span style={{ marginRight: 10 }}>🏅 your best: {records[challenge.key]}</span>}
                  {labs.budget && opts.budget > 0 && <span>{people.length <= opts.budget ? "🏆 within budget" : "over budget"} ({opts.budget})</span>}
                </div>
              )}
              {challenge.tutorial && (
                <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>🎓 Tutorial complete — pick any challenge below!</div>
              )}
              {nextPuzzle && (
                <button onClick={() => startChallenge(dailyDef(daily.dateKey, nextPuzzle))}
                  style={{ marginTop: 10, padding: "8px 20px", background: "#5bb86a", border: "none", borderRadius: 6, color: "#0f1117", fontWeight: 800, cursor: "pointer", fontSize: 14, ...(mobile ? { display: "block", width: "100%" } : {}) }}>
                  ▶ Next puzzle #{nextPuzzle.n}: {nextPuzzle.anchorLabel} → {nextPuzzle.endLabel} (auto in {autoCount ?? 4}s)
                </button>
              )}
              {challenge.daily && !nextPuzzle && (
                <button onClick={() => setBoardForModal(challenge.daily)}
                  style={{ marginTop: 10, padding: "7px 18px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, color: T.accent, fontWeight: 700, cursor: "pointer", fontSize: 13, ...(mobile ? { display: "block", width: "100%" } : {}) }}>
                  🏆 Leaderboard — all 3 done!
                </button>
              )}
              {!nextPuzzle && (
                <button onClick={() => setWonDismissed(true)} style={{ marginTop: 10, padding: "7px 18px", background: "#5bb86a", border: "none", borderRadius: 6, color: "#0f1117", fontWeight: 700, cursor: "pointer", fontSize: 13, ...(mobile ? { display: "block", width: "100%" } : {}) }}>Keep playing</button>
              )}
              {nextPuzzle && (
                <button onClick={() => setWonDismissed(true)} style={{ marginTop: 10, marginLeft: mobile ? 0 : 6, padding: "7px 18px", background: "transparent", border: `1px solid ${T.winBorder}`, borderRadius: 6, color: T.text, cursor: "pointer", fontSize: 13, ...(mobile ? { display: "block", width: "100%" } : {}) }}>Stay here</button>
              )}
              <button onClick={backToMenu} style={{ marginTop: 10, marginLeft: mobile ? 0 : 6, padding: "7px 18px", background: "transparent", border: `1px solid ${T.winBorder}`, borderRadius: 6, color: T.text, cursor: "pointer", fontSize: 13, ...(mobile ? { display: "block", width: "100%" } : {}) }}>New challenge</button>
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
                style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: mobile ? "wrap" : "nowrap", background: T.surface, border: `1px solid ${p.color}33`, borderLeft: `3px solid ${p.color}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, cursor: "pointer", transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = T.surface2}
                onMouseLeave={e => e.currentTarget.style.background = T.surface}
              >
                <span style={{ color: p.color, fontWeight: 700, minWidth: mobile ? 0 : 130 }}>{p.label}</span>
                <span style={{ color: T.faint, fontSize: 11, minWidth: mobile ? 0 : 140 }}>{yearLabel(p.birth)} – {yearLabel(p.death)}</span>
                {marginal[p.id] > 0 && (
                  <span title={`Years only ${p.label} covers — removing them opens that gap`} style={{ fontSize: 10, color: T.accent, background: T.accentBg, borderRadius: 8, padding: "1px 6px", flexShrink: 0 }}>
                    ⛓ holds {marginal[p.id]}y
                  </span>
                )}
                {p.desc && <span style={{ color: T.muted, fontSize: 12, flex: 1, ...(mobile ? { flexBasis: "100%", order: 5 } : {}) }}>{p.desc.slice(0, 90)}{p.desc.length > 90 ? "…" : ""}</span>}
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
            {" · "}
            <a href="https://0rwx.com/" target="_blank" rel="noreferrer" title="0rwx AI usage label: AI made — I curate" style={{ color: T.faint }}>AI:X</a>
          </div>
        </div>
      </div>

      {selectedPerson && (
        <PersonCard person={selectedPerson} allPeople={people} onClose={() => setSelectedPerson(null)} onSelectPerson={p => setSelectedPerson(p)} marginal={marginal[selectedPerson.id] ?? null} mobile={mobile} T={T} />
      )}

      {boardForModal && (
        <Leaderboard
          T={T} mobile={mobile} dateKey={boardForModal.dateKey} n={boardForModal.n}
          entries={boardFor(board, boardForModal.dateKey, boardForModal.n)} highlightId={lastResultId}
          onClose={() => setBoardForModal(null)}
        />
      )}
    </div>
  );
}
