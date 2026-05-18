import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FONT, CIRCUIT_COLORS, CIRCUIT_LABELS,
  computeBaseline, circuitStats, fmtW, dispatchCmd, buildCircuitHistoryRows, buildCircuitHistoryMap,
} from "./roleHelpers.js";
import { Btn, SL, Pill, EmptyState, Hr } from "./panelUI.jsx";

import {
  Chart as ChartJS,
  LineElement, BarElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import { fetchElectricityForCircuits } from "../services/gateBuildingRepository.js";
import { toSofiaDateString } from "../utils/timeUtils.js";

ChartJS.register(
  LineElement, BarElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler,
);

async function fetchGateCircuitHistory(circuitIds, rangeDays) {
  const ids = Array.isArray(circuitIds) ? circuitIds : [circuitIds];
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const dateRange = {
    start_date: toSofiaDateString(startDate),
    end_date: toSofiaDateString(endDate),
  };
  try {
    return await fetchElectricityForCircuits(ids, dateRange);
  } catch (e) {
    console.warn("[IT] Gate API circuit history failed:", e.message);
    return [];
  }
}

const RANGE_OPTIONS = [
  { label: "24 h", value: 1 },
  { label: "48 h", value: 2 },
  { label: "7 d", value: 7 },
  { label: "30 d", value: 30 },
  { label: "90 d",  value: 90 },
];

const FORECAST_API_BASE = String(import.meta.env.VITE_FORECAST_API_BASE || "https://gate-forecast-api.onrender.com").replace(/\/+$/, "");

function getSeason(d) {
  const m = d.getMonth() + 1;
  if ([12, 1, 2].includes(m)) return "Winter";
  if ([3, 4, 5].includes(m)) return "Spring";
  if ([6, 7, 8].includes(m)) return "Summer";
  return "Autumn";
}

/** Map front-end circuit id → DB circuit_id */
function dbCircuitId(id) { return id === "3DLED" ? "x3dled" : id; }

function normalizeKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function candidateMetersForCircuit(circuitId, circuitLabel) {
  const cid = String(circuitId || "");
  const label = String(circuitLabel || "");

  const presets = {
    main: ["BuildingMain", "Main", "buildingmain"],
    circuit6boiler: ["Boiler_Circuit_6", "Circuit_6", "Boiler", "boiler_circuit_6"],
    elevator: ["TAC_Elevator", "Elevator", "tac_elevator"],
    circuit7: ["Circuit_7", "circuit_7"],
    circuit8: ["Circuit_8", "circuit_8"],
    circuit9: ["Circuit_9", "circuit_9"],
    circuit10: ["Circuit_10", "circuit_10"],
    circuit11: ["Circuit_11", "circuit_11"],
    circuit12: ["Circuit_12", "circuit_12"],
    airconditioner1: ["AirConditioner_1", "airconditioner_1"],
    airconditioner2: ["AirConditioner_2", "airconditioner_2"],
    vehiclecharging1: ["VehicleCharging_1", "EV_Charger_1", "vehiclecharging_1"],
    vehiclecharging2: ["VehicleCharging_2", "EV_Charger_2", "vehiclecharging_2"],
    outsidelighting1: ["OutsideLighting_1", "outsidelighting_1"],
    outsidelighting2: ["OutsideLighting_2", "outsidelighting_2"],
    ovk: ["OVK", "ovk"],
    "3DLED": ["3D_LED", "x3dled", "3d_led"],
  };

  return [
    ...(presets[cid] || []),
    cid,
    cid.replace(/([a-z])([A-Z])/g, "$1_$2"),
    cid.replace(/circuit(\d+)/i, "Circuit_$1"),
    label,
    label.replace(/\s+/g, "_"),
  ].filter(Boolean);
}

function resolveMeterForCircuit(circuitId, circuitLabel, meters) {
  if (!circuitId || !Array.isArray(meters) || !meters.length) return "";
  const candidates = candidateMetersForCircuit(circuitId, circuitLabel);

  for (const c of candidates) {
    const exact = meters.find((m) => String(m).toLowerCase() === String(c).toLowerCase());
    if (exact) return exact;
  }

  const normalizedMeters = meters.map((m) => ({ raw: m, key: normalizeKey(m) }));
  for (const c of candidates) {
    const ck = normalizeKey(c);
    const hit = normalizedMeters.find((m) => m.key === ck);
    if (hit) return hit.raw;
  }

  // Fuzzy fallback for naming variants, e.g. Elevator <-> TAC_Elevator.
  for (const c of candidates) {
    const ck = normalizeKey(c);
    if (!ck || ck.length < 4) continue;
    const hit = normalizedMeters.find((m) => m.key.includes(ck) || ck.includes(m.key));
    if (hit) return hit.raw;
  }

  return "";
}

async function forecastGetJson(path) {
  const fetchWithTimeout = async (requestUrl, ms = 7000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(requestUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const url = `${FORECAST_API_BASE}/${String(path || "").replace(/^\/+/, "")}`;
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const csvPath = normalizedPath.startsWith("forecasts/")
    ? normalizedPath.replace(/^forecasts\//, "forecasts-csv/")
    : normalizedPath;
  const csvUrl = `${FORECAST_API_BASE}/${csvPath}`;

  const isForecastPath = normalizedPath.startsWith("forecasts/");
  let res;

  if (isForecastPath) {
    try {
      console.log(`[IT] Trying main forecast API (${url})`);
      res = await fetchWithTimeout(url, 7000);
      if (res.ok) {
        const data = await res.json();
        const count = Array.isArray(data?.data) ? data.data.length : 0;
        console.log(`[IT] Main forecast API succeeded, got ${count} records from ${data?.source || "unknown"}`);
        if (count > 0) return data;
        console.warn("[IT] Main forecast API returned no rows, trying legacy CSV endpoint");
      }
    } catch (err) {
      console.warn(`[IT] Main forecast API failed (${url}):`, err.message);
    }

    try {
      console.log(`[IT] Trying legacy CSV endpoint (${csvUrl})`);
      res = await fetch(csvUrl, { method: "GET", headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        const count = Array.isArray(data?.data) ? data.data.length : 0;
        console.log(`[IT] Legacy CSV endpoint succeeded, got ${count} records`);
        return { ...data, source: data?.source || "csv" };
      }
      console.warn(`[IT] Legacy CSV endpoint returned ${res.status}`);
    } catch (err) {
      console.warn(`[IT] Legacy CSV endpoint failed (${csvUrl}):`, err.message);
    }

    return { data: [], source: null };
  }

  try {
    res = await fetchWithTimeout(url, 7000);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn(`[IT] Main API failed (${url}):`, err.message);
  }

  return {};
}

function forecastSourceLabel(source) {
  if (source === "database") return "Database forecast (local/short)";
  if (source === "csv") return "CSV fallback forecast (local/short)";
  return "No forecast rows";
}

function dateFmt(iso) {
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

/** Hex color → rgba string */
function hexToRgba(hex, alpha) {
  const h = hex.replace("#","");
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Compact chart theme matching the dark panel
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "rgba(10,18,32,0.95)",
      titleColor: "#94A3B8",
      bodyColor: "#E2F1FF",
      borderColor: "rgba(96,165,250,0.3)",
      borderWidth: 1,
      padding: 8,
      titleFont: { size: 10 },
      bodyFont: { size: 11 },
    },
  },
  scales: {
    x: {
      grid: { color: "rgba(96,165,250,0.06)" },
      ticks: { color: "#64748B", font: { size: 9 }, maxTicksLimit: 8 },
      border: { color: "rgba(96,165,250,0.15)" },
    },
    y: {
      grid: { color: "rgba(96,165,250,0.06)" },
      ticks: { color: "#64748B", font: { size: 9 }, maxTicksLimit: 6 },
      border: { color: "rgba(96,165,250,0.15)" },
      beginAtZero: true,
    },
  },
};

function chartLine(labels, data, color, label) {
  return {
    labels,
    datasets: [{
      label,
      data,
      borderColor: color,
      backgroundColor: hexToRgba(color, 0.12),
      borderWidth: 1.5,
      tension: 0.35,
      fill: true,
      pointRadius: 0,
      pointHitRadius: 6,
    }],
  };
}

function chartBar(labels, data, color, label) {
  return {
    labels,
    datasets: [{
      label,
      data,
      backgroundColor: hexToRgba(color, 0.45),
      borderColor: color,
      borderWidth: 1,
      borderRadius: 3,
      maxBarThickness: 18,
    }],
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function toSeries(frames, fallback = 24) {
  const values = (frames || []).map((frame) => Number(frame?.watts) || 0).filter(Number.isFinite);
  if (!values.length) return Array.from({ length: fallback }, (_, i) => 1200 + (Math.sin(i / 2) + 1) * 280);
  return values;
}

function sparklinePoints(series, width = 156, height = 42) {
  const safe = Array.isArray(series) && series.length ? series : [0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const span = Math.max(max - min, 1);
  return safe.map((value, index) => {
    const x = safe.length === 1 ? width / 2 : (index / (safe.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x},${y}`;
  }).join(" ");
}

const LIVE_METRIC_META = {
  power: { label: "Power Consumption", shortLabel: "PWR", unit: "W", decimals: 0, source: "Main switchboard", color: "#60A5FA" },
  solar: { label: "Solar Production", shortLabel: "SOL", unit: "kW", decimals: 1, source: "Solar inverter array", color: "#F59E0B" },
  battery: { label: "Battery Level", shortLabel: "BAT", unit: "%", decimals: 0, source: "Battery storage", color: "#34D399" },
  occupancy: { label: "Room Usage", shortLabel: "RM", unit: "%", decimals: 0, source: "Occupancy sensors", color: "#A78BFA" },
  co2: { label: "CO2 Levels", shortLabel: "CO2", unit: "ppm", decimals: 0, source: "Air quality mesh", color: "#F87171" },
};

function getMetricStatus(metric, value) {
  switch (metric) {
    case "power":
      if (value >= 4200) return { tone: "red", color: "#F87171", label: "High load" };
      if (value >= 3000) return { tone: "yellow", color: "#FBBF24", label: "Watch" };
      return { tone: "green", color: "#4ADE80", label: "Stable" };
    case "solar":
      if (value <= 18) return { tone: "red", color: "#F87171", label: "Low output" };
      if (value <= 35) return { tone: "yellow", color: "#FBBF24", label: "Moderate" };
      return { tone: "green", color: "#4ADE80", label: "Strong" };
    case "battery":
      if (value <= 28) return { tone: "red", color: "#F87171", label: "Low reserve" };
      if (value <= 45) return { tone: "yellow", color: "#FBBF24", label: "Buffering" };
      return { tone: "green", color: "#4ADE80", label: "Charged" };
    case "occupancy":
      if (value >= 88) return { tone: "red", color: "#F87171", label: "Crowded" };
      if (value >= 64) return { tone: "yellow", color: "#FBBF24", label: "Busy" };
      return { tone: "green", color: "#4ADE80", label: "Normal" };
    case "co2":
      if (value >= 950) return { tone: "red", color: "#F87171", label: "Ventilate" };
      if (value >= 760) return { tone: "yellow", color: "#FBBF24", label: "Elevated" };
      return { tone: "green", color: "#4ADE80", label: "Fresh" };
    default:
      return { tone: "green", color: "#4ADE80", label: "OK" };
  }
}

function buildLiveSeries(replayData) {
  const main = toSeries(replayData?.main);
  const server = toSeries(replayData?.circuit8, main.length);
  const rooms = toSeries(replayData?.circuit9, main.length);
  const cooling = toSeries(replayData?.airconditioner1, main.length);
  const lighting = toSeries(replayData?.circuit10, main.length);
  const mainPeak = Math.max(...main, 1);
  const serverPeak = Math.max(...server, 1);
  const roomsPeak = Math.max(...rooms, 1);
  const coolingPeak = Math.max(...cooling, 1);

  const power = main.map((value) => Math.round(value));
  const solar = main.map((value, index) => {
    const shaped = 14 + ((Math.sin((index / Math.max(main.length - 1, 1)) * Math.PI * 1.8 - 0.6) + 1) * 22);
    return Number((shaped + ((lighting[index % lighting.length] || 0) / 150)).toFixed(1));
  });
  const battery = main.map((value, index) => {
    const reserve = 84 - ((value / mainPeak) * 42) + Math.sin(index / 3) * 5;
    return Math.round(clamp(reserve, 12, 98));
  });
  const occupancy = rooms.map((value, index) => {
    const normalized = (value / roomsPeak) * 55;
    const lift = (cooling[index % cooling.length] / coolingPeak) * 28;
    return Math.round(clamp(18 + normalized + lift, 8, 100));
  });
  const co2 = server.map((value, index) => {
    const occupied = occupancy[index % occupancy.length];
    const baseline = 470 + (occupied * 5.1) + ((value / serverPeak) * 140);
    return Math.round(clamp(baseline, 420, 1200));
  });

  return { power, solar, battery, occupancy, co2 };
}

function formatMetricValue(metric, value) {
  const meta = LIVE_METRIC_META[metric];
  return `${Number(value).toFixed(meta.decimals)}${meta.unit}`;
}

function buildLiveEvent(metric, value, previousValue, tick) {
  const meta = LIVE_METRIC_META[metric];
  const delta = value - previousValue;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "steady";
  const status = getMetricStatus(metric, value);
  let message = `${meta.label} update`;

  if (metric === "co2") {
    if (status.tone === "red") message = "CO2 level spike detected";
    else if (direction === "down") message = "Air quality recovering";
    else message = "CO2 trend updated";
  } else if (metric === "power") {
    message = direction === "up" ? "Power consumption update" : "Power draw settling";
  } else if (metric === "solar") {
    message = direction === "up" ? "Solar generation ramping" : "Solar production update";
  } else if (metric === "battery") {
    message = direction === "down" ? "Battery discharge activity" : "Battery charge update";
  } else if (metric === "occupancy") {
    message = direction === "up" ? "Room occupancy rising" : "Room usage update";
  }

  return {
    id: `${metric}-${tick}`,
    metric,
    message,
    valueLabel: formatMetricValue(metric, value),
    source: meta.source,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    accent: status.color,
  };
}

function useLiveMonitoring(replayData) {
  const seriesMap = useMemo(() => buildLiveSeries(replayData), [replayData]);
  const [tick, setTick] = useState(0);
  const [feed, setFeed] = useState([]);
  const metricOrder = useMemo(() => ["co2", "power", "solar", "battery", "occupancy"], []);

  useEffect(() => {
    const timer = setInterval(() => setTick((current) => current + 1), 2200);
    return () => clearInterval(timer);
  }, []);

  const kpis = useMemo(() => {
    return Object.entries(seriesMap).reduce((acc, [metric, series]) => {
      const length = Math.max(series.length, 1);
      const index = tick % length;
      const previousIndex = (tick - 1 + length) % length;
      const recent = Array.from({ length: 12 }, (_, offset) => {
        const sampleIndex = (tick - 11 + offset + length * 12) % length;
        return series[sampleIndex];
      });
      const current = series[index];
      const previous = series[previousIndex];
      acc[metric] = {
        metric,
        current,
        previous,
        delta: current - previous,
        trend: current > previous ? "up" : current < previous ? "down" : "flat",
        status: getMetricStatus(metric, current),
        series: recent,
      };
      return acc;
    }, {});
  }, [seriesMap, tick]);

  useEffect(() => {
    const metric = metricOrder[tick % metricOrder.length];
    const snapshot = kpis[metric];
    if (!snapshot) return;
    setFeed((current) => [buildLiveEvent(metric, snapshot.current, snapshot.previous, tick), ...current].slice(0, 7));
  }, [kpis, metricOrder, tick]);

  return { kpis, feed, tick };
}

function AnimatedMetricValue({ metric, value }) {
  const meta = LIVE_METRIC_META[metric];
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    let frame = null;
    const from = display;
    const start = performance.now();
    const duration = 450;

    const update = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - ((1 - progress) ** 3);
      const next = from + ((value - from) * eased);
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <span>
      {display.toFixed(meta.decimals)}
      <span style={{ fontSize: 11, color: "#7DD3FC", marginLeft: 4 }}>{meta.unit}</span>
    </span>
  );
}

function MiniSparkline({ series, color }) {
  const points = sparklinePoints(series);
  const last = points.split(" ").pop()?.split(",") || ["156", "21"];

  return (
    <svg width="100%" height="42" viewBox="0 0 156 42" preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`${points} 156,42 0,42`} fill={`url(#spark-${color.replace("#", "")})`} stroke="none" />
      <circle cx={last[0]} cy={last[1]} r="3.2" fill={color} />
    </svg>
  );
}

function LiveDataSection({ replayData }) {
  const { kpis, feed, tick } = useLiveMonitoring(replayData);
  const cards = ["power", "solar", "battery", "occupancy", "co2"];

  return (
    <div style={{ marginBottom: 12 }}>
      <style>{`
        @keyframes liveFeedIn {
          from { opacity: 0; transform: translateX(-18px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes livePulse {
          0% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
          50% { box-shadow: 0 0 0 8px rgba(96, 165, 250, 0.08); }
          100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
        }
      `}</style>

      <SL>Live Operations Monitor</SL>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 10,
        padding: 10,
        borderRadius: 10,
        border: "1px solid rgba(96,165,250,0.16)",
        background: "linear-gradient(180deg, rgba(7,14,28,0.96), rgba(10,18,32,0.9))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(2,8,23,0.26)",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#E2F1FF", fontFamily: FONT }}>Live Data Feed</div>
              <div style={{ fontSize: 9, color: "#64748B", fontFamily: FONT }}>Power, solar, battery, rooms, and air quality streams</div>
            </div>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.72)",
              border: "1px solid rgba(74,222,128,0.22)",
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "#4ADE80", boxShadow: "0 0 10px rgba(74,222,128,0.7)" }} />
              <span style={{ fontSize: 9, color: "#B6F7C7", fontWeight: 700, fontFamily: FONT }}>LIVE</span>
            </div>
          </div>

          <div style={{ display: "grid", gap: 7 }}>
            {feed.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 8,
                  alignItems: "center",
                  padding: "9px 10px",
                  borderRadius: 9,
                  background: "rgba(15,23,42,0.68)",
                  border: `1px solid ${hexToRgba(entry.accent, 0.32)}`,
                  animation: "liveFeedIn 320ms ease-out",
                }}
              >
                <div style={{
                  minWidth: 34,
                  height: 34,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  color: entry.accent,
                  background: hexToRgba(entry.accent, 0.12),
                  border: `1px solid ${hexToRgba(entry.accent, 0.28)}`,
                  fontFamily: FONT,
                }}>
                  {LIVE_METRIC_META[entry.metric].shortLabel}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "#E2F1FF", fontWeight: 700, fontFamily: FONT }}>{entry.message}</div>
                  <div style={{ fontSize: 9, color: "#7C93B3", fontFamily: FONT }}>
                    {entry.timestamp}  {entry.source}
                  </div>
                </div>

                <div style={{ fontSize: 10, color: entry.accent, fontWeight: 700, fontFamily: FONT }}>{entry.valueLabel}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#E2F1FF", fontFamily: FONT }}>Live KPIs</div>
              <div style={{ fontSize: 9, color: "#64748B", fontFamily: FONT }}>Instant status, trend, and rolling sensor behavior</div>
            </div>
            <div style={{ fontSize: 9, color: "#7C93B3", fontFamily: FONT }}>Tick {String(tick + 1).padStart(2, "0")}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {cards.map((metric) => {
              const item = kpis[metric];
              if (!item) return null;

              return (
                <div
                  key={metric}
                  style={{
                    padding: "10px 10px 8px",
                    borderRadius: 10,
                    background: "linear-gradient(180deg, rgba(15,23,42,0.86), rgba(11,17,29,0.95))",
                    border: `1px solid ${hexToRgba(item.status.color, 0.28)}`,
                    animation: "livePulse 900ms ease-out",
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 0 18px ${hexToRgba(item.status.color, 0.08)}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#8AA4C3", fontFamily: FONT }}>
                      {LIVE_METRIC_META[metric].label}
                    </div>
                    <div style={{
                      fontSize: 8,
                      fontWeight: 700,
                      color: item.status.color,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: hexToRgba(item.status.color, 0.12),
                      border: `1px solid ${hexToRgba(item.status.color, 0.26)}`,
                      fontFamily: FONT,
                    }}>
                      {item.status.label}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#F8FBFF", letterSpacing: -0.4, fontFamily: FONT }}>
                      <AnimatedMetricValue metric={metric} value={item.current} />
                    </div>
                    <div style={{ fontSize: 10, color: item.delta >= 0 ? "#4ADE80" : "#FCA5A5", fontWeight: 700, fontFamily: FONT }}>
                      {item.trend === "up" ? "UP" : item.trend === "down" ? "DOWN" : "FLAT"}
                    </div>
                  </div>

                  <div style={{ height: 42, marginBottom: 6 }}>
                    <MiniSparkline series={item.series} color={LIVE_METRIC_META[metric].color} />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#7087A5", fontFamily: FONT }}>
                    <span>{LIVE_METRIC_META[metric].source}</span>
                    <span style={{ color: item.delta >= 0 ? "#86EFAC" : "#FCA5A5" }}>
                      {item.delta >= 0 ? "+" : ""}{item.delta.toFixed(metric === "solar" ? 1 : 0)}{LIVE_METRIC_META[metric].unit}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEWS
// ═══════════════════════════════════════════════════════════════════════════════

function CircuitListView({ replayData, onSelect, onCompare }) {
  const [sortKey, setSortKey] = useState("current");
  const [sortAsc, setSortAsc] = useState(false);
  const baseline = computeBaseline(replayData, 0.22);

  const circuitIds = Object.keys(CIRCUIT_COLORS);
  let rows = circuitIds.map(id => ({
    id, label: CIRCUIT_LABELS[id] || id, color: CIRCUIT_COLORS[id],
    ...circuitStats(replayData, id),
  }));
  rows = rows.sort((a, b) => (a[sortKey] - b[sortKey]) * (sortAsc ? 1 : -1));

  const SortHdr = ({ k, children }) => (
    <th onClick={() => { if (sortKey===k) setSortAsc(p=>!p); else { setSortKey(k); setSortAsc(false); }}}
      style={{ cursor:"pointer", padding:"4px 6px", textAlign:"left", fontSize:9, fontWeight:700, color: sortKey===k ? "#60A5FA":"#64748B", whiteSpace:"nowrap" }}>
      {children}{sortKey===k?(sortAsc?"↑":"↓"):""}
    </th>
  );

  const profileIds = ["main","circuit8","circuit9","circuit10","airconditioner1"];

  return (
    <>
      {/*   <SL>Technical KPIs</SL> */}
      {/* <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
        <Pill label="Peak demand" value={fmtW(baseline?.peakW||0)} sub="48h window" color="#F87171"/>
        <Pill label="Load factor" value={baseline?.loadFactor.toFixed(2)||"—"} sub="avg/peak ratio" color="#60A5FA"/>
        <Pill label="Peak factor" value={baseline?.peakFactor.toFixed(2)||"—"} sub={baseline?.peakFactor > 1.6 ? "⚠ High" : "Normal"} color={baseline?.peakFactor > 1.6 ? "#EF4444":"#4ADE80"}/>
        <Pill label="Server room" value={fmtW(circuitStats(replayData,"circuit8").current)} sub="current watts" color="#34D399"/>
      </div> */}

      <SL>Load profile — key circuits</SL>

      <div style={{ marginBottom:6 }}>
        <svg width="100%" viewBox="0 0 264 64" style={{ display:"block", borderRadius:4, background:"rgba(10,15,26,0.7)", border:"1px solid rgba(96,165,250,0.08)" }}>
          {profileIds.map(id => {
            const frames = replayData[id] || [];
            if (frames.length < 2) return null;
            const peakAll = Math.max(...(replayData["main"]||[]).map(f=>f.watts), 1);
            const pts = frames.map((f,i) => {
              const x = (i/(frames.length-1))*264;
              const y = 62 - (f.watts/peakAll)*58;
              return `${x},${y}`;
            }).join(" ");
            return <polyline key={id} points={pts} fill="none" stroke={CIRCUIT_COLORS[id]||"#888"} strokeWidth="1.2" strokeLinejoin="round" opacity="0.85"/>;
          })}
        </svg>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
          {profileIds.map(id => (
            <div key={id} style={{ display:"flex", alignItems:"center", gap:3, fontSize:8, color:"#9AB8D7" }}>
              <div style={{ width:10, height:2, background:CIRCUIT_COLORS[id]||"#888", borderRadius:1 }}/>
              {CIRCUIT_LABELS[id]||id}
            </div>
          ))}
        </div>
      </div>

      <SL>All circuits — click to inspect</SL>
      <div style={{ overflowX:"auto", marginBottom:8 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10, fontFamily:FONT }}>
          <thead>
            <tr style={{ borderBottom:"1px solid rgba(125,211,252,0.15)" }}>
              <th style={{ padding:"4px 6px", textAlign:"left", fontSize:9, color:"#64748B" }}>Circuit</th>
              <SortHdr k="current">Now</SortHdr>
              <SortHdr k="peak">Peak</SortHdr>
              <SortHdr k="avg">Avg</SortHdr>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const loadPct = r.peak > 0 ? r.current/r.peak : 0;
              const rowBg = loadPct > 0.9 ? "rgba(239,68,68,0.08)" : loadPct > 0.75 ? "rgba(251,191,36,0.06)" : "transparent";
              return (
                <tr key={r.id}
                  onClick={() => { dispatchCmd("zoom_to_circuit", { circuit_id: r.id }); onSelect(r.id); }}
                  style={{ background:rowBg, borderBottom:"1px solid rgba(255,255,255,0.03)", cursor:"pointer", transition:"background 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(96,165,250,0.1)"}
                  onMouseLeave={e => e.currentTarget.style.background = rowBg}
                >
                  <td style={{ padding:"3px 6px", color:r.color, fontWeight:700, fontSize:10 }}>
                    {r.label.slice(0,14)} →
                  </td>
                  <td style={{ padding:"3px 6px", color:"#E2F1FF", fontSize:10 }}>{fmtW(r.current)}</td>
                  <td style={{ padding:"3px 6px", color:"#9AB8D7", fontSize:10 }}>{fmtW(r.peak)}</td>
                  <td style={{ padding:"3px 6px", color:"#9AB8D7", fontSize:10 }}>{fmtW(r.avg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:5 }}>
        <Btn onClick={onCompare} accent>⚖ Compare</Btn>
      </div>
    </>
  );
}

function CircuitDetailView({ circuitId, replayData, onBack }) {
  const [rangeDays, setRangeDays] = useState(7);
  const [raw, setRaw] = useState([]);
  const [forecastRows, setForecastRows] = useState([]);
  const [forecastSource, setForecastSource] = useState("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const color = CIRCUIT_COLORS[circuitId] || "#60A5FA";
  const label = CIRCUIT_LABELS[circuitId] || circuitId;

  // Zoom camera to circuit on mount
  useEffect(() => { dispatchCmd("zoom_to_circuit", { circuit_id: circuitId }); }, [circuitId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchGateCircuitHistory(circuitId, rangeDays);
        if (!cancelled) {
          setRaw(data.length ? data : buildCircuitHistoryRows(circuitId, rangeDays, replayData));
        }
      } catch (e) {
        if (!cancelled) {
          setRaw(buildCircuitHistoryRows(circuitId, rangeDays, replayData));
          setError(null);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [circuitId, rangeDays, replayData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meterPayload = await forecastGetJson("/meters");
        if (cancelled) return;
        const meters = Array.isArray(meterPayload?.meters) ? meterPayload.meters : [];
        const meter = resolveMeterForCircuit(circuitId, label, meters);
        if (!meter) {
          setForecastRows([]);
          setForecastSource("none");
          return;
        }
        const payload = await forecastGetJson(`/forecasts/local/short?circuit_id=${encodeURIComponent(meter)}&mode=single`);
        if (cancelled) return;
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        setForecastRows(rows);
        setForecastSource(rows.length ? (payload?.source || "database") : "none");
      } catch (e) {
        if (!cancelled) {
          console.warn("[IT] forecast fetch failed:", e);
          setForecastRows([]);
          setForecastSource("none");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [circuitId, label]);

  const stats = useMemo(() => {
    if (!raw.length) return null;

    const vals = raw.map(r => r.value ?? 0);
    const currentVal = vals[vals.length - 1];
    const peakVal = Math.max(...vals);
    const avgVal = vals.reduce((a, b) => a + b, 0) / vals.length;

    // Timeseries — subsample for chart perf (max ~200 points)
    const step = Math.max(1, Math.floor(raw.length / 200));
    const tsLabels = [];
    const tsData = [];
    for (let i = 0; i < raw.length; i += step) {
      tsLabels.push(dateFmt(raw[i].ts_5min));
      tsData.push(raw[i].value ?? 0);
    }

    // Hourly profile
    const hourMap = new Map();
    raw.forEach(r => {
      const h = new Date(r.ts_5min).getHours();
      const prev = hourMap.get(h) || { sum: 0, count: 0 };
      prev.sum += r.value ?? 0;
      prev.count++;
      hourMap.set(h, prev);
    });
    const hourly = Array.from({ length: 24 }, (_, h) => {
      const entry = hourMap.get(h);
      return { hour: h, avg: entry ? entry.sum / entry.count : 0 };
    });

    // Daily totals
    const dayMap = new Map();
    raw.forEach(r => {
      const dayKey = r.ts_5min.slice(0, 10);
      dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + (r.value ?? 0));
    });
    const daily = [...dayMap.entries()].sort(([a],[b]) => a.localeCompare(b))
      .map(([day, total]) => ({ day, total }));

    // Weekday vs Weekend (average daily total)
    let wdSum = 0, wdCount = 0, weSum = 0, weCount = 0;
    daily.forEach(d => {
      const dow = new Date(d.day).getDay();
      if (dow === 0 || dow === 6) { weSum += d.total; weCount++; }
      else { wdSum += d.total; wdCount++; }
    });

    // Working vs non-working hours (average load)
    let workSum = 0, workN = 0, offSum = 0, offN = 0;
    raw.forEach(r => {
      const dt = new Date(r.ts_5min);
      const dow = dt.getDay();
      const h = dt.getHours();
      const val = r.value ?? 0;
      if (dow >= 1 && dow <= 5 && h >= 8 && h <= 17) { workSum += val; workN++; }
      else { offSum += val; offN++; }
    });

    // Seasonal totals
    const seasonMap = new Map();
    raw.forEach(r => {
      const s = getSeason(new Date(r.ts_5min));
      seasonMap.set(s, (seasonMap.get(s) || 0) + (r.value ?? 0));
    });
    const seasons = ["Winter","Spring","Summer","Autumn"].filter(s => seasonMap.has(s))
      .map(s => ({ season: s, total: seasonMap.get(s) }));

    // Peak demand (top 5)
    const peaks = [...raw]
      .filter(r => typeof r.value === "number")
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map(r => ({ ts: r.ts_5min, value: r.value }));

    return {
      currentVal, peakVal, avgVal,
      tsLabels, tsData,
      hourly, daily,
      weekdayAvg: wdCount ? wdSum / wdCount : 0,
      weekendAvg: weCount ? weSum / weCount : 0,
      wdCount, weCount,
      workAvg: workN ? workSum / workN : 0,
      offAvg: offN ? offSum / offN : 0,
      seasons, peaks,
      totalRecords: raw.length,
    };
  }, [raw]);

  const forecastSeries = useMemo(() => {
    const parsed = (forecastRows || [])
      .map((r) => ({
        ts: r.timestamp,
        prediction: Number(r.prediction ?? r.predicted_value ?? 0),
      }))
      .filter((r) => r.ts && Number.isFinite(r.prediction));
    if (!parsed.length) return null;

    const points = parsed.slice(0, 24);
    const labels = points.map((p) => dateFmt(p.ts));
    const values = points.map((p) => p.prediction);
    const peak = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    return { labels, values, peak, avg, next: values[0] };
  }, [forecastRows]);

  // Circuit selected — no camera change, keep same building view

  return (
    <>
      {/* Back button + header */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
        <button onClick={onBack} style={{
          background:"none", border:"none", cursor:"pointer",
          color:"#64748B", fontSize:14, fontFamily:FONT, padding:"2px 4px",
        }}>←</button>
        <span style={{ fontSize:13, fontWeight:700, color, fontFamily:FONT }}>{label}</span>
      </div>

      {/* Range selector */}
      <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
        {RANGE_OPTIONS.map(r => (
          <Btn key={r.value}
            onClick={() => setRangeDays(r.value)}
            active={rangeDays === r.value}
            small
          >{r.label}</Btn>
        ))}
      </div>

      {loading && <EmptyState msg="Loading circuit data…"/>}
      {error && <EmptyState msg={`Error: ${error}`}/>}
      {!loading && !error && !stats && <EmptyState msg="No data for this circuit"/>}

      {stats && (
        <>
          {/* KPIs */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
            <Pill label="Current" value={fmtW(stats.currentVal)} color={color}/>
            <Pill label="Peak" value={fmtW(stats.peakVal)} sub={`${rangeDays}d window`} color="#F87171"/>
            <Pill label="Average" value={fmtW(stats.avgVal)} color="#94A3B8"/>
            <Pill label="Records" value={stats.totalRecords.toLocaleString()} sub="data points" color="#64748B"/>
          </div>

          {/* Timeseries trend */}
          <SL>Power trend</SL>
          <div style={{ height:100, marginBottom:10 }}>
            <Line
              data={chartLine(stats.tsLabels, stats.tsData, color, "Power (W)")}
              options={{
                ...CHART_OPTS,
                scales: {
                  ...CHART_OPTS.scales,
                  x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 5 } },
                },
              }}
            />
          </div>

          {/* Daily totals */}
          {stats.daily.length > 1 && (
            <>
              <SL>Daily energy</SL>
              <div style={{ height:90, marginBottom:10 }}>
                <Line
                  data={chartLine(
                    stats.daily.map(d => d.day.slice(5)),
                    stats.daily.map(d => d.total),
                    "#2563EB", "Daily energy (Wh)"
                  )}
                  options={{
                    ...CHART_OPTS,
                    scales: {
                      ...CHART_OPTS.scales,
                      x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 7 } },
                    },
                  }}
                />
              </div>
            </>
          )}

          {/* Hourly profile */}
          <SL>Hourly profile (avg)</SL>
          <div style={{ height:80, marginBottom:10 }}>
            <Bar
              data={chartBar(
                stats.hourly.map(h => `${h.hour}h`),
                stats.hourly.map(h => h.avg),
                color, "Avg power (W)"
              )}
              options={CHART_OPTS}
            />
          </div>

          {/* Typical day curve */}
          <SL>Typical day curve</SL>
          <div style={{ height:80, marginBottom:10 }}>
            <Line
              data={chartLine(
                stats.hourly.map(h => `${h.hour}:00`),
                stats.hourly.map(h => h.avg),
                "#10B981", "Typical load (W)"
              )}
              options={CHART_OPTS}
            />
          </div>

          {/* Forecast from table */}
          <SL>Forecast (table, short-term)</SL>
          {forecastSeries ? (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8 }}>
                <Pill label="Next" value={fmtW(forecastSeries.next)} color="#A78BFA"/>
                <Pill label="Fc avg" value={fmtW(forecastSeries.avg)} color="#7C3AED"/>
                <Pill label="Fc peak" value={fmtW(forecastSeries.peak)} color="#C4B5FD"/>
              </div>
              <div style={{ height:86, marginBottom:10 }}>
                <Line
                  data={chartLine(forecastSeries.labels, forecastSeries.values, "#A78BFA", "Forecast (W)")}
                  options={{
                    ...CHART_OPTS,
                    scales: {
                      ...CHART_OPTS.scales,
                      x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 6 } },
                    },
                  }}
                />
              </div>
              <div style={{ fontSize:9, color:"#9AB8D7", marginBottom:10 }}>
                Source: {forecastSourceLabel(forecastSource)}
              </div>
            </>
          ) : (
            <div style={{ fontSize:9, color:"#64748B", marginBottom:10 }}>
              No forecast rows available for this circuit.
            </div>
          )}

          {/* Weekday vs Weekend */}
          <SL>Weekday vs Weekend</SL>
          <div style={{ height:70, marginBottom:10 }}>
            <Bar
              data={{
                labels: [`Weekday (${stats.wdCount}d)`, `Weekend (${stats.weCount}d)`],
                datasets: [{
                  data: [stats.weekdayAvg, stats.weekendAvg],
                  backgroundColor: ["rgba(34,197,94,0.45)", "rgba(168,85,247,0.45)"],
                  borderColor: ["#22C55E", "#A855F7"],
                  borderWidth: 1, borderRadius: 3, maxBarThickness: 32,
                }],
              }}
              options={CHART_OPTS}
            />
          </div>

          {/* Working vs Non-working */}
          <SL>Working vs off-hours</SL>
          <div style={{ height:70, marginBottom:10 }}>
            <Bar
              data={{
                labels: ["Working (Mon-Fri 8-17)", "Off-hours"],
                datasets: [{
                  data: [stats.workAvg, stats.offAvg],
                  backgroundColor: ["rgba(96,165,250,0.45)", "rgba(234,88,12,0.45)"],
                  borderColor: ["#60A5FA", "#EA580C"],
                  borderWidth: 1, borderRadius: 3, maxBarThickness: 32,
                }],
              }}
              options={CHART_OPTS}
            />
          </div>

          {/* Seasonal comparison */}
          {stats.seasons.length > 1 && (
            <>
              <SL>Seasonal comparison</SL>
              <div style={{ height:70, marginBottom:10 }}>
                <Bar
                  data={chartBar(
                    stats.seasons.map(s => s.season),
                    stats.seasons.map(s => s.total),
                    "#3B82F6", "Total energy (Wh)"
                  )}
                  options={CHART_OPTS}
                />
              </div>
            </>
          )}

          {/* Peak demand top 5 */}
          <SL>Peak demand (top 5)</SL>
          <div style={{ marginBottom:10 }}>
            {stats.peaks.map((p, i) => (
              <div key={i} style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"3px 0", borderBottom:"1px solid rgba(255,255,255,0.04)",
                fontSize:10, fontFamily:FONT,
              }}>
                <span style={{ color:"#64748B" }}>#{i+1}</span>
                <span style={{ color:"#E2F1FF", fontWeight:600 }}>{fmtW(p.value)}</span>
                <span style={{ color:"#475569", fontSize:9 }}>{dateFmt(p.ts)}</span>
              </div>
            ))}
          </div>

        </>
      )}
    </>
  );
}


function CompareView({ replayData, onBack }) {
  const allIds = Object.keys(CIRCUIT_COLORS);
  const [selected, setSelected] = useState(() => new Set(["main","circuit8","circuit9"]));
  const [rangeDays, setRangeDays] = useState(7);
  const [dataMap, setDataMap] = useState({});
  const [loading, setLoading] = useState(false);

  const toggle = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Fetch data for all selected circuits
  useEffect(() => {
    if (!selected.size) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ids  = [...selected];
        const rows = await fetchGateCircuitHistory(ids, rangeDays);
        if (!cancelled) {
          if (rows.length) {
            const grouped = {};
            rows.forEach(r => {
              if (!grouped[r.circuit_id]) grouped[r.circuit_id] = [];
              grouped[r.circuit_id].push(r);
            });
            const fallbackMap = buildCircuitHistoryMap(ids, rangeDays, replayData);
            setDataMap({ ...fallbackMap, ...grouped });
          } else {
            setDataMap(buildCircuitHistoryMap([...selected], rangeDays, replayData));
          }
        }
      } catch (e) {
        console.warn("Compare fetch error:", e);
        if (!cancelled) setDataMap(buildCircuitHistoryMap([...selected], rangeDays, replayData));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selected, rangeDays, replayData]);

  const { overlayCfg, totalBarCfg, weekdayCfg } = useMemo(() => {
    const selArr = [...selected];

    // Overlay timeseries — subsample each circuit
    const overlayDatasets = selArr.map(id => {
      const records = dataMap[id] || [];
      const step = Math.max(1, Math.floor(records.length / 150));
      const pts = [];
      const labels = [];
      for (let i = 0; i < records.length; i += step) {
        labels.push(dateFmt(records[i].ts_5min));
        pts.push(records[i].value ?? 0);
      }
      return { id, labels, pts };
    });

    const longestLabels = overlayDatasets.reduce((a, b) => b.labels.length > a.length ? b.labels : a, []);

    const overlayCfg = {
      labels: longestLabels,
      datasets: overlayDatasets.map(d => ({
        label: CIRCUIT_LABELS[d.id] || d.id,
        data: d.pts,
        borderColor: CIRCUIT_COLORS[d.id] || "#888",
        borderWidth: 1.5,
        tension: 0.35,
        fill: false,
        pointRadius: 0,
        pointHitRadius: 4,
      })),
    };

    // Total energy per circuit
    const totalBarCfg = {
      labels: selArr.map(id => (CIRCUIT_LABELS[id] || id).slice(0, 10)),
      datasets: [{
        data: selArr.map(id => {
          const records = dataMap[id] || [];
          return records.reduce((s, r) => s + (r.value ?? 0), 0);
        }),
        backgroundColor: selArr.map(id => hexToRgba(CIRCUIT_COLORS[id] || "#888", 0.45)),
        borderColor: selArr.map(id => CIRCUIT_COLORS[id] || "#888"),
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 24,
      }],
    };

    // Weekday vs Weekend per circuit
    const wdweData = selArr.map(id => {
      const records = dataMap[id] || [];
      const dayMap = new Map();
      records.forEach(r => {
        const dk = r.ts_5min.slice(0, 10);
        dayMap.set(dk, (dayMap.get(dk) || 0) + (r.value ?? 0));
      });
      let wdS = 0, wdN = 0, weS = 0, weN = 0;
      dayMap.forEach((total, dk) => {
        const dow = new Date(dk).getDay();
        if (dow === 0 || dow === 6) { weS += total; weN++; }
        else { wdS += total; wdN++; }
      });
      return {
        id,
        weekdayAvg: wdN ? wdS / wdN : 0,
        weekendAvg: weN ? weS / weN : 0,
      };
    });

    const weekdayCfg = {
      labels: selArr.map(id => (CIRCUIT_LABELS[id]||id).slice(0, 8)),
      datasets: [
        {
          label: "Weekday avg",
          data: wdweData.map(d => d.weekdayAvg),
          backgroundColor: "rgba(34,197,94,0.4)",
          borderColor: "#22C55E",
          borderWidth: 1, borderRadius: 2, maxBarThickness: 18,
        },
        {
          label: "Weekend avg",
          data: wdweData.map(d => d.weekendAvg),
          backgroundColor: "rgba(168,85,247,0.4)",
          borderColor: "#A855F7",
          borderWidth: 1, borderRadius: 2, maxBarThickness: 18,
        },
      ],
    };

    return { overlayCfg, totalBarCfg, weekdayCfg };
  }, [selected, dataMap]);

  return (
    <>
      {/* Back + header */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
        <button onClick={onBack} style={{
          background:"none", border:"none", cursor:"pointer",
          color:"#64748B", fontSize:14, fontFamily:FONT, padding:"2px 4px",
        }}>←</button>
        <span style={{ fontSize:13, fontWeight:700, color:"#A5B4FC", fontFamily:FONT }}>Compare circuits</span>
      </div>

      {/* Range */}
      <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
        {RANGE_OPTIONS.map(r => (
          <Btn key={r.value}
            onClick={() => setRangeDays(r.value)}
            active={rangeDays === r.value}
            small
          >{r.label}</Btn>
        ))}
      </div>

      {/* Circuit toggles */}
      <SL>Select circuits</SL>
      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:10 }}>
        {allIds.map(id => {
          const on = selected.has(id);
          return (
            <button key={id}
              onClick={() => toggle(id)}
              style={{
                fontSize:9, fontWeight:600, fontFamily:FONT,
                padding:"3px 6px", borderRadius:4, cursor:"pointer",
                border: on ? `1px solid ${CIRCUIT_COLORS[id]}` : "1px solid rgba(255,255,255,0.1)",
                background: on ? hexToRgba(CIRCUIT_COLORS[id], 0.15) : "rgba(255,255,255,0.04)",
                color: on ? CIRCUIT_COLORS[id] : "#64748B",
                transition: "all 0.15s",
              }}
            >
              {(CIRCUIT_LABELS[id]||id).slice(0,10)}
            </button>
          );
        })}
      </div>

      {loading && <EmptyState msg="Loading comparison data…"/>}

      {!loading && selected.size > 0 && (
        <>
          {/* Overlay timeseries */}
          <SL>Power overlay</SL>
          <div style={{ height:110, marginBottom:10 }}>
            <Line
              data={overlayCfg}
              options={{
                ...CHART_OPTS,
                plugins: {
                  ...CHART_OPTS.plugins,
                  legend: {
                    display: true,
                    position: "bottom",
                    labels: { color: "#94A3B8", font: { size: 8 }, boxWidth: 10, padding: 6 },
                  },
                },
                scales: {
                  ...CHART_OPTS.scales,
                  x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 5 } },
                },
              }}
            />
          </div>

          {/* Total energy per circuit */}
          <SL>Total energy</SL>
          <div style={{ height:80, marginBottom:10 }}>
            <Bar
              data={totalBarCfg}
              options={CHART_OPTS}
            />
          </div>

          {/* Weekday vs Weekend grouped */}
          <SL>Weekday vs weekend</SL>
          <div style={{ height:90, marginBottom:10 }}>
            <Bar
              data={weekdayCfg}
              options={{
                ...CHART_OPTS,
                plugins: {
                  ...CHART_OPTS.plugins,
                  legend: {
                    display: true,
                    position: "bottom",
                    labels: { color: "#94A3B8", font: { size: 8 }, boxWidth: 10, padding: 6 },
                  },
                },
              }}
            />
          </div>
        </>
      )}
    </>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — orchestrates the three views
// ═══════════════════════════════════════════════════════════════════════════════

export default function ITView({ replayData }) {
  // "list" | { circuit: string } | "compare"
  const [view, setView] = useState("list");

  if (view === "compare") {
    return <CompareView replayData={replayData} onBack={() => setView("list")}/>;
  }

  if (typeof view === "object" && view.circuit) {
    return (
      <CircuitDetailView
        circuitId={view.circuit}
        replayData={replayData}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <CircuitListView
      replayData={replayData}
      onSelect={(id) => setView({ circuit: id })}
      onCompare={() => setView("compare")}
    />
  );
}
