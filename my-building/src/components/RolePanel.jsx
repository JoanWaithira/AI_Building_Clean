import { useState, useEffect, useCallback } from "react";
import { ROLES, ROLE_ENTRY_ACTIONS, ROLE_ENTRY_MESSAGE, dispatchCmd } from "./roleHelpers.js";
import { PS } from "./panelUI.jsx";
import { Btn } from "./panelUI.jsx";
import DirectorView      from "./RoleDashboard_Director.jsx";
import FacilitiesView    from "./RoleDashboard_Facilities.jsx";
import ITView            from "./RoleDashboard_IT.jsx";
import SustainabilityView from "./RoleDashboard_Sustainability.jsx";
import WorkerView        from "./RoleDashboard_Worker.jsx";
// import EVView            from "./RoleDashboard_EV.jsx";
import VisitorView       from "./RoleDashboard_Visitor.jsx";

const FONT = '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif';

function RoleCard({ role, onSelect, index }) {
  return (
    <div
      onClick={onSelect}
      onMouseEnter={e => {
        e.currentTarget.style.background    = role.accentBg;
        e.currentTarget.style.borderColor   = role.accentBorder;
        e.currentTarget.style.transform     = "translateY(-2px)";
        e.currentTarget.style.boxShadow     = "0 8px 24px rgba(0,0,0,0.4)";
        e.currentTarget.style.borderLeft    = `3px solid ${role.color}`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background    = "rgba(255,255,255,0.04)";
        e.currentTarget.style.borderColor   = "rgba(255,255,255,0.08)";
        e.currentTarget.style.transform     = "";
        e.currentTarget.style.boxShadow     = "";
        e.currentTarget.style.borderLeft    = "1px solid rgba(255,255,255,0.08)";
      }}
      style={{
        padding:"12px 14px", borderRadius:10,
        border:"1px solid rgba(255,255,255,0.08)",
        background:"rgba(255,255,255,0.04)",
        cursor:"pointer", transition:"all 0.18s ease",
        marginBottom:6,
        animation:"cardSlideIn 0.3s ease forwards",
        animationDelay:`${index * 40}ms`,
        opacity:0,
      }}
    >
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
        <span style={{ fontSize:20 }}>{role.emoji}</span>
        <span style={{ fontSize:13, fontWeight:700, color:"#E2E8F0" }}>{role.label}</span>
      </div>
      <div style={{ fontSize:10, color:"#64748B", marginBottom:6 }}>{role.tagline}</div>
      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
        <div style={{ width:5, height:5, borderRadius:"50%", background:role.color }}/>
        <span style={{ fontSize:10, color:role.color, fontWeight:600 }}>View dashboard →</span>
      </div>
    </div>
  );
}

export default function RolePanel({
  replayData = {},
  climateData = {},
  pvData = {},
  outsideTemp = [],
  availableRooms = [],
  availableFloors = [],
  onClose,
  tariffRate = 0.22,
  visible = true,
  onRoleChange,
  onExpertMode,
  initialRole = null,
  leftOffset = 272,
  activeHeatmap = null,
  onZoomToCircuit,
}) {
  const [selectedRole, setSelectedRole] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [entryMsg, setEntryMsg] = useState(null);
  const [remembered, setRemembered] = useState(false);

  // Restore persisted role on mount
  useEffect(() => {
    if (initialRole && ROLES[initialRole]) {
      setSelectedRole(initialRole);
      setRemembered(true);
    } else {
      const saved = localStorage.getItem("dtwin_role");
      if (saved && ROLES[saved]) { setSelectedRole(saved); setRemembered(true); }
    }
  }, [initialRole]);

  // Show picker modal when visible and no role selected (and not remembered)
  useEffect(() => {
    if (visible && !selectedRole) setShowPicker(true);
  }, [visible, selectedRole]);

  const selectRole = useCallback((roleId) => {
    setSelectedRole(roleId);
    setShowPicker(false);
    localStorage.setItem("dtwin_role", roleId);
    onRoleChange?.(roleId);
    const actions = ROLE_ENTRY_ACTIONS[roleId] || [];
    actions.forEach((a, i) => {
      const { action, ...extra } = a;
      setTimeout(() => dispatchCmd(action, extra), i * 200);
    });
    setEntryMsg(ROLE_ENTRY_MESSAGE[roleId] || "");
    setTimeout(() => setEntryMsg(null), 3000);
  }, [onRoleChange]);

  const switchRole = useCallback(() => {
    setSelectedRole(null);
    setRemembered(false);
    setShowPicker(true);
    localStorage.removeItem("dtwin_role");
    onRoleChange?.(null);
  }, [onRoleChange]);

  const skipRole = useCallback(() => {
    setSelectedRole(null);
    setShowPicker(false);
    onRoleChange?.(null);
    localStorage.setItem("dtwin_expert", "1");
    onExpertMode?.();
  }, [onRoleChange, onExpertMode]);

  const continueWithSavedRole = useCallback(() => {
    if (selectedRole) {
      setShowPicker(false);
      const actions = ROLE_ENTRY_ACTIONS[selectedRole] || [];
      actions.forEach((a, i) => {
        const { action, ...extra } = a;
        setTimeout(() => dispatchCmd(action, extra), i * 200);
      });
    }
  }, [selectedRole]);

  const activateExpert = useCallback(() => {
    localStorage.setItem("dtwin_expert", "1");
    setShowPicker(false);
    onExpertMode?.();
  }, [onExpertMode]);

  // Open picker externally
  const openPicker = useCallback(() => { setShowPicker(true); }, []);

  if (!visible) return null;

  const role = selectedRole ? ROLES[selectedRole] : null;
  const savedRoleId = localStorage.getItem("dtwin_role");
  const savedRole = savedRoleId && ROLES[savedRoleId] ? ROLES[savedRoleId] : null;
  const showWelcomeBack = showPicker && !selectedRole && remembered && savedRole;

  return (
    <>
      {showPicker && (
        <div
          onClick={() => { if (selectedRole || !showPicker) setShowPicker(false); }}
          style={{
            position:"fixed", top:0, left:0,
            width:"100vw", height:"100vh",
            background:"rgba(2,6,23,0.55)",
            backdropFilter:"blur(3px)",
            zIndex:24,
            animation:"backdropIn 0.3s ease forwards",
          }}
        />
      )}

      {showPicker && (
        <div style={{
          position:"fixed", top:"50%", left:"50%",
          transform:"translate(-50%, -50%)",
          zIndex:25,
          width:400, maxWidth:"calc(100vw - 32px)",
          maxHeight:"calc(100vh - 64px)", overflow:"auto",
          ...PS, padding:20,
          animation:"cardIn 0.25s ease forwards",
        }}>
          {/* Header */}
          <div style={{ textAlign:"center", marginBottom:16 }}>
            <div style={{
              display:"inline-block", borderRadius:"50%",
              width:40, height:40, lineHeight:"40px",
              fontSize:20, textAlign:"center",
              background:"rgba(125,211,252,0.1)",
              animation:"pulse 2s ease-in-out infinite",
              marginBottom:8,
            }}>⬡</div>
            <div style={{ fontSize:20, fontWeight:700, color:"#E2E8F0", fontFamily:FONT }}>
              Gate Digital Twin
            </div>
            <div style={{ fontSize:12, color:"#64748B", marginTop:4, fontFamily:FONT }}>
              Select your role to personalise your view
            </div>
          </div>

          {/* Welcome back banner */}
          {showWelcomeBack && savedRole && (
            <div style={{
              background:savedRole.accentBg, border:`1px solid ${savedRole.accentBorder}`,
              borderRadius:8, padding:"10px 14px", marginBottom:12, textAlign:"center",
            }}>
              <div style={{ fontSize:12, color:"#E2E8F0", fontFamily:FONT, marginBottom:6 }}>
                Welcome back, {savedRole.emoji} {savedRole.label}
              </div>
              <div style={{ display:"flex", justifyContent:"center", gap:8 }}>
                <button onClick={() => { setSelectedRole(savedRoleId); continueWithSavedRole(); selectRole(savedRoleId); }}
                  style={{
                    background:savedRole.accentBg, border:`1px solid ${savedRole.color}`,
                    borderRadius:6, padding:"4px 12px", cursor:"pointer",
                    color:savedRole.color, fontSize:11, fontWeight:600, fontFamily:FONT,
                  }}>Continue as this role</button>
                <button onClick={() => { setRemembered(false); setSelectedRole(null); }}
                  style={{
                    background:"none", border:"none", cursor:"pointer",
                    color:"#64748B", fontSize:11, fontFamily:FONT, textDecoration:"underline",
                  }}>Switch</button>
              </div>
            </div>
          )}

          {/* Role cards */}
          {Object.values(ROLES).map((r, i) => (
            <RoleCard key={r.id} role={r} index={i} onSelect={() => selectRole(r.id)}/>
          ))}

          {/* Expert mode */}
          <div style={{ marginTop:12, paddingTop:10, borderTop:"1px solid rgba(125,211,252,0.1)" }}>
            <button onClick={activateExpert} style={{
              width:"100%", padding:"8px 10px", borderRadius:8,
              background:"rgba(255,255,255,0.04)", border:"1px dashed rgba(125,211,252,0.2)",
              color:"#64748B", fontSize:10, fontFamily:FONT, cursor:"pointer",
              transition:"all 0.15s",
            }}
              onMouseEnter={e => { e.currentTarget.style.background="rgba(125,211,252,0.08)"; e.currentTarget.style.color="#A5C8EC"; }}
              onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.04)"; e.currentTarget.style.color="#64748B"; }}
            >
              🔬 Expert mode — full interface
            </button>
          </div>

          {/* Skip */}
          <div
            onClick={skipRole}
            onMouseEnter={e => { e.currentTarget.style.color="#64748B"; }}
            onMouseLeave={e => { e.currentTarget.style.color="#334155"; }}
            style={{ fontSize:10, color:"#334155", textAlign:"center", marginTop:12, cursor:"pointer", fontFamily:FONT }}>
            Skip — show me everything
          </div>
        </div>
      )}

      {selectedRole && role && !showPicker && (
        <div style={{
          ...PS, padding:14,
          position:"absolute", top:60, left:leftOffset,
          width: selectedRole === "facilities" ? 340 : 240,
          maxHeight:"calc(100% - 76px)",
          overflowY:"auto", zIndex:14,
          pointerEvents:"auto",
          scrollbarWidth:"thin",
          scrollbarColor:"rgba(125,211,252,0.2) transparent",
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <span style={{ fontSize:18 }}>{role.emoji}</span>
            <span style={{ fontWeight:700, fontSize:13, color:role.color, flex:1, fontFamily:FONT }}>{role.label}</span>
            {remembered && (
              <span style={{ fontSize:9, color:"#64748B", padding:"2px 5px", background:"rgba(255,255,255,0.04)", borderRadius:4, fontFamily:FONT }}>remembered</span>
            )}
            <button onClick={switchRole}
              style={{ background:"none", border:"none", cursor:"pointer", color:"#64748B", fontSize:10, fontFamily:FONT }}>
              Switch
            </button>
          </div>
          <div style={{ height:2, background:role.color, opacity:0.6, marginBottom:12, borderRadius:1 }}/>

          {entryMsg && (
            <div style={{
              background:"rgba(37,99,235,0.2)", border:"1px solid rgba(96,165,250,0.3)",
              borderRadius:8, padding:"8px 14px", fontSize:11, color:"#BFDBFE",
              marginBottom:10, textAlign:"center", fontFamily:FONT,
            }}>
              {entryMsg}
            </div>
          )}

          {selectedRole === "director"       && <DirectorView      replayData={replayData}  tariffRate={tariffRate} onZoomToCircuit={onZoomToCircuit}/>}
          {selectedRole === "facilities"     && <FacilitiesView    replayData={replayData}  availableRooms={availableRooms}/>}
          {selectedRole === "it"             && <ITView            replayData={replayData}/>}
          {selectedRole === "sustainability" && <SustainabilityView replayData={replayData} pvData={pvData} tariffRate={tariffRate}/>}
          {selectedRole === "worker"         && <WorkerView        climateData={climateData} availableRooms={availableRooms} availableFloors={availableFloors}/>}
          {/* {selectedRole === "ev"             && <EVView            replayData={replayData}  pvData={pvData} tariffRate={tariffRate}/>} */}
          {selectedRole === "visitor"        && <VisitorView       replayData={replayData}  tariffRate={tariffRate}/>}

          <div style={{ marginTop:14, paddingTop:10, borderTop:"1px solid rgba(125,211,252,0.1)" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#7DD3FC", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6, fontFamily:FONT }}>🗺 Heatmaps</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:6 }}>
              {[
                ["temperature", "🌡 Temp"],
                ["co2",         "💨 CO₂"],
                ["humidity",    "💧 Humid"],
              ].map(([m, label]) => (
                <button key={m}
                  onClick={() => dispatchCmd(activeHeatmap === m ? "clear_heatmap" : "show_heatmap", activeHeatmap === m ? {} : { metric: m })}
                  style={{
                    padding:"5px 0", borderRadius:6, cursor:"pointer",
                    fontSize:10, fontWeight:600, fontFamily:FONT,
                    border:`1px solid ${activeHeatmap === m ? "rgba(125,211,252,0.6)" : "rgba(125,211,252,0.15)"}`,
                    background: activeHeatmap === m ? "rgba(37,99,235,0.35)" : "rgba(255,255,255,0.05)",
                    color: activeHeatmap === m ? "#BAE6FD" : "#94A3B8",
                    transition: "all 0.15s",
                  }}>{label}</button>
              ))}
            </div>
            {activeHeatmap && (
              <button
                onClick={() => dispatchCmd("clear_heatmap")}
                style={{
                  width:"100%", padding:"4px 0", borderRadius:6, cursor:"pointer",
                  fontSize:10, fontWeight:600, fontFamily:FONT,
                  border:"1px solid rgba(248,113,113,0.3)",
                  background:"rgba(127,29,29,0.2)", color:"#FCA5A5",
                  transition:"all 0.15s",
                }}>✕ Clear Heatmap</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
