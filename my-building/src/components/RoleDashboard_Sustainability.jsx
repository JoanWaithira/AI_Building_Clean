import { useState } from "react";
import { CARBON_FACTOR, computeBaseline } from "./roleHelpers.js";
import { Btn, SL, Sparkline, EmptyState, RoleEcosystemCard } from "./panelUI.jsx";

export default function SustainabilityView({ replayData, pvData, tariffRate }) {
  const [reportText, setReportText] = useState(null);
  const baseline = computeBaseline(replayData, tariffRate);

  const mainFrames = replayData["main"] || [];
  const carbonFrames = mainFrames.map((f) => ({ ...f, carbon: (f.watts / 1000) * CARBON_FACTOR * 0.25 }));

  const criteria = baseline
    ? [
        { label: "EPC B or better", met: ["A+", "A", "B"].includes(baseline.epcRating), note: `Rating ${baseline.epcRating}` },
        { label: "EUI below 150 kWh/m²·yr", met: baseline.eui < 150, note: `${baseline.eui.toFixed(0)} kWh/m²·yr` },
        { label: "Metering & reporting", met: true, note: "Live circuits + exportable report" },
      ]
    : [];
  const metCount = criteria.filter((c) => c.met).length;
  const criteriaTotal = criteria.length;

  const genReport = () => {
    if (!baseline) return;
    const now = new Date().toLocaleDateString();
    const text = [
      `CARBON REPORT — Gate Building`,
      `Period: last 48h data as of ${now}`,
      ``,
      `Total consumption:  ${baseline.totalKwh.toFixed(1)} kWh`,
      `Carbon emitted:     ${(baseline.totalKwh * CARBON_FACTOR).toFixed(1)} kg CO₂`,
      `Solar offset:       0 kg CO₂ (no PV data)`,
      `Net carbon:         ${(baseline.totalKwh * CARBON_FACTOR).toFixed(1)} kg CO₂`,
      ``,
      `Annualised:         ${baseline.carbonTonYear.toFixed(2)} tonnes CO₂/year`,
      `EPC Rating:         ${baseline.epcRating}`,
      `Checklist:          ${metCount}/${criteriaTotal} items met`,
    ].join("\n");
    setReportText(text);
  };

  return (
    <>
      <RoleEcosystemCard
        titleColor="#6EE7B7"
        border="1px solid rgba(52,211,153,0.25)"
        background="rgba(16,185,129,0.08)"
        intro={(
          <p style={{ fontSize: 11, color: "#E2F1FF", lineHeight: 1.55, margin: "0 0 8px 0" }}>
            The sustainability officer connects <strong style={{ color: "#A7F3D0" }}>energy use</strong>,{" "}
            <strong style={{ color: "#A7F3D0" }}>indoor environmental quality</strong>, and{" "}
            <strong style={{ color: "#A7F3D0" }}>reporting</strong> so the estate stays efficient, healthy, and defensible to finance and regulators.
          </p>
        )}
        bullets={[
          "Translates meter and sensor data into carbon and performance narratives for leadership.",
          "Aligns operations with targets (e.g. EUI, EPC) and spots drift before it becomes waste.",
          "Bridges facilities, IT data feeds, and compliance — one coherent story from the live twin.",
        ]}
      />

      {!baseline && <EmptyState msg="Load energy data first (▶ Energy → Play)" />}

      {baseline && (
        <>
          <SL>Carbon intensity — 48 h</SL>
          <Sparkline frames={carbonFrames} valueKey="carbon" color="#4ADE80" h={48} />

          <SL>Performance checklist</SL>
          <div style={{ marginBottom: 10 }}>
            {criteria.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{c.met ? "✅" : "❌"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#E2F1FF" }}>{c.label}</div>
                  <div style={{ fontSize: 9, color: "#64748B" }}>{c.note}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 4 }}>{metCount} of {criteriaTotal} met</div>
              <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(metCount / criteriaTotal) * 100}%`, height: "100%", background: metCount >= criteriaTotal ? "#4ADE80" : metCount >= 2 ? "#FBBF24" : "#EF4444", borderRadius: 3 }} />
              </div>
            </div>
          </div>

          <Btn full accent onClick={genReport}>
            📄 Generate Carbon Report
          </Btn>
          {reportText && (
            <textarea
              readOnly
              value={reportText}
              style={{
                width: "100%",
                marginTop: 8,
                background: "rgba(10,15,26,0.9)",
                border: "1px solid rgba(125,211,252,0.2)",
                borderRadius: 6,
                color: "#CBD5E1",
                fontSize: 9,
                fontFamily: "'Courier New',monospace",
                padding: 8,
                resize: "vertical",
                minHeight: 160,
              }}
            />
          )}
        </>
      )}
    </>
  );
}
