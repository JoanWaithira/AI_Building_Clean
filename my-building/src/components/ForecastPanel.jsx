import { useState, useEffect, useMemo, useRef } from "react";
import {
  Chart as ChartJS,
  LineElement, PointElement,
  CategoryScale, LinearScale, TimeScale,
  Tooltip, Legend, Filler,
} from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { Line } from "react-chartjs-2";
import { Btn, SL, Pill } from "./panelUI.jsx";
import ForecastAccuracyPanel from "./ForecastAccuracyPanel.jsx";
import { fetchLocalShortTermForecasts, fetchLocalLongTermForecasts } from '../services/supabaseForecastService';
import { fetchPgLocalShortTermForecasts } from '../services/pgForecastService';

ChartJS.register(
  LineElement, PointElement,
  CategoryScale, LinearScale, TimeScale,
  Tooltip, Legend, Filler, zoomPlugin
);

const FORECAST_API_BASE = String(import.meta.env.VITE_FORECAST_API_BASE || "https://gate-forecast-api.onrender.com").replace(/\/+$/, "");

/** DB stores 3DLED as x3dled */
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
    cid.replace(/circuit(\d+)/i, "circuit_$1"),
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

function formatSupportedCircuits(circuitIds, circuitConfigs) {
  if (!Array.isArray(circuitIds) || !circuitIds.length) return "none";
  return circuitIds
    .map((id) => circuitConfigs?.[id]?.label || id)
    .join(", ");
}

async function forecastGetJson(path) {
  const fetchWithTimeout = async (requestUrl, ms = 15000) => {
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
      console.log(`[Forecast] Calling main forecast API (${url})`);
      res = await fetchWithTimeout(url, 15000);
      if (res.ok) {
        const data = await res.json();
        const count = Array.isArray(data?.data) ? data.data.length : 0;
        if (count > 0) return data;
        console.warn(`[Forecast] Main forecast API returned no rows, trying CSV fallback (${csvUrl})`);
      }
    } catch (err) {
      console.warn(`[Forecast] Main forecast API failed (${url}):`, err.message);
    }

    try {
      res = await fetchWithTimeout(csvUrl, 15000);
      if (res.ok) {
        const data = await res.json();
        return { ...data, source: data?.source || "csv" };
      }
    } catch (err) {
      console.warn(`[Forecast] CSV fallback failed (${csvUrl}):`, err.message);
    }

    return { data: [], source: null };
  }

  try {
    console.log(`[Forecast] Calling main API (${url})`);
    res = await fetchWithTimeout(url, 15000);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(`[Forecast] Main API failed (${url}):`, err.message);
  }

  return {};
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    ...r,
    timestamp: r.forecast_timestamp || r.timestamp || r.ds || r.time,
    value_kw: Number(r.forecast_value ?? r.value_kw ?? r.yhat ?? r.predicted ?? r.prediction ?? r.value ?? 0),
  }));
}

function normalizeHistRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    timestamp: r.ts_5min || r.timestamp,
    value_kw: Number(r.value ?? r.value_kw ?? r.power_kw ?? 0),
  }));
}

function fmt(x, d = 1) {
  return x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toFixed(d);
}

function chartLabel(ts) {
  const d = new Date(ts);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo}/${dd} ${hh}:${mm}`;
}

function hourLabel(h) {
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}${ampm}`;
}

function dayName(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === tomorrow.getTime()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function nextRunAt(dow, hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  if (dow == null) {
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  const dayDelta = (dow - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + dayDelta);
  if (dayDelta === 0 && next <= now) next.setDate(next.getDate() + 7);
  return next;
}

function formatNextRun(ts) {
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) return "-";
  return ts.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function adaptiveY(base, data) {
  const v = (data?.datasets || []).flatMap(d => d.data || []).filter(x => x != null && Number.isFinite(x));
  if (!v.length) return base;
  const mn = Math.min(...v), mx = Math.max(...v), p = (mx - mn) * 0.1 || 1;
  return { ...base, scales: { ...base.scales, y: { ...base.scales?.y, min: Math.floor(mn - p), max: Math.ceil(mx + p) } } };
}

/** Build combined hist + forecast chart */
function buildCombinedChart(histRows, fcRows, fcColor, fcLabel) {
  const lastHistTs = histRows.length
    ? Math.max(...histRows.map((r) => new Date(r.timestamp).getTime()).filter(Number.isFinite))
    : null;

  // Long-horizon feeds may include points that overlap historical data.
  // Keep only future forecast points to avoid a false dip/jump artifact.
  const filteredFcRows = Number.isFinite(lastHistTs)
    ? fcRows.filter((r) => new Date(r.timestamp).getTime() > lastHistTs)
    : fcRows;

  const allPoints = [
    ...histRows.map(r => ({ ts: new Date(r.timestamp).getTime(), kw: r.value_kw, src: "hist" })),
    ...filteredFcRows.map(r => ({ ts: new Date(r.timestamp).getTime(), kw: r.value_kw, src: "fc" })),
  ].sort((a, b) => a.ts - b.ts);

  if (!allPoints.length) return null;

  const labels = allPoints.map(p => chartLabel(new Date(p.ts)));
  const histData = allPoints.map(p => p.src === "hist" ? p.kw : null);
  const fcData = allPoints.map(p => p.src === "fc" ? p.kw : null);

  // Connect boundary
  const lastHistIdx = histData.findLastIndex(v => v !== null);
  const firstFcIdx = fcData.findIndex(v => v !== null);
  if (lastHistIdx >= 0 && firstFcIdx >= 0 && firstFcIdx > lastHistIdx) {
    fcData[lastHistIdx] = histData[lastHistIdx];
  }

  return {
    labels,
    datasets: [
      {
        label: "Historical (24 h)",
        data: histData,
        borderColor: "#F59E0B",
        backgroundColor: "#F59E0B18",
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        spanGaps: true,
      },
      {
        label: fcLabel || "Forecast",
        data: fcData,
        borderColor: fcColor || "#38BDF8",
        backgroundColor: (fcColor || "#38BDF8") + "18",
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
        spanGaps: true,
      },
    ],
  };
}

function generateInsights(fcRows, histRows, circuitLabel) {
  const notes = [];
  if (!fcRows.length) return notes;

  const fcVals = fcRows.map(r => ({ ts: new Date(r.timestamp), kw: r.value_kw })).filter(r => Number.isFinite(r.kw));
  if (!fcVals.length) return notes;

  const fcAvg = fcVals.reduce((s, r) => s + r.kw, 0) / fcVals.length;
  const fcMax = fcVals.reduce((a, b) => b.kw > a.kw ? b : a, fcVals[0]);
  const fcMin = fcVals.reduce((a, b) => b.kw < a.kw ? b : a, fcVals[0]);

  // Peak usage time
  notes.push({
    icon: "⚡",
    text: `Peak usage of ${fmt(fcMax.kw)} kW expected at ${hourLabel(fcMax.ts.getHours())} on ${dayName(fcMax.ts.toISOString().slice(0, 10))}`,
    type: "warn",
  });

  // Lowest usage time
  notes.push({
    icon: "🌙",
    text: `Lowest usage of ${fmt(fcMin.kw)} kW expected at ${hourLabel(fcMin.ts.getHours())} on ${dayName(fcMin.ts.toISOString().slice(0, 10))}`,
    type: "good",
  });

  // Compare historical avg vs forecast avg
  if (histRows.length > 5) {
    const histVals = histRows.map(r => r.value_kw).filter(Number.isFinite);
    if (histVals.length) {
      const histAvg = histVals.reduce((s, x) => s + x, 0) / histVals.length;
      const changePct = ((fcAvg - histAvg) / Math.max(histAvg, 0.01)) * 100;
      if (Math.abs(changePct) > 2) {
        const dir = changePct > 0 ? "increase" : "decrease";
        notes.push({
          icon: changePct > 0 ? "📈" : "📉",
          text: `Forecast avg (${fmt(fcAvg)} kW) is ${Math.abs(changePct).toFixed(0)}% ${dir} from recent 24 h avg (${fmt(histAvg)} kW)`,
          type: changePct > 15 ? "warn" : changePct < -5 ? "good" : "info",
        });
      } else {
        notes.push({
          icon: "➡️",
          text: `Energy usage is expected to stay about the same as the last 24 hours`,
          type: "info",
        });
      }
    }
  }

  // Daily breakdown — which day has most/least usage
  const byDay = {};
  fcVals.forEach(r => {
    const k = r.ts.toISOString().slice(0, 10);
    if (!byDay[k]) byDay[k] = { sum: 0, cnt: 0 };
    byDay[k].sum += r.kw;
    byDay[k].cnt += 1;
  });
  const days = Object.entries(byDay).map(([d, v]) => ({ date: d, avg: v.sum / v.cnt })).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length >= 2) {
    const highDay = days.reduce((a, b) => b.avg > a.avg ? b : a, days[0]);
    const lowDay = days.reduce((a, b) => b.avg < a.avg ? b : a, days[0]);
    if (highDay.date !== lowDay.date) {
      notes.push({
        icon: "📅",
        text: `${dayName(highDay.date)} will have the highest avg load (${fmt(highDay.avg)} kW), ${dayName(lowDay.date)} the lowest (${fmt(lowDay.avg)} kW)`,
        type: "info",
      });
    }
  }

  // Hourly pattern — find top-3 peak hours
  const byHour = {};
  fcVals.forEach(r => {
    const h = r.ts.getHours();
    if (!byHour[h]) byHour[h] = { sum: 0, cnt: 0 };
    byHour[h].sum += r.kw;
    byHour[h].cnt += 1;
  });
  const hours = Object.entries(byHour).map(([h, v]) => ({ h: Number(h), avg: v.sum / v.cnt })).sort((a, b) => b.avg - a.avg);
  if (hours.length >= 3) {
    const top3 = hours.slice(0, 3).map(h => hourLabel(h.h)).join(", ");
    notes.push({
      icon: "🕐",
      text: `Highest demand hours: ${top3}`,
      type: "info",
    });
  }

  // Overnight base load check
  const nightHours = fcVals.filter(r => r.ts.getHours() >= 22 || r.ts.getHours() < 6);
  if (nightHours.length > 3) {
    const nightAvg = nightHours.reduce((s, r) => s + r.kw, 0) / nightHours.length;
    const dayHoursArr = fcVals.filter(r => r.ts.getHours() >= 6 && r.ts.getHours() < 22);
    if (dayHoursArr.length > 3) {
      const dayAvg = dayHoursArr.reduce((s, r) => s + r.kw, 0) / dayHoursArr.length;
      const ratio = nightAvg / Math.max(dayAvg, 0.01);
      if (ratio > 0.6) {
        notes.push({
          icon: "🔌",
          text: `Night-time base load is ${(ratio * 100).toFixed(0)}% of daytime — consider reviewing standby consumption`,
          type: "warn",
        });
      }
    }
  }

  return notes;
}

const insightColors = {
  warn: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", text: "#FCD34D" },
  good: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.25)", text: "#86EFAC" },
  info: { bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.18)", text: "#BAE6FD" },
};

export default function ForecastPanel({ getPowerJson, circuitConfigs, selectStyle }) {
  const circuitIds = useMemo(() => Object.keys(circuitConfigs || {}), [circuitConfigs]);

  const [mode, setMode] = useState("single");
  const [modelScope, setModelScope] = useState("local");
  const [product, setProduct] = useState("long_term");
  const [circuit, setCircuit] = useState("");

  const [shortRows, setShortRows] = useState([]);
  const [longRows, setLongRows] = useState([]);
  const [singleRows, setSingleRows] = useState([]);
  const [histRows, setHistRows] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meters, setMeters] = useState([]);
  const [forecastSource, setForecastSource] = useState('supabase'); // 'supabase' or 'postgresql'

  // Safety net: never leave the panel in loading forever.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setError((prev) => prev || "Forecast request timed out. Please try again.");
    }, 15000);
    return () => clearTimeout(timer);
  }, [loading]);

  const chartRef = useRef(null);
  const circuitLabel = circuitConfigs?.[circuit]?.label || circuit;
  const forecastReadyCircuitIds = useMemo(
    () => circuitIds.filter((id) => hasKnownForecastMapping(id, circuitConfigs?.[id]?.label || id, meters)),
    [circuitIds, circuitConfigs, meters]
  );
  const forecastReadyCircuitList = useMemo(
    () => formatSupportedCircuits(forecastReadyCircuitIds, circuitConfigs),
    [forecastReadyCircuitIds, circuitConfigs]
  );
  const resolvedMeter = useMemo(() => resolveMeterForCircuit(circuit, circuitLabel, meters), [circuit, circuitLabel, meters]);
  const fallbackMeter = useMemo(
    () => fallbackMeterForCircuit(circuit, circuitLabel),
    [circuit, circuitLabel]
  );
  const hasResolvedMeter = useMemo(
    () => modelScope === "global" || (meters.length ? Boolean(resolvedMeter) : Boolean(resolvedMeter || fallbackMeter)),
    [modelScope, meters, resolvedMeter, fallbackMeter]
  );
  const requestMeter = useMemo(
    () => resolvedMeter || (meters.length ? "" : fallbackMeter),
    [meters, resolvedMeter, fallbackMeter]
  );

  // Load available meters once from the new Forecast API.
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const data = await forecastGetJson("/meters");
        if (cancel) return;
        setMeters(Array.isArray(data?.meters) ? data.meters : []);
      } catch (e) {
        if (!cancel) {
          console.warn("[Forecast] failed to load meters:", e);
          setMeters([]);
        }
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Keep Local on a forecast-ready circuit to avoid empty-state traps.
  useEffect(() => {
    if (modelScope === "global") return;
    if (!forecastReadyCircuitIds.length) return;
    if (!circuit || !forecastReadyCircuitIds.includes(circuit)) {
      setCircuit(forecastReadyCircuitIds[0]);
    }
  }, [modelScope, circuit, forecastReadyCircuitIds]);

  const chartOpts = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { color: "rgba(255,255,255,0.75)", font: { size: 10, weight: "500" }, padding: 8, usePointStyle: true, boxWidth: 8 } },
      tooltip: { backgroundColor: "rgba(10,15,30,0.92)", titleFont: { size: 10 }, bodyFont: { size: 10 }, padding: 8, cornerRadius: 6 },
      zoom: { pan: { enabled: true, mode: "x" }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } },
    },
    scales: {
      y: { beginAtZero: false, ticks: { color: "rgba(255,255,255,0.6)", font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: "rgba(255,255,255,0.06)" } },
      x: { ticks: { color: "rgba(255,255,255,0.5)", font: { size: 8 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
    },
  }), []);

  useEffect(() => {
    if (modelScope === "global") { setHistRows([]); return; }
    if (!circuit) { setHistRows([]); return; }
    let cancel = false;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const now = new Date().toISOString();
    const cid = dbCircuitId(circuit);

    (async () => {
      try {
        const raw = await getPowerJson("power_5min", {
          select: "ts_5min,value,circuit_id",
          circuit_id: `eq.${cid}`,
          and: `(ts_5min.gte.${since},ts_5min.lte.${now})`,
          order: "ts_5min.asc",
          limit: 300,
        }).catch(() => []);
        if (cancel) return;
        console.log("[Forecast] hist 24h:", raw?.length, "rows for", cid);
        setHistRows(normalizeHistRows(raw));
      } catch { if (!cancel) setHistRows([]); }
    })();
    return () => { cancel = true; };
  }, [circuit, getPowerJson, modelScope]);

  useEffect(() => {
    if (mode !== "compare") return;
    if (modelScope === "local" && !circuit) {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true); setError(null); setShortRows([]); setLongRows([]);

    if (modelScope === "local" && !hasResolvedMeter) {
      setLoading(false);
      setError(
        `No forecast model is available for '${circuitLabel}'. Forecast-ready circuits currently exposed by the API: ${forecastReadyCircuitList}.`
      );
      return;
    }

    (async () => {
      try {
        const shortPath = modelScope === "global"
          ? "/forecasts/global/short"
          : `/forecasts/local/short?circuit_id=${encodeURIComponent(requestMeter)}&mode=single`;
        const longPath = modelScope === "global"
          ? "/forecasts/global/long"
          : `/forecasts/local/long?circuit_id=${encodeURIComponent(requestMeter)}&mode=single`;
        const [srRes, lrRes] = await Promise.all([
          forecastGetJson(shortPath).catch(() => ({ data: [] })),
          forecastGetJson(longPath).catch(() => ({ data: [] })),
        ]);
        const sr = Array.isArray(srRes?.data) ? srRes.data : [];
        const lr = Array.isArray(lrRes?.data) ? lrRes.data : [];
        if (cancel) return;
        console.log("[Forecast] compare:", sr?.length, "short,", lr?.length, "long");
        setShortRows(normalizeRows(sr));
        setLongRows(normalizeRows(lr));
        if (!sr?.length && !lr?.length) {
          setError(
            modelScope === "global"
              ? "No global forecast data found."
              : `No forecast data found for meter '${requestMeter}'.`
          );
        }
      } catch (e) { if (!cancel) setError(String(e.message || e)); }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [mode, circuit, requestMeter, hasResolvedMeter, circuitLabel, modelScope, forecastReadyCircuitList]);

  useEffect(() => {
    if (mode !== "single") return;
    if (modelScope === "local" && !circuit) {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true); setError(null); setSingleRows([]);

    (async () => {
      try {
        let rows = [];
        if (modelScope === "local") {
          if (forecastSource === 'postgresql') {
            rows = await fetchPgLocalShortTermForecasts(requestMeter);
          } else {
            if (product === "short_term") {
              rows = await fetchLocalShortTermForecasts(requestMeter);
            } else {
              rows = await fetchLocalLongTermForecasts(requestMeter);
            }
          }
        } else {
          // For global, fallback to empty or extend as needed
          rows = [];
        }
        if (cancel) return;
        setSingleRows(normalizeRows(rows));
        if (!rows?.length) {
          setError(
            modelScope === "global"
              ? `No ${product === "short_term" ? "short" : "long"} global forecast data found.`
              : `No ${product === "short_term" ? "short" : "long"} forecast data found for meter '${requestMeter}'.`
          );
        }
      } catch (e) {
        if (!cancel) setError(String(e.message || e));
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [mode, circuit, product, requestMeter, modelScope, forecastSource]);

  const shortChart = useMemo(() => buildCombinedChart(histRows, shortRows, "#38BDF8", "Short-term"), [histRows, shortRows]);
  const longChart = useMemo(() => buildCombinedChart(histRows, longRows, "#A78BFA", "Long-term"), [histRows, longRows]);
  const singleChart = useMemo(() => {
    const c = product === "short_term" ? "#38BDF8" : "#A78BFA";
    return buildCombinedChart(histRows, singleRows, c, product === "short_term" ? "Short-term" : "Long-term");
  }, [histRows, singleRows, product]);

  const activeRows = mode === "compare" ? [...shortRows, ...longRows] : singleRows;

  const insights = useMemo(
    () => generateInsights(activeRows, histRows, circuitLabel),
    [activeRows, histRows, circuitLabel]
  );

  const histSummary = useMemo(() => {
    const v = histRows.map(r => r.value_kw).filter(Number.isFinite);
    if (!v.length) return null;
    return { avg: v.reduce((s, x) => s + x, 0) / v.length, min: Math.min(...v), max: Math.max(...v) };
  }, [histRows]);

  const fcSummary = useMemo(() => {
    const v = activeRows.map(r => r.value_kw).filter(Number.isFinite);
    if (!v.length) return null;
    return { avg: v.reduce((s, x) => s + x, 0) / v.length, min: Math.min(...v), max: Math.max(...v) };
  }, [activeRows]);

  const scheduleNote = useMemo(() => {
    const nextShortInference = nextRunAt(null, 3, 15); // Daily 03:15
    const nextLongInference = nextRunAt(1, 3, 30); // Monday 03:30
    const nextRetrain = nextRunAt(0, 2, 0); // Sunday 02:00
    return {
      nextShortInference: formatNextRun(nextShortInference),
      nextLongInference: formatNextRun(nextLongInference),
      nextRetrain: formatNextRun(nextRetrain),
    };
  }, []);

  const ChartCard = ({ title, children, height = 170 }) => (
    <div style={{ background: "rgba(10,15,26,0.7)", border: "1px solid rgba(125,211,252,0.14)", borderRadius: 6, padding: "8px 8px 4px", marginBottom: 8 }}>
      <SL>{title}</SL>
      <div style={{ height, position: "relative" }}>{children}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#9AB8D7', marginRight: 8 }}>Forecast Source:</label>
        <select value={forecastSource} onChange={e => setForecastSource(e.target.value)} style={{ fontSize: 11, padding: '2px 6px' }}>
          <option value="supabase">Supabase</option>
          <option value="postgresql">PostgreSQL</option>
        </select>
      </div>
      <div
        style={{
          background: "rgba(56,189,248,0.08)",
          border: "1px solid rgba(56,189,248,0.2)",
          borderRadius: 6,
          padding: "6px 8px",
          marginBottom: 8,
          color: "#BAE6FD",
          fontSize: 10,
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Model schedule</div>
        <div>Next short inference: {scheduleNote.nextShortInference}</div>
        <div>Next long inference: {scheduleNote.nextLongInference}</div>
        <div>Next retrain: {scheduleNote.nextRetrain}</div>
      </div>
      {/* Mode */}
      <SL>Mode</SL>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
        <Btn active={mode === "single"} onClick={() => setMode("single")}>📈 Single</Btn>
        <Btn active={mode === "compare"} onClick={() => setMode("compare")}>⚡ Compare</Btn>
      </div>

      {/* Scope */}
      <SL>Scope</SL>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
        <Btn active={modelScope === "local"} onClick={() => setModelScope("local")}>🏢 Local</Btn>
        <Btn active={modelScope === "global"} onClick={() => setModelScope("global")}>🌐 Global</Btn>
      </div>

      {/* Circuit */}
      {modelScope === "local" && (
        <>
          <SL>Circuit</SL>
          <select value={circuit} onChange={e => setCircuit(e.target.value)} style={selectStyle}>
            <option value="">Select circuit…</option>
            {circuitIds.map((id) => {
              const supported = forecastReadyCircuitIds.includes(id);
              const label = circuitConfigs[id]?.label || id;
              return (
                <option key={id} value={id}>
                  {supported ? label : `${label} (no forecast model)`}
                </option>
              );
            })}
          </select>
        </>
      )}

      {/* Product (single only) */}
      {mode === "single" && (
        <>
          <SL>Product</SL>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
            <Btn active={product === "short_term"} onClick={() => setProduct("short_term")}>Short-term</Btn>
            <Btn active={product === "long_term"} onClick={() => setProduct("long_term")}>Long-term</Btn>
          </div>
        </>
      )}

      

      {/* Status */}
      {modelScope === "local" && !circuit && (
        <div style={{ textAlign: "center", color: "#64748B", fontSize: 11, padding: "20px 0" }}>Select a circuit to view forecasts.</div>
      )}
      {loading && (modelScope === "global" || !!circuit) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "#9AB8D7", fontSize: 11 }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#3B82F6", boxShadow: "0 0 8px #3B82F6" }} /> Loading…
        </div>
      )}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 10, color: "#FCA5A5", marginBottom: 8 }}>
          {error}
        </div>
      )}

      {(modelScope === "global" || !!circuit) && (histSummary || fcSummary) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
          {histSummary && <Pill label="Historical Avg (24h)" value={fmt(histSummary.avg) + " kW"} color="#F59E0B" />}
          {fcSummary && <Pill label="Forecast Avg" value={fmt(fcSummary.avg) + " kW"} color="#7DD3FC" />}
          {histSummary && <Pill label="Hist Peak" value={fmt(histSummary.max) + " kW"} color="#F59E0B" />}
          {fcSummary && <Pill label="Fc Peak" value={fmt(fcSummary.max) + " kW"} color="#7DD3FC" />}
        </div>
      )}

      {(modelScope === "global" || !!circuit) && !loading && insights.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <SL>Key Insights</SL>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {insights.map((n, i) => {
              const c = insightColors[n.type] || insightColors.info;
              return (
                <div key={i} style={{
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                  borderRadius: 6,
                  padding: "5px 8px",
                  fontSize: 10,
                  lineHeight: 1.5,
                  color: c.text,
                  display: "flex",
                  gap: 6,
                  alignItems: "flex-start",
                }}>
                  <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>{n.icon}</span>
                  <span>{n.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Single mode */}
      {mode === "single" && (modelScope === "global" || !!circuit) && !loading && singleChart && (
        <ChartCard title={`Historical + ${product === "short_term" ? "Short-term" : "Long-term"} Forecast`}>
          <Line ref={chartRef} data={singleChart} options={adaptiveY(chartOpts, singleChart)} />
        </ChartCard>
      )}

      {/* Compare mode — two stacked charts */}
      {mode === "compare" && (modelScope === "global" || !!circuit) && !loading && (
        <>
          {shortChart && (
            <ChartCard title="Historical + Short-term Forecast">
              <Line data={shortChart} options={adaptiveY(chartOpts, shortChart)} />
            </ChartCard>
          )}
          {longChart && (
            <ChartCard title="Historical + Long-term Forecast">
              <Line data={longChart} options={adaptiveY(chartOpts, longChart)} />
            </ChartCard>
          )}
        </>
      )}

      {/* No data notice */}
      {(modelScope === "global" || !!circuit) && !loading && !error && histRows.length === 0 && activeRows.length === 0 && (
        <div style={{ textAlign: "center", color: "#64748B", fontSize: 10, padding: "16px 0" }}>
          No historical or forecast data available for {modelScope === "global" ? "global forecast" : circuitLabel}.
        </div>
      )}

      <ForecastAccuracyPanel
        circuit={circuit}
        requestMeter={requestMeter}
        scope={modelScope}
        product={product}
        histRows={histRows}
      />
    </div>
  );
}
