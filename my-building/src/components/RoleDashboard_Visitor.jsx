import { useState, useEffect, useRef } from "react";
import { CARBON_FACTOR, FLOOR_AREA_M2, computeBaseline, fmtW, dispatchCmd } from "./roleHelpers.js";
import { Btn, SL, Pill, Hr } from "./panelUI.jsx";

const DID_YOU_KNOW = [
  { icon:"⚡", text:"This building has 17 individually monitored energy circuits, giving real-time visibility into every system." },
  { icon:"🌡", text:"Temperature, humidity and CO₂ are measured in every occupied room — keeping air quality comfortable." },
  { icon:"🚗", text:"Two EV charging stations are available for visitors and staff. Off-peak charging costs 30% less." },
  { icon:"🌿", text:"Smart metering and automated alerts help reduce after-hours energy waste by up to 25%." },
  { icon:"📡", text:"All sensor data is processed in a live digital twin — a 3D virtual copy of the building you're in right now." },
  { icon:"💡", text:"Switching to off-peak EV charging and LED lighting could save over €8,000 per year in this building." },
  { icon:"🔢", text:`This building covers ${FLOOR_AREA_M2.toLocaleString()} m² across multiple floors.` },
  { icon:"🏆", text:"Buildings with a digital twin typically achieve EPC B ratings, qualifying for EU green financing." },
];

// Full building tour — every floor + highlights
const TOUR_STEPS = [
  { label:"Building overview",  action:"reset_view" },
  { label:"Ground floor",       action:"zoom_to_floor", floor:"0" },
  { label:"1st floor",          action:"zoom_to_floor", floor:"1" },
  { label:"2nd floor",          action:"zoom_to_floor", floor:"2" },
  { label:"3rd floor",          action:"zoom_to_floor", floor:"3" },
  { label:"4th floor",          action:"zoom_to_floor", floor:"4" },
  { label:"Roof view",          action:"fly_to_camera_preset", preset:"roof" },
  { label:"Back to overview",   action:"reset_view" },
];

function AnimatedCounter({ target, suffix="" }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = target / 40;
    const id = setInterval(() => {
      start += step;
      if (start >= target) { setVal(target); clearInterval(id); }
      else setVal(Math.round(start));
    }, 30);
    return () => clearInterval(id);
  }, [target]);
  return <span>{val.toLocaleString()}{suffix}</span>;
}

export default function VisitorView({ replayData, tariffRate = 0.22 }) {
  const [cardIdx, setCardIdx]       = useState(0);
  const [tourStep, setTourStep]     = useState(-1);   // -1 = not started
  const [touring,  setTouring]      = useState(false);
  const timerRef = useRef(null);

  // Rotate "did you know" cards every 8 s
  useEffect(() => {
    const id = setInterval(() => setCardIdx(i => (i + 1) % DID_YOU_KNOW.length), 8000);
    return () => clearInterval(id);
  }, []);

  const baseline = computeBaseline(replayData, tariffRate);

  // Tour control
  const startTour = () => {
    setTouring(true);
    setTourStep(0);
    dispatchTourStep(0);
  };

  const dispatchTourStep = (idx) => {
    const step = TOUR_STEPS[idx];
    if (!step) return;
    const { label, action, ...extra } = step;
    dispatchCmd(action, extra);
  };

  useEffect(() => {
    if (!touring || tourStep < 0) return;
    if (tourStep >= TOUR_STEPS.length) { setTouring(false); setTourStep(-1); return; }
    timerRef.current = setTimeout(() => {
      const next = tourStep + 1;
      setTourStep(next);
      if (next < TOUR_STEPS.length) dispatchTourStep(next);
    }, 4500);
    return () => clearTimeout(timerRef.current);
  }, [touring, tourStep]);

  const stopTour = () => {
    clearTimeout(timerRef.current);
    setTouring(false);
    setTourStep(-1);
    dispatchCmd("reset_view");
  };

  const card = DID_YOU_KNOW[cardIdx];

  // Building health indicators
  const healthItems = [
    { label:"Energy systems",  ok: true,  emoji:"⚡" },
    { label:"Air quality",     ok: true,  emoji:"💨" },
    { label:"Thermal comfort", ok: true,  emoji:"🌡" },
    { label:"EV charging",     ok: true,  emoji:"🚗" },
  ];

  return (
    <>
      {/* Welcome banner */}
      <div style={{ background:"rgba(249,168,212,0.08)", border:"1px solid rgba(249,168,212,0.3)", borderRadius:10, padding:"12px 14px", marginBottom:10, textAlign:"center" }}>
        <div style={{ fontSize:22, marginBottom:4 }}>🏢</div>
        <div style={{ fontSize:13, fontWeight:700, color:"#FCE7F3" }}>Welcome to Gate Building</div>
        <div style={{ fontSize:10, color:"#9AB8D7", marginTop:4 }}>A live digital twin — every sensor, every circuit, in real time</div>
      </div>

      {/* Animated stats */}
      {baseline ? (
        <>
          <SL>Building at a glance</SL>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
            <Pill label="Floors monitored" value={<AnimatedCounter target={5}/>} color="#F9A8D4"/>
            <Pill label="Energy circuits" value={<AnimatedCounter target={17}/>} color="#A78BFA"/>
            <Pill label="Floor area" value={<AnimatedCounter target={FLOOR_AREA_M2} suffix=" m²"/>} color="#38BDF8"/>
            <Pill label="Live power now" value={fmtW(baseline.peakW)} color="#4ADE80"/>
          </div>
        </>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
          <Pill label="Floors monitored" value={<AnimatedCounter target={5}/>} color="#F9A8D4"/>
          <Pill label="Energy circuits" value={<AnimatedCounter target={17}/>} color="#A78BFA"/>
          <Pill label="Floor area" value={<AnimatedCounter target={FLOOR_AREA_M2} suffix=" m²"/>} color="#38BDF8"/>
          <Pill label="Sensor zones" value={<AnimatedCounter target={40}/>} color="#4ADE80"/>
        </div>
      )}

      {/* Building health */}
      <SL>Building health</SL>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:10 }}>
        {healthItems.map(item => (
          <div key={item.label} style={{ background:"rgba(15,23,42,0.85)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:8, padding:"7px 10px", display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:16 }}>{item.emoji}</span>
            <div>
              <div style={{ fontSize:9, color:"#9AB8D7" }}>{item.label}</div>
              <div style={{ fontSize:10, fontWeight:700, color:"#4ADE80" }}>✓ Normal</div>
            </div>
          </div>
        ))}
      </div>

      {/* Did you know card */}
      <SL>Did you know?</SL>
      <div style={{ background:"rgba(15,23,42,0.85)", border:"1px solid rgba(249,168,212,0.2)", borderRadius:10, padding:"12px 14px", marginBottom:10, minHeight:72 }}>
        <div style={{ fontSize:20, marginBottom:6 }}>{card.icon}</div>
        <div style={{ fontSize:11, color:"#E2F1FF", lineHeight:1.6 }}>{card.text}</div>
        <div style={{ display:"flex", gap:4, marginTop:8 }}>
          {DID_YOU_KNOW.map((_, i) => (
            <div key={i} onClick={() => setCardIdx(i)}
              style={{ width:i===cardIdx?14:5, height:5, borderRadius:3, background:i===cardIdx?"#F9A8D4":"rgba(255,255,255,0.15)", cursor:"pointer", transition:"width 0.3s" }}/>
          ))}
        </div>
      </div>

      {/* Explore shortcuts */}
      <SL>Explore the building</SL>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:10 }}>
        <Btn onClick={() => dispatchCmd("show_heatmap", { metric:"temperature" })}>🌡 Heat map</Btn>
        <Btn onClick={() => dispatchCmd("zoom_to_circuit", { circuit_id:"vehiclecharging1" })}>🚗 EV charging</Btn>
        <Btn onClick={() => dispatchCmd("reset_view")}>🏢 Overview</Btn>
      </div>

      <Hr/>

      {/* Building tour */}
      {!touring ? (
        <Btn full accent onClick={startTour}>🗺 Start building tour</Btn>
      ) : (
        <div style={{ background:"rgba(99,102,241,0.12)", border:"1px solid rgba(129,140,248,0.3)", borderRadius:8, padding:"10px 12px" }}>
          <div style={{ fontSize:11, color:"#C7D2FE", marginBottom:8, textAlign:"center" }}>
            🗺 Tour in progress — step {tourStep + 1} of {TOUR_STEPS.length}
          </div>
          <div style={{ display:"flex", gap:4, marginBottom:8 }}>
            {TOUR_STEPS.map((s, i) => (
              <div key={i} style={{ flex:1, height:3, borderRadius:2, background:i < tourStep ? "#818CF8" : i === tourStep ? "#A5B4FC" : "rgba(255,255,255,0.1)" }}/>
            ))}
          </div>
          <div style={{ fontSize:10, color:"#E0E7FF", textAlign:"center", marginBottom:8 }}>
            {tourStep < TOUR_STEPS.length ? TOUR_STEPS[tourStep]?.label : "Tour complete!"}
          </div>
          <Btn full danger small onClick={stopTour}>✕ Stop tour</Btn>
        </div>
      )}
    </>
  );
}
