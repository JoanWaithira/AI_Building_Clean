import { useEffect, useMemo, useState } from "react";
import {
  CARBON_FACTOR,
  CIRCUIT_COLORS,
  CIRCUIT_LABELS,
  FLOOR_AREA_M2,
  FONT,
  WORKING_DAYS_MONTH,
  comfortStatus,
  computeBaseline,
  circuitStats,
} from "./roleHelpers.js";

const ROLE_LABELS = {
  director: "Director",
  facilities: "Facilities",
  sustainability: "Sustainability",
  it: "IT Staff",
  worker: "Worker",
  visitor: "Visitor",
};

const CONTROL_CONFIG = {
  director: ["time", "temp", "occupancy"],
  facilities: ["time", "temp", "occupancy"],
  sustainability: ["time", "temp", "occupancy"],
  it: [],
  worker: ["time", "occupancy"],
  visitor: ["time"],
};

const CIRCUIT_PRIORITY = [
  "airconditioner1",
  "airconditioner2",
  "circuit6boiler",
  "ovk",
  "circuit8",
  "circuit10",
  "circuit11",
  "circuit12",
  "circuit7",
  "circuit9",
  "elevator",
  "outsidelighting1",
  "outsidelighting2",
  "vehiclecharging1",
  "vehiclecharging2",
  "3DLED",
];

const FACILITIES_CIRCUITS = [
  "airconditioner1",
  "airconditioner2",
  "circuit6boiler",
  "ovk",
  "circuit10",
  "circuit11",
  "circuit12",
  "outsidelighting1",
];

const IT_CIRCUITS = [
  "circuit8",
  "main",
  "ovk",
  "airconditioner1",
  "airconditioner2",
  "circuit6boiler",
  "elevator",
  "3DLED",
];

const PRETTY_CIRCUIT_LABELS = {
  circuit6boiler: "Boiler",
  airconditioner1: "Air conditioning floors 1-2",
  airconditioner2: "Air conditioning floors 3-5",
  circuit8: "Server room",
  circuit10: "Floor services A",
  circuit11: "Floor services B",
  circuit12: "Floor services C",
  circuit7: "General circuit 7",
  circuit9: "General circuit 9",
  ovk: "Ventilation (OVK)",
  outsidelighting1: "Outside lighting north",
  outsidelighting2: "Outside lighting south",
  vehiclecharging1: "EV charger 1",
  vehiclecharging2: "EV charger 2",
  elevator: "Elevator",
  main: "Main feed",
  "3DLED": "3D LED display",
};

const BUDGET_LIMIT_EUR = 4000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRole(role) {
  return Object.hasOwn(ROLE_LABELS, role) ? role : "director";
}

function getRatingFromEui(eui) {
  if (eui < 50) return "A+";
  if (eui < 100) return "A";
  if (eui < 150) return "B";
  if (eui < 200) return "C";
  if (eui < 250) return "D";
  if (eui < 350) return "E";
  if (eui < 500) return "F";
  return "G";
}

function getRatingColor(rating) {
  if (rating === "A+" || rating === "A") return "#4ADE80";
  if (rating === "B" || rating === "C") return "#FBBF24";
  if (rating === "D" || rating === "E") return "#FB923C";
  return "#F87171";
}

function formatCurrency(value, digits = 0) {
  return `€${Number(value || 0).toFixed(digits)}`;
}

function formatSignedCurrency(value, digits = 0) {
  const amount = Number(value || 0);
  return `${amount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(amount), digits)}`;
}

function formatKwh(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)} kWh`;
}

function formatPercent(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function formatCo2(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)} ppm`;
}

function formatHumidity(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function formatTemperature(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}°C`;
}

function formatCompact(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return `${Math.round(amount)}`;
}

function getFrameHour(frame, index, total) {
  const explicitHour = Number(frame?.hour);
  if (Number.isFinite(explicitHour)) {
    const normalizedHour = ((Math.floor(explicitHour) % 24) + 24) % 24;
    return normalizedHour;
  }

  const rawTs = frame?.timestampMs ?? frame?.ts ?? frame?.ts_5min;
  if (rawTs != null) {
    const date = new Date(rawTs);
    if (!Number.isNaN(date.getTime())) return date.getHours();
  }

  return Math.floor((index / Math.max(total - 1, 1)) * 24) % 24;
}

function getFrameWatts(frame) {
  const watts = Number(frame?.watts ?? frame?.value ?? 0);
  return Number.isFinite(watts) ? watts : 0;
}

function buildHourlyWatts(frames) {
  const buckets = Array.from({ length: 24 }, () => ({ total: 0, count: 0 }));

  (frames || []).forEach((frame, index) => {
    const hour = getFrameHour(frame, index, frames.length || 1);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;
    buckets[hour].total += getFrameWatts(frame);
    buckets[hour].count += 1;
  });

  return buckets.map((bucket) => (
    bucket.count ? bucket.total / bucket.count : 0
  ));
}

function classifyAirQuality(co2) {
  if (co2 < 800) return { label: "Good", color: "#4ADE80" };
  if (co2 < 1000) return { label: "Moderate", color: "#FBBF24" };
  return { label: "Stale", color: "#F87171" };
}

function getCircuitLabel(circuitId) {
  return PRETTY_CIRCUIT_LABELS[circuitId] || CIRCUIT_LABELS[circuitId] || circuitId;
}

function sortCircuitIds(ids) {
  return [...ids].sort((left, right) => {
    const leftIndex = CIRCUIT_PRIORITY.indexOf(left);
    const rightIndex = CIRCUIT_PRIORITY.indexOf(right);
    const leftScore = leftIndex === -1 ? 999 : leftIndex;
    const rightScore = rightIndex === -1 ? 999 : rightIndex;
    return leftScore - rightScore || String(left).localeCompare(String(right));
  });
}

function buildCircuitRows(replayData) {
  const available = Object.keys(replayData || {}).filter((id) => Array.isArray(replayData[id]) && replayData[id].length);
  const sourceIds = available.length ? available : Object.keys(CIRCUIT_LABELS);

  return sortCircuitIds(sourceIds)
    .filter((id) => id !== "main")
    .map((id) => {
      const stats = circuitStats(replayData || {}, id);
      return {
        id,
        label: getCircuitLabel(id),
        color: CIRCUIT_COLORS[id] || "#94A3B8",
        dailyKwh: stats.kwh48 / 2,
        currentWatts: stats.current,
      };
    });
}

function selectCircuitRows(rows, preferredIds) {
  const map = new Map(rows.map((row) => [row.id, row]));
  const selected = preferredIds.map((id) => map.get(id)).filter(Boolean);
  if (selected.length) return selected;
  return rows.slice(0, 8);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildSharedSimulation({
  baseline,
  tariff,
  mainHourlyWatts,
  timeHour,
  occupancy,
  tempSetpoint,
  circuitRows,
  activeCircuitIds,
}) {
  const avgHourlyWatts = average(mainHourlyWatts.filter((value) => value > 0)) || baseline?.avgW || 10000;
  const selectedHourlyWatts = mainHourlyWatts[timeHour] || avgHourlyWatts;
  const occupancyFactor = 0.6 + (occupancy / 100) * 0.75;
  const setpointFactor = 1 + Math.abs(tempSetpoint - 21) * 0.045;
  const profileFactor = clamp(selectedHourlyWatts / Math.max(avgHourlyWatts, 1), 0.55, 1.6);

  const allCircuitIds = circuitRows.map((row) => row.id);
  const activeIds = activeCircuitIds?.length ? activeCircuitIds : allCircuitIds;
  const activeShare = allCircuitIds.length ? activeIds.length / allCircuitIds.length : 1;

  const hvacIds = ["circuit6boiler", "airconditioner1", "airconditioner2", "ovk"];
  const ventilationIds = ["ovk"];

  const hvacAvailable = hvacIds.filter((id) => allCircuitIds.includes(id));
  const ventilationAvailable = ventilationIds.filter((id) => allCircuitIds.includes(id));

  const hvacShare = hvacAvailable.length
    ? hvacAvailable.filter((id) => activeIds.includes(id)).length / hvacAvailable.length
    : 1;
  const ventilationShare = ventilationAvailable.length
    ? ventilationAvailable.filter((id) => activeIds.includes(id)).length / ventilationAvailable.length
    : 1;

  const dailyKwhBase = baseline?.dailyKwh || 220;
  const adjustedDailyKwh = dailyKwhBase * occupancyFactor * setpointFactor * (0.75 + profileFactor * 0.25) * (0.85 + activeShare * 0.15);
  const monthlyKwh = adjustedDailyKwh * WORKING_DAYS_MONTH;
  const annualKwh = monthlyKwh * 12;
  const monthlyCost = monthlyKwh * tariff;
  const carbonTodayKg = adjustedDailyKwh * CARBON_FACTOR;
  const annualCarbonTon = (annualKwh * CARBON_FACTOR) / 1000;
  const eui = annualKwh / FLOOR_AREA_M2;
  const epcRating = getRatingFromEui(eui);
  const currentLoadKw = (selectedHourlyWatts / 1000) * occupancyFactor * setpointFactor * (0.8 + activeShare * 0.2);
  const afterHoursWasteDay = ((baseline?.afterHoursKwh ?? dailyKwhBase * 0.2) / 2) * (0.75 + occupancy / 200);
  const afterHoursHalfSaving = afterHoursWasteDay * 0.5 * WORKING_DAYS_MONTH * tariff;

  const temperature = clamp(
    tempSetpoint + (occupancy - 50) * 0.012 + (profileFactor - 1) * 1.4 - (1 - hvacShare) * 2.6,
    17,
    28
  );
  const co2 = clamp(
    470 + occupancy * 5 + (1 - ventilationShare) * 360 + (timeHour >= 10 && timeHour <= 16 ? 80 : 20),
    500,
    1600
  );
  const humidity = clamp(
    42 + occupancy * 0.12 + (1 - hvacShare) * 8 - (timeHour >= 12 && timeHour <= 17 ? 2 : 0),
    28,
    72
  );
  const comfort = comfortStatus(temperature, co2, humidity);
  const airQuality = classifyAirQuality(co2);

  return {
    dailyKwh: adjustedDailyKwh,
    monthlyKwh,
    annualKwh,
    monthlyCost,
    carbonTodayKg,
    annualCarbonTon,
    eui,
    epcRating,
    currentLoadKw,
    afterHoursWasteDay,
    afterHoursHalfSaving,
    temperature,
    co2,
    humidity,
    comfort,
    airQuality,
    activeCircuitCount: activeIds.length,
    totalCircuitCount: allCircuitIds.length,
    hvacShare,
    ventilationShare,
  };
}

function StatCard({ label, value, sub, tone }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12,
      padding: "12px 14px",
      minHeight: 86,
    }}>
      <div style={{ fontSize: 10, color: "#A5B4C7", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: tone || "#F8FAFC", lineHeight: 1.15 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.35 }}>{sub}</div> : null}
    </div>
  );
}

function StatusPill({ text, tone = "#4ADE80" }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "4px 10px",
      borderRadius: 999,
      background: `${tone}22`,
      color: tone,
      fontSize: 11,
      fontWeight: 700,
    }}>
      {text}
    </span>
  );
}

function SectionCard({ title, children, footer }) {
  return (
    <div style={{
      marginTop: 12,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14,
      padding: "14px 16px",
    }}>
      {title ? <div style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0", marginBottom: 12, letterSpacing: 0.4 }}>{title}</div> : null}
      {children}
      {footer ? <div style={{ marginTop: 12, fontSize: 11, color: "#94A3B8", lineHeight: 1.45 }}>{footer}</div> : null}
    </div>
  );
}

function SliderRow({ label, min, max, step, value, onChange, formatValue }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 60px", gap: 12, alignItems: "center", marginTop: 10 }}>
      <div style={{ fontSize: 11, color: "#CBD5E1" }}>{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", accentColor: "#E5E7EB" }}
      />
      <div style={{ fontSize: 11, color: "#F8FAFC", fontWeight: 700, textAlign: "right" }}>{formatValue(value)}</div>
    </div>
  );
}

function ToggleRow({ row, checked, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 0",
        border: "none",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: "#F8FAFC" }}>{row.label}</div>
        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{formatKwh(row.dailyKwh, 1)}/day</div>
      </div>
      <div style={{
        width: 34,
        height: 20,
        borderRadius: 999,
        border: `1px solid ${checked ? `${row.color}AA` : "rgba(255,255,255,0.18)"}`,
        background: checked ? `${row.color}33` : "rgba(255,255,255,0.04)",
        position: "relative",
        flexShrink: 0,
      }}>
        <div style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          background: checked ? row.color : "#E5E7EB",
          position: "absolute",
          top: 2,
          left: checked ? 17 : 2,
          transition: "left 0.15s ease",
        }} />
      </div>
    </button>
  );
}

function InlineStatusRow({ label, text, tone }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      padding: "12px 0",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    }}>
      <div style={{ fontSize: 12, color: "#F8FAFC" }}>{label}</div>
      <StatusPill text={text} tone={tone} />
    </div>
  );
}

function renderControls(role, controls, setControls) {
  const fields = CONTROL_CONFIG[role] || [];
  if (!fields.length) return null;

  return (
    <SectionCard title="SIMULATION CONTROLS">
      {fields.includes("time") ? (
        <SliderRow
          label="Time of day"
          min={0}
          max={23}
          step={1}
          value={controls.timeHour}
          onChange={(value) => setControls((current) => ({ ...current, timeHour: value }))}
          formatValue={(value) => `${String(value).padStart(2, "0")}:00`}
        />
      ) : null}
      {fields.includes("temp") ? (
        <SliderRow
          label="Temp setpoint (°C)"
          min={18}
          max={24}
          step={1}
          value={controls.tempSetpoint}
          onChange={(value) => setControls((current) => ({ ...current, tempSetpoint: value }))}
          formatValue={(value) => `${value}°C`}
        />
      ) : null}
      {fields.includes("occupancy") ? (
        <SliderRow
          label="Occupancy"
          min={0}
          max={100}
          step={5}
          value={controls.occupancy}
          onChange={(value) => setControls((current) => ({ ...current, occupancy: value }))}
          formatValue={(value) => `${value}%`}
        />
      ) : null}
    </SectionCard>
  );
}

function dispatchWorkerPrompt(prompt) {
  window.dispatchEvent(new CustomEvent("scenario-chat-prompt", { detail: { prompt } }));
}

export default function ScenarioPanel({
  replayDataRef,
  tariffRate,
  activeRoleProp,
  setTariffRate,
  occupancyLevel,
  setOccupancyLevel,
  carbonPrice,
  setCarbonPrice,
  scenarioGoal,
  setScenarioGoal,
  appliedScenarios,
  setAppliedScenarios,
  scenarioResult,
  setScenarioResult,
}) {
  void setTariffRate;
  void occupancyLevel;
  void setOccupancyLevel;
  void carbonPrice;
  void setCarbonPrice;
  void scenarioGoal;
  void setScenarioGoal;
  void appliedScenarios;
  void setAppliedScenarios;
  void scenarioResult;

  const activeRole = toRole(activeRoleProp);
  const [controls, setControls] = useState({
    timeHour: 14,
    tempSetpoint: 21,
    occupancy: 70,
  });
  const [facilityToggles, setFacilityToggles] = useState({});
  const [itToggles, setItToggles] = useState({});

  const tariff = tariffRate ?? 0.22;
  const replayData = replayDataRef?.current ?? {};
  const baseline = useMemo(() => computeBaseline(replayData, tariff), [replayData, tariff]);
  const mainHourlyWatts = useMemo(() => buildHourlyWatts(replayData.main || []), [replayData]);
  const circuitRows = useMemo(() => buildCircuitRows(replayData), [replayData]);
  const facilitiesRows = useMemo(() => selectCircuitRows(circuitRows, FACILITIES_CIRCUITS), [circuitRows]);
  const itRows = useMemo(() => selectCircuitRows(circuitRows, IT_CIRCUITS), [circuitRows]);

  useEffect(() => {
    setFacilityToggles((current) => Object.fromEntries(
      facilitiesRows.map((row) => [row.id, current[row.id] ?? true])
    ));
  }, [facilitiesRows]);

  useEffect(() => {
    setItToggles((current) => Object.fromEntries(
      itRows.map((row) => [row.id, current[row.id] ?? true])
    ));
  }, [itRows]);

  const facilityActiveIds = facilitiesRows
    .filter((row) => facilityToggles[row.id] !== false)
    .map((row) => row.id);
  const itActiveIds = itRows
    .filter((row) => itToggles[row.id] !== false)
    .map((row) => row.id);

  const allActiveIds = circuitRows.map((row) => row.id);

  const directorModel = useMemo(() => buildSharedSimulation({
    baseline,
    tariff,
    mainHourlyWatts,
    timeHour: controls.timeHour,
    occupancy: controls.occupancy,
    tempSetpoint: controls.tempSetpoint,
    circuitRows,
    activeCircuitIds: allActiveIds,
  }), [allActiveIds, baseline, circuitRows, controls.occupancy, controls.tempSetpoint, controls.timeHour, mainHourlyWatts, tariff]);

  const facilitiesModel = useMemo(() => buildSharedSimulation({
    baseline,
    tariff,
    mainHourlyWatts,
    timeHour: controls.timeHour,
    occupancy: controls.occupancy,
    tempSetpoint: controls.tempSetpoint,
    circuitRows,
    activeCircuitIds: facilityActiveIds,
  }), [baseline, circuitRows, controls.occupancy, controls.tempSetpoint, controls.timeHour, facilityActiveIds, mainHourlyWatts, tariff]);

  const sustainabilityModel = useMemo(() => buildSharedSimulation({
    baseline,
    tariff,
    mainHourlyWatts,
    timeHour: controls.timeHour,
    occupancy: controls.occupancy,
    tempSetpoint: controls.tempSetpoint,
    circuitRows,
    activeCircuitIds: allActiveIds,
  }), [allActiveIds, baseline, circuitRows, controls.occupancy, controls.tempSetpoint, controls.timeHour, mainHourlyWatts, tariff]);

  const itModel = useMemo(() => buildSharedSimulation({
    baseline,
    tariff,
    mainHourlyWatts,
    timeHour: controls.timeHour,
    occupancy: controls.occupancy,
    tempSetpoint: controls.tempSetpoint,
    circuitRows,
    activeCircuitIds: itActiveIds,
  }), [baseline, circuitRows, controls.occupancy, controls.tempSetpoint, controls.timeHour, itActiveIds, mainHourlyWatts, tariff]);

  const workerModel = useMemo(() => buildSharedSimulation({
    baseline,
    tariff,
    mainHourlyWatts,
    timeHour: controls.timeHour,
    occupancy: controls.occupancy,
    tempSetpoint: 21,
    circuitRows,
    activeCircuitIds: allActiveIds,
  }), [allActiveIds, baseline, circuitRows, controls.occupancy, controls.timeHour, mainHourlyWatts, tariff]);

  const visitorModel = useMemo(() => buildSharedSimulation({
    baseline,
    tariff,
    mainHourlyWatts,
    timeHour: controls.timeHour,
    occupancy: 55,
    tempSetpoint: 21,
    circuitRows,
    activeCircuitIds: allActiveIds,
  }), [allActiveIds, baseline, circuitRows, controls.timeHour, mainHourlyWatts, tariff]);

  const budgetPercent = clamp((directorModel.monthlyCost / BUDGET_LIMIT_EUR) * 100, 0, 100);
  const focusReady = workerModel.temperature >= 20 && workerModel.temperature <= 24 && workerModel.co2 < 950 && workerModel.humidity >= 35 && workerModel.humidity <= 65;
  const pipelineCoverage = itRows.length ? itActiveIds.length / itRows.length : 1;
  const dataGapRisk = pipelineCoverage > 0.85 ? { label: "Low", color: "#4ADE80" } : pipelineCoverage > 0.6 ? { label: "Medium", color: "#FBBF24" } : { label: "High", color: "#F87171" };
  const iaqSensorsOnline = clamp(
    3 - (itToggles.ovk === false ? 1 : 0) - ((itToggles.airconditioner1 === false && itToggles.airconditioner2 === false) ? 1 : 0),
    0,
    3
  );
  const visitorEnergyUsed = visitorModel.dailyKwh * ((controls.timeHour + 1) / 24);
  const visitorCarbonSavedGrams = directorModel.afterHoursWasteDay * 0.18 * CARBON_FACTOR * 1000;

  const roleSummary = useMemo(() => {
    if (activeRole === "director") {
      return {
        role: activeRole,
        monthlyCost: directorModel.monthlyCost,
        epcRating: directorModel.epcRating,
        carbonTodayKg: directorModel.carbonTodayKg,
      };
    }
    if (activeRole === "facilities") {
      return {
        role: activeRole,
        activeCircuits: facilitiesModel.activeCircuitCount,
        totalCircuits: facilitiesModel.totalCircuitCount,
        temperature: facilitiesModel.temperature,
        co2: facilitiesModel.co2,
      };
    }
    if (activeRole === "sustainability") {
      return {
        role: activeRole,
        monthlyKwh: sustainabilityModel.monthlyKwh,
        carbonTodayKg: sustainabilityModel.carbonTodayKg,
        epcRating: sustainabilityModel.epcRating,
      };
    }
    if (activeRole === "it") {
      return {
        role: activeRole,
        activeSensors: itActiveIds.length,
        totalSensors: itRows.length,
        risk: dataGapRisk.label,
      };
    }
    if (activeRole === "worker") {
      return {
        role: activeRole,
        temperature: workerModel.temperature,
        co2: workerModel.co2,
        humidity: workerModel.humidity,
        comfort: workerModel.comfort.label,
      };
    }
    return {
      role: activeRole,
      energyToday: visitorEnergyUsed,
      epcRating: visitorModel.epcRating,
      carbonTodayKg: visitorModel.carbonTodayKg,
    };
  }, [activeRole, dataGapRisk.label, directorModel.carbonTodayKg, directorModel.epcRating, directorModel.monthlyCost, facilitiesModel.activeCircuitCount, facilitiesModel.co2, facilitiesModel.temperature, facilitiesModel.totalCircuitCount, itActiveIds.length, itRows.length, sustainabilityModel.carbonTodayKg, sustainabilityModel.epcRating, sustainabilityModel.monthlyKwh, visitorEnergyUsed, visitorModel.carbonTodayKg, visitorModel.epcRating, workerModel.co2, workerModel.comfort.label, workerModel.humidity, workerModel.temperature]);

  useEffect(() => {
    setScenarioResult?.(roleSummary);
  }, [roleSummary, setScenarioResult]);

  const workerPrompt = `I want to report discomfort from the worker scenario. Time: ${String(controls.timeHour).padStart(2, "0")}:00. Occupancy: ${controls.occupancy}%. Simulated readings: temperature ${formatTemperature(workerModel.temperature)}, CO2 ${formatCo2(workerModel.co2)}, humidity ${formatHumidity(workerModel.humidity)}. Comfort status: ${workerModel.comfort.label}. Please suggest facilities actions.`;

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>
          Scenario View
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC" }}>
          {ROLE_LABELS[activeRole] || "Director"} scenario
        </div>
        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.45 }}>
          This scenario is now tied to the active dashboard role instead of showing every role in one shared panel.
        </div>
      </div>

      {renderControls(activeRole, controls, setControls)}

      {activeRole === "director" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <StatCard label="Monthly cost" value={formatCurrency(directorModel.monthlyCost, 0)} sub={`${formatCurrency(directorModel.monthlyCost / WORKING_DAYS_MONTH, 0)}/day`} />
            <StatCard label="EPC rating" value={directorModel.epcRating} sub={`EUI ${Math.round(directorModel.eui)} kWh/m²`} tone={getRatingColor(directorModel.epcRating)} />
            <StatCard label="Carbon today" value={`${directorModel.carbonTodayKg.toFixed(0)} kg`} sub={`${directorModel.annualCarbonTon.toFixed(1)} t/yr`} />
          </div>

          <SectionCard title="BUDGET STATUS" footer={`After-hours waste is ${directorModel.afterHoursWasteDay.toFixed(1)} kWh/day. Potential saving of ${formatCurrency(directorModel.afterHoursHalfSaving, 0)}/month if reduced by half.`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#F8FAFC" }}>{formatCurrency(directorModel.monthlyCost, 0)} of {formatCurrency(BUDGET_LIMIT_EUR, 0)} budget</div>
              <StatusPill text={directorModel.monthlyCost <= BUDGET_LIMIT_EUR ? "Under budget" : "Over budget"} tone={directorModel.monthlyCost <= BUDGET_LIMIT_EUR ? "#4ADE80" : "#F87171"} />
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${budgetPercent}%`, height: "100%", background: directorModel.monthlyCost <= BUDGET_LIMIT_EUR ? "#FBBF24" : "#F87171" }} />
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeRole === "facilities" ? (
        <>
          <SectionCard title="CIRCUIT SWITCHES">
            {facilitiesRows.map((row, index) => (
              <div key={row.id} style={{ borderTop: index === 0 ? "none" : undefined }}>
                <ToggleRow
                  row={row}
                  checked={facilityToggles[row.id] !== false}
                  onToggle={() => setFacilityToggles((current) => ({ ...current, [row.id]: !(current[row.id] ?? true) }))}
                />
              </div>
            ))}
          </SectionCard>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <StatCard label="Temperature" value={formatTemperature(facilitiesModel.temperature)} sub={`Setpoint ${controls.tempSetpoint}°C`} />
            <StatCard label="CO2 level" value={formatCo2(facilitiesModel.co2)} sub={facilitiesModel.airQuality.label} tone={facilitiesModel.airQuality.color} />
            <StatCard label="Active circuits" value={`${facilitiesModel.activeCircuitCount}`} sub={`of ${facilitiesModel.totalCircuitCount} total`} />
          </div>

          <SectionCard>
            <InlineStatusRow label="Comfort status" text={facilitiesModel.comfort.label.replace(/^✓\s*/, "")} tone={facilitiesModel.comfort.color} />
            <InlineStatusRow label="Air quality" text={facilitiesModel.airQuality.label} tone={facilitiesModel.airQuality.color} />
            <div style={{ paddingTop: 12, fontSize: 11, color: "#94A3B8", lineHeight: 1.45 }}>
              Total draw right now: {formatKwh(facilitiesModel.currentLoadKw, 1)}. After-hours waste: {facilitiesModel.afterHoursWasteDay.toFixed(1)} kWh/day.
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeRole === "sustainability" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <StatCard label="Daily carbon" value={`${sustainabilityModel.carbonTodayKg.toFixed(0)} kg`} sub="CO2" />
            <StatCard label="Annual estimate" value={`${sustainabilityModel.annualCarbonTon.toFixed(1)} t`} sub="CO2/yr" />
            <StatCard label="EPC rating" value={sustainabilityModel.epcRating} sub={`EUI ${Math.round(sustainabilityModel.eui)}`} tone={getRatingColor(sustainabilityModel.epcRating)} />
          </div>

          <SectionCard title="MONTHLY ENERGY TOTAL" footer={`At this rate, annual carbon output is ${sustainabilityModel.annualCarbonTon.toFixed(1)} t CO2. Reducing after-hours waste by half would save ${formatCurrency(sustainabilityModel.afterHoursHalfSaving, 0)} /month.`}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#F8FAFC" }}>{formatKwh(sustainabilityModel.monthlyKwh, 0)}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#CBD5E1" }}>
              Avg indoor CO2: <strong>{formatCo2(sustainabilityModel.co2)}</strong> · Humidity: <strong>{formatHumidity(sustainabilityModel.humidity)}</strong>
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeRole === "it" ? (
        <>
          <SectionCard title="CIRCUIT SWITCHES">
            {itRows.map((row, index) => (
              <div key={row.id} style={{ borderTop: index === 0 ? "none" : undefined }}>
                <ToggleRow
                  row={row}
                  checked={itToggles[row.id] !== false}
                  onToggle={() => setItToggles((current) => ({ ...current, [row.id]: !(current[row.id] ?? true) }))}
                />
              </div>
            ))}
          </SectionCard>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <StatCard label="Active sensors" value={`${itActiveIds.length}/${itRows.length || 0}`} sub="circuits reporting" />
            <StatCard label="Data gap risk" value={dataGapRisk.label} sub="all nominal" tone={dataGapRisk.color} />
            <StatCard label="IAQ sensors" value={`${iaqSensorsOnline}/3`} sub="temp, CO2, RH" />
          </div>

          <SectionCard title="LIVE READINGS" footer={`Pipeline health: ${itActiveIds.length} of ${itRows.length || 0} selected circuits active. ${pipelineCoverage > 0.85 ? "All systems nominal." : pipelineCoverage > 0.6 ? "Watch reporting gaps." : "Simulation indicates degraded telemetry."}`}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 12, color: "#F8FAFC" }}>Temperature sensor</div>
                <StatusPill text={formatTemperature(itModel.temperature)} tone="#4ADE80" />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 12, color: "#F8FAFC" }}>CO2 sensor</div>
                <StatusPill text={formatCo2(itModel.co2)} tone={itModel.airQuality.color} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 12, color: "#F8FAFC" }}>Humidity sensor</div>
                <StatusPill text={formatHumidity(itModel.humidity)} tone="#4ADE80" />
              </div>
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeRole === "worker" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <StatCard label="My room temp" value={formatTemperature(workerModel.temperature)} sub={workerModel.temperature < 20 || workerModel.temperature > 24 ? "Slightly off" : "On target"} tone={workerModel.temperature < 20 || workerModel.temperature > 24 ? "#FBBF24" : "#F8FAFC"} />
            <StatCard label="Air quality" value={formatCo2(workerModel.co2)} sub={workerModel.airQuality.label} tone={workerModel.airQuality.color} />
            <StatCard label="Humidity" value={formatHumidity(workerModel.humidity)} sub={workerModel.humidity >= 35 && workerModel.humidity <= 65 ? "Healthy range" : "Needs attention"} />
          </div>

          <SectionCard>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 14, color: "#F8FAFC" }}>Good conditions for focused work?</div>
              <StatusPill text={focusReady ? "Yes" : "Not quite"} tone={focusReady ? "#4ADE80" : "#FBBF24"} />
            </div>
          </SectionCard>

          <button
            type="button"
            onClick={() => dispatchWorkerPrompt(workerPrompt)}
            style={{
              width: "100%",
              marginTop: 12,
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "#F8FAFC",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Report discomfort to facilities ↗
          </button>
        </>
      ) : null}

      {activeRole === "visitor" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            <StatCard label="Energy used today" value={formatKwh(visitorEnergyUsed, 0)} sub="so far" />
            <StatCard label="Air quality" value={visitorModel.airQuality.label} sub={formatCo2(visitorModel.co2)} tone={visitorModel.airQuality.color} />
            <StatCard label="Carbon saved" value={`${visitorCarbonSavedGrams.toFixed(0)} g`} sub="vs. baseline today" />
          </div>

          <SectionCard>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, color: "#F8FAFC", marginBottom: 8 }}>Building sustainability status</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#F8FAFC", marginBottom: 8 }}>
                EPC {visitorModel.epcRating} · {visitorModel.carbonTodayKg.toFixed(0)} kg CO2 today
              </div>
              <div style={{ fontSize: 13, color: "#CBD5E1" }}>
                This building is actively managed for energy efficiency.
              </div>
            </div>
          </SectionCard>
        </>
      ) : null}

      {!baseline && (
        <div style={{ textAlign: "center", padding: "16px 0", color: "#64748B", fontSize: 11 }}>
          Play the Energy tab first to load live building data for the simulation.
        </div>
      )}
    </div>
  );
}