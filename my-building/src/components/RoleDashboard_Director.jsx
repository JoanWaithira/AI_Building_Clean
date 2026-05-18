import { useState, useCallback } from "react";
import { WORKING_DAYS_MONTH, computeBaseline } from "./roleHelpers.js";
import { Pill, SL, EmptyState, RoleEcosystemCard } from "./panelUI.jsx";
import { exportEnergyReportPDF } from "../utils/exportUtils.js";

const FONT = '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif';

const CIRCUIT_GUIDANCE = {
  main: { label:"Total building load", tier:"heavy" },
  ovk: { label:"Ventilation (OVK)", tier:"heavy" },
  airconditioner1: { label:"Air conditioning floors 1–2", tier:"heavy" },
  airconditioner2: { label:"Air conditioning floors 3–5", tier:"heavy" },
  circuit6boiler: { label:"Boiler / heating plant", tier:"heavy" },
  circuit8: { label:"Server room", tier:"heavy" },
  circuit7: { label:"Conference floor", tier:"mid" },
  circuit9: { label:"Office floor 1", tier:"mid" },
  circuit10: { label:"Electrical room / services", tier:"mid" },
  circuit11: { label:"Office floor 2", tier:"mid" },
  circuit12: { label:"Storage areas", tier:"mid" },
  vehiclecharging1: { label:"EV charger 1", tier:"mid" },
  vehiclecharging2: { label:"EV charger 2", tier:"mid" },
  elevator: { label:"Elevator", tier:"low" },
  outsidelighting1: { label:"Outside lights north", tier:"low" },
  outsidelighting2: { label:"Outside lights south", tier:"low" },
  "3DLED": { label:"LED signage / display", tier:"low" },
};

const TIER_META = {
  heavy: { label:"Heavy consumer", color:"#FB923C" },
  mid: { label:"Mid-range", color:"#FBBF24" },
  low: { label:"Low-draw", color:"#60A5FA" },
};

function estimateObservedDays(frames) {
  return Math.max(1, (Array.isArray(frames) ? frames.length : 0) / 96);
}

function CircuitRow({ item, rank, onZoomToCircuit }) {
  const tier = TIER_META[item.tier] || TIER_META.mid;
  return (
    <button type="button" onClick={() => onZoomToCircuit?.(item.id)} title={`Zoom to ${item.label}`}
      style={{ width:"100%", textAlign:"left", background:"rgba(15,23,42,0.82)", border:"1px solid rgba(125,211,252,0.15)", borderRadius:8, padding:"8px 9px", marginBottom:6, cursor:onZoomToCircuit ? "pointer" : "default" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
        <div style={{ minWidth:18, fontSize:10, fontWeight:700, color:"#7DD3FC", paddingTop:2 }}>{String(rank).padStart(2,"0")}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#E2F1FF" }}>{item.label}</span>
            <span style={{ fontSize:11, fontWeight:700, color:tier.color }}>{item.dailyKwh.toFixed(1)} kWh</span>
          </div>
          <div style={{ fontSize:9, color:tier.color, marginTop:2, textTransform:"uppercase", letterSpacing:"0.05em" }}>{tier.label}</div>
        </div>
      </div>
    </button>
  );
}

function BudgetTab({ monthlyCost }) {
  const [budget, setBudget] = useState(() => {
    const v = parseFloat(localStorage.getItem("dtwin_budget") || "0");
    return v > 0 ? v : "";
  });
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState("");

  const save = useCallback(() => {
    const v = parseFloat(draft);
    if (v > 0) { setBudget(v); localStorage.setItem("dtwin_budget", String(v)); }
    setEditing(false);
  }, [draft]);

  const usedPct   = budget > 0 ? Math.min(100, (monthlyCost / budget) * 100) : 0;
  const overBudget = budget > 0 && monthlyCost > budget;
  const barColor  = overBudget ? "#EF4444" : usedPct > 80 ? "#FBBF24" : "#4ADE80";

  return (
    <>
      <SL>Monthly Budget Target</SL>

      {/* Budget input */}
      {editing ? (
        <div style={{ display:"flex", gap:5, marginBottom:8 }}>
          <input
            type="number" autoFocus
            value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            placeholder="e.g. 1200"
            style={{ flex:1, padding:"6px 8px", borderRadius:6, border:"1px solid rgba(125,211,252,0.3)", background:"rgba(15,23,42,0.9)", color:"#E2F1FF", fontSize:11, fontFamily:FONT, outline:"none" }}
          />
          <button onClick={save} style={{ padding:"6px 10px", borderRadius:6, border:"none", background:"#2563EB", color:"#fff", cursor:"pointer", fontSize:11, fontFamily:FONT }}>Save</button>
          <button onClick={() => setEditing(false)} style={{ padding:"6px 8px", borderRadius:6, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:11, fontFamily:FONT }}>✕</button>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <div style={{ flex:1, background:"rgba(15,23,42,0.85)", border:"1px solid rgba(125,211,252,0.15)", borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:9, color:"#9AB8D7", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:2 }}>Target</div>
            <div style={{ fontSize:14, fontWeight:700, color:"#818CF8" }}>{budget ? `€${Number(budget).toFixed(0)}` : "Not set"}</div>
          </div>
          <button onClick={() => { setDraft(budget ? String(budget) : ""); setEditing(true); }}
            style={{ padding:"6px 10px", borderRadius:6, border:"1px solid rgba(125,211,252,0.25)", background:"rgba(37,99,235,0.18)", color:"#7DD3FC", cursor:"pointer", fontSize:10, fontFamily:FONT }}>
            {budget ? "Edit" : "Set budget"}
          </button>
        </div>
      )}

      {/* Progress */}
      {budget > 0 && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:10 }}>
            <Pill label="Budget"      value={`€${Number(budget).toFixed(0)}`}         color="#818CF8" />
            <Pill label="Projected"   value={`€${monthlyCost.toFixed(0)}`}             color={barColor} />
            <Pill label="Remaining"   value={overBudget ? `-€${(monthlyCost - budget).toFixed(0)}` : `€${(budget - monthlyCost).toFixed(0)}`} color={barColor} />
          </div>

          <div style={{ marginBottom:6 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#64748B", marginBottom:3 }}>
              <span>Budget used</span>
              <span style={{ color:barColor, fontWeight:700 }}>{usedPct.toFixed(0)}%</span>
            </div>
            <div style={{ height:8, borderRadius:4, background:"rgba(255,255,255,0.06)", overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${usedPct}%`, background:barColor, borderRadius:4, transition:"width 0.4s ease" }} />
            </div>
          </div>

          {overBudget && (
            <div style={{ padding:"7px 10px", borderRadius:7, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", fontSize:10, color:"#FCA5A5", marginBottom:6 }}>
              ⚠️ Projected spend exceeds budget by <strong>€{(monthlyCost - budget).toFixed(0)}</strong>. Review after-hours waste to close the gap.
            </div>
          )}
          {!overBudget && usedPct > 80 && (
            <div style={{ padding:"7px 10px", borderRadius:7, background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.25)", fontSize:10, color:"#FDE68A", marginBottom:6 }}>
              ⚡ Approaching budget — {(100 - usedPct).toFixed(0)}% headroom remaining.
            </div>
          )}
          {!overBudget && usedPct <= 80 && (
            <div style={{ padding:"7px 10px", borderRadius:7, background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.2)", fontSize:10, color:"#86EFAC", marginBottom:6 }}>
              ✓ On track — well within monthly budget.
            </div>
          )}
        </>
      )}
      {!budget && (
        <div style={{ padding:"14px 10px", textAlign:"center", fontSize:10, color:"#334155", border:"1px dashed rgba(125,211,252,0.1)", borderRadius:8 }}>
          Set a monthly budget target to track spend and get alerts when approaching the limit.
        </div>
      )}
    </>
  );
}

function TariffTab({ localTariff, setLocalTariff }) {
  const [cfg, setCfg] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dtwin_tariff") || "{}");
      return {
        peakRate: saved.peakRate ?? localTariff,
        offPeakRate: saved.offPeakRate ?? Math.max(0.05, localTariff * 0.6),
        peakStart: saved.peakStart ?? 7,
        peakEnd: saved.peakEnd ?? 22,
      };
    } catch {
      return { peakRate: localTariff, offPeakRate: Math.max(0.05, localTariff * 0.6), peakStart: 7, peakEnd: 22 };
    }
  });

  const saveCfg = useCallback((next) => {
    setCfg(next);
    localStorage.setItem("dtwin_tariff", JSON.stringify(next));
    setLocalTariff(next.peakRate);
  }, [setLocalTariff]);

  const field = (label, key, min, max, step, unit) => (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontSize:9, color:"#9AB8D7", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>{label}</div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <input type="number" value={cfg[key]} min={min} max={max} step={step}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) saveCfg({ ...cfg, [key]: v });
          }}
          style={{ width:72, padding:"5px 7px", borderRadius:6, border:"1px solid rgba(125,211,252,0.25)", background:"rgba(15,23,42,0.9)", color:"#E2F1FF", fontSize:12, fontFamily:FONT, outline:"none" }}
        />
        <span style={{ fontSize:10, color:"#64748B" }}>{unit}</span>
      </div>
    </div>
  );

  return (
    <>
      <SL>Rate Schedule</SL>
      <div style={{ background:"rgba(15,23,42,0.72)", border:"1px solid rgba(125,211,252,0.1)", borderRadius:8, padding:"10px 12px", marginBottom:10 }}>
        {field("Peak rate",      "peakRate",    0.01, 2,    0.01, "€/kWh")}
        {field("Off-peak rate",  "offPeakRate", 0.01, 2,    0.01, "€/kWh")}
        {field("Peak hours from","peakStart",   0,    23,   1,    "h (0–23)")}
        {field("Peak hours to",  "peakEnd",     1,    24,   1,    "h (1–24)")}
      </div>
      <div style={{ padding:"7px 10px", borderRadius:7, background:"rgba(125,211,252,0.06)", border:"1px solid rgba(125,211,252,0.12)", fontSize:10, color:"#7DD3FC", marginBottom:6 }}>
        Peak hours: <strong>{cfg.peakStart}:00 – {cfg.peakEnd}:00</strong><br/>
        Peak: <strong>€{cfg.peakRate.toFixed(3)}/kWh</strong> · Off-peak: <strong>€{cfg.offPeakRate.toFixed(3)}/kWh</strong>
      </div>
      <div style={{ fontSize:9, color:"#334155" }}>
        Changes apply to all cost calculations in this session and persist across page reloads.
      </div>
    </>
  );
}

function ReportTab({ baseline, circuitRows, localTariff }) {
  const [generating, setGenerating] = useState(false);
  const [done,       setDone]       = useState(false);
  const budget = parseFloat(localStorage.getItem("dtwin_budget") || "0") || undefined;

  const generate = useCallback(async () => {
    setGenerating(true); setDone(false);
    try {
      exportEnergyReportPDF({ baseline, circuitRows, tariffRate: localTariff, budgetMonthly: budget });
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } finally {
      setGenerating(false);
    }
  }, [baseline, circuitRows, localTariff, budget]);

  return (
    <>
      <SL>Monthly Energy Report</SL>
      <div style={{ background:"rgba(15,23,42,0.72)", border:"1px solid rgba(125,211,252,0.1)", borderRadius:8, padding:"10px 12px", marginBottom:10 }}>
        <div style={{ fontSize:10, color:"#9AB8D7", marginBottom:8, lineHeight:1.5 }}>
          Generates a branded PDF containing:
        </div>
        {["Key performance indicators (EUI, EPC, carbon, cost)", "Budget vs. actual (if budget is set)", "All 17 circuit energy breakdown with monthly cost", "Applied tariff rate"].map((t, i) => (
          <div key={i} style={{ display:"flex", gap:6, marginBottom:4 }}>
            <span style={{ color:"#4ADE80", flexShrink:0 }}>✓</span>
            <span style={{ fontSize:10, color:"#7DD3FC" }}>{t}</span>
          </div>
        ))}
      </div>

      <button
        onClick={generate}
        disabled={generating}
        style={{
          width:"100%", padding:"9px 0", borderRadius:8, border:"1px solid rgba(37,99,235,0.5)",
          background: done ? "rgba(74,222,128,0.2)" : "rgba(37,99,235,0.3)",
          color: done ? "#4ADE80" : "#93C5FD",
          cursor: generating ? "wait" : "pointer",
          fontSize:12, fontWeight:700, fontFamily:FONT, marginBottom:8,
          transition:"all 0.2s",
        }}>
        {generating ? "Generating…" : done ? "✓ PDF downloaded!" : "⬇ Download Energy Report PDF"}
      </button>

      <div style={{ fontSize:9, color:"#334155", textAlign:"center" }}>
        Uses data currently loaded in the viewer.<br/>
        Tariff: €{localTariff.toFixed(3)}/kWh · {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
      </div>
    </>
  );
}

export default function DirectorView({ replayData, tariffRate, onZoomToCircuit }) {
  const [dirTab, setDirTab] = useState("circuits");

  // Local tariff state — reads from localStorage, falls back to prop
  const [localTariff, setLocalTariff] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dtwin_tariff") || "{}");
      return saved.peakRate ?? tariffRate;
    } catch { return tariffRate; }
  });

  const baseline = computeBaseline(replayData, localTariff);

  const mainFrames = replayData["main"] || [];
  const observedDays = baseline ? estimateObservedDays(mainFrames) : 0;
  const observedKwh = baseline
    ? mainFrames.reduce((s, f) => s + (Number(f?.watts || 0) / 1000) * 0.25, 0)
    : 0;
  const dailyKwh = baseline && observedDays > 0 ? observedKwh / observedDays : 0;
  const monthlyCost = baseline ? dailyKwh * WORKING_DAYS_MONTH * localTariff : 0;

  const circuitRows = baseline
    ? Object.entries(replayData)
        .map(([id, frames]) => {
          const totalKwh = (frames || []).reduce((s, f) => s + (Number(f?.watts || 0) / 1000) * 0.25, 0);
          const dailyEquiv = totalKwh / estimateObservedDays(frames);
          const guidance = CIRCUIT_GUIDANCE[id] || {
            label: String(id),
            tier: dailyEquiv >= 120 ? "heavy" : dailyEquiv >= 30 ? "mid" : "low",
          };
          return { id, label: guidance.label, tier: guidance.tier, dailyKwh: dailyEquiv };
        })
        .sort((a, b) => b.dailyKwh - a.dailyKwh)
    : [];

  const TABS = [
    { key:"circuits", label:"Circuits" },
    { key:"budget",   label:"Budget"   },
    { key:"tariff",   label:"Tariff"   },
    { key:"report",   label:"Report"   },
  ];

  return (
    <>
      <RoleEcosystemCard
        titleColor="#A5B4FC"
        border="1px solid rgba(129,140,248,0.35)"
        background="rgba(99,102,241,0.1)"
        intro={(
          <p style={{ fontSize: 11, color: "#E2F1FF", lineHeight: 1.55, margin: "0 0 8px 0" }}>
            The building director holds the <strong style={{ color: "#C7D2FE" }}>overall performance story</strong>: cost, risk, and outcomes across departments. The twin is the single place to see whether energy, operations, and tenant experience line up with strategy.
          </p>
        )}
        bullets={[
          "Sets direction from consolidated load, spend, and carbon — not from isolated spreadsheets.",
          "Prioritises capital and attention using circuit-level evidence and budget guardrails.",
          "Connects facilities, sustainability, and IT narratives so decisions are aligned and audit-ready.",
        ]}
      />

      {!baseline && <EmptyState msg="Load energy data first (▶ Energy → Play)" />}

      {baseline && (
        <>
          <div style={{ display: "flex", gap: 3, marginBottom: 10, background: "rgba(15,23,42,0.6)", borderRadius: 8, padding: 3 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setDirTab(t.key)}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: FONT,
                  background: dirTab === t.key ? "rgba(37,99,235,0.4)" : "transparent",
                  color: dirTab === t.key ? "#DBEAFE" : "#475569",
                  transition: "all 0.15s",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {dirTab === "circuits" && (
            <>
              <SL>17 Circuit Priorities</SL>
              <div style={{ background: "rgba(15,23,42,0.72)", border: "1px solid rgba(125,211,252,0.08)", borderRadius: 8, padding: "6px 9px", marginBottom: 8, fontSize: 10, color: "#64748B" }}>
                Heavy first, then mid, then low-draw. Click a row to zoom.
              </div>
              {circuitRows.map((item, index) => (
                <CircuitRow key={item.id} item={item} rank={index + 1} onZoomToCircuit={onZoomToCircuit} />
              ))}
            </>
          )}

          {dirTab === "budget" && <BudgetTab monthlyCost={monthlyCost} />}

          {dirTab === "tariff" && <TariffTab localTariff={localTariff} setLocalTariff={setLocalTariff} />}

          {dirTab === "report" && <ReportTab baseline={baseline} circuitRows={circuitRows} localTariff={localTariff} />}
        </>
      )}
    </>
  );
}
