import { useState, useEffect, useCallback } from "react";
import { FAULT_RULES, FAULT_CATEGORY } from "../faultEngine";
import { exportFaultsCSV, faultAckKey } from "../utils/exportUtils";

const UI_FONT = '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif';
const LS_KEY  = "dtwin_fault_acks";

function severityColor(s) {
  if (s === "critical") return "#EF4444";
  if (s === "alert")    return "#FBBF24";
  if (s === "warning")  return "#94A3B8";
  return "#475569";
}
function severityIcon(s) {
  if (s === "critical") return "🚨";
  if (s === "alert")    return "⚠️";
  if (s === "warning")  return "⚡";
  return "ℹ";
}

function FaultCard({ fault, ackEntry, onAck, onResolve, onReopen }) {
  const [expanded, setExpanded] = useState(false);
  const color   = severityColor(fault.severity);
  const status  = ackEntry?.status ?? "active";
  const isAcked = status === "ack";
  const dimmed  = isAcked ? 0.55 : 1;

  return (
    <div style={{
      marginBottom: 8,
      background: "rgba(15,23,42,0.6)",
      border: `1px solid ${color}33`,
      borderLeft: `3px solid ${isAcked ? "#475569" : color}`,
      borderRadius: 6,
      overflow: "hidden",
      fontFamily: UI_FONT,
      opacity: dimmed,
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width:"100%", background:"transparent", border:"none", cursor:"pointer", padding:"7px 10px", display:"flex", alignItems:"center", gap:7, textAlign:"left" }}
      >
        <span style={{ fontSize:13, flexShrink:0 }}>{severityIcon(fault.severity)}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#E2E8F0", lineHeight:1.3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {fault.label}
          </div>
          <div style={{ fontSize:9, color:"#475569", marginTop:1 }}>
            {fault.data?.circuit ?? fault.data?.room ?? fault.category}
            {fault.data?.deviationPct ? ` · +${fault.data.deviationPct}%` : ""}
            {fault.data?.co2          ? ` · ${Math.round(fault.data.co2)} ppm` : ""}
            {fault.data?.temp         ? ` · ${fault.data.temp.toFixed(1)}°C` : ""}
            {isAcked && <span style={{ marginLeft:6, color:"#22D3EE", fontSize:8, fontWeight:700 }}>ACKNOWLEDGED</span>}
          </div>
        </div>
        {fault.weeklyCost > 0 && (
          <div style={{ fontSize:9, color:"#FDE68A", flexShrink:0, textAlign:"right" }}>
            €{fault.weeklyCost.toFixed(1)}<br/><span style={{ color:"#475569" }}>/wk</span>
          </div>
        )}
        <span style={{ color:"#334155", fontSize:10, flexShrink:0 }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding:"0 10px 10px", borderTop:"1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize:10, color:"#94A3B8", margin:"8px 0 6px", lineHeight:1.5 }}>{fault.description}</p>

          <div style={{ fontSize:9, color:"#FBBF24", fontWeight:700, marginBottom:3, textTransform:"uppercase", letterSpacing:"0.06em" }}>Likely causes</div>
          <ul style={{ margin:"0 0 8px", paddingLeft:14 }}>
            {fault.causes.map((c, i) => <li key={i} style={{ fontSize:10, color:"#64748B", marginBottom:2 }}>{c}</li>)}
          </ul>

          <div style={{ fontSize:9, color:"#4ADE80", fontWeight:700, marginBottom:3, textTransform:"uppercase", letterSpacing:"0.06em" }}>Recommended actions</div>
          <ul style={{ margin:"0 0 10px", paddingLeft:14 }}>
            {fault.actions.map((a, i) => <li key={i} style={{ fontSize:10, color:"#86EFAC", marginBottom:2 }}>{a}</li>)}
          </ul>

          {/* Workflow buttons */}
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {status === "active" && (
              <>
                <button onClick={() => onAck(fault)}
                  style={{ fontSize:9, fontWeight:700, padding:"3px 8px", borderRadius:4, cursor:"pointer", border:"1px solid rgba(34,211,238,0.4)", background:"rgba(34,211,238,0.1)", color:"#22D3EE", fontFamily:UI_FONT }}>
                  ✓ Acknowledge
                </button>
                <button onClick={() => onResolve(fault)}
                  style={{ fontSize:9, fontWeight:700, padding:"3px 8px", borderRadius:4, cursor:"pointer", border:"1px solid rgba(74,222,128,0.4)", background:"rgba(74,222,128,0.1)", color:"#4ADE80", fontFamily:UI_FONT }}>
                  ✔ Resolve
                </button>
              </>
            )}
            {status === "ack" && (
              <>
                <button onClick={() => onResolve(fault)}
                  style={{ fontSize:9, fontWeight:700, padding:"3px 8px", borderRadius:4, cursor:"pointer", border:"1px solid rgba(74,222,128,0.4)", background:"rgba(74,222,128,0.1)", color:"#4ADE80", fontFamily:UI_FONT }}>
                  ✔ Mark Resolved
                </button>
                <button onClick={() => onReopen(fault)}
                  style={{ fontSize:9, fontWeight:700, padding:"3px 8px", borderRadius:4, cursor:"pointer", border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.04)", color:"#64748B", fontFamily:UI_FONT }}>
                  ↺ Re-open
                </button>
              </>
            )}
            {ackEntry?.ts && (
              <span style={{ fontSize:8, color:"#334155", alignSelf:"center", marginLeft:"auto" }}>
                {status === "ack" ? "Acked" : "Resolved"} {new Date(ackEntry.ts).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResolvedRow({ entry, onReopen }) {
  const f = entry.fault;
  const color = severityColor(f.severity);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:6, border:"1px solid rgba(74,222,128,0.12)", background:"rgba(74,222,128,0.04)", marginBottom:5, fontFamily:UI_FONT }}>
      <span style={{ color, fontSize:11, flexShrink:0 }}>{severityIcon(f.severity)}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:10, color:"#94A3B8", fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{f.label}</div>
        <div style={{ fontSize:8, color:"#334155" }}>
          {f.data?.circuit ?? f.data?.room ?? f.category} ·{" "}
          {new Date(entry.ts).toLocaleString()}
        </div>
      </div>
      <button onClick={() => onReopen(f)}
        style={{ fontSize:8, fontWeight:700, padding:"2px 6px", borderRadius:4, cursor:"pointer", border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.04)", color:"#64748B", fontFamily:UI_FONT, flexShrink:0 }}>
        ↺
      </button>
    </div>
  );
}

const PS = {
  background: "rgba(10,15,26,0.95)",
  border: "1px solid rgba(125,211,252,0.15)",
  borderRadius: 12,
  backdropFilter: "blur(14px)",
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  fontFamily: UI_FONT,
  color: "#D1E8FF",
  fontSize: 12,
};

export default function FaultPanel({ faults = [], summary = null, faultHistory = [], clearHistory, replayFrame = 0, onClose }) {
  const [view, setView] = useState("active");

  const [acks, setAcks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(acks));
  }, [acks]);

  const handleAck = useCallback((fault) => {
    const key = faultAckKey(fault);
    setAcks(prev => ({ ...prev, [key]: { status: "ack", ts: new Date().toISOString(), fault } }));
  }, []);

  const handleResolve = useCallback((fault) => {
    const key = faultAckKey(fault);
    setAcks(prev => ({ ...prev, [key]: { status: "resolved", ts: new Date().toISOString(), fault } }));
  }, []);

  const handleReopen = useCallback((fault) => {
    const key = faultAckKey(fault);
    setAcks(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Derived lists
  const activeFaults   = faults.filter(f => acks[faultAckKey(f)]?.status !== "resolved");
  const resolvedEntries = Object.values(acks).filter(a => a.status === "resolved");
  const resolvedCount  = resolvedEntries.length;

  return (
    <div style={{ ...PS, display:"flex", flexDirection:"column", maxHeight:"calc(100vh - 32px)" }}>

      {/* Header */}
      <div style={{ padding:"12px 14px 8px", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:"#F8FAFC" }}>🔍 Fault Detection</div>
          <div style={{ fontSize:9, color:"#475569" }}>Frame {replayFrame}/96 · updated every 15 min</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button
            onClick={() => exportFaultsCSV(faults, acks)}
            title="Export fault log as CSV"
            style={{ fontSize:9, padding:"3px 7px", borderRadius:5, border:"1px solid rgba(125,211,252,0.25)", background:"rgba(125,211,252,0.07)", color:"#7DD3FC", cursor:"pointer", fontFamily:UI_FONT, fontWeight:700 }}>
            ↓ CSV
          </button>
          {onClose && (
            <button onClick={onClose} style={{ background:"transparent", border:"none", color:"#475569", fontSize:16, cursor:"pointer", padding:4 }}>✕</button>
          )}
        </div>
      </div>

      {/* Severity summary bar */}
      <div style={{ display:"flex", gap:6, padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.04)", flexShrink:0 }}>
        {[
          { key:"critical", label:"Critical", color:"#EF4444" },
          { key:"alert",    label:"Alert",    color:"#FBBF24" },
          { key:"warning",  label:"Warning",  color:"#94A3B8" },
          { key:"info",     label:"Info",     color:"#475569" },
        ].map(({ key, label, color }) => {
          const count = summary?.[key] ?? 0;
          return (
            <div key={key} style={{ flex:1, textAlign:"center", background:count > 0 ? `${color}14` : "rgba(15,23,42,0.5)", borderRadius:6, padding:"4px 0", border:`1px solid ${count > 0 ? color+"44" : "rgba(255,255,255,0.04)"}` }}>
              <div style={{ fontSize:16, fontWeight:700, color:count > 0 ? color : "#334155" }}>{count}</div>
              <div style={{ fontSize:8, color:"#475569" }}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* Weekly cost banner */}
      {(summary?.totalWeeklyCost ?? 0) > 1 && (
        <div style={{ margin:"6px 12px 0", padding:"6px 10px", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:6, fontSize:10, color:"#FDE68A", flexShrink:0 }}>
          ⚡ Estimated waste: <strong>€{summary.totalWeeklyCost.toFixed(2)}/week</strong> if faults unresolved
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display:"flex", gap:2, padding:"8px 12px 0", flexShrink:0 }}>
        {[
          { key:"active",   label:"Active" },
          { key:"resolved", label:`Resolved${resolvedCount > 0 ? ` (${resolvedCount})` : ""}` },
          { key:"history",  label:"History" },
          { key:"rules",    label:"All Rules" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setView(key)} style={{
            flex:1, padding:"4px 0", fontSize:10, borderRadius:4,
            border:"1px solid rgba(125,211,252,0.15)",
            background: view === key ? "rgba(125,211,252,0.12)" : "transparent",
            color: view === key ? "#7DD3FC" : "#475569",
            cursor:"pointer", fontFamily:UI_FONT,
          }}>
            {label}
            {key === "active" && (activeFaults.length ?? 0) > 0 && (
              <span style={{ marginLeft:4, background:"#EF4444", color:"#fff", borderRadius:8, padding:"0 4px", fontSize:8 }}>
                {activeFaults.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex:1, overflowY:"auto", padding:"8px 12px 16px" }}>

        {view === "active" && (
          activeFaults.length === 0 ? (
            <div style={{ textAlign:"center", padding:"32px 0", color:"#4ADE80", fontSize:12 }}>
              <div style={{ fontSize:28 }}>✓</div>
              <div style={{ marginTop:8, fontWeight:600 }}>No active faults</div>
              <div style={{ fontSize:10, color:"#334155", marginTop:4 }}>
                {replayFrame < 3 ? "Load more replay data to enable detection" : "All systems operating normally"}
              </div>
            </div>
          ) : (
            activeFaults.map((fault, fi) => (
              <FaultCard
                key={fault.id + fi}
                fault={fault}
                ackEntry={acks[faultAckKey(fault)]}
                onAck={handleAck}
                onResolve={handleResolve}
                onReopen={handleReopen}
              />
            ))
          )
        )}

        {view === "resolved" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={{ fontSize:10, color:"#475569" }}>{resolvedCount} fault{resolvedCount !== 1 ? "s" : ""} resolved</span>
              {resolvedCount > 0 && (
                <button
                  onClick={() => setAcks(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach(k => { if (next[k].status === "resolved") delete next[k]; });
                    return next;
                  })}
                  style={{ fontSize:9, color:"#475569", background:"transparent", border:"1px solid rgba(255,255,255,0.08)", borderRadius:4, padding:"2px 6px", cursor:"pointer", fontFamily:UI_FONT }}>
                  Clear all
                </button>
              )}
            </div>
            {resolvedCount === 0 ? (
              <div style={{ textAlign:"center", padding:"24px 0", color:"#334155", fontSize:11 }}>
                No resolved faults yet.<br />Acknowledge and resolve active faults above.
              </div>
            ) : (
              [...resolvedEntries]
                .sort((a, b) => new Date(b.ts) - new Date(a.ts))
                .map((entry, i) => (
                  <ResolvedRow key={i} entry={entry} onReopen={handleReopen} />
                ))
            )}
          </>
        )}

        {view === "history" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={{ fontSize:10, color:"#475569" }}>{faultHistory.length} events recorded</span>
              <button onClick={clearHistory} style={{ fontSize:9, color:"#475569", background:"transparent", border:"1px solid rgba(255,255,255,0.08)", borderRadius:4, padding:"2px 6px", cursor:"pointer", fontFamily:UI_FONT }}>
                Clear
              </button>
            </div>
            {faultHistory.length === 0 ? (
              <div style={{ textAlign:"center", padding:"24px 0", color:"#334155", fontSize:11 }}>
                No fault history yet.<br />Play the replay to accumulate data.
              </div>
            ) : (
              [...faultHistory].reverse().map((f, i) => (
                <div key={i} style={{ display:"flex", gap:8, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.03)", fontSize:10 }}>
                  <span style={{ color:severityColor(f.severity), flexShrink:0, width:12 }}>{severityIcon(f.severity)}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#CBD5E1", fontWeight:500 }}>{f.label}</div>
                    <div style={{ color:"#475569" }}>Frame {f.frameIdx} · {f.data?.circuit ?? f.data?.room ?? ""}</div>
                  </div>
                  <div style={{ color:"#334155", fontSize:9, flexShrink:0 }}>{f.hour}:00</div>
                </div>
              ))
            )}
          </>
        )}

        {view === "rules" && (
          <>
            <div style={{ fontSize:9, color:"#334155", marginBottom:8 }}>
              {FAULT_RULES.length} rules active · monitoring all circuits
            </div>
            {Object.values(FAULT_CATEGORY).map(cat => (
              <div key={cat} style={{ marginBottom:10 }}>
                <div style={{ fontSize:9, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, marginBottom:4, borderBottom:"1px solid rgba(255,255,255,0.04)", paddingBottom:2 }}>
                  {cat}
                </div>
                {FAULT_RULES.filter(r => r.category === cat).map(r => {
                  const isActive = faults.some(f => f.id === r.id);
                  return (
                    <div key={r.id} style={{ display:"flex", alignItems:"center", gap:6, padding:"3px 0", borderBottom:"1px solid rgba(255,255,255,0.02)" }}>
                      <span style={{ fontSize:9, color:isActive ? severityColor(r.severity) : "#1E293B", flexShrink:0 }}>
                        {isActive ? severityIcon(r.severity) : "○"}
                      </span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:10, color:isActive ? "#E2E8F0" : "#334155", fontWeight:isActive ? 600 : 400 }}>{r.label}</div>
                      </div>
                      <span style={{ fontSize:8, color:isActive ? severityColor(r.severity) : "#1E293B", textTransform:"uppercase", letterSpacing:"0.05em" }}>
                        {isActive ? r.severity : "ok"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
