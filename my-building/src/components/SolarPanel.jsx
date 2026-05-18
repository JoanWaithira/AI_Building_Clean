import { useState, useCallback, useEffect, useMemo } from "react";
import { fetchSolar } from "../services/gateBuildingRepository.js";
import { toSofiaDateParams } from "../utils/timeUtils.js";

const BATTERY_CAPACITY_KWH = 50;
const BATTERY_EFFICIENCY = 0.92;
const BUCKET_MS = 5 * 60 * 1000;

const HORIZON_OPTIONS = [
  { hours: 24, label: "24h" },
  { hours: 48, label: "48h" },
  { hours: 168, label: "7d" },
  { hours: 720, label: "30d" },
];

const VIEW_OPTIONS = [
  { key: "overview", label: "Now" },
  { key: "power", label: "Power" },
  { key: "battery", label: "Battery" },
  { key: "strings", label: "Strings" },
];

import { useRef, useLayoutEffect } from "react";

// Responsive chart width
const CHART_H = 84;
const STRING_CHART_H = 140;

function fmtTime(timestampMs) {
  if (!Number.isFinite(timestampMs)) return "--:--";
  const d = new Date(timestampMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function bucket(ts) {
  return Math.round(ts / BUCKET_MS) * BUCKET_MS;
}

function sumKwh(series) {
  return (series || []).reduce((sum, point) => sum + (point.value || 0) * 0.25, 0);
}

function buildSeries(byParam, param) {
  return (byParam[param] || []).map((r) => {
    const d = new Date(r.timestampMs);
    return {
      timestampMs: r.timestampMs,
      time: fmtTime(r.timestampMs),
      hour: d.getHours() + d.getMinutes() / 60,
      value: r.value,
    };
  });
}

function transformSolarReadings(readings) {
  const byParam = {};

  for (const r of readings) {
    if (!byParam[r.parameter]) byParam[r.parameter] = [];
    byParam[r.parameter].push(r);
  }

  for (const arr of Object.values(byParam)) {
    arr.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  const pvTotal = buildSeries(byParam, "PpvInput");
  const pvBattery = buildSeries(byParam, "Battery_P");
  const soc = buildSeries(byParam, "SOC");
  const bmsTemp = buildSeries(byParam, "Temperature1");
  const loadSeries = buildSeries(byParam, "Pload");
  const meterSeries = buildSeries(byParam, "PmeterTotal");

  const batteryMap = new Map(pvBattery.map((x) => [bucket(x.timestampMs), x.value]));
  const loadMap = new Map(loadSeries.map((x) => [bucket(x.timestampMs), x.value]));
  const meterMap = new Map(meterSeries.map((x) => [bucket(x.timestampMs), x.value]));

  const gridExport = pvTotal.map((x) => {
    const load = loadMap.get(bucket(x.timestampMs)) ?? 0;
    const battery = batteryMap.get(bucket(x.timestampMs)) ?? 0;
    return {
      ...x,
      value: Math.max(0, x.value - load - Math.max(0, battery)),
    };
  });

  const gridImport = pvTotal.map((x) => {
    const load = loadMap.get(bucket(x.timestampMs)) ?? 0;
    const battery = batteryMap.get(bucket(x.timestampMs)) ?? 0;
    return {
      ...x,
      value: Math.max(0, load - x.value - Math.max(0, -battery)),
    };
  });

  const pv1Power = pvTotal.map((x) => ({ ...x, value: x.value * 0.55 }));
  const pv2Power = pvTotal.map((x) => ({ ...x, value: x.value * 0.45 }));

  return {
    pvTotal,
    pvBattery,
    soc,
    bmsTemp,
    pv1Power,
    pv2Power,
    gridExport,
    gridImport,
    dailyPv: pvTotal,
    dailyLoad: loadSeries,
    dailyPurchased: gridImport,
    threePhaseMeter: meterSeries,
    meterSeries,
    meterMap,
    backupA: [],
    backupB: [],
    backupC: [],
  };
}

function computeSolarMetrics(pvData, replayData) {
  if (!pvData?.pvTotal?.length) return null;

  const pvSeries = pvData.pvTotal || [];
  const batSeries = pvData.pvBattery || [];
  const socSeries = pvData.soc || [];
  const bmsSeries = pvData.bmsTemp || [];
  const loadSeries = replayData?.main || [];

  const latest = {
    pvKw: pvSeries[pvSeries.length - 1]?.value ?? 0,
    batteryKw: batSeries[batSeries.length - 1]?.value ?? 0,
    socPct: socSeries[socSeries.length - 1]?.value ?? 0,
    loadKw: (loadSeries[loadSeries.length - 1]?.watts ?? 0) / 1000,
    bmsTempC: bmsSeries[bmsSeries.length - 1]?.value ?? 0,
  };

  latest.gridKw = Math.max(0, latest.loadKw - latest.pvKw - Math.max(0, -latest.batteryKw));
  latest.exportKw = Math.max(0, latest.pvKw - latest.loadKw - Math.max(0, latest.batteryKw));
  latest.solarFraction = latest.loadKw > 0 ? Math.min(100, (latest.pvKw / latest.loadKw) * 100) : 0;

  const pvKwh = sumKwh(pvSeries);
  const gridExportKwh = sumKwh(pvData.gridExport || []);
  const gridImportKwh = sumKwh(pvData.gridImport || []);
  const selfUsedKwh = Math.max(0, pvKwh - gridExportKwh);

  const socValues = socSeries.map((x) => x.value).filter(Number.isFinite);
  const socMin = socValues.length ? Math.min(...socValues) : 0;
  const socMax = socValues.length ? Math.max(...socValues) : 0;

  const pv1Kwh = sumKwh(pvData.pv1Power || []);
  const pv2Kwh = sumKwh(pvData.pv2Power || []);
  const stringBalance =
    pv1Kwh + pv2Kwh > 0
      ? (Math.abs(pv1Kwh - pv2Kwh) / ((pv1Kwh + pv2Kwh) / 2)) * 100
      : 0;

  return {
    latest,
    totals: {
      pvKwh,
      gridExportKwh,
      gridImportKwh,
      selfUsedKwh,
      pv1Kwh,
      pv2Kwh,
    },
    battery: {
      socMin,
      socMax,
    },
    strings: {
      balancePct: stringBalance,
      alert: stringBalance > 20,
    },
  };
}

function alignReplayLoadToPv(pvSeries, replayMain) {
  return (pvSeries || []).map((pv, i) => ({
    timestampMs: pv.timestampMs,
    time: pv.time,
    value: ((replayMain || [])[i]?.watts ?? 0) / 1000,
  }));
}

function getTimeAxisTicks(horizon) {
  if (horizon <= 48) {
    return Array.from({ length: 5 }, (_, i) => `${Math.round((horizon / 4) * i)}h`);
  }
  if (horizon <= 168) {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
  return ["Week 1", "Week 2", "Week 3", "Week 4"];
}

function getRoleBanner(metrics, activeRole) {
  if (!metrics || !activeRole) return null;

  const { socPct, loadKw, solarFraction } = metrics.latest;
  const { balancePct } = metrics.strings;
  const usableKwh = BATTERY_CAPACITY_KWH * (socPct / 100) * BATTERY_EFFICIENCY;
  const hoursBackup = (usableKwh / Math.max(0.1, loadKw)).toFixed(1);

  const bannerMap = {
    director: `Solar generated ${metrics.totals.pvKwh.toFixed(1)} kWh in the selected period`,
    facilities: `Solar system status: ${balancePct > 20 ? "Check string imbalance" : "OK"}`,
    sustainability: `Solar is covering ${solarFraction.toFixed(0)}% of the building load right now`,
    it: `Battery backup: ${hoursBackup} hours at current load`,
    worker: `The building is ${solarFraction.toFixed(0)}% solar powered right now`,
    visitor: `Right now, solar is powering ${solarFraction.toFixed(0)}% of this building`,
  };

  return bannerMap[activeRole] || null;
}

function SegmentedButton({ active, onClick, children, compact = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: compact ? 1 : undefined,
        background: active ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.08)",
        color: active ? "#FBBF24" : "#DDEFFF",
        border: active
          ? "1px solid rgba(251,191,36,0.3)"
          : "1px solid rgba(186,230,253,0.35)",
        borderRadius: 6,
        padding: compact ? "5px 0" : "7px 2px",
        fontSize: 10,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function MetricCard({ value, label, color }) {
  return (
    <div
      style={{
        flex: 1,
        background: "rgba(15,23,42,0.8)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        padding: "10px 8px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 10, color: "#64748B", marginBottom: 6, marginTop: 6 }}>
      {children}
    </div>
  );
}

function TimeRangeTabs({ horizon, setHorizon }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
      {HORIZON_OPTIONS.map(({ hours, label }) => (
        <SegmentedButton
          key={hours}
          compact
          active={horizon === hours}
          onClick={() => setHorizon(hours)}
        >
          {label}
        </SegmentedButton>
      ))}
    </div>
  );
}

function TimeAxis({ ticks }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 9,
        color: "#475569",
        marginBottom: 10,
      }}
    >
      {ticks.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  );
}

function SeriesChart({
  label,
  series,
  color = "#60A5FA",
  width: propWidth,
  height = CHART_H,
  fixedMin = null,
  fixedMax = null,
  fill = null,
  dashedLines = [],
  topLabelFormatter = (v) => `${v.toFixed(1)}`,
  bottomLabelFormatter = (v) => `${v.toFixed(1)}`,
}) {
  // Responsive width
  const containerRef = useRef(null);
  const [width, setWidth] = useState(propWidth || 256);
  useLayoutEffect(() => {
    if (!propWidth && containerRef.current) {
      const handleResize = () => {
        setWidth(containerRef.current.offsetWidth || 256);
      };
      handleResize();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, [propWidth]);

  const values = (series || []).map((x) => x.value).filter(Number.isFinite);
  if (!values.length) return null;
  const min = fixedMin ?? Math.min(...values, 0);
  const max = fixedMax ?? Math.max(...values, 0.001);
  const range = Math.max(0.001, max - min);
  const xOf = (i, len) => (i / Math.max(1, len - 1)) * width;
  const yOf = (v) => height - ((v - min) / range) * height;
  const points = series
    .map((p, i) => `${xOf(i, series.length)},${yOf(p.value)}`)
    .join(" ");
  const fillPoints = `0,${height} ${points} ${width},${height}`;

  // Tooltip state
  const [hoverIdx, setHoverIdx] = useState(null);
  const handleMouseMove = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round((x / width) * (series.length - 1));
    setHoverIdx(Math.max(0, Math.min(series.length - 1, idx)));
  };
  const handleMouseLeave = () => setHoverIdx(null);

  // Time axis ticks (use actual times)
  const tickCount = 5;
  const tickIdxs = Array.from({ length: tickCount }, (_, i) => Math.round((series.length - 1) * (i / (tickCount - 1))));
  const tickLabels = tickIdxs.map((idx) => series[idx]?.time || "");

  // Show date of first reading (if available)
  let dateLabel = null;
  if (series && series.length > 0) {
    const d = new Date(series[0].timestampMs);
    dateLabel = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return (
    <div ref={containerRef} style={{ marginBottom: 10, width: propWidth ? propWidth : "100%" }}>
      {dateLabel && (
        <div style={{ fontSize: 10, color: "#FBBF24", marginBottom: 2, fontWeight: 600 }}>{dateLabel}</div>
      )}
      <div style={{ fontSize: 9, color: "#64748B", marginBottom: 6 }}>{label}</div>
      <svg
        width={width}
        height={height + 22}
        style={{
          display: "block",
          borderRadius: 4,
          background: "rgba(10,15,26,0.7)",
          border: "1px solid rgba(125,211,252,0.10)",
          marginBottom: 2,
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {dashedLines.map((line, i) => (
          <line
            key={i}
            x1={0}
            y1={yOf(line.value)}
            x2={width}
            y2={yOf(line.value)}
            stroke={line.color}
            strokeWidth={1}
            strokeDasharray="3,3"
            opacity={0.35}
          />
        ))}

        {fill && <polyline points={fillPoints} fill={fill} stroke="none" />}

        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Tooltip marker */}
        {hoverIdx !== null && series[hoverIdx] && (() => {
          // Tooltip vertical positioning logic
          const cx = xOf(hoverIdx, series.length);
          const cy = yOf(series[hoverIdx].value);
          const tooltipWidth = 80;
          const tooltipHeight = 22;
          let tooltipY = cy - 28;
          // If tooltip would go above the chart, place it below the point
          if (tooltipY < 8) tooltipY = cy + 12;
          // If tooltip would go below the chart, clamp it
          if (tooltipY + tooltipHeight > height + 2) tooltipY = height - tooltipHeight - 2;
          const tooltipX = Math.min(width - tooltipWidth, Math.max(0, cx - tooltipWidth / 2));
          const textX = Math.min(width - tooltipWidth / 2, Math.max(tooltipWidth / 2, cx));
          return (
            <g>
              <circle
                cx={cx}
                cy={cy}
                r={3.5}
                fill="#fff"
                stroke={color}
                strokeWidth={1.2}
              />
              {/* Tooltip box */}
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height={tooltipHeight}
                rx={4}
                fill="#1e293b"
                stroke={color}
                strokeWidth={0.7}
                opacity={0.97}
              />
              <text
                x={textX}
                y={tooltipY + 10}
                fontSize={10}
                fill="#fff"
                textAnchor="middle"
                fontWeight="bold"
              >
                {series[hoverIdx].value.toFixed(2)}
              </text>
              <text
                x={textX}
                y={tooltipY + 20}
                fontSize={9}
                fill="#FBBF24"
                textAnchor="middle"
              >
                {series[hoverIdx].time}
              </text>
            </g>
          );
        })()}

        <text x={2} y={10} fontSize={8} fill={color} opacity={0.65}>
          {topLabelFormatter(max)}
        </text>
        <text x={2} y={height - 2} fontSize={8} fill={color} opacity={0.45}>
          {bottomLabelFormatter(min)}
        </text>

        {/* Time axis ticks */}
        {tickIdxs.map((idx, i) => (
          <g key={i}>
            <line
              x1={xOf(idx, series.length)}
              y1={height}
              x2={xOf(idx, series.length)}
              y2={height + 4}
              stroke="#64748B"
              strokeWidth={1}
            />
            <text
              x={xOf(idx, series.length)}
              y={height + 15}
              fontSize={8}
              fill="#64748B"
              textAnchor="middle"
            >
              {tickLabels[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DualSeriesChart({
  label,
  seriesA,
  seriesB,
  colorA = "#F59E0B",
  colorB = "#FCD34D",
  legendA = "Series A",
  legendB = "Series B",
  width: propWidth,
  height = STRING_CHART_H,
  annotation = null,
}) {
  // Responsive width
  const containerRef = useRef(null);
  const [width, setWidth] = useState(propWidth || 256);
  useLayoutEffect(() => {
    if (!propWidth && containerRef.current) {
      const handleResize = () => {
        setWidth(containerRef.current.offsetWidth || 256);
      };
      handleResize();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, [propWidth]);

  const values = [...(seriesA || []), ...(seriesB || [])].map((x) => x.value).filter(Number.isFinite);
  if (!values.length) return null;

  const max = Math.max(0.001, ...values);
  const xOf = (i, len) => (i / Math.max(1, len - 1)) * width;
  const yOf = (v) => height - (Math.max(0, v) / max) * height;

  const pointsA = (seriesA || [])
    .map((p, i) => `${xOf(i, seriesA.length)},${yOf(p.value)}`)
    .join(" ");

  const pointsB = (seriesB || [])
    .map((p, i) => `${xOf(i, seriesB.length)},${yOf(p.value)}`)
    .join(" ");

  // Tooltip state for dual series
  const [hoverIdx, setHoverIdx] = useState(null);
  const handleMouseMove = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round((x / width) * (seriesA.length - 1));
    setHoverIdx(Math.max(0, Math.min(seriesA.length - 1, idx)));
  };
  const handleMouseLeave = () => setHoverIdx(null);

  // Time axis ticks (use actual times)
  const tickCount = 5;
  const tickIdxs = Array.from({ length: tickCount }, (_, i) => Math.round((seriesA.length - 1) * (i / (tickCount - 1))));
  const tickLabels = tickIdxs.map((idx) => seriesA[idx]?.time || "");

  // Show date of first reading (if available)
  let dateLabel = null;
  if (seriesA && seriesA.length > 0) {
    const d = new Date(seriesA[0].timestampMs);
    dateLabel = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return (
    <div ref={containerRef} style={{ marginBottom: 10, width: propWidth ? propWidth : "100%" }}>
      {dateLabel && (
        <div style={{ fontSize: 10, color: "#FBBF24", marginBottom: 2, fontWeight: 600 }}>{dateLabel}</div>
      )}
      <div style={{ fontSize: 9, color: "#64748B", marginBottom: 6 }}>{label}</div>
      <svg
        width={width}
        height={height + 22}
        style={{
          display: "block",
          borderRadius: 4,
          background: "rgba(10,15,26,0.7)",
          border: "1px solid rgba(125,211,252,0.10)",
          marginBottom: 4,
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {pointsA && (
          <polyline
            points={pointsA}
            fill="none"
            stroke={colorA}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {pointsB && (
          <polyline
            points={pointsB}
            fill="none"
            stroke={colorB}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {annotation && (
          <g>
            <line
              x1={annotation.x}
              y1={annotation.y}
              x2={annotation.x}
              y2={annotation.y - 10}
              stroke="#EF4444"
              strokeWidth={1}
            />
            <text
              x={annotation.x}
              y={annotation.y - 13}
              textAnchor="middle"
              fontSize={8}
              fill="#EF4444"
            >
              {annotation.text}
            </text>
          </g>
        )}

        {/* Tooltip marker for dual series */}
        {hoverIdx !== null && seriesA[hoverIdx] && (() => {
          const cx = xOf(hoverIdx, seriesA.length);
          const cyA = yOf(seriesA[hoverIdx].value);
          const cyB = yOf(seriesB[hoverIdx].value);
          const tooltipWidth = 90;
          const tooltipHeight = 28;
          let tooltipY = Math.min(cyA, cyB) - 32;
          if (tooltipY < 8) tooltipY = Math.max(cyA, cyB) + 12;
          if (tooltipY + tooltipHeight > height + 2) tooltipY = height - tooltipHeight - 2;
          const tooltipX = Math.min(width - tooltipWidth, Math.max(0, cx - tooltipWidth / 2));
          const textX = Math.min(width - tooltipWidth / 2, Math.max(tooltipWidth / 2, cx));
          return (
            <g>
              <circle
                cx={cx}
                cy={cyA}
                r={3.5}
                fill="#fff"
                stroke={colorA}
                strokeWidth={1.2}
              />
              <circle
                cx={cx}
                cy={cyB}
                r={3.5}
                fill="#fff"
                stroke={colorB}
                strokeWidth={1.2}
              />
              {/* Tooltip box */}
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height={tooltipHeight}
                rx={4}
                fill="#1e293b"
                stroke="#F59E0B"
                strokeWidth={0.7}
                opacity={0.97}
              />
              <text
                x={textX}
                y={tooltipY + 12}
                fontSize={10}
                fill={colorA}
                textAnchor="middle"
                fontWeight="bold"
              >
                {seriesA[hoverIdx].value.toFixed(2)} / {seriesB[hoverIdx].value.toFixed(2)}
              </text>
              <text
                x={textX}
                y={tooltipY + 23}
                fontSize={9}
                fill="#FBBF24"
                textAnchor="middle"
              >
                {seriesA[hoverIdx].time}
              </text>
            </g>
          );
        })()}

        {/* Time axis ticks */}
        {tickIdxs.map((idx, i) => (
          <g key={i}>
            <line
              x1={xOf(idx, seriesA.length)}
              y1={height}
              x2={xOf(idx, seriesA.length)}
              y2={height + 4}
              stroke="#64748B"
              strokeWidth={1}
            />
            <text
              x={xOf(idx, seriesA.length)}
              y={height + 15}
              fontSize={8}
              fill="#64748B"
              textAnchor="middle"
            >
              {tickLabels[i]}
            </text>
          </g>
        ))}
      </svg>

      <div style={{ display: "flex", gap: 10, fontSize: 9 }}>
        <span style={{ color: colorA }}>■ {legendA}</span>
        <span style={{ color: colorB }}>■ {legendB}</span>
      </div>
    </div>
  );
}

function OverviewView({ metrics }) {
  if (!metrics) return null;

  const { pvKw, batteryKw, socPct, loadKw, gridKw, exportKw } = metrics.latest;

  const battLabel =
    batteryKw > 0.1 ? "charging" : batteryKw < -0.1 ? "discharging" : "standby";

  const battColor = socPct > 50 ? "#60A5FA" : socPct > 20 ? "#FBBF24" : "#EF4444";

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <MetricCard value={`${pvKw.toFixed(1)} kW`} label="solar now" color="#FBBF24" />
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 2, textAlign: 'center' }}>
            Current power being generated by the solar panels.
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <MetricCard value={`${socPct.toFixed(0)}%`} label={battLabel} color={battColor} />
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 2, textAlign: 'center' }}>
            Battery state of charge and status (charging/discharging/standby).
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <MetricCard value={`${loadKw.toFixed(1)} kW`} label="building load" color="#94A3B8" />
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 2, textAlign: 'center' }}>
            Total power currently consumed by the building.
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <MetricCard value={`${metrics.latest.gridKw.toFixed(1)} kW`} label="grid import now" color="#EF4444" />
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 2, textAlign: 'center' }}>
            Real-time power drawn from the grid.
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <MetricCard value={`${metrics.latest.exportKw.toFixed(1)} kW`} label="grid export now" color="#818CF8" />
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 2, textAlign: 'center' }}>
            Real-time power exported to the grid.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          marginBottom: 8,
        }}
      >
        {[
          {
            label: "Grid import",
            value: `${metrics.totals.gridImportKwh.toFixed(1)} kWh`,
            color: "#EF4444",
            desc: "Total energy drawn from the external grid in the selected period."
          },
          {
            label: "Grid export",
            value: `${metrics.totals.gridExportKwh.toFixed(1)} kWh`,
            color: "#818CF8",
            desc: "Total excess solar energy sent back to the grid in the selected period."
          },
          {
            label: "PV total",
            value: `${metrics.totals.pvKwh.toFixed(1)} kWh`,
            color: "#F59E0B",
            desc: "Total solar energy generated in the selected period."
          },
          {
            label: "Self used",
            value: `${metrics.totals.selfUsedKwh.toFixed(1)} kWh`,
            color: "#4ADE80",
            desc: "Solar energy used directly by the building."
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              background: "rgba(15,23,42,0.6)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "#64748B",
                textTransform: "uppercase",
                marginBottom: 2,
              }}
            >
              {item.label}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 9, color: '#64748B', marginTop: 2, textAlign: 'center' }}>{item.desc}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function PowerView({ pvData, replayData, horizon }) {
  const pvSeries = pvData?.pvTotal || [];
  const loadSeries = alignReplayLoadToPv(pvSeries, replayData?.main || []);
  const gridImport = pvData?.gridImport || [];
  const gridExport = pvData?.gridExport || [];
  const meterSeries = pvData?.meterSeries || [];
  const ticks = getTimeAxisTicks(horizon);

  if (!pvSeries.length) {
    return <div style={{ fontSize: 10, color: "#9AB8D7", padding: "12px 0" }}>No data available for this period.</div>;
  }

  const peakIdx = pvSeries.reduce(
    (best, p, i) => (p.value > (pvSeries[best]?.value ?? -Infinity) ? i : best),
    0
  );
  const peakPoint = pvSeries[peakIdx];

  return (
    <>
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>Solar production (kW):</b> Shows the real-time power generated by the solar panels. The peak value and time are highlighted.
      </div>
      <SeriesChart
        label={`Solar production (kW) — peak at ${peakPoint?.time || "--:--"}: ${(peakPoint?.value || 0).toFixed(1)} kW`}
        series={pvSeries}
        color="#F59E0B"
        fill="rgba(245,158,11,0.15)"
        fixedMin={0}
        topLabelFormatter={(v) => `${v.toFixed(1)} kW`}
        bottomLabelFormatter={() => "0"}
      />
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>Building load (kW):</b> Displays the total power currently consumed by the building.
      </div>
      <SeriesChart
        label="Building load (kW)"
        series={loadSeries}
        color="#94A3B8"
        fill={null}
        fixedMin={0}
        topLabelFormatter={(v) => `${v.toFixed(1)} kW`}
        bottomLabelFormatter={() => "0"}
      />
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>Grid import (kW):</b> Power drawn from the external grid to meet building demand when solar and battery are insufficient.
      </div>
      <SeriesChart
        label="Grid import (kW)"
        series={gridImport}
        color="#EF4444"
        fixedMin={0}
        topLabelFormatter={(v) => `${v.toFixed(1)} kW`}
        bottomLabelFormatter={() => "0"}
      />
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>Grid export (kW):</b> Excess solar power sent back to the grid when generation exceeds building needs.
      </div>
      <SeriesChart
        label="Grid export (kW)"
        series={gridExport}
        color="#818CF8"
        fixedMin={0}
        topLabelFormatter={(v) => `${v.toFixed(1)} kW`}
        bottomLabelFormatter={() => "0"}
      />
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>Meter total (kW):</b> The total measured power at the main meter, including all sources and loads.
      </div>
      <SeriesChart
        label="Meter total (kW)"
        series={meterSeries}
        color="#22C55E"
        topLabelFormatter={(v) => `${v.toFixed(1)} kW`}
        bottomLabelFormatter={(v) => `${v.toFixed(1)} kW`}
      />
      <TimeAxis ticks={ticks} />
    </>
  );
}

function BatteryView({ pvData, horizon }) {
  const batteryPower = pvData?.pvBattery || [];
  const socSeries = pvData?.soc || [];
  const tempSeries = pvData?.bmsTemp || [];
  const ticks = getTimeAxisTicks(horizon);

  if (!batteryPower.length && !socSeries.length && !tempSeries.length) {
    return <div style={{ fontSize: 10, color: "#9AB8D7", padding: "12px 0" }}>No battery data available for this period.</div>;
  }

  return (
    <>
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>Battery power (kW):</b> Shows the charging (positive) or discharging (negative) power of the battery.
      </div>
      <SeriesChart
        label="Battery power (kW)"
        series={batteryPower}
        color="#60A5FA"
        topLabelFormatter={(v) => `${v.toFixed(1)} kW`}
        bottomLabelFormatter={(v) => `${v.toFixed(1)} kW`}
      />
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>Battery charge (%):</b> The state of charge of the battery, indicating how full it is.
      </div>
      <SeriesChart
        label="Battery charge (%)"
        series={socSeries}
        color="#38BDF8"
        fixedMin={0}
        fixedMax={100}
        dashedLines={[
          { value: 80, color: "#4ADE80" },
          { value: 20, color: "#EF4444" },
        ]}
        topLabelFormatter={() => "100%"}
        bottomLabelFormatter={() => "0%"}
      />
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>BMS temperature (°C):</b> The temperature of the battery management system, important for battery health.
      </div>
      <SeriesChart
        label="BMS temperature (°C)"
        series={tempSeries}
        color="#F97316"
        topLabelFormatter={(v) => `${v.toFixed(1)}°C`}
        bottomLabelFormatter={(v) => `${v.toFixed(1)}°C`}
      />
      <TimeAxis ticks={ticks} />
    </>
  );
}

function StringsView({ pvData, metrics, horizon }) {
  const pv1Series = pvData?.pv1Power || [];
  const pv2Series = pvData?.pv2Power || [];
  const balance = metrics?.strings?.balancePct ?? 0;

  if (!pv1Series.length && !pv2Series.length) {
    return <div style={{ fontSize: 10, color: "#9AB8D7", padding: "12px 0" }}>No string data available for this period.</div>;
  }

  const minLen = Math.min(pv1Series.length, pv2Series.length);
  let maxDivIdx = 0;
  let maxDivVal = 0;

  for (let i = 0; i < minLen; i++) {
    const diff = Math.abs((pv1Series[i]?.value ?? 0) - (pv2Series[i]?.value ?? 0));
    if (diff > maxDivVal) {
      maxDivVal = diff;
      maxDivIdx = i;
    }
  }

  const allVals = [...pv1Series, ...pv2Series].map((x) => x.value).filter(Number.isFinite);
  const max = Math.max(0.001, ...allVals);
  const xOf = (i, len) => (i / Math.max(1, len - 1)) * CHART_W;
  const yOf = (v) => STRING_CHART_H - (Math.max(0, v) / max) * STRING_CHART_H;

  const annotation =
    balance > 20 && maxDivVal > 0
      ? {
          x: xOf(maxDivIdx, minLen || 1),
          y: yOf(((pv1Series[maxDivIdx]?.value ?? 0) + (pv2Series[maxDivIdx]?.value ?? 0)) / 2),
          text: "Largest gap here",
        }
      : null;

  const horizonLabel = HORIZON_OPTIONS.find((o) => o.hours === horizon)?.label ?? `${horizon}h`;

  const pv1Kwh = metrics?.totals?.pv1Kwh ?? 0;
  const pv2Kwh = metrics?.totals?.pv2Kwh ?? 0;

  const statusColor = balance < 10 ? "#4ADE80" : balance <= 20 ? "#FBBF24" : "#EF4444";
  const statusText =
    balance < 10
      ? "Both strings generating evenly"
      : balance <= 20
      ? `Strings differ by ${balance.toFixed(0)}% — could be cloud or dust`
      : `String imbalance: ${balance.toFixed(0)}% — inspect the lower string`;

  const summaryText =
    balance < 5
      ? "Both strings are generating equally — system is healthy."
      : balance < 20
      ? "Strings are slightly different — worth checking after the next sunny day."
      : `String 1 generated ${pv1Kwh.toFixed(1)} kWh, String 2 generated ${pv2Kwh.toFixed(1)} kWh over the last ${horizonLabel}. Inspect the lower string.`;

  return (
    <>
      <div
        style={{
          fontSize: 11,
          color: statusColor,
          marginBottom: 10,
          padding: "6px 8px",
          background: `${statusColor}11`,
          border: `1px solid ${statusColor}33`,
          borderRadius: 6,
        }}
      >
        {statusText}
      </div>
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <b>PV string comparison (kW):</b> Compares the output of two separate solar panel strings to detect imbalances or faults.
      </div>
      <DualSeriesChart
        label="PV string comparison (kW)"
        seriesA={pv1Series}
        seriesB={pv2Series}
        colorA="#F59E0B"
        colorB="#FCD34D"
        legendA="String 1"
        legendB="String 2"
        annotation={annotation}
      />
      <div style={{ fontSize: 10, color: "#64748B", textAlign: "center", marginTop: 8 }}>
        {summaryText}
      </div>
    </>
  );
}

export default function SolarPanel({
  replayData,
  replayDataRef,
  tariffRate,
  pvDataRef,
  getBuildingJson,
  activeRole,
}) {
  const [pvLoading, setPvLoading] = useState(false);
  const [pvError, setPvError] = useState(null);
  const [solarView, setSolarView] = useState("overview");
  const [horizon, setHorizon] = useState(48);
  const [pvDataTick, setPvDataTick] = useState(0);

  const loadPVData = useCallback(
    async (hours, silent = false) => {
      if (!silent) setPvLoading(true);
      setPvError(null);
      pvDataRef.current = {};

      try {
        const readings = await fetchSolar(toSofiaDateParams(hours));

        if (readings.length) {
          pvDataRef.current = transformSolarReadings(readings);
        } else {
          setPvError("Solar history unavailable from Gate API for this period");
        }
      } catch (err) {
        console.warn("PV data load failed:", err);
        setPvError("Solar data unavailable");
      } finally {
        if (!silent) setPvLoading(false);
        setPvDataTick((t) => t + 1);
      }
    },
    [pvDataRef]
  );

  // Initial and on-horizon-change load
  useEffect(() => {
    loadPVData(horizon);
  }, [horizon, loadPVData]);

  // Real-time polling for live updates (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      loadPVData(horizon, true); // silent update
    }, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, [horizon, loadPVData]);

  void replayDataRef;
  void tariffRate;
  void getBuildingJson;
  void pvDataTick;

  const pvData = pvDataRef.current;

  const metrics = useMemo(() => computeSolarMetrics(pvData, replayData), [pvData, replayData]);
  const roleBanner = useMemo(() => getRoleBanner(metrics, activeRole), [metrics, activeRole]);

  return (
    <>
      {pvLoading && (
        <div style={{ textAlign: "center", padding: "32px 0", color: "#475569", fontSize: 12 }}>
          Loading solar data...
        </div>
      )}

      {pvError && (
        <div
          style={{
            textAlign: "center",
            padding: "16px",
            background: "rgba(251,191,36,0.06)",
            borderRadius: 8,
            fontSize: 11,
            color: "#FDE68A",
            marginBottom: 8,
          }}
        >
          Using estimated values — live solar data unavailable
        </div>
      )}

      {roleBanner && (
        <div
          style={{
            fontSize: 11,
            color: "#FBBF24",
            textAlign: "center",
            padding: "6px 0",
            marginBottom: 8,
          }}
        >
          {roleBanner}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 10 }}>
        {VIEW_OPTIONS.map(({ key, label }) => (
          <SegmentedButton
            key={key}
            active={solarView === key}
            onClick={() => setSolarView(key)}
          >
            {label}
          </SegmentedButton>
        ))}
      </div>

      <TimeRangeTabs horizon={horizon} setHorizon={setHorizon} />

      {solarView === "overview" && <OverviewView metrics={metrics} />}

      {solarView === "power" && (
        <PowerView pvData={pvData} replayData={replayData} horizon={horizon} />
      )}

      {solarView === "battery" && (
        <BatteryView pvData={pvData} horizon={horizon} />
      )}

      {solarView === "strings" && (
        <StringsView pvData={pvData} metrics={metrics} horizon={horizon} />
      )}
    </>
  );
}