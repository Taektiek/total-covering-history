// Person detail modal: Wikipedia summary, image and direct links to the
// person's Wikipedia article and Wikidata item.
import { useState, useEffect } from "react";
import { yearLabel, fetchPersonDetails, wikiUrl } from "./lib";

export default function PersonCard({ person, allPeople, onClose, onSelectPerson, T }) {
  const [details, setDetails] = useState(null);
  const overlaps = allPeople.filter(p => p.id !== person.id && p.birth < person.death && p.death > person.birth);
  useEffect(() => { fetchPersonDetails(person.id).then(setDetails); }, [person.id]);

  const linkStyle = {
    display: "inline-block", padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
    textDecoration: "none", cursor: "pointer",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: T.overlay, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "85vh", overflow: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", position: "relative" }}>
        <div style={{ background: person.color, borderRadius: "16px 16px 0 0", padding: "18px 22px 14px", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 12, right: 14, background: "rgba(0,0,0,0.2)", border: "none", borderRadius: 20, color: "#fff", fontSize: 18, width: 30, height: 30, cursor: "pointer", lineHeight: "30px", textAlign: "center", padding: 0 }}>×</button>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {details?.image
              ? <img src={details.image} alt={person.label} style={{ width: 72, height: 88, objectFit: "cover", borderRadius: 8, border: "3px solid rgba(255,255,255,0.4)", flexShrink: 0 }} />
              : <div style={{ width: 72, height: 88, borderRadius: 8, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>👤</div>
            }
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>{person.label}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 3 }}>{yearLabel(person.birth)} — {yearLabel(person.death)}</div>
              {person.desc && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4, fontStyle: "italic" }}>{person.desc}</div>}
            </div>
          </div>
        </div>
        <div style={{ padding: "18px 22px" }}>
          {details === null
            ? <div style={{ color: T.muted, fontSize: 13 }}>Loading…</div>
            : details.extract
              ? <p style={{ fontSize: 13, color: T.text, lineHeight: 1.7, margin: 0 }}>{details.extract}</p>
              : <p style={{ fontSize: 13, color: T.muted, fontStyle: "italic" }}>No Wikipedia summary available.</p>
          }

          {/* direct links to the Wikipedia article and Wikidata item */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {details?.wikiTitle && (
              <a href={wikiUrl(details.wikiTitle)} target="_blank" rel="noreferrer"
                style={{ ...linkStyle, background: "#4f86c6", color: "#fff" }}>
                📖 Read on Wikipedia ↗
              </a>
            )}
            <a href={`https://www.wikidata.org/wiki/${person.id}`} target="_blank" rel="noreferrer"
              style={{ ...linkStyle, background: T.accentBg, color: T.accent, border: `1px solid ${T.accentBorder}` }}>
              ⌬ Wikidata item ↗
            </a>
          </div>

          {overlaps.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: T.muted, textTransform: "uppercase", marginBottom: 8 }}>Contemporaries in your list</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {overlaps.map(p => (
                  <button key={p.id} onClick={() => onSelectPerson(p)} style={{ padding: "4px 10px", background: p.color + "22", border: `1px solid ${p.color}66`, borderRadius: 20, color: p.color, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {p.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>({yearLabel(p.birth)}–{yearLabel(p.death)})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
