import { useState } from "react";
import { FONT, circuitStats, fmtW, dispatchCmd } from "./roleHelpers.js";
import { SL, Btn } from "./panelUI.jsx";

export default function EVView({ replayData }) {
  const [targetSoc, setTargetSoc] = useState(100);
  const [batteryKwh, setBatteryKwh] = useState(60);

  const ev1 = circuitStats(replayData, "vehiclecharging1");
  const ev2 = circuitStats(replayData, "vehiclecharging2");

  const isInUse = (watts) => watts > 500;
  const hours = Array.from({ length: 24 }, (_, h) => ({
    h,
    preferred: h >= 22 || h < 6,
  }));

  const chargeNeeded = Math.max(0, batteryKwh * ((targetSoc - 20) / 100));
  const chargeH = chargeNeeded / 7.2;

  return (
    <>
      <SL>Charger status</SL>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        {[{ label: "EV Charger 1", stats: ev1, id: "vehiclecharging1" }, { label: "EV Charger 2", stats: ev2, id: "vehiclecharging2" }].map(({ label, stats, id }) => {
          const inUse = isInUse(stats.current);
          return (
            <div
              key={id}
              onClick={() => dispatchCmd("zoom_to_circuit", { circuit_id: id })}
              style={{ background: "rgba(15,23,42,0.85)", border: `1px solid ${inUse ? "rgba(239,68,68,0.4)" : "rgba(74,222,128,0.4)"}`, borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}
            >
              <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 4 }}>{label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: inUse ? "#EF4444" : "#4ADE80", boxShadow: `0 0 5px ${inUse ? "#EF4444" : "#4ADE80"}` }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: inUse ? "#FCA5A5" : "#BBF7D0" }}>{inUse ? "In use" : "Available"}</span>
              </div>
              <div style={{ fontSize: 11, color: "#E2F1FF" }}>{fmtW(stats.current)}</div>
              <div style={{ fontSize: 9, color: "#9AB8D7" }}>
                {inUse ? "Charging session active" : "Ready for charging"}
              </div>
            </div>
          );
        })}
      </div>

      <SL>Charging window by hour (today)</SL>
      <svg width="100%" viewBox="0 0 264 60" style={{ display: "block", borderRadius: 4, background: "rgba(10,15,26,0.7)", border: "1px solid rgba(56,189,248,0.08)", marginBottom: 4 }}>
        {hours.map(({ h, preferred }, i) => {
          const barW = 264 / 24 - 1;
          const barH = preferred ? 50 : 24;
          const x = i * (264 / 24);
          return <rect key={h} x={x} y={60 - barH - 5} width={barW} height={barH} fill={preferred ? "#818CF8" : "#EF4444"} rx={1} opacity={0.8} />;
        })}
        <text x={0} y={10} fontSize={7} fill="#9AB8D7" fontFamily={FONT}>Preferred charging hours</text>
      </svg>
      <div style={{ display: "flex", gap: 10, fontSize: 9, color: "#9AB8D7", marginBottom: 8 }}>
        <span><span style={{ color: "#818CF8" }}>¦</span> Recommended</span>
        <span><span style={{ color: "#EF4444" }}>¦</span> Busy daytime</span>
      </div>
      <div style={{ fontSize: 11, color: "#E2F1FF", marginBottom: 4 }}>
        Best time today: <span style={{ color: "#818CF8", fontWeight: 700 }}>22:00 - 06:00</span>
      </div>

      <SL>Charging time estimator</SL>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 4 }}>Target state of charge: {targetSoc}%</div>
        <input
          type="range"
          min={30}
          max={100}
          step={5}
          value={targetSoc}
          onChange={(e) => setTargetSoc(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#38BDF8", cursor: "pointer" }}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 6 }}>Battery size</div>
        <div style={{ display: "flex", gap: 5 }}>
          {[40, 60, 80, 100].map((k) => (
            <Btn key={k} small active={batteryKwh === k} onClick={() => setBatteryKwh(k)}>{k} kWh</Btn>
          ))}
        </div>
      </div>
      <div style={{ background: "rgba(15,23,42,0.85)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 4 }}>Charging {batteryKwh} kWh battery to {targetSoc}%</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#38BDF8", marginBottom: 3 }}>
          Estimated energy needed: {chargeNeeded.toFixed(1)} kWh
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#818CF8" }}>
          Charging time: ~{chargeH.toFixed(1)} hours at 7.2 kW
        </div>
        <div style={{ fontSize: 10, color: "#4ADE80", marginTop: 4 }}>
          Starting after 22:00 is the preferred charging window.
        </div>
      </div>
    </>
  );
}
