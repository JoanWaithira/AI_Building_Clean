import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FONT, CIRCUIT_COLORS, CIRCUIT_LABELS,
  computeBaseline, circuitStats, fmtW, dispatchCmd, buildCircuitHistoryRows, buildCircuitHistoryMap,
} from "./roleHelpers.js";
import { Btn, SL, Pill, BarChart, EmptyState, Hr } from "./panelUI.jsx";
import {
  MOCK_ROOM_DATA,
  fetchLatestRoomTelemetry, fetchRoomHistory,
  toReplayRoomKey,
} from "../utils/roomDataUtils.js";
import { fetchElectricityForCircuits } from "../services/gateBuildingRepository.js";
import { fetchLocalShortTermForecasts } from '../services/supabaseForecastService';
import { toSofiaDateString } from "../utils/timeUtils.js";
import MaintenanceCalendar from "./MaintenanceCalendar.jsx";
import BaselineCalibration from "./BaselineCalibration.jsx";

import {
  Chart as ChartJS,
  LineElement, BarElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

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
    console.warn("[Facilities] Gate API circuit history failed:", e.message);
    return [];
  }
}

const RANGE_OPTIONS = [
  { label: "24 h", value: 1 },
  { label: "48 h", value: 2 },
  { label: "7 d", value: 7 },
  { label: "30 d", value: 30 },
];

const FORECAST_API_BASE = String(import.meta.env.VITE_FORECAST_API_BASE || "https://gate-forecast-api.onrender.com").replace(/\/+$/, "");

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

function fallbackMeterForCircuit(circuitId, circuitLabel) {
  const candidates = candidateMetersForCircuit(circuitId, circuitLabel);
  return candidates.length ? String(candidates[0]) : "";
}

function hasKnownForecastMapping(circuitId, circuitLabel, meters) {
  if (resolveMeterForCircuit(circuitId, circuitLabel, meters)) return true;
  if (Array.isArray(meters) && meters.length) return false;
  return Boolean(fallbackMeterForCircuit(circuitId, circuitLabel));
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
      console.log(`[Facilities] Trying main forecast API (${url})`);
      res = await fetchWithTimeout(url, 7000);
      if (res.ok) {
        const data = await res.json();
        const count = Array.isArray(data?.data) ? data.data.length : 0;
        console.log(`[Facilities] Main forecast API succeeded, got ${count} records from ${data?.source || "unknown"}`);
        if (count > 0) return data;
        console.warn("[Facilities] Main forecast API returned no rows, trying legacy CSV endpoint");
      }
    } catch (err) {
      console.warn(`[Facilities] Main forecast API failed (${url}):`, err.message);
    }

    try {
      console.log(`[Facilities] Trying legacy CSV endpoint (${csvUrl})`);
      res = await fetch(csvUrl, { method: "GET", headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        const count = Array.isArray(data?.data) ? data.data.length : 0;
        console.log(`[Facilities] Legacy CSV endpoint succeeded, got ${count} records`);
        return { ...data, source: data?.source || "csv" };
      }
      console.warn(`[Facilities] Legacy CSV endpoint returned ${res.status}`);
    } catch (err) {
      console.warn(`[Facilities] Legacy CSV endpoint failed (${csvUrl}):`, err.message);
    }

    return { data: [], source: null };
  }

  try {
    res = await fetchWithTimeout(url, 7000);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn(`[Facilities] Main API failed (${url}):`, err.message);
  }

  return {};
}

function forecastSourceLabel(source) {
  if (source === "supabase") return "Supabase forecast (local/short)";
  if (source === "database") return "Database forecast (local/short)";
  if (source === "csv") return "CSV fallback forecast (local/short)";
  return "Pattern-based fallback";
}

function dateFmt(iso) {
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayFmt(iso) {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getMonth()+1}/${d.getDate()}`;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "rgba(10,18,32,0.95)", titleColor: "#94A3B8",
      bodyColor: "#E2F1FF", borderColor: "rgba(96,165,250,0.3)",
      borderWidth: 1, padding: 8, titleFont: { size: 10 }, bodyFont: { size: 11 },
    },
  },
  scales: {
    x: { grid: { color: "rgba(96,165,250,0.06)" }, ticks: { color: "#64748B", font: { size: 8 }, maxTicksLimit: 8 }, border: { color: "rgba(96,165,250,0.15)" } },
    y: { grid: { color: "rgba(96,165,250,0.06)" }, ticks: { color: "#64748B", font: { size: 8 }, maxTicksLimit: 6 }, border: { color: "rgba(96,165,250,0.15)" }, beginAtZero: true },
  },
};

function chartLine(labels, data, color, label) {
  return { labels, datasets: [{ label, data, borderColor: color, backgroundColor: hexToRgba(color, 0.12), borderWidth: 1.5, tension: 0.35, fill: true, pointRadius: 0, pointHitRadius: 6 }] };
}

function chartBar(labels, data, color, label) {
  return { labels, datasets: [{ label, data, backgroundColor: hexToRgba(color, 0.45), borderColor: color, borderWidth: 1, borderRadius: 3, maxBarThickness: 18 }] };
}

function SectionHeader({ icon, title, color = "#7DD3FC" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 0 4px", marginTop: 4,
      borderBottom: `1px solid ${hexToRgba(color, 0.2)}`,
      marginBottom: 8,
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: FONT }}>{title}</span>
    </div>
  );
}

function InsightCard({ icon, text, detail, level = "info" }) {
  const colors = {
    info: { bg: "rgba(37,99,235,0.08)", border: "rgba(96,165,250,0.25)", text: "#93C5FD", icon: "#60A5FA" },
    warn: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.25)", text: "#FDE68A", icon: "#FBBF24" },
    good: { bg: "rgba(74,222,128,0.08)", border: "rgba(74,222,128,0.25)", text: "#86EFAC", icon: "#4ADE80" },
    bad:  { bg: "rgba(239,68,68,0.08)", border: "rgba(248,113,113,0.25)", text: "#FCA5A5", icon: "#F87171" },
  };
  const c = colors[level] || colors.info;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 7, padding: "6px 9px", marginBottom: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: c.text, fontFamily: FONT }}>
        <span style={{ color: c.icon, marginRight: 4 }}>{icon}</span>{text}
      </div>
      {detail && <div style={{ fontSize: 9, color: "#9AB8D7", marginTop: 2, fontFamily: FONT }}>{detail}</div>}
    </div>
  );
}

function generateInsights(stats, circuitId, rangeDays) {
  if (!stats) return [];
  const insights = [];
  const label = CIRCUIT_LABELS[circuitId] || circuitId;

  if (stats.hourly?.length) {
    const peakH = stats.hourly.reduce((best, h) => h.avg > best.avg ? h : best, stats.hourly[0]);
    insights.push({
      icon: "⏰", level: "info",
      text: `Peak usage forecast around ${peakH.hour}:00`,
      detail: `Average ${fmtW(peakH.avg)} during this hour`,
    });
  }

  if (stats.hourly?.length) {
    const eveningAvg = stats.hourly.filter(h => h.hour >= 18 && h.hour <= 23).reduce((s, h) => s + h.avg, 0) / 6;
    const dayAvg = stats.hourly.filter(h => h.hour >= 8 && h.hour <= 17).reduce((s, h) => s + h.avg, 0) / 10;
    if (dayAvg > 0 && eveningAvg < dayAvg * 0.6) {
      const dropPct = ((1 - eveningAvg / dayAvg) * 100).toFixed(0);
      insights.push({
        icon: "📉", level: "good",
        text: `Energy drops ${dropPct}% in evening hours`,
        detail: "Demand expected to decrease after 18:00",
      });
    }
  }

  if (stats.workAvg > 0 && stats.offAvg > 0) {
    const ratio = (stats.offAvg / stats.workAvg) * 100;
    if (ratio > 60) {
      insights.push({ icon: "🌙", level: "bad", text: `Off-hours consumption is ${ratio.toFixed(0)}% of working hours`, detail: "Consider implementing auto-shutoff schedules" });
    } else if (ratio > 30) {
      insights.push({ icon: "🌙", level: "warn", text: `Off-hours consumption at ${ratio.toFixed(0)}% of working hours`, detail: "Moderate standby load — review overnight equipment" });
    } else {
      insights.push({ icon: "✅", level: "good", text: `Off-hours consumption is low at ${ratio.toFixed(0)}%`, detail: "Good energy management outside working hours" });
    }
  }

  if (stats.daily?.length >= 4) {
    const half = Math.floor(stats.daily.length / 2);
    const firstHalf = stats.daily.slice(0, half);
    const secondHalf = stats.daily.slice(half);
    const firstAvg = firstHalf.reduce((s, d) => s + d.total, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, d) => s + d.total, 0) / secondHalf.length;
    if (firstAvg > 0) {
      const changePct = ((secondAvg - firstAvg) / firstAvg * 100).toFixed(0);
      if (Math.abs(changePct) > 5) {
        insights.push({
          icon: changePct > 0 ? "📈" : "📉",
          level: changePct > 15 ? "warn" : changePct < -10 ? "good" : "info",
          text: `Energy consumption ${changePct > 0 ? "increased" : "decreased"} by ~${Math.abs(changePct)}%`,
          detail: `Comparing recent ${secondHalf.length} days vs prior ${firstHalf.length} days`,
        });
      }
    }
  }

  if (stats.currentVal > 0 && stats.avgVal > 0) {
    const deviation = ((stats.currentVal - stats.avgVal) / stats.avgVal * 100).toFixed(0);
    if (deviation > 40) {
      insights.push({ icon: "⚠️", level: "bad", text: `Currently ${deviation}% above average for ${label}`, detail: `Now: ${fmtW(stats.currentVal)} vs avg: ${fmtW(stats.avgVal)}` });
    } else if (deviation < -30) {
      insights.push({ icon: "💤", level: "info", text: `Currently ${Math.abs(deviation)}% below average`, detail: `Now: ${fmtW(stats.currentVal)} vs avg: ${fmtW(stats.avgVal)}` });
    }
  }

  if (rangeDays >= 7 && stats.weekdayAvg != null && stats.weekendAvg != null && stats.weekdayAvg > 0) {
    const weekendRatio = ((stats.weekendAvg / stats.weekdayAvg) * 100).toFixed(0);
    if (weekendRatio > 70) {
      insights.push({ icon: "📅", level: "warn", text: `Weekend usage is ${weekendRatio}% of weekday levels`, detail: "High weekend consumption — check if equipment is being left on" });
    }
  }

  return insights;
}
// generating forecasts and insights based on historical stats for a specific circuit and time range

function generateForecast(stats) {
  if (!stats?.hourly?.length) return null;
  const trendFactor = stats.daily?.length >= 2
    ? stats.daily[stats.daily.length - 1].total / (stats.daily[stats.daily.length - 2].total || 1)
    : 1;
  const clampedTrend = Math.max(0.7, Math.min(1.3, trendFactor));

  const forecast = stats.hourly.map(h => ({
    hour: h.hour,
    predicted: Math.round(h.avg * clampedTrend),
    baseline: Math.round(h.avg),
  }));

  const peakH = forecast.reduce((best, f) => f.predicted > best.predicted ? f : best, forecast[0]);
  const minH = forecast.reduce((best, f) => f.predicted < best.predicted ? f : best, forecast[0]);
  const totalPredicted = forecast.reduce((s, f) => s + f.predicted, 0);
  const totalBaseline = forecast.reduce((s, f) => s + f.baseline, 0);
  const changePct = totalBaseline > 0 ? ((totalPredicted - totalBaseline) / totalBaseline * 100).toFixed(1) : 0;

  return { forecast, peakHour: peakH.hour, minHour: minH.hour, peakWatts: peakH.predicted, changePct };
}

function generateForecastFromRows(rows, stats) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const byHourBaseline = new Map((stats?.hourly || []).map((h) => [h.hour, Math.round(h.avg || 0)]));

  const forecast = rows
    .map((r) => {
      const ts = new Date(r.forecast_timestamp ?? r.timestamp);
      const predicted = Math.round(Number(r.forecast_value ?? r.prediction ?? r.predicted_value ?? 0));
      if (!Number.isFinite(ts.getTime()) || !Number.isFinite(predicted)) return null;
      const hour = ts.getHours();
      return {
        hour,
        label: `${hour}:00`,
        predicted,
        baseline: byHourBaseline.get(hour) ?? Math.round(stats?.avgVal || predicted),
      };
    })
    .filter(Boolean)
    .slice(0, 24);

  if (!forecast.length) return null;

  const peakH = forecast.reduce((best, f) => (f.predicted > best.predicted ? f : best), forecast[0]);
  const minH = forecast.reduce((best, f) => (f.predicted < best.predicted ? f : best), forecast[0]);
  const totalPredicted = forecast.reduce((s, f) => s + f.predicted, 0);
  const totalBaseline = forecast.reduce((s, f) => s + f.baseline, 0);
  const changePct = totalBaseline > 0 ? ((totalPredicted - totalBaseline) / totalBaseline * 100).toFixed(1) : 0;

  return { forecast, peakHour: peakH.hour, minHour: minH.hour, peakWatts: peakH.predicted, changePct, source: "table" };
}

// Main overview dashboard combining current circuit status, after-hours waste analysis, room monitoring access, forecast insights, and quick action buttons for facilities management tasks.

function OverviewView({ replayData, onSelectCircuit, onSelectRoom, onCompare, onOpenTasks, onOpenBaselines }) {
  const baseline = computeBaseline(replayData, 0.22);
  const latestFrame = (id) => { const f = replayData[id] || []; return f[f.length - 1] || f[0] || { watts: 0 }; };
  const evW = (latestFrame("vehiclecharging1").watts || 0) + (latestFrame("vehiclecharging2").watts || 0);

  const circuitIds = Object.keys(CIRCUIT_COLORS);

  const wasteItems = circuitIds.filter(id => id !== "main").map(id => {
    const f = replayData[id] || [];
    const afterF = f.filter(fr => fr.hour >= 20 || fr.hour < 7);
    const afterW = afterF.length ? afterF.reduce((s, fr) => s + fr.watts, 0) / afterF.length : 0;
    return { label: CIRCUIT_LABELS[id] || id, value: afterW, color: afterW > 2000 ? "#EF4444" : afterW > 500 ? "#FBBF24" : "#4ADE80" };
  }).filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
  const maxWaste = Math.max(...wasteItems.map(x => x.value), 1);

  return (
    <>
      <SectionHeader icon="⚡" title="Circuit Status" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 10 }}>
        {circuitIds.filter(id => id !== "main").map(id => {
          const s = circuitStats(replayData, id);
          const loadPct = s.peak > 0 ? s.current / s.peak : 0;
          const dot = loadPct > 0.9 ? "#EF4444" : loadPct > 0.75 ? "#FBBF24" : "#4ADE80";
          return (
            <div key={id} onClick={() => { dispatchCmd("zoom_to_circuit", { circuit_id: id }); onSelectCircuit(id); }}
              style={{ background: "rgba(15,23,42,0.85)", border: "1px solid rgba(125,211,252,0.1)", borderRadius: 6, padding: "5px 6px", cursor: "pointer", transition: "border-color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(125,211,252,0.4)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(125,211,252,0.1)"}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: dot, marginBottom: 3, boxShadow: `0 0 4px ${dot}` }} />
              <div style={{ fontSize: 8, color: "#9AB8D7", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(CIRCUIT_LABELS[id] || id).slice(0, 10)}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#E2F1FF" }}>{fmtW(s.current)}</div>
            </div>
          );
        })}
      </div>

      <SectionHeader icon="🌙" title="After-Hours Waste" />
      {wasteItems.length ? <BarChart items={wasteItems} maxVal={maxWaste} /> : <EmptyState />}

      <Hr />
      <SectionHeader icon="🏠" title="Room Monitor" />
      <Btn full onClick={onSelectRoom} accent>🏠 Live room conditions</Btn>

      <SectionHeader icon="💻" title="IT / Technical" color="#60A5FA" />
      <Btn full onClick={onCompare} accent>🔀 Compare circuits</Btn>

      <SectionHeader icon="🛠" title="Quick Actions" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <Btn onClick={() => dispatchCmd("show_sensor_markers", { sensor_type: "all" })}>📡 Sensors</Btn>
        <Btn onClick={() => dispatchCmd("reset_view")}>↺ Reset view</Btn>
        <Btn onClick={onSelectRoom} accent>🏠 Rooms</Btn>
      </div>
      <SectionHeader icon="📋" title="Operations" color="#FBBF24" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <Btn onClick={onOpenTasks}  accent>🛠 Work Orders</Btn>
        <Btn onClick={onOpenBaselines}>⚙ Baselines</Btn>
      </div>
    </>
  );
}

// ═

const SECTION_TABS = [
  { id: "historical", icon: "📊", label: "Historical" },
  { id: "forecast",   icon: "🔮", label: "Forecast" },
  { id: "insights",   icon: "💡", label: "Insights" },
];

function CircuitDetailView({ circuitId, replayData, onBack }) {
  const [rangeDays, setRangeDays] = useState(7);
  const [raw, setRaw] = useState([]);
  const [forecastRows, setForecastRows] = useState([]);
  const [forecastSource, setForecastSource] = useState("synthetic");
  const [meters, setMeters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState("historical");
  const color = CIRCUIT_COLORS[circuitId] || "#60A5FA";
  const label = CIRCUIT_LABELS[circuitId] || circuitId;
  const resolvedMeter = useMemo(() => resolveMeterForCircuit(circuitId, label, meters), [circuitId, label, meters]);
  const fallbackMeter = useMemo(() => fallbackMeterForCircuit(circuitId, label), [circuitId, label]);
  const requestMeter = useMemo(
    () => resolvedMeter || (meters.length ? "" : fallbackMeter),
    [resolvedMeter, meters, fallbackMeter]
  );
  const hasForecastMapping = useMemo(
    () => hasKnownForecastMapping(circuitId, label, meters),
    [circuitId, label, meters]
  );

  useEffect(() => { dispatchCmd("zoom_to_circuit", { circuit_id: circuitId }); }, [circuitId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await forecastGetJson("/meters");
        if (!cancelled) {
          setMeters(Array.isArray(data?.meters) ? data.meters : []);
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[Facilities] failed to load forecast meters:", e);
          setMeters([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const data = await fetchGateCircuitHistory(circuitId, rangeDays);
        if (!cancelled) {
          setRaw(data.length ? data : buildCircuitHistoryRows(circuitId, rangeDays, replayData));
        }
      } catch (e) {
        if (!cancelled) setRaw(buildCircuitHistoryRows(circuitId, rangeDays, replayData));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [circuitId, rangeDays, replayData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!hasForecastMapping || !requestMeter) {
          if (!cancelled) {
            setForecastRows([]);
            setForecastSource("synthetic");
          }
          return;
        }
        const rows = await fetchLocalShortTermForecasts(requestMeter);
        if (cancelled) return;
        setForecastRows(rows);
        setForecastSource(rows.length ? "supabase" : "synthetic");
      } catch (e) {
        if (!cancelled) {
          console.warn("[Facilities] forecast fetch failed:", e);
          setForecastRows([]);
          setForecastSource("synthetic");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [hasForecastMapping, requestMeter]);

  const stats = useMemo(() => {
    if (!raw.length) return null;
    const vals = raw.map(r => r.value ?? 0);
    const currentVal = vals[vals.length - 1], peakVal = Math.max(...vals);
    const avgVal = vals.reduce((a, b) => a + b, 0) / vals.length;

    const step = Math.max(1, Math.floor(raw.length / 200));
    const tsLabels = [], tsData = [];
    for (let i = 0; i < raw.length; i += step) { tsLabels.push(dateFmt(raw[i].ts_5min)); tsData.push(raw[i].value ?? 0); }

    const hourMap = new Map();
    raw.forEach(r => { const h = new Date(r.ts_5min).getHours(); const p = hourMap.get(h) || { sum: 0, count: 0 }; p.sum += r.value ?? 0; p.count++; hourMap.set(h, p); });
    const hourly = Array.from({ length: 24 }, (_, h) => { const e = hourMap.get(h); return { hour: h, avg: e ? e.sum / e.count : 0 }; });

    const dayMap = new Map();
    raw.forEach(r => { const dk = r.ts_5min.slice(0, 10); dayMap.set(dk, (dayMap.get(dk) || 0) + (r.value ?? 0)); });
    const daily = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, total]) => ({ day, total }));

    let workSum = 0, workN = 0, offSum = 0, offN = 0;
    let weekdaySum = 0, weekdayN = 0, weekendSum = 0, weekendN = 0;
    raw.forEach(r => {
      const dt = new Date(r.ts_5min); const dow = dt.getDay(); const h = dt.getHours(); const val = r.value ?? 0;
      if (dow >= 1 && dow <= 5 && h >= 8 && h <= 17) { workSum += val; workN++; } else { offSum += val; offN++; }
      if (dow >= 1 && dow <= 5) { weekdaySum += val; weekdayN++; } else { weekendSum += val; weekendN++; }
    });

    const peaks = [...raw].filter(r => typeof r.value === "number").sort((a, b) => b.value - a.value).slice(0, 5).map(r => ({ ts: r.ts_5min, value: r.value }));

    const weekMap = new Map();
    raw.forEach(r => {
      const d = new Date(r.ts_5min);
      const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
      const wk = weekStart.toISOString().slice(0, 10);
      weekMap.set(wk, (weekMap.get(wk) || 0) + (r.value ?? 0));
    });
    const weekly = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, total]) => ({ week, total }));

    return {
      currentVal, peakVal, avgVal, tsLabels, tsData, hourly, daily, weekly,
      workAvg: workN ? workSum / workN : 0, offAvg: offN ? offSum / offN : 0,
      weekdayAvg: weekdayN ? weekdaySum / weekdayN : 0,
      weekendAvg: weekendN ? weekendSum / weekendN : 0,
      peaks, totalRecords: raw.length,
    };
  }, [raw]);

  const liveStats = circuitStats(replayData, circuitId);
  const wasteRatio = stats ? (stats.offAvg > 0 && stats.workAvg > 0 ? ((stats.offAvg / stats.workAvg) * 100).toFixed(0) : "—") : "—";
  const insights = useMemo(() => generateInsights(stats, circuitId, rangeDays), [stats, circuitId, rangeDays]);
  const forecast = useMemo(() => {
    const fromTable = generateForecastFromRows(forecastRows, stats);
    return fromTable || generateForecast(stats);
  }, [forecastRows, stats]);

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B", fontSize: 14, fontFamily: FONT, padding: "2px 4px" }}>←</button>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: FONT, flex: 1 }}>{label}</span>
        <span style={{ fontSize: 9, color: "#64748B" }}>Live: {fmtW(liveStats.current)}</span>
      </div>

      {/* KPI strip */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
          <Pill label="Now" value={fmtW(stats.currentVal)} color={color} />
          <Pill label="Peak" value={fmtW(stats.peakVal)} color="#F87171" />
          <Pill label="Avg" value={fmtW(stats.avgVal)} color="#94A3B8" />
          <Pill label="Waste" value={`${wasteRatio}%`} color={Number(wasteRatio) > 50 ? "#EF4444" : "#4ADE80"} />
        </div>
      )}

      {/* Range selector */}
      <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
        {RANGE_OPTIONS.map(r => <Btn key={r.value} onClick={() => setRangeDays(r.value)} active={rangeDays === r.value} small>{r.label}</Btn>)}
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 8, borderBottom: "1px solid rgba(125,211,252,0.1)", paddingBottom: 6 }}>
        {SECTION_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveSection(tab.id)} style={{
            flex: 1, padding: "5px 0", borderRadius: "6px 6px 0 0", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: FONT,
            border: "none", borderBottom: activeSection === tab.id ? `2px solid ${color}` : "2px solid transparent",
            background: activeSection === tab.id ? hexToRgba(color, 0.12) : "transparent",
            color: activeSection === tab.id ? "#E2F1FF" : "#64748B",
            transition: "all 0.15s",
          }}>{tab.icon} {tab.label}</button>
        ))}
      </div>

      {loading && <EmptyState msg="Loading circuit data…" />}
      {error && <EmptyState msg={`Error: ${error}`} />}
      {!loading && !error && !stats && <EmptyState msg="No data for this circuit" />}

      {stats && activeSection === "historical" && (
        <>
          <SectionHeader icon="📈" title="Power Trend" color={color} />
          <div style={{ height: 100, marginBottom: 10 }}>
            <Line data={chartLine(stats.tsLabels, stats.tsData, color, "Power (W)")} options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 5 } } } }} />
          </div>

          {stats.daily.length > 1 && (
            <>
              <SectionHeader icon="📅" title="Daily Energy" color="#2563EB" />
              <div style={{ height: 90, marginBottom: 10 }}>
                <Bar data={chartBar(stats.daily.map(d => dayFmt(d.day)), stats.daily.map(d => d.total), "#2563EB", "Daily Wh")} options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 7 } } } }} />
              </div>
            </>
          )}

          {stats.weekly.length > 1 && rangeDays >= 14 && (
            <>
              <SectionHeader icon="📆" title="Weekly Totals" color="#7C3AED" />
              <div style={{ height: 80, marginBottom: 10 }}>
                <Bar data={chartBar(stats.weekly.map(w => `Wk ${w.week.slice(5)}`), stats.weekly.map(w => w.total), "#7C3AED", "Weekly Wh")} options={CHART_OPTS} />
              </div>
            </>
          )}

          <SectionHeader icon="🕐" title="Hourly Profile" color={color} />
          <div style={{ height: 80, marginBottom: 10 }}>
            <Bar data={chartBar(stats.hourly.map(h => `${h.hour}h`), stats.hourly.map(h => h.avg), color, "Avg W")} options={CHART_OPTS} />
          </div>

          <SectionHeader icon="⏱" title="Working vs Off-Hours" color="#34D399" />
          <div style={{ height: 65, marginBottom: 10 }}>
            <Bar data={{ labels: ["Working (M-F 8-17)", "Off-hours"], datasets: [{ data: [stats.workAvg, stats.offAvg], backgroundColor: ["rgba(52,211,153,0.45)", "rgba(239,68,68,0.45)"], borderColor: ["#34D399", "#EF4444"], borderWidth: 1, borderRadius: 3, maxBarThickness: 32 }] }} options={CHART_OPTS} />
          </div>

          <SectionHeader icon="🏆" title="Peak Demand (Top 5)" />
          <div style={{ marginBottom: 6 }}>
            {stats.peaks.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 10, fontFamily: FONT }}>
                <span style={{ color: "#64748B", width: 16 }}>#{i + 1}</span>
                <span style={{ color: "#E2F1FF", fontWeight: 600, flex: 1 }}>{fmtW(p.value)}</span>
                <span style={{ color: "#475569", fontSize: 9 }}>{dateFmt(p.ts)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {stats && activeSection === "forecast" && (
        <>
          {forecast ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
                <Pill label="Peak hour" value={`${forecast.peakHour}:00`} color="#F87171" />
                <Pill label="Peak (W)" value={fmtW(forecast.peakWatts)} color="#FBBF24" />
                <Pill label="Trend" value={`${forecast.changePct > 0 ? "+" : ""}${forecast.changePct}%`} color={forecast.changePct > 5 ? "#F87171" : forecast.changePct < -5 ? "#4ADE80" : "#94A3B8"} />
              </div>

              <div style={{ fontSize: 9, color: "#9AB8D7", marginBottom: 8 }}>
                Source: {forecastSourceLabel(forecastSource)}
              </div>

              <SectionHeader icon="🔮" title="24h Forecast" color="#A78BFA" />
              <div style={{ height: 100, marginBottom: 10 }}>
                <Line data={{
                  labels: forecast.forecast.map(f => f.label || `${f.hour}:00`),
                  datasets: [
                    { label: "Forecast", data: forecast.forecast.map(f => f.predicted), borderColor: "#A78BFA", backgroundColor: hexToRgba("#A78BFA", 0.12), borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0, pointHitRadius: 6 },
                    { label: "Baseline", data: forecast.forecast.map(f => f.baseline), borderColor: "#475569", backgroundColor: "transparent", borderWidth: 1, borderDash: [4, 3], tension: 0.4, fill: false, pointRadius: 0, pointHitRadius: 6 },
                  ],
                }} options={{
                  ...CHART_OPTS,
                  plugins: { ...CHART_OPTS.plugins, legend: { display: true, position: "top", labels: { color: "#94A3B8", font: { size: 9 }, boxWidth: 12, padding: 6 } } },
                  scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 8 } } },
                }} />
              </div>

              <SectionHeader icon="🎯" title="Forecast Highlights" color="#FBBF24" />
              <InsightCard icon="⏰" text={`Peak demand expected at ${forecast.peakHour}:00`} detail={`Forecast: ${fmtW(forecast.peakWatts)}`} level="warn" />
              <InsightCard icon="💤" text={`Lowest demand expected at ${forecast.minHour}:00`} detail="Good window for maintenance activities" level="good" />
              {Math.abs(forecast.changePct) > 5 && (
                <InsightCard
                  icon={forecast.changePct > 0 ? "📈" : "📉"}
                  text={`Energy ${forecast.changePct > 0 ? "increase" : "decrease"} of ~${Math.abs(forecast.changePct)}% expected`}
                  detail="Based on recent daily trend analysis"
                  level={forecast.changePct > 10 ? "warn" : "info"}
                />
              )}
            </>
          ) : (
            <EmptyState msg="Not enough data to generate forecast" />
          )}
        </>
      )}

      {stats && activeSection === "insights" && (
        <>
          <SectionHeader icon="💡" title="Key Observations" color="#FBBF24" />
          {insights.length ? (
            insights.map((ins, i) => <InsightCard key={i} {...ins} />)
          ) : (
            <EmptyState msg="No notable patterns detected" />
          )}

          <SectionHeader icon="📊" title="Circuit Summary" />
          <div style={{ background: "rgba(15,23,42,0.85)", border: "1px solid rgba(125,211,252,0.1)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 6, fontFamily: FONT }}>
              Analysis based on {stats.totalRecords.toLocaleString()} readings over {rangeDays} day{rangeDays > 1 ? "s" : ""}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div>
                <div style={{ fontSize: 8, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Working hours avg</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#34D399" }}>{fmtW(stats.workAvg)}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Off-hours avg</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#F87171" }}>{fmtW(stats.offAvg)}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Weekday avg</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#60A5FA" }}>{fmtW(stats.weekdayAvg)}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Weekend avg</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#FBBF24" }}>{fmtW(stats.weekendAvg)}</div>
              </div>
            </div>
          </div>

          <SectionHeader icon="🛠" title="Recommendations" color="#34D399" />
          {stats.offAvg > stats.workAvg * 0.4 && (
            <InsightCard icon="💡" text="Schedule circuit auto-shutoff after 20:00" detail={`Could save ~${fmtW(stats.offAvg * 0.5)} average off-hours`} level="info" />
          )}
          {stats.peakVal > stats.avgVal * 3 && (
            <InsightCard icon="⚡" text="Investigate peak demand spikes" detail={`Peak (${fmtW(stats.peakVal)}) is ${(stats.peakVal / stats.avgVal).toFixed(1)}× the average`} level="warn" />
          )}
          {stats.weekendAvg > stats.weekdayAvg * 0.5 && rangeDays >= 7 && (
            <InsightCard icon="📅" text="Review weekend equipment schedules" detail="Significant weekend energy use detected" level="warn" />
          )}
          {insights.length === 0 && stats.offAvg <= stats.workAvg * 0.4 && stats.peakVal <= stats.avgVal * 3 && (
            <InsightCard icon="✅" text="No immediate actions required" detail="Energy patterns look healthy for this circuit" level="good" />
          )}
        </>
      )}
    </>
  );
}

// Room monitoring view with live telemetry and historical trends for temperature, humidity, and CO2 levels, accessible from the main dashboard and integrated with BMS data where available.

const METRIC_CFG = {
  temperature: { label: "Temperature", unit: "°C", icon: "🌡️", good: [20, 24], color: "#F97316" },
  humidity:    { label: "Humidity",    unit: "%",  icon: "💧", good: [30, 60], color: "#3B82F6" },
  co2:         { label: "CO₂",        unit: "ppm", icon: "🌬️", good: [0, 800], color: "#10B981" },
};

function metricStatus(key, val) {
  if (val == null) return { color: "#475569", tag: "—" };
  const cfg = METRIC_CFG[key];
  if (val < cfg.good[0]) return { color: "#3B82F6", tag: "Low" };
  if (val > cfg.good[1]) return { color: "#EF4444", tag: "High" };
  return { color: "#4ADE80", tag: "OK" };
}

/** Format Gate API reading time for display (wall time in Sofia). */
function formatGateApiDateTime(iso, ms) {
  const d = iso ? new Date(iso) : ms != null ? new Date(ms) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return {
    local: d.toLocaleString("en-GB", {
      timeZone: "Europe/Sofia",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    iso: d.toISOString(),
  };
}

function RoomMonitorView({ availableRooms, onBack }) {
  const monitoredRooms = useMemo(() => (availableRooms?.length ? availableRooms : []), [availableRooms]);

  const [selectedRoom, setSelectedRoom] = useState(() => monitoredRooms[0]?.roomNumber || "");
  const [live, setLive] = useState({
    temperature: null,
    humidity: null,
    co2: null,
    timestampMs: null,
    timestampISO: null,
    temperatureObservedAtMs: null,
    humidityObservedAtMs: null,
    co2ObservedAtMs: null,
  });
  const [history, setHistory] = useState({ temp: [], humidity: [], co2: [] });
  const [loading, setLoading] = useState(false);
  const [histDays, setHistDays] = useState(2);
  const [trendMetric, setTrendMetric] = useState("temperature");

  const roomKey = useMemo(() => toReplayRoomKey(selectedRoom), [selectedRoom]);

  useEffect(() => {
    if (!roomKey) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [liveData, histData] = await Promise.all([
          fetchLatestRoomTelemetry(roomKey),
          fetchRoomHistory(roomKey, histDays, null, { allowSyntheticFallback: false }),
        ]);
        if (!cancelled) { setLive(liveData); setHistory(histData); }
      } catch (e) { console.warn("Room fetch error:", e); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [roomKey, histDays]);

  const meta = MOCK_ROOM_DATA[roomKey] || MOCK_ROOM_DATA[selectedRoom];
  const hasLive = live.temperature != null || live.humidity != null || live.co2 != null;
  const newestSampleFmt = useMemo(
    () => formatGateApiDateTime(live.timestampISO, live.timestampMs),
    [live.timestampISO, live.timestampMs]
  );

  const historyChart = useMemo(() => {
    const seriesKey = trendMetric === "temperature" ? "temp" : trendMetric === "humidity" ? "humidity" : "co2";
    const pts = history?.[seriesKey] || [];
    if (pts.length < 2) return null;
    const step = Math.max(1, Math.floor(pts.length / 120));
    const spanDays = histDays >= 7;
    const labels = [];
    const data = [];
    for (let i = 0; i < pts.length; i += step) {
      const d = new Date(pts[i].t);
      labels.push(
        spanDays
          ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
          : `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
      );
      data.push(pts[i]?.v ?? null);
    }
    return { labels, data, seriesKey };
  }, [history, trendMetric, histDays]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B", fontSize: 14, fontFamily: FONT, padding: "2px 4px" }}>←</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#34D399", fontFamily: FONT }}>Room Monitor</span>
      </div>

      <SL>Select room</SL>
      <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)}
        style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(125,211,252,0.25)", background: "rgba(15,23,42,0.85)", color: "#E2F1FF", fontSize: 11, fontFamily: FONT, marginBottom: 6, outline: "none" }}>
        <option value="" style={{ background: "#1E293B" }}>Select room...</option>
        {monitoredRooms.map(r => (
          <option key={`${r.roomNumber}-${r.floorLevel}`} value={r.roomNumber} style={{ background: "#1E293B" }}>
            {r.roomNumber} — {r.roomName} (F{r.floorLevel})
          </option>
        ))}
      </select>

      {selectedRoom && (
        <Btn full onClick={() => dispatchCmd("zoom_to_room", { room_number: selectedRoom })} style={{ marginBottom: 10 }}>🔍 Zoom to room {selectedRoom}</Btn>
      )}

      {loading && <EmptyState msg="Loading room data…" />}

      {!loading && (
        <>
          {meta && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
              <Pill label="Floor" value={meta.floor} color="#94A3B8" />
              <Pill label="Area" value={`${meta.area} m²`} color="#94A3B8" />
              <Pill label="Capacity" value={meta.occupancy} color="#94A3B8" />
            </div>
          )}

          <SectionHeader icon="📡" title="Live Conditions" color="#34D399" />
          {!hasLive ? (
            <EmptyState msg="No live telemetry available for this room" />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
              {Object.entries(METRIC_CFG).map(([key, cfg]) => {
                const val = live[key];
                const st = metricStatus(key, val);
                const obsMs = key === "temperature"
                  ? live.temperatureObservedAtMs
                  : key === "humidity"
                    ? live.humidityObservedAtMs
                    : live.co2ObservedAtMs;
                const apiTs = obsMs ?? live.timestampMs;
                const apiIso = apiTs != null ? new Date(apiTs).toISOString() : null;
                const apiFmt = formatGateApiDateTime(apiIso, apiTs);
                return (
                  <div key={key} style={{ background: "rgba(15,23,42,0.85)", border: `1px solid ${hexToRgba(st.color, 0.3)}`, borderRadius: 8, padding: "8px 8px 6px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 2 }}>{cfg.icon} {cfg.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: st.color }}>{val != null ? (key === "co2" ? `${Math.round(val)}` : `${val.toFixed(1)}`) : "—"}</div>
                    <div style={{ fontSize: 8, color: "#64748B" }}>{cfg.unit}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: st.color, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{st.tag}</div>
                    {val != null && apiFmt && (
                      <div style={{ fontSize: 7, color: "#475569", marginTop: 6, lineHeight: 1.3 }} title={`Gate API · ${apiFmt.iso}`}>
                        API: {apiFmt.local}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {hasLive && newestSampleFmt && (
            <div style={{ fontSize: 9, color: "#64748B", textAlign: "right", marginBottom: 8 }} title={`Gate API (ISO 8601): ${newestSampleFmt.iso}`}>
              Newest sample in room (all channels): {newestSampleFmt.local} <span style={{ color: "#475569" }}>Sofia</span>
            </div>
          )}

          <SectionHeader icon="📈" title="Trends" />
          <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
            {[{ label: "48 h", value: 2 }, { label: "7 d", value: 7 }, { label: "30 d", value: 30 }].map(r => (
              <Btn key={r.value} onClick={() => setHistDays(r.value)} active={histDays === r.value} small>{r.label}</Btn>
            ))}
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {Object.entries(METRIC_CFG).map(([key, cfg]) => (
              <Btn key={key} onClick={() => setTrendMetric(key)} active={trendMetric === key} small>{cfg.icon} {cfg.label}</Btn>
            ))}
          </div>

          {historyChart ? (
            <div style={{ height: 110, marginBottom: 10 }}>
              <Line
                data={chartLine(historyChart.labels, historyChart.data, METRIC_CFG[trendMetric].color, `${METRIC_CFG[trendMetric].label} (${METRIC_CFG[trendMetric].unit})`)}
                options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit: 6 } } } }}
              />
            </div>
          ) : (
            <EmptyState msg={`No ${METRIC_CFG[trendMetric].label.toLowerCase()} history available`} />
          )}

          {meta?.energy && (
            <>
              <SectionHeader icon="⚡" title="Monthly Energy" color="#FDE68A" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                <Pill label="Lighting" value={`${meta.energy.lighting} kWh`} color="#FDE68A" />
                <Pill label="Plugs" value={`${meta.energy.plugs} kWh`} color="#60A5FA" />
                <Pill label="AC" value={`${meta.energy.ac} kWh`} color="#38BDF8" />
                <Pill label="Total" value={`${meta.energy.total} kWh`} sub={`${meta.energy.perM2} kWh/m²`} color="#E2F1FF" />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// View for comparing historical energy usage across multiple circuits, with options to select circuits, adjust time range, and visualize trends and totals side by side.

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

    const overlayDatasets = selArr.map(id => {
      const records = dataMap[id] || [];
      const step = Math.max(1, Math.floor(records.length / 150));
      const pts = [], labels = [];
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
      return { id, weekdayAvg: wdN ? wdS / wdN : 0, weekendAvg: weN ? weS / weN : 0 };
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
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
        <button onClick={onBack} style={{
          background:"none", border:"none", cursor:"pointer",
          color:"#64748B", fontSize:14, fontFamily:FONT, padding:"2px 4px",
        }}>←</button>
        <span style={{ fontSize:13, fontWeight:700, color:"#60A5FA", fontFamily:FONT }}>💻 Compare circuits</span>
      </div>

      <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
        {RANGE_OPTIONS.map(r => (
          <Btn key={r.value} onClick={() => setRangeDays(r.value)} active={rangeDays === r.value} small>{r.label}</Btn>
        ))}
      </div>

      <SL>Select circuits</SL>
      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:10 }}>
        {allIds.map(id => {
          const on = selected.has(id);
          return (
            <button key={id} onClick={() => toggle(id)} style={{
              fontSize:9, fontWeight:600, fontFamily:FONT,
              padding:"3px 6px", borderRadius:4, cursor:"pointer",
              border: on ? `1px solid ${CIRCUIT_COLORS[id]}` : "1px solid rgba(255,255,255,0.1)",
              background: on ? hexToRgba(CIRCUIT_COLORS[id], 0.15) : "rgba(255,255,255,0.04)",
              color: on ? CIRCUIT_COLORS[id] : "#64748B",
              transition: "all 0.15s",
            }}>
              {(CIRCUIT_LABELS[id]||id).slice(0,10)}
            </button>
          );
        })}
      </div>

      {loading && <EmptyState msg="Loading comparison data…"/>}

      {!loading && selected.size > 0 && (
        <>
          <SL>Power overlay</SL>
          <div style={{ height:110, marginBottom:10 }}>
            <Line data={overlayCfg} options={{
              ...CHART_OPTS,
              plugins: {
                ...CHART_OPTS.plugins,
                legend: { display:true, position:"bottom", labels:{ color:"#94A3B8", font:{ size:8 }, boxWidth:10, padding:6 } },
              },
              scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, ticks: { ...CHART_OPTS.scales.x.ticks, maxTicksLimit:5 } } },
            }}/>
          </div>

          <SL>Total energy</SL>
          <div style={{ height:80, marginBottom:10 }}>
            <Bar data={totalBarCfg} options={CHART_OPTS}/>
          </div>

          <SL>Weekday vs weekend</SL>
          <div style={{ height:90, marginBottom:10 }}>
            <Bar data={weekdayCfg} options={{
              ...CHART_OPTS,
              plugins: {
                ...CHART_OPTS.plugins,
                legend: { display:true, position:"bottom", labels:{ color:"#94A3B8", font:{ size:8 }, boxWidth:10, padding:6 } },
              },
            }}/>
          </div>
        </>
      )}
    </>
  );
}

// 

export default function FacilitiesView({ replayData, availableRooms }) {
  const [view, setView] = useState("overview");

  if (view === "rooms")     return <RoomMonitorView    availableRooms={availableRooms} onBack={() => setView("overview")} />;
  if (view === "compare")   return <CompareView        replayData={replayData}         onBack={() => setView("overview")} />;
  if (view === "tasks")     return <MaintenanceCalendar                                onBack={() => setView("overview")} />;
  if (view === "baselines") return <BaselineCalibration                                onBack={() => setView("overview")} />;
  if (typeof view === "object" && view.circuit) {
    return <CircuitDetailView circuitId={view.circuit} replayData={replayData} onBack={() => setView("overview")} />;
  }
  return (
    <OverviewView
      replayData={replayData}
      onSelectCircuit={(id)  => setView({ circuit: id })}
      onSelectRoom={()       => setView("rooms")}
      onCompare={()          => setView("compare")}
      onOpenTasks={()        => setView("tasks")}
      onOpenBaselines={()    => setView("baselines")}
    />
  );
}
