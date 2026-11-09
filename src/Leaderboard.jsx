// Daily leaderboard modal: ranked table of recorded best solutions for one
// daily puzzle. (A percentile graph was planned but deferred until there is a
// server-backed board to compute percentiles over.)
import { fmtMs } from "./daily.js";

export default function Leaderboard({ T, mobile, dateKey, n, entries, highlightId, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: T.overlay, zIndex: 1000, display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", padding: mobile ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: mobile ? "16px 16px 0 0" : 16, width: "100%", maxWidth: 560, maxHeight: mobile ? "85dvh" : "85vh", overflow: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", padding: "18px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>🏆 Daily {dateKey} · puzzle #{n}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 12 }}>
          Best-only leaderboard, stored in this browser: fewest people wins, ties broken by time.
          Compare with friends via the 🔗 share links. The store is isolated in <code>src/daily.js</code> if a shared backend is added later.
        </div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 13, color: T.muted, fontStyle: "italic" }}>No solution recorded yet — finish the puzzle to appear here.</div>
        ) : (
          <div>
            {entries.map((e, i) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6, background: e.id === highlightId ? T.accentBg : "transparent", border: e.id === highlightId ? `1px solid ${T.accentBorder}` : "1px solid transparent", fontSize: 13 }}>
                <span style={{ width: 22, color: T.faint, fontWeight: 700 }}>{i + 1}</span>
                <span style={{ flex: 1, color: T.text, fontWeight: e.id === highlightId ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.name}{e.id === highlightId && <span style={{ color: "#d4a843", fontSize: 11 }}> (you)</span>}
                </span>
                <span style={{ color: T.text, fontWeight: 700, minWidth: 64, textAlign: "right" }}>{e.people} people</span>
                <span style={{ color: T.muted, fontSize: 11, minWidth: 48, textAlign: "right" }}>{fmtMs(e.ms)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
