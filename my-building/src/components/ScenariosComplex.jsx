import { epcFromEui } from '../scenarios/roleScenarios';
import { CARBON_FACTOR, WORKING_DAYS_MONTH, epcColor, computeBaseline } from './roleHelpers';

const DEMAND_CHARGE = 8.50;
const UI_FONT = '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif';

/** One scenario id per building-director goal (same for every role). */
const GOAL_TO_SCENARIO = {
  bill:    "after_hours_off",
  comfort: "precool_30min",
  carbon:  "boiler_setpoint",
  ev:      "ev_night_shift",
  waste:   "weekend_skeleton",
};

const GOAL_LABELS = {
  bill:    { emoji: "💰", label: "Reduce our energy bill" },
  comfort: { emoji: "🌡", label: "Improve comfort for staff" },
  carbon:  { emoji: "🌍", label: "Lower our carbon footprint" },
  ev:      { emoji: "🚗", label: "Manage EV charging better" },
  waste:   { emoji: "🔍", label: "Find energy waste" },
};

const GOAL_ORDER = ["bill", "comfort", "carbon", "ev", "waste"];

// ─── Module-scope style constants ─────────────────────────────────────────────

const SEVERITY_STYLES = {
  HIGH: { background: "rgba(220,38,38,0.2)",  color: "#FCA5A5" },
  MED:  { background: "rgba(251,191,36,0.2)", color: "#FDE68A" },
  LOW:  { background: "rgba(74,222,128,0.2)", color: "#BBF7D0" },
};

const pillStyle = { background: "rgba(15,23,42,0.85)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: 8, padding: 8 };
const pillLabel = { fontSize: 10, color: "#9AB8D7", marginBottom: 3 };
const pillValue = { fontSize: 14, fontWeight: 700, color: "#E2F1FF" };

// ─── Scenario logic ───────────────────────────────────────────────────────────

function getSeverity(monthlySaving, baselineMonthlyCost) {
  if (!baselineMonthlyCost) return "LOW";
  const pct = (monthlySaving / baselineMonthlyCost) * 100;
  if (pct >= 10) return "HIGH";
  if (pct >= 4)  return "MED";
  return "LOW";
}

function fmtEur(v) {
  return isNaN(v) ? "—" : `€${Math.abs(v).toFixed(0)}`;
}

function applyScenario(scenarioId, replayData, tariff, _occupancyPct, carbonPriceTonne, baseline) {
  if (!baseline) return null;

  const cp = carbonPriceTonne / 1000;

  const scenarios = {
    after_hours_off: {
      label: "After-hours Auto-off", emoji: "🌙",
      description: "Circuits 9 and 11 switch off automatically after 20:00. Staff who stay late can override manually.",
      hardware: null,
      compute: () => {
        const savedKwh = ["circuit9","circuit11"].reduce((sum, id) => {
          const s = replayData[id] || [];
          return sum + s.filter(f => f.hour >= 20 || f.hour < 7)
                        .reduce((a, f) => a + (f.watts / 1000) * 0.25, 0);
        }, 0);
        const dailySaving   = savedKwh / 2;
        const monthlySaving = dailySaving * WORKING_DAYS_MONTH;
        return { dailySaving, monthlySaving, demandSaving: 0,
                 carbonSaving: monthlySaving * CARBON_FACTOR,
                 comfortImpact: "No change expected", peakReduction: 0 };
      },
    },

    ev_night_shift: {
      label: "EV Night Shift", emoji: "🚗",
      description: "Move EV charging from daytime to after 22:00 when tariffs are lower and grid is greener.",
      hardware: "EV smart charging controller", hardwareCost: 650,
      compute: () => {
        const evIds = ["vehiclecharging1","vehiclecharging2"];
        const daytimeKwh = evIds.reduce((sum, id) => {
          const s = replayData[id] || [];
          return sum + s.filter(f => f.hour >= 7 && f.hour < 22)
                        .reduce((a, f) => a + (f.watts / 1000) * 0.25, 0);
        }, 0);
        const peakEvW = evIds.reduce((max, id) => {
          const s = replayData[id] || [];
          return max + Math.max(...s.map(f => f.watts), 0);
        }, 0);
        const dailySaving   = (daytimeKwh / 2) * 0.08;
        const demandSaving  = (peakEvW / 1000) * DEMAND_CHARGE;
        const monthlySaving = dailySaving * WORKING_DAYS_MONTH + demandSaving;
        return { dailySaving, monthlySaving, demandSaving,
                 carbonSaving: (daytimeKwh / 2) * WORKING_DAYS_MONTH * CARBON_FACTOR * 0.15,
                 comfortImpact: "No change expected", peakReduction: 18 };
      },
    },

    friday_shutdown: {
      label: "Friday Afternoon Shutdown", emoji: "🏖",
      description: "Non-essential circuits off from 13:00 on Fridays. Saves roughly half a working day per week.",
      hardware: null,
      compute: () => {
        const nonEssential = ["circuit9","circuit11","circuit7","outsidelighting1","outsidelighting2","3DLED"];
        const afternoonKwh = nonEssential.reduce((sum, id) => {
          const s = replayData[id] || [];
          return sum + s.filter(f => f.hour >= 13 && f.hour < 20)
                        .reduce((a, f) => a + (f.watts / 1000) * 0.25, 0);
        }, 0);
        const dailySaving   = afternoonKwh / 2;
        const monthlySaving = dailySaving * 4;
        return { dailySaving, monthlySaving, demandSaving: 0,
                 carbonSaving: monthlySaving * CARBON_FACTOR,
                 comfortImpact: "No change on Mon–Thu", peakReduction: 5 };
      },
    },

    weekend_skeleton: {
      label: "Weekend Skeleton Mode", emoji: "🏢",
      description: "Keep only essential services running on weekends. Everything else powers down automatically.",
      hardware: "BMS scheduling integration", hardwareCost: 1200,
      compute: () => {
        const nonEssential = ["circuit7","circuit8","circuit9","circuit10",
          "circuit11","circuit12","airconditioner1","airconditioner2",
          "outsidelighting1","outsidelighting2","3DLED","elevator"];
        const weekendKwh = nonEssential.reduce((sum, id) => {
          const s = replayData[id] || [];
          return sum + s.reduce((a, f) => a + (f.watts / 1000) * 0.25, 0);
        }, 0) * 0.85;
        const dailySaving   = weekendKwh / 2;
        const monthlySaving = dailySaving * 8;
        return { dailySaving, monthlySaving, demandSaving: 0,
                 carbonSaving: monthlySaving * CARBON_FACTOR,
                 comfortImpact: "Weekdays unaffected", peakReduction: 30 };
      },
    },

    precool_30min: {
      label: "Pre-cool Before Arrival", emoji: "❄️",
      description: "Start AC 30 minutes before staff arrive so the building is already comfortable at 08:00.",
      hardware: null,
      compute: () => {
        const acAvgW = ["airconditioner1","airconditioner2"].reduce((sum, id) => {
          const s = replayData[id] || [];
          const morning = s.filter(f => f.hour >= 7 && f.hour < 9);
          return sum + (morning.length ? morning.reduce((a, f) => a + f.watts, 0) / morning.length : 0);
        }, 0);
        const addedKwh      = (acAvgW / 1000) * 0.5;
        const savedKwh      = addedKwh * 0.3;
        const dailySaving   = Math.max(0, savedKwh - addedKwh) * tariff;
        const monthlySaving = dailySaving * WORKING_DAYS_MONTH;
        return { dailySaving, monthlySaving, demandSaving: 0,
                 carbonSaving: monthlySaving * CARBON_FACTOR,
                 comfortImpact: "Noticeable improvement", peakReduction: 8 };
      },
    },

    boiler_setpoint: {
      label: "Boiler Setpoint −2°C", emoji: "🔥",
      description: "Reduce heating setpoint by 2°C. Barely noticeable to occupants, meaningful energy saving.",
      hardware: null,
      compute: () => {
        const s = replayData["circuit6boiler"] || [];
        const boilerKwh     = s.reduce((a, f) => a + (f.watts / 1000) * 0.25, 0);
        const savedKwh      = (boilerKwh / 2) * 0.12;
        const monthlySaving = savedKwh * WORKING_DAYS_MONTH * tariff;
        return { dailySaving: savedKwh * tariff, monthlySaving, demandSaving: 0,
                 carbonSaving: savedKwh * WORKING_DAYS_MONTH * CARBON_FACTOR,
                 comfortImpact: "Slight reduction — within comfort range", peakReduction: 3 };
      },
    },

    monday_ventilation: {
      label: "Monday Morning Ventilation", emoji: "💨",
      description: "Run ventilation 1 hour before staff arrive on Mondays to flush weekend air buildup.",
      hardware: null,
      compute: () => {
        const s = replayData["ovk"] || [];
        const ovkAvgW       = s.length ? s.reduce((a, f) => a + f.watts, 0) / s.length : 3000;
        const addedKwh      = (ovkAvgW / 1000) * 1;
        const monthlySaving = addedKwh * 4 * tariff * -1;
        return { dailySaving: 0, monthlySaving, demandSaving: 0, carbonSaving: 0,
                 comfortImpact: "Noticeable improvement on Mondays", peakReduction: 0,
                 note: "Small cost — big comfort win on Monday mornings" };
      },
    },

    ev_stagger: {
      label: "Stagger EV Chargers", emoji: "⚡",
      description: "Start the two EV chargers 30 minutes apart instead of simultaneously. Cuts peak demand spike.",
      hardware: null,
      compute: () => {
        const peakEvW = ["vehiclecharging1","vehiclecharging2"].reduce((max, id) => {
          const s = replayData[id] || [];
          return max + Math.max(...s.map(f => f.watts), 0);
        }, 0);
        const demandSaving = (peakEvW * 0.4 / 1000) * DEMAND_CHARGE;
        return { dailySaving: 0, monthlySaving: demandSaving, demandSaving,
                 carbonSaving: 0, comfortImpact: "No change expected", peakReduction: 40,
                 note: "No energy saving — but reduces peak demand charge" };
      },
    },
  };

  const s = scenarios[scenarioId];
  if (!s) return null;
  const result = s.compute();

  const carbonValueSaving  = result.carbonSaving * cp * 1000;
  const totalMonthlySaving = result.monthlySaving + carbonValueSaving;
  const paybackMonths      = s.hardwareCost
    ? Math.ceil(s.hardwareCost / Math.max(0.01, totalMonthlySaving)) : 0;

  const savingFraction = baseline.monthlyCost > 0
    ? result.monthlySaving / baseline.monthlyCost : 0;
  const newEui = baseline.eui * (1 - savingFraction);

  return {
    ...s, scenarioId, ...result,
    carbonValueSaving, totalMonthlySaving, paybackMonths,
    hardwareCost:     s.hardwareCost || 0,
    newEpcRating:     epcFromEui(newEui),
    currentEpcRating: baseline.epcRating,
  };
}

// ─── Shared UI primitives ────────────────────────────────────────────────────

const SBtn = ({ children, onClick, style = {}, active, accent, full, danger, small }) => (
  <button onClick={onClick} style={{
    borderRadius: 6, border: "1px solid rgba(125,211,252,0.28)", cursor: "pointer",
    fontFamily: UI_FONT, fontSize: small ? 10 : 12, fontWeight: 600, letterSpacing: "0.01em",
    transition: "all 0.15s ease", padding: small ? "4px 8px" : "7px 10px",
    width: full ? "100%" : undefined,
    background: danger ? "rgba(220,38,38,0.24)" : active ? "rgba(37,99,235,0.35)" : accent ? "rgba(14,165,233,0.24)" : "rgba(255,255,255,0.08)",
    color:      danger ? "#FECACA" : active ? "#DBEAFE" : accent ? "#CFFAFE" : "#DDEFFF",
    borderColor: danger ? "rgba(248,113,113,0.58)" : active ? "rgba(147,197,253,0.72)" : accent ? "rgba(125,211,252,0.6)" : "rgba(186,230,253,0.35)",
    ...style,
  }}>{children}</button>
);

const SSL = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A5C8EC", marginBottom: 5, marginTop: 12 }}>
    {children}
  </div>
);

const SHr = () => <div style={{ height: 1, background: "rgba(147,197,253,0.2)", margin: "10px 0" }} />;

function MetricGrid({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
      {items.map(([lbl, val]) => (
        <div key={lbl} style={{ background: "rgba(15,23,42,0.7)", borderRadius: 6, padding: "7px 8px" }}>
          <div style={{ fontSize: 9, color: "#9AB8D7", marginBottom: 2 }}>{lbl}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#E2F1FF" }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function ScenarioPanel({
  replayDataRef, pvDataRef,
  tariffRate, setTariffRate,
  occupancyLevel, setOccupancyLevel,
  carbonPrice, setCarbonPrice,
  scenarioGoal, setScenarioGoal,
  appliedScenarios, setAppliedScenarios,
  setScenarioResult,
}) {
  const replayData = replayDataRef.current || {};
  const hasData    = Object.values(replayData).some(arr => Array.isArray(arr) && arr.length > 0);

  if (!hasData) {
    return (
      <div style={{ fontSize: 11, color: "#9AB8D7", lineHeight: 1.6, padding: "12px 0", textAlign: "center" }}>
        Load energy data first — click{" "}
        <span style={{ color: "#A5B4FC", fontWeight: 700 }}>▶ Energy</span>{" "}
        tab and press{" "}
        <span style={{ color: "#60A5FA", fontWeight: 700 }}>Play</span>{" "}
        to populate baseline data.
      </div>
    );
  }

  const baseline = computeBaseline(replayData, tariffRate);

  const appliedResults = appliedScenarios
    .map(id => applyScenario(id, replayData, tariffRate, occupancyLevel, carbonPrice, baseline))
    .filter(Boolean);

  const combined = appliedResults.length > 0 ? {
    monthlySaving: appliedResults.reduce((s, r) => s + r.totalMonthlySaving, 0),
    carbonSaving:  appliedResults.reduce((s, r) => s + (r.carbonSaving || 0), 0),
    peakReduction: Math.max(0, ...appliedResults.map(r => r.peakReduction || 0)),
    hardwareCost:  appliedResults.reduce((s, r) => s + (r.hardwareCost || 0), 0),
    paybackMonths: Math.max(0, ...appliedResults.map(r => r.paybackMonths || 0)),
    comfortImpact: appliedResults[0]?.comfortImpact || "",
    currentEpc:    appliedResults[0]?.currentEpcRating || baseline?.epcRating || "—",
    newEpc:        appliedResults[appliedResults.length - 1]?.newEpcRating || baseline?.epcRating || "—",
  } : null;

  return (
    <>
      {baseline && (
        <>
          <SSL>Building Baseline</SSL>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
            <div style={pillStyle}>
              <div style={pillLabel}>EUI</div>
              <div style={pillValue}>{baseline.eui.toFixed(0)} <span style={{ fontSize: 9, color: "#9AB8D7" }}>kWh/m²/yr</span></div>
            </div>
            <div style={pillStyle}>
              <div style={pillLabel}>EPC Rating</div>
              <div style={{ ...pillValue, color: epcColor(baseline.epcRating) }}>{baseline.epcRating}</div>
            </div>
            <div style={pillStyle}>
              <div style={pillLabel}>After-hours waste</div>
              <div style={pillValue}>{baseline.afterHoursRatio.toFixed(1)}<span style={{ fontSize: 9, color: "#9AB8D7" }}>%</span></div>
            </div>
            <div style={pillStyle}>
              <div style={pillLabel}>Est. monthly cost</div>
              <div style={{ ...pillValue, color: "#FBBF24" }}>~{fmtEur(baseline.monthlyCost)}</div>
            </div>
          </div>
          <SHr />
        </>
      )}

      {!scenarioGoal ? (
        <>
          <SSL>What&apos;s your goal?</SSL>
          <div style={{ fontSize: 10, color: "#64748B", marginBottom: 8, lineHeight: 1.4 }}>
            Same priorities for every role — pick one to see a single recommended scenario.
          </div>
          {GOAL_ORDER.map((key) => {
            const g = GOAL_LABELS[key];
            if (!g) return null;
            return <GoalCard key={key} emoji={g.emoji} label={g.label} onClick={() => setScenarioGoal(key)} />;
          })}
        </>
      ) : (
        <>
          <button
            onClick={() => setScenarioGoal(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#60A5FA", fontSize: 11, padding: "0 0 8px 0", fontFamily: UI_FONT }}
          >
            ← Back to goals
          </button>

          <div style={{ fontSize: 13, fontWeight: 700, color: "#E2F1FF", marginBottom: 10 }}>
            {GOAL_LABELS[scenarioGoal]?.emoji} {GOAL_LABELS[scenarioGoal]?.label}
          </div>

          {(() => {
            const scenarioId = GOAL_TO_SCENARIO[scenarioGoal];
            if (!scenarioId) return null;
            const result = applyScenario(scenarioId, replayData, tariffRate, occupancyLevel, carbonPrice, baseline);
            if (!result) return null;
            const sev = getSeverity(result.totalMonthlySaving, baseline?.monthlyCost);
            const isApplied = appliedScenarios.includes(scenarioId);
            return (
              <div key={scenarioId}>
                <div style={{ background: "rgba(15,23,42,0.85)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: 8, padding: "10px 12px", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 16 }}>{result.emoji}</span>
                    <span style={{ fontWeight: 700, fontSize: 12, color: "#E2F1FF", flex: 1 }}>{result.label}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 4, ...(SEVERITY_STYLES[sev] || SEVERITY_STYLES.LOW) }}>{sev}</span>
                  </div>

                  <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 8, lineHeight: 1.5 }}>{result.description}</div>

                  <div style={{ fontSize: 16, fontWeight: 700, color: "#4ADE80", marginBottom: 3 }}>
                    Saves ~{fmtEur(result.totalMonthlySaving)}/month
                  </div>
                  {result.demandSaving > 0 && (
                    <div style={{ fontSize: 10, color: "#FBBF24", marginBottom: 3 }}>+ {fmtEur(result.demandSaving)} demand charge saving</div>
                  )}
                  {result.note && (
                    <div style={{ fontSize: 10, color: "#94A3B8", fontStyle: "italic", marginBottom: 3 }}>{result.note}</div>
                  )}
                  {result.hardwareCost > 0 && (
                    <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 3 }}>
                      Needs: {result.hardware} — payback ~{result.paybackMonths} months
                    </div>
                  )}
                  {result.newEpcRating !== result.currentEpcRating && (
                    <div style={{ fontSize: 10, color: "#CBD5E1", marginBottom: 6 }}>
                      EPC:{" "}
                      <span style={{ color: epcColor(result.currentEpcRating), fontWeight: 700 }}>{result.currentEpcRating}</span>
                      {" → "}
                      <span style={{ color: epcColor(result.newEpcRating), fontWeight: 700 }}>{result.newEpcRating}</span>
                    </div>
                  )}

                  <SBtn full accent={!isApplied} active={isApplied} onClick={() => {
                    if (isApplied) {
                      setAppliedScenarios([]);
                      setScenarioResult?.(null);
                    } else {
                      setAppliedScenarios([scenarioId]);
                      setScenarioResult?.({ scenarioId, goal: scenarioGoal, label: result.label });
                    }
                  }}>
                    {isApplied ? "✓ Applied — click to remove" : "Apply scenario"}
                  </SBtn>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {combined && appliedScenarios.length === 1 && (
        <>
          <SHr />
          <div style={{ background: "rgba(10,18,32,0.9)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 4 }}>
              Your scenario
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#4ADE80", letterSpacing: "-0.02em" }}>
              {fmtEur(combined.monthlySaving)}<span style={{ fontSize: 14, color: "#9AB8D7", fontWeight: 400 }}>/month</span>
            </div>
            <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 10 }}>estimated saving</div>

            <MetricGrid items={[
              ["Annual saving",  fmtEur(combined.monthlySaving * 12)],
              ["Carbon saved",   `${combined.carbonSaving.toFixed(1)} kg/mo`],
              ["Peak reduction", `${combined.peakReduction}%`],
              ["Payback",        combined.hardwareCost > 0 ? `~${combined.paybackMonths} mo` : "Immediate"],
            ]} />

            {combined.comfortImpact && (
              <div style={{ fontSize: 10, color: "#CBD5E1", marginBottom: 8 }}>Comfort: {combined.comfortImpact}</div>
            )}

            {combined.currentEpc !== combined.newEpc && (
              <>
                <SHr />
                <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 4 }}>EPC change</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: epcColor(combined.currentEpc) + "33", color: epcColor(combined.currentEpc), fontWeight: 700, fontSize: 13, padding: "3px 8px", borderRadius: 5 }}>
                    {combined.currentEpc}
                  </span>
                  <span style={{ color: "#475569" }}>→</span>
                  <span style={{ background: epcColor(combined.newEpc) + "33", color: epcColor(combined.newEpc), fontWeight: 700, fontSize: 13, padding: "3px 8px", borderRadius: 5 }}>
                    {combined.newEpc}
                  </span>
                </div>
              </>
            )}

            {combined.hardwareCost > 0 && (
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 8 }}>
                Requires investment: {fmtEur(combined.hardwareCost)} total<br />
                Payback: ~{combined.paybackMonths} months at current rates
              </div>
            )}

            <SHr />
            <SBtn full danger onClick={() => { setAppliedScenarios([]); setScenarioResult(null); }}>× Clear scenario</SBtn>
          </div>
        </>
      )}

    </>
  );
}

function GoalCard({ emoji, label, onClick }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(125,211,252,0.6)"; e.currentTarget.style.background = "rgba(15,23,42,0.95)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(125,211,252,0.2)"; e.currentTarget.style.background = "rgba(15,23,42,0.7)"; }}
      style={{
        padding: "12px 14px", borderRadius: 8, cursor: "pointer", marginBottom: 6,
        border: "1px solid rgba(125,211,252,0.2)", background: "rgba(15,23,42,0.7)",
        display: "flex", alignItems: "center", gap: 10,
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <span style={{ fontSize: 20 }}>{emoji}</span>
      <span style={{ fontWeight: 700, fontSize: 13, color: "#E2F1FF" }}>{label}</span>
    </div>
  );
}
