import { useState, useCallback } from "react";
import { FONT, CIRCUIT_LABELS, CIRCUIT_COLORS } from "./roleHelpers.js";
import { EmptyState, SL } from "./panelUI.jsx";

const LS_KEY = "dtwin_baselines";

// Default baselines match the fallback profiles used by roleHelpers synthCircuitWatts
const DEFAULT_BASELINES = {
  main: { baselineKw: 8.2, tolerancePct: 30 },
  ovk: { baselineKw: 0.9, tolerancePct: 40 },
  circuit6boiler: { baselineKw: 3.2, tolerancePct: 50 },
  circuit7: { baselineKw: 0.4, tolerancePct: 45 },
  circuit8: { baselineKw: 2.1, tolerancePct: 20 },
  circuit9: { baselineKw: 1.8, tolerancePct: 40 },
  circuit10: { baselineKw: 2.4, tolerancePct: 35 },
  circuit11: { baselineKw: 1.6, tolerancePct: 40 },
  circuit12: { baselineKw: 0.9, tolerancePct: 45 },
  airconditioner1: { baselineKw: 1.4, tolerancePct: 45 },
  airconditioner2: { baselineKw: 1.3, tolerancePct: 45 },
  outsidelighting1: { baselineKw: 0.15, tolerancePct: 25 },
  outsidelighting2: { baselineKw: 0.18, tolerancePct: 25 },
  vehiclecharging1: { baselineKw: 0.0, tolerancePct: 60 },
  vehiclecharging2: { baselineKw: 0.0, tolerancePct: 60 },
  elevator: { baselineKw: 0.25, tolerancePct: 55 },
  "3DLED": { baselineKw: 0.3, tolerancePct: 30 },
};

function loadBaselines() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return { ...DEFAULT_BASELINES, ...saved };
  } catch {
    return { ...DEFAULT_BASELINES };
  }
}

function CircuitRow({ id, cfg, dirty, onChange }) {
  const color = CIRCUIT_COLORS[id] || "#94A3B8";
  const label = CIRCUIT_LABELS[id] || id;

  return (
    <div style={{
      display:"flex", alignItems:"center", gap:7, padding:"6px 8px",
      borderRadius:7, border:`1px solid ${dirty ? "rgba(251,191,36,0.35)" : "rgba(125,211,252,0.08)"}`,
      background:"rgba(15,23,42,0.75)", marginBottom:5,
      fontFamily:FONT,
    }}>
      <div style={{ width:6, height:6, borderRadius:"50%", background:color, flexShrink:0, boxShadow:`0 0 4px ${color}` }} />
      <div style={{ flex:1, minWidth:0, fontSize:10, color:"#CBD5E1", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
        {label}
      </div>

      {/* Baseline kW */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
        <span style={{ fontSize:7, color:"#475569", textTransform:"uppercase", letterSpacing:"0.04em" }}>Baseline kW</span>
        <input
          type="number" min="0" max="100" step="0.1"
          value={cfg.baselineKw}
          onChange={e => onChange(id, "baselineKw", parseFloat(e.target.value) || 0)}
          style={{
            width:52, padding:"3px 5px", borderRadius:5, textAlign:"right",
            border:`1px solid ${dirty ? "rgba(251,191,36,0.4)" : "rgba(125,211,252,0.18)"}`,
            background:"rgba(10,15,26,0.9)", color:"#E2F1FF", fontSize:10, fontFamily:FONT, outline:"none",
          }}
        />
      </div>

      {/* Tolerance % */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
        <span style={{ fontSize:7, color:"#475569", textTransform:"uppercase", letterSpacing:"0.04em" }}>Tolerance %</span>
        <input
          type="number" min="5" max="200" step="5"
          value={cfg.tolerancePct}
          onChange={e => onChange(id, "tolerancePct", parseInt(e.target.value) || 20)}
          style={{
            width:46, padding:"3px 5px", borderRadius:5, textAlign:"right",
            border:`1px solid ${dirty ? "rgba(251,191,36,0.4)" : "rgba(125,211,252,0.18)"}`,
            background:"rgba(10,15,26,0.9)", color:"#E2F1FF", fontSize:10, fontFamily:FONT, outline:"none",
          }}
        />
      </div>
    </div>
  );
}

export default function BaselineCalibration({ onBack }) {
  const [baselines, setBaselines]   = useState(loadBaselines);
  const [dirtyKeys, setDirtyKeys]   = useState(new Set());
  const [saved,     setSaved]       = useState(false);

  const handleChange = useCallback((id, field, value) => {
    setBaselines(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setDirtyKeys(prev => new Set(prev).add(id));
    setSaved(false);
  }, []);

  const saveAll = useCallback(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(baselines));
    setDirtyKeys(new Set());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [baselines]);

  const resetAll = useCallback(() => {
    setBaselines({ ...DEFAULT_BASELINES });
    setDirtyKeys(new Set(Object.keys(DEFAULT_BASELINES)));
    setSaved(false);
  }, []);

  const circuitIds = Object.keys(DEFAULT_BASELINES);

  return (
    <>
      {/* Nav header */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", color:"#64748B", fontSize:14, fontFamily:FONT, padding:"2px 4px" }}>←</button>
        <span style={{ fontSize:13, fontWeight:700, color:"#60A5FA", fontFamily:FONT, flex:1 }}>⚙ Circuit Baselines</span>
        {dirtyKeys.size > 0 && (
          <span style={{ fontSize:8, color:"#FBBF24", background:"rgba(251,191,36,0.12)", padding:"2px 6px", borderRadius:4 }}>
            {dirtyKeys.size} unsaved
          </span>
        )}
      </div>

      {/* Info card */}
      <div style={{ background:"rgba(37,99,235,0.08)", border:"1px solid rgba(96,165,250,0.2)", borderRadius:7, padding:"8px 10px", marginBottom:10, fontSize:9, color:"#93C5FD", fontFamily:FONT, lineHeight:1.5 }}>
        <strong>Baseline kW</strong> — expected average consumption for this circuit during working hours.<br/>
        <strong>Tolerance %</strong> — how far above baseline triggers an overconsumption fault. Lower = more sensitive.
      </div>

      {/* Column headers */}
      <div style={{ display:"flex", gap:7, paddingRight:2, marginBottom:4 }}>
        <div style={{ flex:1 }} />
        <div style={{ width:52, fontSize:7, color:"#475569", textAlign:"right", textTransform:"uppercase", letterSpacing:"0.04em" }}>Base kW</div>
        <div style={{ width:46, fontSize:7, color:"#475569", textAlign:"right", textTransform:"uppercase", letterSpacing:"0.04em" }}>Tol %</div>
      </div>

      {/* Circuit rows */}
      {circuitIds.map(id => (
        <CircuitRow
          key={id}
          id={id}
          cfg={baselines[id] || DEFAULT_BASELINES[id]}
          dirty={dirtyKeys.has(id)}
          onChange={handleChange}
        />
      ))}

      {/* Action bar */}
      <div style={{ display:"flex", gap:6, marginTop:10 }}>
        <button onClick={saveAll} style={{
          flex:1, padding:"8px 0", borderRadius:7, border:"none", cursor:"pointer",
          background: saved ? "rgba(74,222,128,0.25)" : "rgba(37,99,235,0.35)",
          color:      saved ? "#4ADE80"               : "#93C5FD",
          fontSize:11, fontWeight:700, fontFamily:FONT, transition:"all 0.2s",
        }}>
          {saved ? "✓ Saved" : "Save baselines"}
        </button>
        <button onClick={resetAll} style={{
          padding:"8px 12px", borderRadius:7, cursor:"pointer",
          border:"1px solid rgba(255,255,255,0.1)", background:"transparent",
          color:"#475569", fontSize:11, fontFamily:FONT,
        }}>
          Reset
        </button>
      </div>

      <div style={{ fontSize:8, color:"#334155", textAlign:"center", marginTop:6, fontFamily:FONT }}>
        Baselines persist across page reloads. The fault detection engine reads these thresholds.
      </div>
    </>
  );
}

export function getCircuitBaseline(circuitId) {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return saved[circuitId] ?? DEFAULT_BASELINES[circuitId] ?? { baselineKw: 1.0, tolerancePct: 45 };
  } catch {
    return DEFAULT_BASELINES[circuitId] ?? { baselineKw: 1.0, tolerancePct: 45 };
  }
}
