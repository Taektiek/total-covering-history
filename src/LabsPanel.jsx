// Labs panel: one switch per experiment (all default OFF), numeric options for
// core labs, and one-click playsets. Flags persist in localStorage.
import { LAB_DEFS, PLAYSETS } from "./labs.js";

export default function LabsPanel({ T, labs, opts, mobile = false, onToggle, onOpt, onPlayset, onClose }) {
  const row = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}`,
  };
  const sw = (on, onClick) => (
    <button onClick={onClick} aria-label="toggle"
      style={{
        width: 34, height: 18, borderRadius: 10, border: `1px solid ${T.border2}`,
        background: on ? "#5bb86a" : T.border, position: "relative", cursor: "pointer", flexShrink: 0, padding: 0,
      }}>
      <span style={{
        position: "absolute", top: 1, left: on ? 17 : 1, width: 14, height: 14, borderRadius: 7,
        background: "#fff", transition: "left 0.12s",
      }} />
    </button>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: T.overlay, zIndex: 900, display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", padding: mobile ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: mobile ? "14px 14px 0 0" : 14, width: "100%", maxWidth: 520, maxHeight: mobile ? "85dvh" : "85vh", overflow: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>🧪 Labs — experiments</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
          Every experiment is off by default, so the base game is unchanged. “Core” labs change what adds are legal and apply to every add from now on.
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {Object.entries(PLAYSETS).map(([name, ids]) => (
            <button key={name} onClick={() => onPlayset(ids)}
              style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, background: T.accentBg, color: T.accent, border: `1px solid ${T.accentBorder}`, borderRadius: 14, cursor: "pointer" }}>
              {name}
            </button>
          ))}
          <button onClick={() => onPlayset(null)}
            style={{ padding: "4px 10px", fontSize: 11, background: "none", color: T.faint, border: `1px solid ${T.border2}`, borderRadius: 14, cursor: "pointer" }}>
            clear all
          </button>
        </div>
        {LAB_DEFS.map(d => (
          <div key={d.id} style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                {d.name} {d.ui === "core" && <span style={{ fontSize: 9, color: T.faint, border: `1px solid ${T.border2}`, borderRadius: 4, padding: "0 4px", marginLeft: 4 }}>core</span>}
              </div>
              <div style={{ fontSize: 11, color: T.muted }}>{d.desc}</div>
              {d.id === "maxOverlap" && labs.maxOverlap && (
                <input type="number" min={0} max={200} value={opts.maxOverlapYears}
                  onChange={e => onOpt("maxOverlapYears", Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 60, marginTop: 4, padding: "2px 6px", fontSize: 11, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 6, color: T.text }} />
              )}
              {d.id === "budget" && labs.budget && (
                <input type="number" min={0} max={500} value={opts.budget}
                  onChange={e => onOpt("budget", Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 60, marginTop: 4, padding: "2px 6px", fontSize: 11, background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 6, color: T.text }} />
              )}
            </div>
            {sw(labs[d.id], () => onToggle(d.id, !labs[d.id]))}
          </div>
        ))}
      </div>
    </div>
  );
}
