import { useState, useEffect, useMemo } from "react";
import {
  Chart as ChartJS,
  LineElement, PointElement, BarElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import { SL, Pill } from "./panelUI.jsx";

ChartJS.register(
  LineElement, PointElement, BarElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
);

const FORECAST_API_BASE = String(
  import.meta.env.VITE_FORECAST_API_BASE || "https://gate-forecast-api.onrender.com"
).replace(/\/+$/, "");

// MAPE quality thresholds (%)
const MAPE_EXCELLENT = 5;
const MAPE_GOOD = 10;
const MAPE_FAIR = 20;

function fmt(x, d = 2) {
  return x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toFixed(d);
}

function chartLabel(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mo}/${dd} ${hh}:${mm}`;
}

// Aligns forecast rows against actual readings within toleranceMs; only pairs within 15 min are kept.
function alignPairs(fcRows, histRows, toleranceMs = 15 * 60 * 1000) {
  if (!fcRows.length || !histRows.length) return [];

  // Index histRows by rounded-minute bucket for fast lookup
  const histMap = new Map();
  for (const h of histRows) {
    const hTs = new Date(h.timestamp).getTime();
    if (!Number.isFinite(hTs)) continue;
    const bucket = Math.round(hTs / 60000) * 60000;
    if (!histMap.has(bucket)) histMap.set(bucket, { ts: hTs, value_kw: h.value_kw });
  }

  const pairs = [];
  for (const fc of fcRows) {
    const fcTs = new Date(fc.forecast_timestamp || fc.timestamp).getTime();
    if (!Number.isFinite(fcTs)) continue;

    // Check surrounding minute buckets within tolerance
    const bucketMs = 60000;
    const range = Math.ceil(toleranceMs / bucketMs);
    const fcBucket = Math.round(fcTs / bucketMs) * bucketMs;

    let nearest = null;
    let nearestDiff = Infinity;
    for (let offset = -range; offset <= range; offset++) {
      const candidate = histMap.get(fcBucket + offset * bucketMs);
      if (!candidate) continue;
      const diff = Math.abs(candidate.ts - fcTs);
      if (diff < nearestDiff) { nearestDiff = diff; nearest = candidate; }
    }

    if (nearest && nearestDiff <= toleranceMs) {
      pairs.push({
        ts:        fcTs,
        fcVal:     Number(fc.forecast_value ?? fc.value_kw ?? 0),
        actualVal: Number(nearest.value_kw ?? 0),
        step_ahead: Number(fc.step_ahead ?? 0),
        model_type: fc.model_type ?? "",
      });
    }
  }

  return pairs.sort((a, b) => a.ts - b.ts);
}

/** Compute MAE, MAPE, RMSE from aligned pairs in a single pass. */
function computeMetrics(pairs) {
  if (!pairs.length) return null;

  let sumAbsErr = 0, sumSqErr = 0, sumPctErr = 0, pctCount = 0;
  for (const { fcVal, actualVal } of pairs) {
    const err    = actualVal - fcVal;
    const absErr = Math.abs(err);
    sumAbsErr += absErr;
    sumSqErr  += err * err;
    if (Math.abs(actualVal) > 0.05) {
      sumPctErr += (absErr / Math.abs(actualVal)) * 100;
      pctCount++;
    }
  }

  return {
    mae:  sumAbsErr / pairs.length,
    rmse: Math.sqrt(sumSqErr / pairs.length),
    mape: pctCount > 0 ? sumPctErr / pctCount : null,
    n:    pairs.length,
  };
}

/** MAPE % bucketed by step_ahead for the horizon breakdown chart. */
function mapeByStep(pairs) {
  const buckets = {};
  for (const { step_ahead, fcVal, actualVal } of pairs) {
    if (Math.abs(actualVal) <= 0.05) continue;
    if (!buckets[step_ahead]) buckets[step_ahead] = { sum: 0, cnt: 0 };
    buckets[step_ahead].sum += (Math.abs(actualVal - fcVal) / Math.abs(actualVal)) * 100;
    buckets[step_ahead].cnt++;
  }
  return Object.entries(buckets)
    .map(([step, { sum, cnt }]) => ({ step: Number(step), mape: sum / cnt }))
    .sort((a, b) => a.step - b.step)
    .slice(0, 24);
}

function mapeColor(mape) {
  if (mape == null)            return "#64748B";
  if (mape < MAPE_EXCELLENT)   return "#4ADE80";
  if (mape < MAPE_GOOD)        return "#86EFAC";
  if (mape < MAPE_FAIR)        return "#FBBF24";
  return "#F87171";
}

function mapeLabel(mape) {
  if (mape == null)            return "N/A";
  if (mape < MAPE_EXCELLENT)   return "Excellent";
  if (mape < MAPE_GOOD)        return "Good";
  if (mape < MAPE_FAIR)        return "Fair";
  return "Poor";
}

function stepBarColor(mape) {
  if (mape < MAPE_EXCELLENT) return "#4ADE8088";
  if (mape < MAPE_GOOD) return "#FBBF2488";
  return "#F8717188";
}

const GRID_COLOR = "rgba(255,255,255,0.06)";
const TICK_COLOR = "rgba(255,255,255,0.5)";

const BASE_CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: {
      position: "bottom",
      labels: { color: "rgba(255,255,255,0.75)", font: { size: 10 }, usePointStyle: true, boxWidth: 8, padding: 8 },
    },
    tooltip: {
      backgroundColor: "rgba(10,15,30,0.92)",
      titleFont: { size: 10 },
      bodyFont: { size: 10 },
      padding: 8,
      cornerRadius: 6,
    },
  },
  scales: {
    x: { ticks: { color: TICK_COLOR, font: { size: 8 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
    y: { ticks: { color: TICK_COLOR, font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: GRID_COLOR } },
  },
};

const STEP_CHART_OPTS = {
  ...BASE_CHART_OPTS,
  plugins: { ...BASE_CHART_OPTS.plugins, legend: { display: false } },
  scales: {
    ...BASE_CHART_OPTS.scales,
    y: { ...BASE_CHART_OPTS.scales.y, title: { display: true, text: "MAPE %", color: TICK_COLOR, font: { size: 9 } } },
    x: { ...BASE_CHART_OPTS.scales.x, title: { display: true, text: "Step ahead", color: TICK_COLOR, font: { size: 9 } } },
  },
};

function ChartCard({ title, subtitle, height = 150, children }) {
  return (
    <div style={{ background: "rgba(10,15,26,0.7)", border: "1px solid rgba(125,211,252,0.14)", borderRadius: 6, padding: "8px 8px 4px", marginBottom: 8 }}>
      <SL>{title}</SL>
      {subtitle && <div style={{ fontSize: 9, color: "#64748B", marginBottom: 4 }}>{subtitle}</div>}
      <div style={{ height, position: "relative" }}>{children}</div>
    </div>
  );
}

export default function ForecastAccuracyPanel({
  circuit,
  requestMeter,
  scope,
  product,
  histRows,
  hoursBack = 24,
}) {
  const [pastFcRows, setPastFcRows] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  useEffect(() => {
    if (scope !== "local" || !circuit || !requestMeter) {
      setPastFcRows([]);
      setError(null);
      return;
    }

    let cancel = false;
    // Declare controller + timer in outer scope so cleanup can clear them
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    setLoading(true);
    setError(null);
    setPastFcRows([]);

    const params = new URLSearchParams({
      scope,
      product,
      circuit_id: requestMeter,
      hours_back: String(hoursBack),
    });

    (async () => {
      try {
        const res = await fetch(
          `${FORECAST_API_BASE}/forecasts/accuracy/?${params.toString()}`,
          { headers: { Accept: "application/json" }, signal: controller.signal }
        );
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancel) return;
        setPastFcRows(Array.isArray(data) ? data : []);
        setError(null);
      } catch (e) {
        if (!cancel) {
          if (e.name !== "AbortError") console.warn("[Accuracy] Data not available:", e.message);
          setPastFcRows([]);
          setError(null);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [circuit, requestMeter, scope, product, hoursBack]);

  const pairs      = useMemo(() => alignPairs(pastFcRows, histRows), [pastFcRows, histRows]);
  const metrics    = useMemo(() => computeMetrics(pairs), [pairs]);
  const stepData   = useMemo(() => mapeByStep(pairs), [pairs]);

  const lineChartData = useMemo(() => {
    if (!pairs.length) return null;
    return {
      labels: pairs.map((p) => chartLabel(p.ts)),
      datasets: [
        {
          label: "Actual (kW)",
          data: pairs.map((p) => p.actualVal),
          borderColor: "#F59E0B", backgroundColor: "#F59E0B18",
          borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false, spanGaps: true,
        },
        {
          label: "Forecast (kW)",
          data: pairs.map((p) => p.fcVal),
          borderColor: "#38BDF8", backgroundColor: "#38BDF818",
          borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false, spanGaps: true,
        },
      ],
    };
  }, [pairs]);

  const stepChartData = useMemo(() => {
    if (!stepData.length) return null;
    return {
      labels: stepData.map((d) => `S${d.step}`),
      datasets: [{
        label: "MAPE % by step ahead",
        data: stepData.map((d) => +d.mape.toFixed(2)),
        backgroundColor: stepData.map((d) => stepBarColor(d.mape)),
        borderRadius: 3,
        borderSkipped: false,
      }],
    };
  }, [stepData]);

  if (scope !== "local" || !circuit) return null;

  const accentColor = mapeColor(metrics?.mape);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6, padding: "6px 8px", marginBottom: 8, color: "#BAE6FD", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>
        Forecast Accuracy — last {hoursBack} h
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", color: "#9AB8D7", fontSize: 11 }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#3B82F6", boxShadow: "0 0 8px #3B82F6" }} />
          Loading accuracy data…
        </div>
      )}

      {error && !loading && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 10, color: "#FCA5A5", marginBottom: 8 }}>
          {error}
        </div>
      )}

      {!loading && !error && !pairs.length && (
        <div style={{ fontSize: 10, color: "#64748B", padding: "8px 0" }}>
          No overlapping forecast + actual data found for the last {hoursBack} h.
          Past forecast records may not yet exist in the database.
        </div>
      )}

      {metrics && (
        <>
          <SL>Accuracy Metrics ({metrics.n} matched points)</SL>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
            <Pill label="MAE"  value={`${fmt(metrics.mae, 3)} kW`}  sub="Mean Absolute Error"   color="#38BDF8" />
            <Pill label="MAPE" value={metrics.mape != null ? `${fmt(metrics.mape, 1)}%` : "N/A"} sub={mapeLabel(metrics.mape)} color={accentColor} />
            <Pill label="RMSE" value={`${fmt(metrics.rmse, 3)} kW`} sub="Root Mean Sq. Error"  color="#A78BFA" />
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `${accentColor}18`, border: `1px solid ${accentColor}44`, borderRadius: 20, padding: "3px 10px", fontSize: 10, color: accentColor, fontWeight: 600, marginBottom: 10 }}>
            <span style={{ fontSize: 11 }}>
              {metrics.mape == null ? "?" : metrics.mape < MAPE_EXCELLENT ? "✓" : metrics.mape < MAPE_GOOD ? "~" : "!"}
            </span>
            Model quality: {mapeLabel(metrics.mape)}
            {metrics.mape != null && ` (MAPE ${fmt(metrics.mape, 1)}%)`}
          </div>
        </>
      )}

      {lineChartData && (
        <ChartCard title={`Actual vs Forecast (past ${hoursBack} h)`}>
          <Line data={lineChartData} options={BASE_CHART_OPTS} />
        </ChartCard>
      )}

      {stepChartData && stepData.length > 1 && (
        <ChartCard title="MAPE by Forecast Step Ahead" subtitle="Shows how accuracy degrades over the forecast horizon" height={120}>
          <Bar data={stepChartData} options={STEP_CHART_OPTS} />
        </ChartCard>
      )}
    </div>
  );
}
