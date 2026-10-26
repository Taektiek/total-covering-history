// Timeline canvas: pan by dragging, shift-drag to zoom into a region,
// zoom-aware date/name labels on the bars, clickable gaps.
import { useRef, useState, useEffect } from "react";
import { assignRows, yearLabel, compactYear } from "./lib";

const BAR_H = 10, TALL_BAR_H = 16, ROW_GAP = 4, TOP_PAD = 4;
const MAX_TL_HEIGHT = 220;
const DATES_PX = 70;   // bar pixel width at which dates appear on the bar
const NAME_PX = 150;   // bar pixel width at which the name appears too

export default function Timeline({ people, view, setView, bounds, gaps, range, onGapClick, wikiTitles, onHover, onSelectPerson, T }) {
  const tlRef = useRef(null);
  const dragRef = useRef(null);
  const justDraggedRef = useRef(false);
  const [width, setWidth] = useState(900);
  const [dragSel, setDragSel] = useState(null); // {lo, hi} in percent

  useEffect(() => {
    if (!tlRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(tlRef.current);
    return () => ro.disconnect();
  }, []);

  const viewSpan = view[1] - view[0];
  const pxPerYear = width / viewSpan;
  const { rowMap, numRows } = assignRows(people);
  const tall = people.some(p => (p.death - p.birth) * pxPerYear >= DATES_PX);
  const barH = tall ? TALL_BAR_H : BAR_H;
  const contentH = TOP_PAD + numRows * (barH + ROW_GAP) + 22;
  const tlHeight = Math.min(contentH, MAX_TL_HEIGHT);

  const pctInView = (y) => ((y - view[0]) / viewSpan) * 100;

  const getPct = (clientX) => {
    if (!tlRef.current) return 0;
    const rect = tlRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100));
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    justDraggedRef.current = false;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const mode = e.shiftKey ? "select" : "pan";
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: tlRef.current ? tlRef.current.scrollTop : 0,
      startView: [...view],
      startPct: getPct(e.clientX),
      moved: false,
    };
    if (mode === "select") setDragSel({ lo: getPct(e.clientX), hi: getPct(e.clientX) });
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3 || Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (d.mode === "pan") {
      // horizontal: drag the view window with the pointer
      const dYears = dx / width * viewSpan;
      let s = d.startView[0] - dYears;
      s = Math.max(bounds[0], Math.min(s, bounds[1] - viewSpan));
      setView([s, s + viewSpan]);
      // vertical: scroll through the rows when they overflow the box
      if (tlRef.current) tlRef.current.scrollTop = d.startScroll - (e.clientY - d.startY);
    } else {
      setDragSel({ lo: d.startPct, hi: getPct(e.clientX) });
    }
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    justDraggedRef.current = d.moved;
    if (e) e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragSel(null);
    if (d.mode === "select") {
      const lo = Math.min(d.startPct, getPct(e.clientX));
      const hi = Math.max(d.startPct, getPct(e.clientX));
      if (hi - lo > 1) {
        const ns = view[0] + lo / 100 * viewSpan;
        const ne = view[0] + hi / 100 * viewSpan;
        if (ne - ns >= 10) setView([ns, ne]);
      }
    }
  };

  // ticks
  const ticks = [];
  const step = viewSpan > 1500 ? 200 : viewSpan > 600 ? 100 : viewSpan > 200 ? 50 : viewSpan > 80 ? 20 : 10;
  for (let y = Math.ceil(view[0] / step) * step; y <= view[1]; y += step) ticks.push(y);

  const rangeL = range ? Math.max(pctInView(range[0]), 0) : 0;
  const rangeR = range ? Math.min(pctInView(range[1]), 100) : 0;

  return (
    <div>
      <div
        ref={tlRef}
        style={{
          position: "relative", height: tlHeight, background: T.surface, borderRadius: 8,
          border: `1px solid ${T.border}`, overflowX: "hidden", overflowY: contentH > MAX_TL_HEIGHT ? "auto" : "hidden",
          cursor: "grab", userSelect: "none", touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* challenge-range highlight */}
        {range && rangeR > rangeL && (
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `${rangeL}%`, width: `${rangeR - rangeL}%`,
            background: "rgba(212,168,67,0.10)", borderTop: "2px solid #d4a843", borderBottom: "2px solid #d4a843",
            pointerEvents: "none", zIndex: 5 }} />
        )}
        {/* gaps (clickable to start a gap challenge) */}
        {gaps.map(([s, e], i) => {
          const l = Math.max(pctInView(s), 0), r = Math.min(pctInView(e), 100);
          if (r <= 0 || l >= 100) return null;
          return (
            <div key={`g${i}`}
              onClick={(ev) => { ev.stopPropagation(); if (!justDraggedRef.current) onGapClick(s, e); }}
              title={`Play a gap challenge for ${yearLabel(Math.round(s))} – ${yearLabel(Math.round(e))}`}
              style={{ position: "absolute", top: 0, bottom: 0, left: `${l}%`, width: `${r - l}%`, background: T.gap,
                borderLeft: s > view[0] ? `2px dashed ${T.gapDash}` : "none",
                borderRight: e < view[1] ? `2px dashed ${T.gapDash}` : "none",
                cursor: "pointer", zIndex: 1 }} />
          );
        })}
        {/* people bars */}
        {people.map(p => {
          const row = rowMap[p.id] ?? 0;
          const l = Math.max(pctInView(p.birth), 0), r = Math.min(pctInView(p.death), 100);
          if (r <= 0 || l >= 100) return null;
          const barPx = Math.max((r - l) / 100 * width, 0.3);
          const showDates = barPx >= DATES_PX;
          const showName = barPx >= NAME_PX;
          return (
            <div key={p.id}
              onPointerEnter={() => onHover?.(p)}
              onPointerLeave={() => onHover?.(null)}
              onClick={(ev) => { ev.stopPropagation(); if (!justDraggedRef.current) onSelectPerson(p); }}
              title={`${p.label}: ${yearLabel(p.birth)}–${yearLabel(p.death)}${wikiTitles[p.id] ? ` — ${wikiTitles[p.id]}` : ""}`}
              style={{ position: "absolute", top: TOP_PAD + row * (barH + ROW_GAP), height: barH,
                left: `${l}%`, width: `${Math.max(r - l, 0.15)}%`,
                background: p.color, borderRadius: 3, opacity: 0.88, cursor: "pointer", zIndex: 2,
                display: "flex", alignItems: "center", overflow: "hidden" }}>
              {showDates && (
                <span style={{
                  fontSize: 9, lineHeight: `${barH}px`, color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.55)", paddingLeft: 5, whiteSpace: "nowrap", fontWeight: 600,
                  pointerEvents: "none", userSelect: "none",
                }}>
                  {showName ? `${p.label} · ` : ""}{compactYear(p.birth)}–{compactYear(p.death)}
                </span>
              )}
            </div>
          );
        })}
        {/* ticks */}
        {ticks.map(y => {
          const x = pctInView(y); if (x < 0 || x > 100) return null;
          return (
            <div key={`t${y}`} style={{ position: "absolute", bottom: 0, left: `${x}%`, width: 1, height: 8, background: T.faint2, transform: "translateX(-50%)", zIndex: 3, pointerEvents: "none" }}>
              <div style={{ position: "absolute", bottom: -15, left: "50%", transform: "translateX(-50%)", fontSize: 9, color: T.faint, whiteSpace: "nowrap" }}>{yearLabel(y)}</div>
            </div>
          );
        })}
        {/* region-selection zoom */}
        {dragSel && Math.abs(dragSel.hi - dragSel.lo) > 0.5 && (
          <div style={{ position: "absolute", top: 0, bottom: 0,
            left: `${Math.min(dragSel.lo, dragSel.hi)}%`, width: `${Math.abs(dragSel.hi - dragSel.lo)}%`,
            background: "rgba(74,90,170,0.15)", border: "2px solid rgba(74,90,170,0.5)", pointerEvents: "none", zIndex: 6 }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.faint, marginTop: 5, padding: "0 2px" }}>
        <span>{yearLabel(Math.round(view[0]))}</span>
        <span style={{ color: T.muted }}>drag to pan · shift+drag to zoom · click a red gap to challenge it</span>
        <span>{yearLabel(Math.round(view[1]))}</span>
      </div>
    </div>
  );
}
