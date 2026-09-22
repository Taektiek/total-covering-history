
import { useState, useEffect, useRef, useCallback } from "react";

const SOCRATES = { id: "Q913", label: "Socrates", desc: "Ancient Greek philosopher", birth: -470, death: -399, color: "#4f86c6" };
const TIMELINE_START = SOCRATES.birth;
const TIMELINE_END = new Date().getFullYear();
const SPAN = TIMELINE_END - TIMELINE_START;

const COLORS = ["#4f86c6","#e07b54","#5bb86a","#c97dc8","#d4a843","#5bc4c4","#e05470","#8c7ae6","#a0c45a","#e08c54"];

const DARK = {
  bg:"#0f1117",surface:"#1a1d27",surface2:"#1e2130",border:"#2a2d3a",border2:"#333",
  text:"#e8e8e8",muted:"#888",faint:"#555",faint2:"#444",
  accent:"#a0a8e0",accentBg:"#252840",accentBorder:"#4a4e6a",
  gap:"rgba(224,84,84,0.15)",gapDash:"#e05454",
  win:"linear-gradient(135deg,#1a2e1a,#1e2e1e)",winBorder:"#3a6a3a",
  overlay:"rgba(0,0,0,0.7)",card:"#1a1d27",cardBorder:"#3a3d5a",
};
const LIGHT = {
  bg:"#f5f6fa",surface:"#ffffff",surface2:"#f0f1f8",border:"#d0d4e8",border2:"#c0c4d8",
  text:"#1a1d2e",muted:"#666",faint:"#888",faint2:"#aaa",
  accent:"#4a5aaa",accentBg:"#e8eaf8",accentBorder:"#9aa0d0",
  gap:"rgba(200,50,50,0.10)",gapDash:"#cc3333",
  win:"linear-gradient(135deg,#e8f5e8,#f0faf0)",winBorder:"#5aaa5a",
  overlay:"rgba(0,0,0,0.45)",card:"#ffffff",cardBorder:"#c0c8e8",
};

function yearLabel(y) { return y < 0 ? `${Math.abs(y)} BC` : `${y} AD`; }

function assignRows(people) {
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

async function searchPeople(query) {
  if (!query || query.length < 2) return [];
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=20&format=json&origin=*&type=item`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rx = /\b(politician|president|king|queen|emperor|empress|writer|author|poet|philosopher|scientist|mathematician|physicist|chemist|biologist|historian|artist|painter|sculptor|composer|musician|singer|actor|actress|director|general|admiral|pope|bishop|saint|explorer|inventor|architect|economist|lawyer|judge|revolutionary|activist|athlete|footballer|monarch|prince|princess|duke|duchess|pharaoh|sultan|caliph|tsar|chancellor|minister|senator|leader|founder|reformer|theologian|astronomer|engineer|physician|doctor|soldier|officer|commander|ruler|dictator|statesman|diplomat|journalist|novelist|playwright|scholar|professor|rabbi|imam|monk|nun|warrior|knight|baron|count|earl|lord|born|died|\d{3,4})/i;
    return (data.search||[]).filter(e=>e.description&&rx.test(e.description)).slice(0,8).map(e=>({id:e.id,label:e.label,desc:e.description||""}));
  } catch { return []; }
}

async function fetchPersonDates(qid) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|labels&languages=en&format=json&origin=*`;
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
    const isHuman = (claims["P31"]||[]).some(v=>v.mainsnak?.datavalue?.value?.id==="Q5");
    if (!isHuman) return null;
    const birth = extractYear("P569");
    let death = extractYear("P570");
    if (birth===null) return null;
    if (death===null) death = TIMELINE_END;
    return { label, birth, death };
  } catch { return null; }
}

async function fetchPersonDetails(qid) {
  try {
    const slRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`);
    const slData = await slRes.json();
    const title = slData.entities?.[qid]?.sitelinks?.enwiki?.title;
    if (!title) return { extract: null, image: null };
    const wpRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts|pageimages&exintro=true&explaintext=true&exsentences=3&piprop=thumbnail&pithumbsize=300&format=json&origin=*`);
    const wpData = await wpRes.json();
    const page = Object.values(wpData.query?.pages||{})[0];
    return { extract: page?.extract||null, image: page?.thumbnail?.source||null };
  } catch { return { extract: null, image: null }; }
}

function computeCoverage(people) {
  if (!people.length) return { gaps:[[TIMELINE_START,TIMELINE_END]], total:0 };
  const intervals = people.map(p=>[p.birth,p.death]).sort((a,b)=>a[0]-b[0]);
  const merged = [];
  for (const [s,e] of intervals) {
    if (!merged.length||s>merged[merged.length-1][1]) merged.push([s,e]);
    else merged[merged.length-1][1]=Math.max(merged[merged.length-1][1],e);
  }
  const gaps=[]; let prev=TIMELINE_START;
  for (const [s,e] of merged) { if(s>prev) gaps.push([prev,s]); prev=e; }
  if (prev<TIMELINE_END) gaps.push([prev,TIMELINE_END]);
  return { gaps, total: merged.reduce((a,[s,e])=>a+e-s,0) };
}

function PersonCard({ person, allPeople, onClose, onSelectPerson, T }) {
  const [details, setDetails] = useState(null);
  const overlaps = allPeople.filter(p => p.id !== person.id && p.birth < person.death && p.death > person.birth);
  useEffect(() => { fetchPersonDetails(person.id).then(setDetails); }, [person.id]);
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:T.overlay,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.card,border:`1px solid ${T.cardBorder}`,borderRadius:16,width:"100%",maxWidth:560,maxHeight:"85vh",overflow:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.5)",position:"relative" }}>
        <div style={{ background:person.color,borderRadius:"16px 16px 0 0",padding:"18px 22px 14px",position:"relative" }}>
          <button onClick={onClose} style={{ position:"absolute",top:12,right:14,background:"rgba(0,0,0,0.2)",border:"none",borderRadius:20,color:"#fff",fontSize:18,width:30,height:30,cursor:"pointer",lineHeight:"30px",textAlign:"center",padding:0 }}>×</button>
          <div style={{ display:"flex",gap:16,alignItems:"flex-start" }}>
            {details?.image
              ? <img src={details.image} alt={person.label} style={{ width:72,height:88,objectFit:"cover",borderRadius:8,border:"3px solid rgba(255,255,255,0.4)",flexShrink:0 }} />
              : <div style={{ width:72,height:88,borderRadius:8,background:"rgba(255,255,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0 }}>👤</div>
            }
            <div>
              <div style={{ fontSize:22,fontWeight:800,color:"#fff",letterSpacing:-0.5 }}>{person.label}</div>
              <div style={{ fontSize:13,color:"rgba(255,255,255,0.8)",marginTop:3 }}>{yearLabel(person.birth)} — {yearLabel(person.death)}</div>
              {person.desc&&<div style={{ fontSize:12,color:"rgba(255,255,255,0.7)",marginTop:4,fontStyle:"italic" }}>{person.desc}</div>}
            </div>
          </div>
        </div>
        <div style={{ padding:"18px 22px" }}>
          {details===null
            ? <div style={{ color:T.muted,fontSize:13 }}>Loading…</div>
            : details.extract
              ? <p style={{ fontSize:13,color:T.text,lineHeight:1.7,margin:0 }}>{details.extract}</p>
              : <p style={{ fontSize:13,color:T.muted,fontStyle:"italic" }}>No Wikipedia summary available.</p>
          }
          {overlaps.length>0&&(
            <div style={{ marginTop:18 }}>
              <div style={{ fontSize:11,fontWeight:700,letterSpacing:1,color:T.muted,textTransform:"uppercase",marginBottom:8 }}>Contemporaries in your list</div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                {overlaps.map(p=>(
                  <button key={p.id} onClick={()=>onSelectPerson(p)} style={{ padding:"4px 10px",background:p.color+"22",border:`1px solid ${p.color}66`,borderRadius:20,color:p.color,fontSize:12,fontWeight:600,cursor:"pointer" }}>
                    {p.label} <span style={{ opacity:0.7,fontWeight:400 }}>({yearLabel(p.birth)}–{yearLabel(p.death)})</span>
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

export default function App() {
  const [people, setPeople] = useState([SOCRATES]);
  const [inputVal, setInputVal] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchingId, setFetchingId] = useState(null);
  const [error, setError] = useState("");
  const [won, setWon] = useState(false);
  const [dark, setDark] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [view, setView] = useState([TIMELINE_START, TIMELINE_END]);
  const [dragSel, setDragSel] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);

  const timelineRef = useRef(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const T = dark ? DARK : LIGHT;
  const viewSpan = view[1] - view[0];
  const { gaps, total } = computeCoverage(people);
  const fullyCovered = gaps.every(([s,e])=>s>=e);
  const coverPct = Math.min(100,(total/SPAN)*100).toFixed(1);
  const sortedPeople = [...people].sort((a,b)=>a.birth-b.birth);
  const { rowMap, numRows } = assignRows(people);
  const BAR_H = 10, ROW_GAP = 4, TOP_PAD = 4;
  const tlHeight = Math.max(48, TOP_PAD + numRows*(BAR_H+ROW_GAP) + 20);

  useEffect(() => { if (fullyCovered && people.length>1) setWon(true); }, [fullyCovered, people.length]);

  const pctInView = (y) => ((y-view[0])/viewSpan)*100;
  const yearAtPct = (pct) => view[0] + pct/100 * viewSpan;

  const getTimelinePct = (clientX) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, (clientX-rect.left)/rect.width*100));
  };

  const onTLMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragSel({ startPct: getTimelinePct(e.clientX), endPct: getTimelinePct(e.clientX) });
    setIsDragging(true);
  };

  const onTLMouseMove = useCallback((e) => {
    if (!isDragging) return;
    setDragSel(prev => prev ? { ...prev, endPct: getTimelinePct(e.clientX) } : null);
  }, [isDragging]);

  const onTLMouseUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (!dragSel) return;
    const lo = Math.min(dragSel.startPct, dragSel.endPct);
    const hi = Math.max(dragSel.startPct, dragSel.endPct);
    if (hi - lo > 1) {
      const ns = yearAtPct(lo), ne = yearAtPct(hi);
      if (ne - ns >= 10) setView([ns, ne]);
    }
    setDragSel(null);
  }, [isDragging, dragSel]);

  useEffect(() => {
    window.addEventListener("mousemove", onTLMouseMove);
    window.addEventListener("mouseup", onTLMouseUp);
    return () => { window.removeEventListener("mousemove", onTLMouseMove); window.removeEventListener("mouseup", onTLMouseUp); };
  }, [onTLMouseMove, onTLMouseUp]);

  const handleInput = (val) => {
    setInputVal(val); setError("");
    clearTimeout(debounceRef.current);
    if (val.length<2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true); setSuggestions(await searchPeople(val)); setLoading(false);
    }, 300);
  };

  const handleSelect = useCallback(async (item) => {
    setSuggestions([]); setInputVal(item.label);
    if (people.find(p=>p.id===item.id)) { setError("Already added."); setInputVal(""); return; }
    setFetchingId(item.id);
    const dates = await fetchPersonDates(item.id);
    setFetchingId(null);
    if (!dates) { setError(`No dates found for "${item.label}".`); setInputVal(""); return; }
    if (dates.death <= SOCRATES.death) { setError(`"${item.label}" died before Socrates' death — can't help cover the timeline.`); setInputVal(""); return; }
    const before = computeCoverage(people).total;
    const after = computeCoverage([...people,{...dates,id:item.id,color:"#fff"}]).total;
    if (after <= before) { setError(`"${item.label}" (${yearLabel(dates.birth)}–${yearLabel(dates.death)}) is already fully covered — adds nothing new.`); setInputVal(""); return; }
    const color = COLORS[people.length % COLORS.length];
    setPeople(prev=>[...prev,{...dates,id:item.id,color,desc:item.desc||""}]);
    setInputVal(""); inputRef.current?.focus();
  }, [people]);

  const handleKeyDown = (e) => {
    if (e.key==="Enter"&&suggestions.length>0) handleSelect(suggestions[0]);
    if (e.key==="Escape") setSuggestions([]);
  };

  const removePerson = (id) => {
    if (id===SOCRATES.id) return;
    setPeople(prev=>prev.filter(p=>p.id!==id)); setWon(false);
  };

  const reset = () => { setPeople([SOCRATES]); setWon(false); setInputVal(""); setSuggestions([]); setError(""); setView([TIMELINE_START,TIMELINE_END]); };

  // Save: write JSON file with IDs (excluding Socrates since it's always preloaded)
  const handleSave = () => {
    const ids = people.filter(p=>p.id!==SOCRATES.id).map(p=>p.id);
    const blob = new Blob([JSON.stringify({ version:1, ids }, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "timeline-cover.json"; a.click();
    URL.revokeObjectURL(url);
  };

  // Load: read file, fetch each person by QID
  const handleLoadClick = () => { setLoadError(""); fileInputRef.current?.click(); };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setLoadingFile(true); setLoadError("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const ids = parsed.ids;
      if (!Array.isArray(ids)) throw new Error("Invalid file format.");

      const newPeople = [SOCRATES];
      const failed = [];
      for (const qid of ids) {
        if (qid === SOCRATES.id) continue;
        // Fetch both dates and search desc
        const dates = await fetchPersonDates(qid);
        if (!dates) { failed.push(qid); continue; }
        // Get description from wikidata labels/descriptions
        let desc = "";
        try {
          const dRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=descriptions&languages=en&format=json&origin=*`);
          const dData = await dRes.json();
          desc = dData.entities?.[qid]?.descriptions?.en?.value || "";
        } catch {}
        const color = COLORS[newPeople.length % COLORS.length];
        newPeople.push({ ...dates, id: qid, color, desc });
      }

      setPeople(newPeople);
      setWon(false);
      setView([TIMELINE_START, TIMELINE_END]);
      if (failed.length) setLoadError(`Loaded with ${failed.length} unresolved ID(s): ${failed.join(", ")}`);
    } catch (err) {
      setLoadError("Failed to load file: " + err.message);
    }
    setLoadingFile(false);
  };

  // Ticks
  const ticks = [];
  const step = viewSpan>1500?200:viewSpan>600?100:viewSpan>200?50:viewSpan>80?20:10;
  for (let y=Math.ceil(view[0]/step)*step; y<=view[1]; y+=step) ticks.push(y);

  const selLo = dragSel ? Math.min(dragSel.startPct, dragSel.endPct) : 0;
  const selHi = dragSel ? Math.max(dragSel.startPct, dragSel.endPct) : 0;

  const btnStyle = (extra={}) => ({
    padding:"4px 10px", background:T.accentBg, border:`1px solid ${T.accentBorder}`,
    borderRadius:6, color:T.accent, cursor:"pointer", fontSize:12, ...extra
  });

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", background:T.bg, minHeight:"100vh", color:T.text, display:"flex", flexDirection:"column" }}>
      {/* Sticky top */}
      <div style={{ position:"sticky", top:0, zIndex:50, background:T.bg, borderBottom:`1px solid ${T.border}`, padding:"14px 20px 10px" }}>
        <div style={{ maxWidth:920, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <h1 style={{ fontSize:19,fontWeight:700,margin:0 }}>🕰️ Timeline Total Cover</h1>
            <div style={{ display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" }}>
              {(view[0]!==TIMELINE_START||view[1]!==TIMELINE_END) &&
                <button style={btnStyle()} onClick={()=>setView([TIMELINE_START,TIMELINE_END])}>↺ Reset zoom</button>}
              <button style={btnStyle()} onClick={handleSave} title="Save progress to file">💾 Save</button>
              <button style={btnStyle({ opacity: loadingFile ? 0.6 : 1 })} onClick={handleLoadClick} disabled={loadingFile} title="Load progress from file">
                {loadingFile ? "⏳ Loading…" : "📂 Load"}
              </button>
              <button style={btnStyle()} onClick={()=>setDark(d=>!d)}>{dark?"☀️":"🌙"}</button>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display:"none" }} onChange={handleFileChange} />
            </div>
          </div>

          {/* Input */}
          <div style={{ position:"relative", marginBottom:8 }}>
            <input ref={inputRef} value={inputVal} onChange={e=>handleInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Search for a historical person…" disabled={!!fetchingId||won} autoComplete="off"
              style={{ width:"100%",boxSizing:"border-box",padding:"8px 14px",fontSize:14,background:T.surface,border:`1px solid ${T.border2}`,borderRadius:8,color:T.text,outline:"none" }}
            />
            {(loading||fetchingId)&&<span style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:T.muted,fontSize:12 }}>{fetchingId?"Loading…":"Searching…"}</span>}
            {suggestions.length>0&&(
              <div style={{ position:"absolute",top:"100%",left:0,right:0,zIndex:200,background:T.surface2,border:`1px solid ${T.border2}`,borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.3)",overflow:"hidden",marginTop:3 }}>
                {suggestions.map((s,i)=>(
                  <div key={s.id} onClick={()=>handleSelect(s)}
                    style={{ padding:"8px 14px",cursor:"pointer",borderBottom:i<suggestions.length-1?`1px solid ${T.border}`:"none",background:i===0?T.accentBg:"transparent" }}
                    onMouseEnter={e=>e.currentTarget.style.background=T.accentBg}
                    onMouseLeave={e=>e.currentTarget.style.background=i===0?T.accentBg:"transparent"}
                  >
                    <span style={{ fontWeight:600,fontSize:14,color:T.text }}>{s.label}</span>
                    {s.desc&&<span style={{ color:T.muted,fontSize:12,marginLeft:8 }}>{s.desc.slice(0,70)}{s.desc.length>70?"…":""}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {error&&<div style={{ color:"#e07b54",fontSize:12,marginBottom:4 }}>{error}</div>}
          {loadError&&<div style={{ color:"#e07b54",fontSize:12,marginBottom:4 }}>{loadError}</div>}

          {/* Timeline */}
          <div style={{ position:"relative",height:tlHeight,background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden",cursor:"crosshair",userSelect:"none",marginBottom:4 }}
            ref={timelineRef} onMouseDown={onTLMouseDown}>
            {gaps.map(([s,e],i)=>{
              const l=Math.max(pctInView(s),0),r=Math.min(pctInView(e),100);
              if(r<=0||l>=100) return null;
              return <div key={i} style={{ position:"absolute",top:0,bottom:0,left:`${l}%`,width:`${r-l}%`,background:T.gap,
                borderLeft:s>view[0]?`2px dashed ${T.gapDash}`:"none",
                borderRight:e<view[1]?`2px dashed ${T.gapDash}`:"none" }} />;
            })}
            {people.map(p=>{
              const row=rowMap[p.id]??0;
              const l=Math.max(pctInView(p.birth),0),r=Math.min(pctInView(p.death),100);
              if(r<=0||l>=100) return null;
              return <div key={p.id} onClick={e=>{e.stopPropagation();setSelectedPerson(p);}}
                title={`${p.label}: ${yearLabel(p.birth)}–${yearLabel(p.death)}`}
                style={{ position:"absolute",top:TOP_PAD+row*(BAR_H+ROW_GAP),height:BAR_H,left:`${l}%`,width:`${Math.max(r-l,0.3)}%`,
                  background:p.color,borderRadius:3,opacity:0.88,cursor:"pointer",transition:"opacity 0.1s" }}
                onMouseEnter={e=>e.currentTarget.style.opacity="1"}
                onMouseLeave={e=>e.currentTarget.style.opacity="0.88"}
              />;
            })}
            {ticks.map(y=>{
              const x=pctInView(y); if(x<0||x>100) return null;
              return <div key={y} style={{ position:"absolute",bottom:0,left:`${x}%`,width:1,height:8,background:T.faint2,transform:"translateX(-50%)" }}>
                <div style={{ position:"absolute",bottom:-15,left:"50%",transform:"translateX(-50%)",fontSize:9,color:T.faint,whiteSpace:"nowrap" }}>{yearLabel(y)}</div>
              </div>;
            })}
            {dragSel&&selHi-selLo>0.5&&(
              <div style={{ position:"absolute",top:0,bottom:0,left:`${selLo}%`,width:`${selHi-selLo}%`,
                background:"rgba(74,90,170,0.15)",border:"2px solid rgba(74,90,170,0.5)",pointerEvents:"none" }} />
            )}
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:T.faint,marginBottom:4,padding:"0 2px" }}>
            <span>{yearLabel(Math.round(view[0]))}</span>
            <span style={{ color:T.muted }}>drag to zoom into a region</span>
            <span>{yearLabel(Math.round(view[1]))}</span>
          </div>

          {/* Coverage bar */}
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <div style={{ flex:1,height:6,background:T.border,borderRadius:3,overflow:"hidden" }}>
              <div style={{ height:"100%",width:`${coverPct}%`,background:fullyCovered?"#5bb86a":"#4f86c6",borderRadius:3,transition:"width 0.4s" }} />
            </div>
            <span style={{ fontSize:12,color:fullyCovered?"#5bb86a":T.muted,minWidth:44 }}>{coverPct}%</span>
            {gaps.length>0&&!fullyCovered&&(()=>{const g=[...gaps].sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];return<span style={{fontSize:11,color:T.faint}}>largest gap: {yearLabel(Math.round(g[0]))}–{yearLabel(Math.round(g[1]))}</span>;})()}
          </div>
        </div>
      </div>

      {/* Scrollable list */}
      <div style={{ flex:1,overflowY:"auto",padding:"14px 20px 24px" }}>
        <div style={{ maxWidth:920,margin:"0 auto" }}>
          {won&&(
            <div style={{ background:T.win,border:`1px solid ${T.winBorder}`,borderRadius:12,padding:"16px 20px",textAlign:"center",marginBottom:16 }}>
              <div style={{ fontSize:28,marginBottom:6 }}>🎉</div>
              <div style={{ fontSize:18,fontWeight:700,color:"#5bb86a" }}>Timeline Covered!</div>
              <div style={{ color:T.muted,fontSize:13,marginTop:4 }}>
                Covered with <strong style={{color:T.text}}>{people.length} people</strong>.
                {people.length<=5&&" Incredible!"}
                {people.length>5&&people.length<=10&&" Great job!"}
                {people.length>10&&" Can you do it with fewer?"}
              </div>
              <button onClick={reset} style={{ marginTop:10,padding:"7px 18px",background:"#5bb86a",border:"none",borderRadius:6,color:"#0f1117",fontWeight:700,cursor:"pointer",fontSize:13 }}>Play Again</button>
            </div>
          )}

          <div style={{ fontSize:12,color:T.faint,marginBottom:8 }}>
            <strong style={{color:T.text}}>{people.length}</strong> {people.length===1?"person":"people"} — sorted by birth year — click to inspect
          </div>

          <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
            {sortedPeople.map(p=>(
              <div key={p.id} onClick={()=>setSelectedPerson(p)}
                style={{ display:"flex",alignItems:"center",gap:8,background:T.surface,border:`1px solid ${p.color}33`,borderLeft:`3px solid ${p.color}`,borderRadius:6,padding:"6px 10px",fontSize:13,cursor:"pointer",transition:"background 0.1s" }}
                onMouseEnter={e=>e.currentTarget.style.background=T.surface2}
                onMouseLeave={e=>e.currentTarget.style.background=T.surface}
              >
                <span style={{ color:p.color,fontWeight:700,minWidth:130 }}>{p.label}</span>
                <span style={{ color:T.faint,fontSize:11,minWidth:140 }}>{yearLabel(p.birth)} – {yearLabel(p.death)}</span>
                {p.desc&&<span style={{ color:T.muted,fontSize:12,flex:1 }}>{p.desc.slice(0,90)}{p.desc.length>90?"…":""}</span>}
                {p.id!==SOCRATES.id&&(
                  <button onClick={e=>{e.stopPropagation();removePerson(p.id);}}
                    style={{ background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:16,padding:"0 4px",lineHeight:1,marginLeft:"auto",flexShrink:0 }}>×</button>
                )}
              </div>
            ))}
          </div>

          {!won&&people.length>1&&(
            <button onClick={reset} style={{ marginTop:14,padding:"5px 12px",background:"transparent",border:`1px solid ${T.border2}`,borderRadius:6,color:T.faint,cursor:"pointer",fontSize:12 }}>Reset</button>
          )}

          <div style={{ marginTop:24,fontSize:10,color:T.faint2 }}>
            Data from <a href="https://www.wikidata.org" target="_blank" rel="noreferrer" style={{color:T.faint}}>Wikidata</a> & <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer" style={{color:T.faint}}>Wikipedia</a>
          </div>
        </div>
      </div>

      {selectedPerson&&(
        <PersonCard person={selectedPerson} allPeople={people} onClose={()=>setSelectedPerson(null)} onSelectPerson={p=>setSelectedPerson(p)} T={T} />
      )}
    </div>
  );
}

