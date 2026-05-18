import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { fetchAllSensors, fetchSensorFloor, fetchSensorMeta } from "../services/gateBuildingRepository.js";
import { toSofiaDateParams } from "../utils/timeUtils.js";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
);

const RANGE_OPTIONS = [7, 30, 90];
const ROOM_RANGE_OPTIONS = [24, 48, 168, 720];

const BASE_CARD = {
  background: "linear-gradient(180deg, rgba(12,18,32,0.96), rgba(7,12,23,0.96))",
  border: "1px solid rgba(148,163,184,0.18)",
  borderRadius: 16,
  boxShadow: "0 22px 70px rgba(2,6,23,0.6)",
};

const PANEL_BG = "rgba(2, 6, 23, 0.72)";
const TEXT_DIM = "rgba(226,232,240,0.64)";
const TEXT_SOFT = "rgba(226,232,240,0.84)";
const GRID_COLOR = "rgba(148,163,184,0.14)";

const CIRCUIT_COLORS = [
  "#38BDF8",
  "#60A5FA",
  "#34D399",
  "#FBBF24",
  "#FB7185",
  "#A78BFA",
  "#F97316",
  "#22C55E",
  "#E879F9",
  "#F59E0B",
];

const CHART_INFO = {
  kpis: {
    title: "KPI summary",
    formula: "Latest = last power point; Last full day = last completed daily kWh; Peak 24h = max power in trailing 24h; Avg day = mean of daily kWh totals.",
    text: "These cards summarize the selected circuit or the main building feed when ALL is selected.",
  },
  dailyTotals: {
    title: "Daily totals",
    formula: "Daily kWh = sum of trapezoid-integrated power across each calendar day.",
    text: "Power readings are converted into energy by integrating between consecutive samples.",
  },
  hourlyProfile: {
    title: "Hourly profile",
    formula: "Hourly average = average power for all samples that fall in the same hour of day.",
    text: "Shows the typical load pattern across 24 hours.",
  },
  weekdayWeekend: {
    title: "Weekday vs weekend",
    formula: "Average daily kWh for weekdays vs average daily kWh for weekends.",
    text: "Compares day types without bias from different day counts.",
  },
  peakDemand: {
    title: "Peak demand",
    formula: "Top 5 = highest instantaneous power points in the selected dataset.",
    text: "Ranks the biggest spikes with timestamp and circuit context.",
  },
  workNonWork: {
    title: "Working vs non-working",
    formula: "Working = weekday 08:00-17:59 average power; Non-working = all remaining hours average power.",
    text: "Highlights how much load remains outside normal operating hours.",
  },
  seasonal: {
    title: "Seasonal comparison",
    formula: "Seasonal kWh = sum of daily totals grouped by season over the selected window.",
    text: "This uses the available date range, so shorter windows may only show one or two seasons.",
  },
  typicalDay: {
    title: "Typical day",
    formula: "Typical load = same hourly profile rendered as a 24-hour curve.",
    text: "Useful for spotting ramp-up, lunch-time peaks, and overnight baseload.",
  },
  circuitShare: {
    title: "Circuit share",
    formula: "Share = circuit kWh / total kWh across available subcircuits.",
    text: "Only shown for ALL, to indicate which subcircuits dominate the period.",
  },
  roomKpis: {
    title: "Room KPI summary",
    formula: "Current values = latest timestamp returned for the selected room after averaging same-timestamp sensor readings across all sensors in that room.",
    text: "This gives one room-level temperature, humidity, and CO2 snapshot even when a room has multiple sensors.",
  },
  roomCombined: {
    title: "Combined room trends",
    formula: "Each line plots the selected room over time; when multiple sensors exist in the room, values are averaged per timestamp and parameter.",
    text: "Use this to compare temperature, humidity, and CO2 movement over the same period without switching charts.",
  },
  roomTemperature: {
    title: "Temperature trend",
    formula: "Temperature line = averaged room temperature by timestamp in degrees Celsius.",
    text: "This makes drift, overheating, and recovery periods visible for the selected room.",
  },
  roomHumidity: {
    title: "Humidity trend",
    formula: "Humidity line = averaged room relative humidity by timestamp in %RH.",
    text: "Use this to spot dryness, damp conditions, or instability after HVAC changes.",
  },
  roomCo2: {
    title: "CO2 trend",
    formula: "CO2 line = averaged room CO2 concentration by timestamp in ppm.",
    text: "This is useful for identifying occupancy build-up, ventilation lag, and poor air refresh periods.",
  },
  occupancyMethod: {
    title: "Room comfort methodology",
    formula: "Overall comfort is a weighted score: temperature 40%, humidity 30%, CO2 30%. Each room uses the latest available averaged sensor values for those three signals.",
    text: "This is a room-comfort assessment, not a live occupancy count. It shows how close the room is to the target environmental conditions.",
  },
};

function dbCircuitId(id) {
  return id === "3DLED" ? "x3dled" : id;
}

function parseTimestampMs(ts) {
  const value = Date.parse(ts);
  return Number.isFinite(value) ? value : NaN;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function localDayKey(timestampMs) {
  const dt = new Date(timestampMs);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function shortDayLabel(dayKey) {
  const dt = new Date(`${dayKey}T12:00:00`);
  return `${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}`;
}

function dateTimeLabel(ts) {
  const dt = new Date(ts);
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSeason(date) {
  const month = date.getMonth() + 1;
  if ([12, 1, 2].includes(month)) return "Winter";
  if ([3, 4, 5].includes(month)) return "Spring";
  if ([6, 7, 8].includes(month)) return "Summer";
  return "Autumn";
}

function formatPower(value) {
  if (!Number.isFinite(value)) return "-";
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)} kW` : `${value.toFixed(0)} W`;
}

function formatEnergy(value) {
  if (!Number.isFinite(value)) return "-";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} MWh` : `${value.toFixed(1)} kWh`;
}

function formatCircuitLabel(circuitId, circuitConfigs) {
  return circuitConfigs?.[circuitId]?.label || circuitId;
}

function formatRoomLabel(roomId) {
  return String(roomId || "Room")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function flattenRoomOptions(sensorMeta) {
  return Object.entries(sensorMeta || {})
    .flatMap(([floorKey, floorValue]) => {
      const floorMatch = String(floorKey).match(/(\d+)/);
      const floor = floorMatch ? Number(floorMatch[1]) : Number(floorKey);
      const rooms = floorValue?.rooms || {};
      return Object.entries(rooms).map(([roomId, roomMeta]) => ({
        key: `${floor}:${roomId}`,
        floor,
        roomId,
        label: `${formatRoomLabel(roomId)} • Floor ${floor}`,
        sensorCount: Array.isArray(roomMeta?.sensor_ids) ? roomMeta.sensor_ids.length : 0,
        parameters: Array.isArray(roomMeta?.parameters) ? roomMeta.parameters : [],
      }));
    })
    .filter((room) => Number.isFinite(room.floor) && room.roomId)
    .sort((a, b) => {
      if (a.floor !== b.floor) return a.floor - b.floor;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
}

function aggregateRoomTrendPoints(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const timestampMs = Number(row?.timestampMs);
    const parameter = String(row?.parameter || "");
    const value = Number(row?.value);
    if (!Number.isFinite(timestampMs) || !Number.isFinite(value) || !parameter) return;

    const entry = grouped.get(timestampMs) || {
      timestampMs,
      tsISO: row.tsISO || new Date(timestampMs).toISOString(),
      tempSum: 0,
      tempCount: 0,
      humiditySum: 0,
      humidityCount: 0,
      co2Sum: 0,
      co2Count: 0,
    };

    if (parameter === "Temp") {
      entry.tempSum += value;
      entry.tempCount += 1;
    } else if (parameter === "Humidity") {
      entry.humiditySum += value;
      entry.humidityCount += 1;
    } else if (parameter === "CO2") {
      entry.co2Sum += value;
      entry.co2Count += 1;
    }

    grouped.set(timestampMs, entry);
  });

  return Array.from(grouped.values())
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((entry) => ({
      timestampMs: entry.timestampMs,
      tsISO: entry.tsISO,
      temperature: entry.tempCount ? entry.tempSum / entry.tempCount : null,
      humidity: entry.humidityCount ? entry.humiditySum / entry.humidityCount : null,
      co2: entry.co2Count ? entry.co2Sum / entry.co2Count : null,
    }));
}

function downsampleRoomTrendPoints(points, targetCount = 480) {
  if (!Array.isArray(points) || points.length <= targetCount) return points;
  const stride = (points.length - 1) / (targetCount - 1);
  return Array.from({ length: targetCount }, (_, index) => points[Math.round(index * stride)]).filter(Boolean);
}

function formatRoomTrendLabel(timestampMs, rangeHours) {
  return new Date(timestampMs).toLocaleString(undefined, rangeHours <= 48
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: rangeHours <= 168 ? "2-digit" : undefined, minute: rangeHours <= 168 ? "2-digit" : undefined });
}

function formatRoomMetric(value, suffix, digits = 1) {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : "-";
}

function calculateTemperatureScore(temp) {
  if (!Number.isFinite(temp)) return null;
  if (temp >= 20 && temp <= 24) return 100;
  if (temp >= 18 && temp < 20) return 100 - ((20 - temp) * 25);
  if (temp > 24 && temp <= 26) return 100 - ((temp - 24) * 25);
  if (temp >= 16 && temp < 18) return 50 - ((18 - temp) * 25);
  if (temp > 26 && temp <= 28) return 50 - ((temp - 26) * 25);
  if (temp < 16) return Math.max(0, 25 - ((16 - temp) * 5));
  if (temp > 28) return Math.max(0, 25 - ((temp - 28) * 5));
  return 0;
}

function calculateHumidityScore(humidity) {
  if (!Number.isFinite(humidity)) return null;
  if (humidity >= 40 && humidity <= 60) return 100;
  if (humidity >= 30 && humidity < 40) return 75 + ((humidity - 30) * 2.5);
  if (humidity > 60 && humidity <= 70) return 75 + ((70 - humidity) * 2.5);
  if (humidity >= 20 && humidity < 30) return 25 + ((humidity - 20) * 5);
  if (humidity > 70 && humidity <= 80) return 25 + ((80 - humidity) * 5);
  if (humidity < 20) return Math.max(0, humidity * 1.25);
  if (humidity > 80) return Math.max(0, (100 - humidity) * 1.25);
  return 0;
}

function calculateCO2Score(co2) {
  if (!Number.isFinite(co2)) return null;
  if (co2 < 800) return 100;
  if (co2 <= 1000) return 100 - ((co2 - 800) * 0.125);
  if (co2 <= 1500) return 75 - ((co2 - 1000) * 0.1);
  if (co2 <= 2000) return 25 - ((co2 - 1500) * 0.05);
  return 0;
}

function calculateOverallComfort(tempScore, humScore, co2Score) {
  const scores = [tempScore, humScore, co2Score].filter((value) => Number.isFinite(value));
  if (!scores.length) return null;

  let total = 0;
  let weight = 0;

  if (Number.isFinite(tempScore)) {
    total += tempScore * 0.4;
    weight += 0.4;
  }
  if (Number.isFinite(humScore)) {
    total += humScore * 0.3;
    weight += 0.3;
  }
  if (Number.isFinite(co2Score)) {
    total += co2Score * 0.3;
    weight += 0.3;
  }

  return weight > 0 ? total / weight : null;
}

function getComfortLevel(score) {
  if (!Number.isFinite(score)) return { label: "Unknown", color: "#94A3B8", background: "rgba(148,163,184,0.12)" };
  if (score >= 85) return { label: "Excellent", color: "#22C55E", background: "rgba(34,197,94,0.14)" };
  if (score >= 70) return { label: "Good", color: "#84CC16", background: "rgba(132,204,22,0.14)" };
  if (score >= 50) return { label: "Fair", color: "#F59E0B", background: "rgba(245,158,11,0.14)" };
  if (score >= 25) return { label: "Poor", color: "#F97316", background: "rgba(249,115,22,0.14)" };
  return { label: "Very poor", color: "#EF4444", background: "rgba(239,68,68,0.14)" };
}

function latestAverageByParameter(rows, parameter) {
  const filtered = rows.filter((row) => row.parameter === parameter && Number.isFinite(row.timestampMs) && Number.isFinite(row.value));
  if (!filtered.length) return { value: null, timestampMs: null, tsISO: null };
  const latestTimestampMs = Math.max(...filtered.map((row) => row.timestampMs));
  const latestRows = filtered.filter((row) => row.timestampMs === latestTimestampMs);
  const average = latestRows.reduce((sum, row) => sum + row.value, 0) / latestRows.length;
  return { value: average, timestampMs: latestTimestampMs, tsISO: latestRows[0]?.tsISO || null };
}

function buildRoomComfortRows(sensorRows, roomOptions) {
  const rowsByRoom = new Map();
  sensorRows.forEach((row) => {
    const key = `${row.floor}:${row.room_id}`;
    const list = rowsByRoom.get(key) || [];
    list.push(row);
    rowsByRoom.set(key, list);
  });

  return roomOptions.map((room) => {
    const rows = rowsByRoom.get(room.key) || [];
    const tempInfo = latestAverageByParameter(rows, "Temp");
    const humidityInfo = latestAverageByParameter(rows, "Humidity");
    const co2Info = latestAverageByParameter(rows, "CO2");
    const latestTimestampMs = Math.max(tempInfo.timestampMs || 0, humidityInfo.timestampMs || 0, co2Info.timestampMs || 0) || null;
    const tempScore = calculateTemperatureScore(tempInfo.value);
    const humScore = calculateHumidityScore(humidityInfo.value);
    const co2Score = calculateCO2Score(co2Info.value);
    const overallScore = calculateOverallComfort(tempScore, humScore, co2Score);

    return {
      ...room,
      temperature: tempInfo.value,
      humidity: humidityInfo.value,
      co2: co2Info.value,
      tempScore,
      humScore,
      co2Score,
      overallScore,
      latestTimestampMs,
      latestTsISO: latestTimestampMs ? new Date(latestTimestampMs).toISOString() : null,
    };
  }).filter((room) => Number.isFinite(room.temperature) || Number.isFinite(room.humidity) || Number.isFinite(room.co2));
}

function normalizeRows(rawRows) {
  return (rawRows || [])
    .map((row) => ({
      ...row,
      timestampMs: parseTimestampMs(row.ts_5min),
      value: Number(row.value ?? 0),
    }))
    .filter((row) => Number.isFinite(row.timestampMs) && Number.isFinite(row.value))
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

function groupRowsByCircuit(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const circuitId = String(row.circuit_id || "unknown");
    const list = map.get(circuitId) || [];
    list.push(row);
    map.set(circuitId, list);
  });
  return map;
}

function aggregateRowsByTimestamp(rows) {
  const bucket = new Map();
  rows.forEach((row) => {
    const key = row.ts_5min;
    const entry = bucket.get(key) || { ts_5min: row.ts_5min, timestampMs: row.timestampMs, value: 0, circuit_id: "aggregate" };
    entry.value += row.value;
    bucket.set(key, entry);
  });
  return Array.from(bucket.values()).sort((a, b) => a.timestampMs - b.timestampMs);
}

function integrateReadingsKwh(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const deltaHours = (current.timestampMs - previous.timestampMs) / 3600000;
    if (!Number.isFinite(deltaHours) || deltaHours <= 0 || deltaHours > 2) continue;
    total += (((previous.value + current.value) / 2) / 1000) * deltaHours;
  }
  return total;
}

function buildDailyTotals(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const totals = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const deltaHours = (current.timestampMs - previous.timestampMs) / 3600000;
    if (!Number.isFinite(deltaHours) || deltaHours <= 0 || deltaHours > 2) continue;
    const day = localDayKey(previous.timestampMs);
    const kwh = (((previous.value + current.value) / 2) / 1000) * deltaHours;
    totals.set(day, (totals.get(day) || 0) + kwh);
  }
  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, totalKwh]) => ({ day, totalKwh }));
}

function buildHourlyProfile(rows) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, sum: 0, count: 0 }));
  rows.forEach((row) => {
    const hour = new Date(row.timestampMs).getHours();
    hourly[hour].sum += row.value;
    hourly[hour].count += 1;
  });
  return hourly.map(({ hour, sum, count }) => ({
    hour,
    avgWatts: count ? sum / count : 0,
  }));
}

function buildWeekdayWeekend(dailyTotals) {
  let weekdaySum = 0;
  let weekdayCount = 0;
  let weekendSum = 0;
  let weekendCount = 0;

  dailyTotals.forEach(({ day, totalKwh }) => {
    const dow = new Date(`${day}T12:00:00`).getDay();
    if (dow === 0 || dow === 6) {
      weekendSum += totalKwh;
      weekendCount += 1;
    } else {
      weekdaySum += totalKwh;
      weekdayCount += 1;
    }
  });

  return [
    { label: `Weekday (${weekdayCount}d)`, totalKwh: weekdayCount ? weekdaySum / weekdayCount : 0 },
    { label: `Weekend (${weekendCount}d)`, totalKwh: weekendCount ? weekendSum / weekendCount : 0 },
  ];
}

function buildWorkVsNonWork(rows) {
  const working = { sum: 0, count: 0 };
  const nonWorking = { sum: 0, count: 0 };

  rows.forEach((row) => {
    const dt = new Date(row.timestampMs);
    const dayOfWeek = dt.getDay();
    const hour = dt.getHours();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isWorking = isWeekday && hour >= 8 && hour <= 17;
    if (isWorking) {
      working.sum += row.value;
      working.count += 1;
    } else {
      nonWorking.sum += row.value;
      nonWorking.count += 1;
    }
  });

  return [
    { label: "Working hours", avgWatts: working.count ? working.sum / working.count : 0 },
    { label: "Non-working hours", avgWatts: nonWorking.count ? nonWorking.sum / nonWorking.count : 0 },
  ];
}

function buildSeasonalTotals(dailyTotals) {
  const totals = new Map();
  dailyTotals.forEach(({ day, totalKwh }) => {
    const season = getSeason(new Date(`${day}T12:00:00`));
    totals.set(season, (totals.get(season) || 0) + totalKwh);
  });

  return ["Winter", "Spring", "Summer", "Autumn"]
    .filter((season) => totals.has(season))
    .map((season) => ({ season, totalKwh: totals.get(season) }));
}

function buildTopPeaks(rows, circuitConfigs) {
  return [...rows]
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((row) => ({
      ts: row.ts_5min,
      value: row.value,
      circuit_id: row.circuit_id,
      label: formatCircuitLabel(row.circuit_id, circuitConfigs),
    }));
}

function buildCircuitShare(rowsByCircuit, circuitConfigs) {
  const entries = Array.from(rowsByCircuit.entries())
    .filter(([circuitId]) => circuitId !== "main")
    .map(([circuitId, rows]) => ({
      circuitId,
      label: formatCircuitLabel(circuitId, circuitConfigs),
      totalKwh: integrateReadingsKwh(rows),
    }))
    .filter((row) => row.totalKwh > 0)
    .sort((a, b) => b.totalKwh - a.totalKwh);

  const total = entries.reduce((sum, row) => sum + row.totalKwh, 0);
  return entries.slice(0, 8).map((row) => ({
    ...row,
    pct: total ? (row.totalKwh / total) * 100 : 0,
  }));
}

function InfoButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        borderRadius: 999,
        border: "1px solid rgba(148,163,184,0.24)",
        background: "rgba(15,23,42,0.8)",
        color: "#CBD5E1",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      i
    </button>
  );
}

function SectionCard({ title, infoKey, onInfo, children, subtitle }) {
  return (
    <section style={{ ...BASE_CARD, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC" }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 4 }}>{subtitle}</div> : null}
        </div>
        {infoKey ? <InfoButton onClick={() => onInfo(infoKey)} /> : null}
      </div>
      {children}
    </section>
  );
}

function MetricTile({ label, value, sub, accent = "#38BDF8" }) {
  return (
    <div style={{
      background: PANEL_BG,
      border: "1px solid rgba(148,163,184,0.16)",
      borderRadius: 14,
      padding: "14px 16px",
      minHeight: 92,
    }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: TEXT_DIM, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 8 }}>{sub}</div> : null}
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div style={{ ...BASE_CARD, padding: 28, textAlign: "center" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#F8FAFC", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: TEXT_DIM }}>{detail}</div>
    </div>
  );
}

export default function EnergyAnalyticsPanel({ onClose, getPowerJson, circuitConfigs = {} }) {
  const [viewMode, setViewMode] = useState("energy");
  const [selectedCircuit, setSelectedCircuit] = useState("ALL");
  const [rangeDays, setRangeDays] = useState(90);
  const [rawRows, setRawRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeInfoChart, setActiveInfoChart] = useState("");
  const [roomOptions, setRoomOptions] = useState([]);
  const [selectedRoomKey, setSelectedRoomKey] = useState("");
  const [roomRangeHours, setRoomRangeHours] = useState(24);
  const [roomRows, setRoomRows] = useState([]);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [occupancyRows, setOccupancyRows] = useState([]);
  const [occupancyLoading, setOccupancyLoading] = useState(false);
  const [occupancyError, setOccupancyError] = useState("");
  const [occupancySortBy, setOccupancySortBy] = useState("comfort");
  const [occupancySortOrder, setOccupancySortOrder] = useState("desc");

  const dailyChartRef = useRef(null);
  const hourlyChartRef = useRef(null);
  const weekdayWeekendChartRef = useRef(null);
  const workChartRef = useRef(null);
  const seasonalChartRef = useRef(null);
  const typicalDayChartRef = useRef(null);
  const circuitShareChartRef = useRef(null);
  const roomCombinedChartRef = useRef(null);
  const roomTempChartRef = useRef(null);
  const roomHumidityChartRef = useRef(null);
  const roomCo2ChartRef = useRef(null);

  const circuitOptions = useMemo(() => {
    const ids = Object.keys(circuitConfigs || {}).sort((a, b) =>
      formatCircuitLabel(a, circuitConfigs).localeCompare(formatCircuitLabel(b, circuitConfigs), undefined, { sensitivity: "base" })
    );
    return [
      { id: "ALL", label: "All circuits" },
      ...ids.map((id) => ({ id, label: formatCircuitLabel(id, circuitConfigs) })),
    ];
  }, [circuitConfigs]);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      if (typeof getPowerJson !== "function") {
        setError("Analytics data source is not available.");
        setRawRows([]);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - (rangeDays * 24 * 60 * 60 * 1000));
        const requestedIds = selectedCircuit === "ALL"
          ? Object.keys(circuitConfigs || {})
          : [selectedCircuit];

        const circuitFilter = requestedIds.map((id) => dbCircuitId(id)).join(",");
        const rows = await getPowerJson("power_5min", {
          circuit_id: requestedIds.length === 1 ? `eq.${circuitFilter}` : `in.(${circuitFilter})`,
          and: `(ts_5min.gte.${startDate.toISOString()},ts_5min.lte.${endDate.toISOString()})`,
          order: "ts_5min.asc",
          limit: 250000,
        });

        if (!cancelled) {
          setRawRows(Array.isArray(rows) ? rows : []);
          setError("");
        }
      } catch (fetchError) {
        if (!cancelled) {
          setRawRows([]);
          setError(fetchError?.message || "Failed to load analytics data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [circuitConfigs, getPowerJson, rangeDays, selectedCircuit]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoomOptions() {
      try {
        const meta = await fetchSensorMeta();
        if (cancelled) return;
        const options = flattenRoomOptions(meta);
        setRoomOptions(options);
        setSelectedRoomKey((current) => current || options[0]?.key || "");
      } catch (fetchError) {
        if (!cancelled) {
          setRoomOptions([]);
          setRoomError(fetchError?.message || "Failed to load room metadata.");
        }
      }
    }

    loadRoomOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRoom = useMemo(
    () => roomOptions.find((room) => room.key === selectedRoomKey) || null,
    [roomOptions, selectedRoomKey]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadRoomTrends() {
      if (viewMode !== "rooms" || !selectedRoom) return;
      setRoomLoading(true);
      setRoomError("");

      try {
        const dateRange = toSofiaDateParams(roomRangeHours);
        const readings = await fetchSensorFloor(selectedRoom.floor, dateRange, selectedRoom.roomId);
        if (!cancelled) {
          setRoomRows(Array.isArray(readings) ? readings : []);
          setRoomError("");
        }
      } catch (fetchError) {
        if (!cancelled) {
          setRoomRows([]);
          setRoomError(fetchError?.message || "Failed to load room trend data.");
        }
      } finally {
        if (!cancelled) setRoomLoading(false);
      }
    }

    loadRoomTrends();
    return () => {
      cancelled = true;
    };
  }, [roomRangeHours, selectedRoom, viewMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadOccupancyData() {
      if (viewMode !== "occupancy") return;
      setOccupancyLoading(true);
      setOccupancyError("");

      try {
        const readings = await fetchAllSensors(undefined);
        if (!cancelled) {
          setOccupancyRows(Array.isArray(readings) ? readings : []);
          setOccupancyError("");
        }
      } catch (fetchError) {
        if (!cancelled) {
          setOccupancyRows([]);
          setOccupancyError(fetchError?.message || "Failed to load room comfort data.");
        }
      } finally {
        if (!cancelled) setOccupancyLoading(false);
      }
    }

    loadOccupancyData();
    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  const analytics = useMemo(() => {
    const normalizedRows = normalizeRows(rawRows);
    const rowsByCircuit = groupRowsByCircuit(normalizedRows);

    const scopeRows = (() => {
      if (selectedCircuit !== "ALL") return rowsByCircuit.get(selectedCircuit) || [];
      if (rowsByCircuit.has("main")) return rowsByCircuit.get("main") || [];
      const nonMainRows = Array.from(rowsByCircuit.entries())
        .filter(([circuitId]) => circuitId !== "main")
        .flatMap(([, rows]) => rows);
      return aggregateRowsByTimestamp(nonMainRows);
    })();

    const dailyTotals = buildDailyTotals(scopeRows);
    const hourlyProfile = buildHourlyProfile(scopeRows);
    const peaks = buildTopPeaks(normalizedRows, circuitConfigs);
    const circuitShare = selectedCircuit === "ALL" ? buildCircuitShare(rowsByCircuit, circuitConfigs) : [];
    const workVsNon = buildWorkVsNonWork(scopeRows);
    const weekdayVsWeekend = buildWeekdayWeekend(dailyTotals);
    const seasonalTotals = buildSeasonalTotals(dailyTotals);

    const latest = scopeRows.at(-1) || null;
    const latestTimestampMs = latest?.timestampMs || null;
    const peak24hWatts = latestTimestampMs
      ? Math.max(
          0,
          ...scopeRows
            .filter((row) => row.timestampMs >= latestTimestampMs - (24 * 60 * 60 * 1000))
            .map((row) => row.value)
        )
      : 0;
    const todayKey = localDayKey(Date.now());
    const completedDailyTotals = dailyTotals.filter((entry) => entry.day < todayKey);
    const lastFullDay = completedDailyTotals.at(-1) || null;
    const totalEnergyKwh = dailyTotals.reduce((sum, entry) => sum + entry.totalKwh, 0);
    const averageDailyKwh = dailyTotals.length ? totalEnergyKwh / dailyTotals.length : 0;

    return {
      normalizedRows,
      scopeRows,
      dailyTotals,
      hourlyProfile,
      peaks,
      circuitShare,
      workVsNon,
      weekdayVsWeekend,
      seasonalTotals,
      latest,
      peak24hWatts,
      lastFullDay,
      totalEnergyKwh,
      averageDailyKwh,
    };
  }, [circuitConfigs, rawRows, selectedCircuit]);

  const selectedCircuitLabel = selectedCircuit === "ALL"
    ? "All circuits"
    : formatCircuitLabel(selectedCircuit, circuitConfigs);

  const roomTrendPoints = useMemo(() => aggregateRoomTrendPoints(roomRows), [roomRows]);
  const roomChartPoints = useMemo(() => downsampleRoomTrendPoints(roomTrendPoints), [roomTrendPoints]);
  const roomLatest = roomTrendPoints.at(-1) || null;
  const roomNoData = !roomLoading && !roomError && selectedRoom && roomTrendPoints.length === 0;

  const roomLabels = useMemo(
    () => roomChartPoints.map((entry) => formatRoomTrendLabel(entry.timestampMs, roomRangeHours)),
    [roomChartPoints, roomRangeHours]
  );

  const roomCombinedChart = useMemo(() => ({
    labels: roomLabels,
    datasets: [
      {
        label: "Temperature (°C)",
        data: roomChartPoints.map((entry) => entry.temperature),
        borderColor: "#FB7185",
        backgroundColor: "rgba(251,113,133,0.14)",
        yAxisID: "yTemp",
        tension: 0.32,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: "Humidity (%RH)",
        data: roomChartPoints.map((entry) => entry.humidity),
        borderColor: "#38BDF8",
        backgroundColor: "rgba(56,189,248,0.14)",
        yAxisID: "yHumidity",
        tension: 0.32,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: "CO2 (ppm)",
        data: roomChartPoints.map((entry) => entry.co2),
        borderColor: "#22C55E",
        backgroundColor: "rgba(34,197,94,0.14)",
        yAxisID: "yCo2",
        tension: 0.32,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  }), [roomChartPoints, roomLabels]);

  const occupancyTableRows = useMemo(
    () => buildRoomComfortRows(occupancyRows, roomOptions),
    [occupancyRows, roomOptions]
  );

  const sortedOccupancyRows = useMemo(() => {
    const sorted = [...occupancyTableRows];
    sorted.sort((a, b) => {
      let aValue;
      let bValue;

      switch (occupancySortBy) {
        case "name":
          aValue = a.label;
          bValue = b.label;
          return occupancySortOrder === "asc"
            ? aValue.localeCompare(bValue, undefined, { sensitivity: "base" })
            : bValue.localeCompare(aValue, undefined, { sensitivity: "base" });
        case "floor":
          aValue = a.floor;
          bValue = b.floor;
          break;
        case "temp":
          aValue = a.tempScore ?? -1;
          bValue = b.tempScore ?? -1;
          break;
        case "humidity":
          aValue = a.humScore ?? -1;
          bValue = b.humScore ?? -1;
          break;
        case "co2":
          aValue = a.co2Score ?? -1;
          bValue = b.co2Score ?? -1;
          break;
        case "comfort":
        default:
          aValue = a.overallScore ?? -1;
          bValue = b.overallScore ?? -1;
          break;
      }

      return occupancySortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });
    return sorted;
  }, [occupancySortBy, occupancySortOrder, occupancyTableRows]);

  const occupancyStats = useMemo(() => {
    if (!occupancyTableRows.length) return null;
    const scores = occupancyTableRows.map((room) => room.overallScore).filter((value) => Number.isFinite(value));
    if (!scores.length) return null;
    const avgComfort = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const excellent = occupancyTableRows.filter((room) => Number.isFinite(room.overallScore) && room.overallScore >= 85).length;
    const good = occupancyTableRows.filter((room) => Number.isFinite(room.overallScore) && room.overallScore >= 70 && room.overallScore < 85).length;
    const fair = occupancyTableRows.filter((room) => Number.isFinite(room.overallScore) && room.overallScore >= 50 && room.overallScore < 70).length;
    const needsAttention = occupancyTableRows.filter((room) => Number.isFinite(room.overallScore) && room.overallScore < 50).length;

    return {
      avgComfort,
      excellent,
      good,
      fair,
      needsAttention,
      totalRooms: occupancyTableRows.length,
    };
  }, [occupancyTableRows]);

  const roomTempChart = useMemo(() => ({
    labels: roomLabels,
    datasets: [{
      label: "Temperature (°C)",
      data: roomChartPoints.map((entry) => entry.temperature),
      borderColor: "#FB7185",
      backgroundColor: "rgba(251,113,133,0.18)",
      fill: true,
      tension: 0.32,
      pointRadius: 0,
      borderWidth: 2,
    }],
  }), [roomChartPoints, roomLabels]);

  const roomHumidityChart = useMemo(() => ({
    labels: roomLabels,
    datasets: [{
      label: "Humidity (%RH)",
      data: roomChartPoints.map((entry) => entry.humidity),
      borderColor: "#38BDF8",
      backgroundColor: "rgba(56,189,248,0.18)",
      fill: true,
      tension: 0.32,
      pointRadius: 0,
      borderWidth: 2,
    }],
  }), [roomChartPoints, roomLabels]);

  const roomCo2Chart = useMemo(() => ({
    labels: roomLabels,
    datasets: [{
      label: "CO2 (ppm)",
      data: roomChartPoints.map((entry) => entry.co2),
      borderColor: "#22C55E",
      backgroundColor: "rgba(34,197,94,0.18)",
      fill: true,
      tension: 0.32,
      pointRadius: 0,
      borderWidth: 2,
    }],
  }), [roomChartPoints, roomLabels]);

  const commonChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: TEXT_SOFT,
          boxWidth: 12,
          padding: 14,
        },
      },
      tooltip: {
        backgroundColor: "rgba(15,23,42,0.98)",
        titleColor: "#F8FAFC",
        bodyColor: TEXT_SOFT,
        borderColor: "rgba(148,163,184,0.22)",
        borderWidth: 1,
        padding: 12,
      },
    },
    scales: {
      x: {
        grid: { color: GRID_COLOR },
        ticks: { color: TEXT_DIM, maxRotation: 0 },
      },
      y: {
        beginAtZero: true,
        grid: { color: GRID_COLOR },
        ticks: { color: TEXT_DIM },
      },
    },
  }), []);

  const roomCombinedChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: commonChartOptions.plugins,
    scales: {
      x: commonChartOptions.scales.x,
      yTemp: {
        type: "linear",
        position: "left",
        grid: { color: GRID_COLOR },
        ticks: { color: TEXT_DIM },
        title: { display: true, text: "°C", color: TEXT_DIM },
      },
      yHumidity: {
        type: "linear",
        position: "right",
        grid: { drawOnChartArea: false },
        ticks: { color: TEXT_DIM },
        title: { display: true, text: "%RH", color: TEXT_DIM },
      },
      yCo2: {
        type: "linear",
        position: "right",
        offset: true,
        grid: { drawOnChartArea: false },
        ticks: { color: TEXT_DIM },
        title: { display: true, text: "ppm", color: TEXT_DIM },
      },
    },
  }), [commonChartOptions]);

  const dailyChart = useMemo(() => ({
    labels: analytics.dailyTotals.map((entry) => shortDayLabel(entry.day)),
    datasets: [
      {
        label: "Daily energy (kWh)",
        data: analytics.dailyTotals.map((entry) => Number(entry.totalKwh.toFixed(2))),
        borderColor: "#38BDF8",
        backgroundColor: "rgba(56,189,248,0.18)",
        fill: true,
        tension: 0.28,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  }), [analytics.dailyTotals]);

  const hourlyChart = useMemo(() => ({
    labels: analytics.hourlyProfile.map((entry) => `${entry.hour}:00`),
    datasets: [
      {
        label: "Average power (kW)",
        data: analytics.hourlyProfile.map((entry) => Number((entry.avgWatts / 1000).toFixed(3))),
        backgroundColor: "rgba(99,102,241,0.45)",
        borderColor: "rgba(129,140,248,1)",
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  }), [analytics.hourlyProfile]);

  const weekdayWeekendChart = useMemo(() => ({
    labels: analytics.weekdayVsWeekend.map((entry) => entry.label),
    datasets: [
      {
        label: "Average daily energy (kWh)",
        data: analytics.weekdayVsWeekend.map((entry) => Number(entry.totalKwh.toFixed(2))),
        backgroundColor: ["rgba(34,197,94,0.48)", "rgba(168,85,247,0.48)"],
        borderColor: ["rgba(34,197,94,1)", "rgba(168,85,247,1)"],
        borderWidth: 1,
        borderRadius: 8,
      },
    ],
  }), [analytics.weekdayVsWeekend]);

  const workChart = useMemo(() => ({
    labels: analytics.workVsNon.map((entry) => entry.label),
    datasets: [
      {
        label: "Average power (kW)",
        data: analytics.workVsNon.map((entry) => Number((entry.avgWatts / 1000).toFixed(3))),
        backgroundColor: ["rgba(245,158,11,0.5)", "rgba(59,130,246,0.5)"],
        borderColor: ["rgba(245,158,11,1)", "rgba(59,130,246,1)"],
        borderWidth: 1,
        borderRadius: 8,
      },
    ],
  }), [analytics.workVsNon]);

  const seasonalChart = useMemo(() => ({
    labels: analytics.seasonalTotals.map((entry) => entry.season),
    datasets: [
      {
        label: "Energy (kWh)",
        data: analytics.seasonalTotals.map((entry) => Number(entry.totalKwh.toFixed(2))),
        backgroundColor: [
          "rgba(56,189,248,0.48)",
          "rgba(52,211,153,0.48)",
          "rgba(251,191,36,0.48)",
          "rgba(249,115,22,0.48)",
        ],
        borderColor: [
          "rgba(56,189,248,1)",
          "rgba(52,211,153,1)",
          "rgba(251,191,36,1)",
          "rgba(249,115,22,1)",
        ],
        borderWidth: 1,
        borderRadius: 8,
      },
    ],
  }), [analytics.seasonalTotals]);

  const typicalDayChart = useMemo(() => ({
    labels: analytics.hourlyProfile.map((entry) => `${entry.hour}:00`),
    datasets: [
      {
        label: "Typical load (kW)",
        data: analytics.hourlyProfile.map((entry) => Number((entry.avgWatts / 1000).toFixed(3))),
        borderColor: "#10B981",
        backgroundColor: "rgba(16,185,129,0.14)",
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: "#10B981",
      },
    ],
  }), [analytics.hourlyProfile]);

  const circuitShareChart = useMemo(() => ({
    labels: analytics.circuitShare.map((entry) => entry.label),
    datasets: [
      {
        data: analytics.circuitShare.map((entry) => Number(entry.totalKwh.toFixed(2))),
        backgroundColor: analytics.circuitShare.map((_, index) => `${CIRCUIT_COLORS[index % CIRCUIT_COLORS.length]}BB`),
        borderColor: analytics.circuitShare.map((_, index) => CIRCUIT_COLORS[index % CIRCUIT_COLORS.length]),
        borderWidth: 1,
      },
    ],
  }), [analytics.circuitShare]);

  async function exportToPDF() {
    try {
      const jsPDF = (await import("jspdf")).default;
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = autoTableModule.default;
      const doc = new jsPDF({ unit: "pt", format: "a4" });

      if (viewMode === "rooms") {
        if (!selectedRoom || roomTrendPoints.length === 0) {
          window.alert("No room trend data is available to export.");
          return;
        }

        let cursorY = 40;
        const addTitle = (text, size = 16) => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(size);
          doc.setTextColor(15, 23, 42);
          doc.text(text, 40, cursorY);
          cursorY += size + 10;
        };
        const addMuted = (text) => {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.setTextColor(71, 85, 105);
          doc.text(text, 40, cursorY);
          cursorY += 14;
        };

        addTitle("Room Trends Report", 20);
        addMuted(`Room: ${selectedRoom.label}`);
        addMuted(`Window: last ${roomRangeHours} hours`);
        addMuted(`Generated: ${new Date().toLocaleString()}`);
        cursorY += 10;

        addTitle("Current conditions", 14);
        autoTable(doc, {
          startY: cursorY,
          head: [["Metric", "Value"]],
          body: [
            ["Temperature", formatRoomMetric(roomLatest?.temperature, " °C")],
            ["Humidity", formatRoomMetric(roomLatest?.humidity, " %RH")],
            ["CO2", formatRoomMetric(roomLatest?.co2, " ppm", 0)],
            ["Last update", roomLatest ? dateTimeLabel(roomLatest.tsISO) : "-"],
          ],
          theme: "grid",
          headStyles: { fillColor: [30, 41, 59], textColor: 255 },
          styles: { fontSize: 9, cellPadding: 6 },
          margin: { left: 40, right: 40 },
        });
        cursorY = (doc.lastAutoTable?.finalY || cursorY) + 20;

        const chartEntries = [
          [roomCombinedChartRef, "Combined room trends", 220],
          [roomTempChartRef, "Temperature", 200],
          [roomHumidityChartRef, "Humidity", 200],
          [roomCo2ChartRef, "CO2", 200],
        ];

        chartEntries.forEach(([chartRef, title, imageHeight]) => {
          if (!chartRef.current) return;
          const image = chartRef.current.toBase64Image();
          if (cursorY + imageHeight > 760) {
            doc.addPage();
            cursorY = 40;
          }
          addTitle(title, 13);
          doc.addImage(image, "PNG", 40, cursorY, 515, imageHeight);
          cursorY += imageHeight + 22;
        });

        const totalPages = doc.internal.getNumberOfPages();
        for (let page = 1; page <= totalPages; page += 1) {
          doc.setPage(page);
          doc.setFontSize(9);
          doc.setTextColor(100, 116, 139);
          doc.text(`Page ${page} of ${totalPages}`, 297.5, 820, { align: "center" });
        }

        doc.save(`room_trends_${selectedRoom.roomId}_${new Date().toISOString().slice(0, 10)}.pdf`);
        return;
      }

      if (viewMode === "occupancy") {
        if (!sortedOccupancyRows.length) {
          window.alert("No room comfort data is available to export.");
          return;
        }

        let cursorY = 40;
        const addTitle = (text, size = 16) => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(size);
          doc.setTextColor(15, 23, 42);
          doc.text(text, 40, cursorY);
          cursorY += size + 10;
        };
        const addMuted = (text) => {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.setTextColor(71, 85, 105);
          doc.text(text, 40, cursorY);
          cursorY += 14;
        };

        addTitle("Room Comfort Report", 20);
        addMuted(`Generated: ${new Date().toLocaleString()}`);
        if (occupancyStats) {
          addMuted(`Average comfort: ${occupancyStats.avgComfort.toFixed(0)} / 100`);
          addMuted(`Rooms reporting: ${occupancyStats.totalRooms}`);
        }
        cursorY += 10;

        autoTable(doc, {
          startY: cursorY,
          head: [["Room", "Floor", "Comfort", "Temperature", "Humidity", "CO2", "Last updated"]],
          body: sortedOccupancyRows.map((room) => [
            room.label,
            String(room.floor),
            Number.isFinite(room.overallScore) ? `${room.overallScore.toFixed(0)} (${getComfortLevel(room.overallScore).label})` : "-",
            formatRoomMetric(room.temperature, " °C"),
            formatRoomMetric(room.humidity, " %RH"),
            formatRoomMetric(room.co2, " ppm", 0),
            room.latestTsISO ? dateTimeLabel(room.latestTsISO) : "-",
          ]),
          theme: "grid",
          headStyles: { fillColor: [30, 41, 59], textColor: 255 },
          styles: { fontSize: 8, cellPadding: 5 },
          margin: { left: 24, right: 24 },
        });

        const totalPages = doc.internal.getNumberOfPages();
        for (let page = 1; page <= totalPages; page += 1) {
          doc.setPage(page);
          doc.setFontSize(9);
          doc.setTextColor(100, 116, 139);
          doc.text(`Page ${page} of ${totalPages}`, 297.5, 820, { align: "center" });
        }

        doc.save(`room_comfort_${new Date().toISOString().slice(0, 10)}.pdf`);
        return;
      }

      let cursorY = 40;
      const addTitle = (text, size = 16) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        doc.setTextColor(15, 23, 42);
        doc.text(text, 40, cursorY);
        cursorY += size + 10;
      };

      const addMuted = (text) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        doc.text(text, 40, cursorY);
        cursorY += 14;
      };

      addTitle("Energy Analytics Report", 20);
      addMuted(`Scope: ${selectedCircuitLabel}`);
      addMuted(`Window: last ${rangeDays} days`);
      addMuted(`Generated: ${new Date().toLocaleString()}`);
      cursorY += 10;

      addTitle("Summary", 14);
      autoTable(doc, {
        startY: cursorY,
        head: [["Metric", "Value"]],
        body: [
          ["Latest power", analytics.latest ? formatPower(analytics.latest.value) : "-"],
          ["Last full day", analytics.lastFullDay ? formatEnergy(analytics.lastFullDay.totalKwh) : "-"],
          ["Peak last 24h", formatPower(analytics.peak24hWatts)],
          ["Average daily energy", formatEnergy(analytics.averageDailyKwh)],
          ["Total energy", formatEnergy(analytics.totalEnergyKwh)],
        ],
        theme: "grid",
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        styles: { fontSize: 9, cellPadding: 6 },
        margin: { left: 40, right: 40 },
      });
      cursorY = (doc.lastAutoTable?.finalY || cursorY) + 20;

      if (analytics.peaks.length) {
        addTitle("Peak Demand", 14);
        autoTable(doc, {
          startY: cursorY,
          head: [["Rank", "Circuit", "Value", "Timestamp"]],
          body: analytics.peaks.map((peak, index) => [
            String(index + 1),
            peak.label,
            formatPower(peak.value),
            dateTimeLabel(peak.ts),
          ]),
          theme: "grid",
          headStyles: { fillColor: [30, 41, 59], textColor: 255 },
          styles: { fontSize: 9, cellPadding: 6 },
          margin: { left: 40, right: 40 },
        });
        cursorY = (doc.lastAutoTable?.finalY || cursorY) + 20;
      }

      const chartEntries = [
        [dailyChartRef, "Daily Totals"],
        [hourlyChartRef, "Hourly Profile"],
        [weekdayWeekendChartRef, "Weekday vs Weekend"],
        [workChartRef, "Working vs Non-Working"],
        [seasonalChartRef, "Seasonal Comparison"],
        [typicalDayChartRef, "Typical Day Load Profile"],
      ];
      if (analytics.circuitShare.length) chartEntries.splice(4, 0, [circuitShareChartRef, "Circuit Share"]);

      chartEntries.forEach(([chartRef, title]) => {
        if (!chartRef.current) return;
        const chart = chartRef.current;
        const image = chart.toBase64Image();
        const imageHeight = title === "Circuit Share" ? 180 : 220;
        if (cursorY + imageHeight > 760) {
          doc.addPage();
          cursorY = 40;
        }
        addTitle(title, 13);
        doc.addImage(image, "PNG", 40, cursorY, 515, imageHeight);
        cursorY += imageHeight + 22;
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`Page ${page} of ${totalPages}`, 297.5, 820, { align: "center" });
      }

      doc.save(`energy_analytics_${selectedCircuit}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (pdfError) {
      console.error("Failed to generate PDF report:", pdfError);
      window.alert("Failed to generate PDF report. Check the console for details.");
    }
  }

  const noData = !loading && !error && analytics.scopeRows.length === 0;
  const exportDisabled = viewMode === "energy"
    ? analytics.scopeRows.length === 0
    : viewMode === "rooms"
      ? !selectedRoom || roomTrendPoints.length === 0
      : sortedOccupancyRows.length === 0;
  const panelTitle = viewMode === "energy" ? "Energy Analytics" : viewMode === "rooms" ? "Room Trends" : "Room Comfort";
  const panelSubtitle = viewMode === "energy"
    ? "Real power analytics for the selected circuit or the building main feed."
    : viewMode === "rooms"
      ? "Environmental trends for Gate Building rooms using the live sensor API."
      : "Current room comfort scoring across Gate Building rooms using live sensor conditions.";

  function toggleOccupancySort(column) {
    if (occupancySortBy === column) {
      setOccupancySortOrder((current) => current === "asc" ? "desc" : "asc");
    } else {
      setOccupancySortBy(column);
      setOccupancySortOrder(column === "name" || column === "floor" ? "asc" : "desc");
    }
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 3100,
      background: "rgba(2,6,23,0.68)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        ...BASE_CARD,
        width: "min(1180px, 100%)",
        height: "min(92vh, 900px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "18px 20px",
          borderBottom: "1px solid rgba(148,163,184,0.16)",
          flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#F8FAFC" }}>{panelTitle}</div>
            <div style={{ fontSize: 13, color: TEXT_DIM, marginTop: 4 }}>{panelSubtitle}</div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[
              { key: "energy", label: "Energy" },
              { key: "rooms", label: "Room trends" },
              { key: "occupancy", label: "Room Comfort" },
            ].map((option) => (
              <button
                key={option.key}
                onClick={() => setViewMode(option.key)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: viewMode === option.key ? "1px solid rgba(56,189,248,0.8)" : "1px solid rgba(148,163,184,0.18)",
                  background: viewMode === option.key ? "rgba(8,145,178,0.16)" : PANEL_BG,
                  color: viewMode === option.key ? "#BAE6FD" : "#E2E8F0",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {viewMode === "energy" ? (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: TEXT_DIM }}>Circuit</span>
                <select
                  value={selectedCircuit}
                  onChange={(event) => setSelectedCircuit(event.target.value)}
                  style={{
                    background: PANEL_BG,
                    border: "1px solid rgba(148,163,184,0.22)",
                    color: "#F8FAFC",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  {circuitOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: TEXT_DIM }}>Window</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {RANGE_OPTIONS.map((days) => (
                    <button
                      key={days}
                      onClick={() => setRangeDays(days)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: rangeDays === days ? "1px solid rgba(56,189,248,0.8)" : "1px solid rgba(148,163,184,0.18)",
                        background: rangeDays === days ? "rgba(8,145,178,0.16)" : PANEL_BG,
                        color: rangeDays === days ? "#BAE6FD" : "#E2E8F0",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {days}d
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : viewMode === "rooms" ? (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 280 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: TEXT_DIM }}>Room</span>
                <select
                  value={selectedRoomKey}
                  onChange={(event) => setSelectedRoomKey(event.target.value)}
                  style={{
                    background: PANEL_BG,
                    border: "1px solid rgba(148,163,184,0.22)",
                    color: "#F8FAFC",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  {roomOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: TEXT_DIM }}>Window</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ROOM_RANGE_OPTIONS.map((hours) => (
                    <button
                      key={hours}
                      onClick={() => setRoomRangeHours(hours)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: roomRangeHours === hours ? "1px solid rgba(56,189,248,0.8)" : "1px solid rgba(148,163,184,0.18)",
                        background: roomRangeHours === hours ? "rgba(8,145,178,0.16)" : PANEL_BG,
                        color: roomRangeHours === hours ? "#BAE6FD" : "#E2E8F0",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {hours < 168 ? `${hours}h` : hours === 168 ? "7d" : "30d"}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {viewMode === "occupancy" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: TEXT_DIM, fontSize: 12 }}>
              <span>Live room snapshot across all floors</span>
            </div>
          ) : null}

          <button
            onClick={exportToPDF}
            disabled={exportDisabled}
            style={{
              padding: "11px 16px",
              borderRadius: 12,
              border: "1px solid rgba(16,185,129,0.4)",
              background: exportDisabled ? "rgba(15,23,42,0.7)" : "rgba(16,185,129,0.18)",
              color: exportDisabled ? TEXT_DIM : "#D1FAE5",
              cursor: exportDisabled ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            Export PDF
          </button>

          <button
            onClick={onClose}
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              border: "1px solid rgba(148,163,184,0.22)",
              background: PANEL_BG,
              color: "#F8FAFC",
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {viewMode === "energy" ? (
              <>
                <SectionCard title="Key metrics" infoKey="kpis" onInfo={setActiveInfoChart} subtitle={`${selectedCircuitLabel} • last ${rangeDays} days`}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    <MetricTile label="Latest power" value={analytics.latest ? formatPower(analytics.latest.value) : "-"} sub={analytics.latest ? dateTimeLabel(analytics.latest.ts_5min) : "No current sample"} accent="#38BDF8" />
                    <MetricTile label="Last full day" value={analytics.lastFullDay ? formatEnergy(analytics.lastFullDay.totalKwh) : "-"} sub={analytics.lastFullDay ? analytics.lastFullDay.day : "No completed day"} accent="#A78BFA" />
                    <MetricTile label="Peak last 24h" value={formatPower(analytics.peak24hWatts)} sub="trailing window" accent="#FB7185" />
                    <MetricTile label="Average day" value={formatEnergy(analytics.averageDailyKwh)} sub="mean daily energy" accent="#22C55E" />
                    <MetricTile label="Total energy" value={formatEnergy(analytics.totalEnergyKwh)} sub={`window total • ${analytics.dailyTotals.length} days`} accent="#F59E0B" />
                  </div>
                </SectionCard>

                {loading ? <EmptyState title="Loading analytics" detail="Fetching power history and computing aggregations." /> : null}
                {error ? <EmptyState title="Analytics unavailable" detail={error} /> : null}
                {noData ? <EmptyState title="No data" detail="No power readings were returned for this circuit and date range." /> : null}

                {!loading && !error && analytics.scopeRows.length > 0 ? (
                  <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 18 }}>
                  <SectionCard title="Daily totals" infoKey="dailyTotals" onInfo={setActiveInfoChart}>
                    <div style={{ height: 250 }}>
                      <Line
                        ref={dailyChartRef}
                        data={dailyChart}
                        options={{
                          ...commonChartOptions,
                          scales: {
                            ...commonChartOptions.scales,
                            y: {
                              ...commonChartOptions.scales.y,
                              title: { display: true, text: "kWh", color: TEXT_DIM },
                            },
                          },
                        }}
                      />
                    </div>
                  </SectionCard>

                  <SectionCard title="Hourly profile" infoKey="hourlyProfile" onInfo={setActiveInfoChart}>
                    <div style={{ height: 250 }}>
                      <Bar
                        ref={hourlyChartRef}
                        data={hourlyChart}
                        options={{
                          ...commonChartOptions,
                          scales: {
                            ...commonChartOptions.scales,
                            y: {
                              ...commonChartOptions.scales.y,
                              title: { display: true, text: "kW", color: TEXT_DIM },
                            },
                          },
                        }}
                      />
                    </div>
                  </SectionCard>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 18 }}>
                  <SectionCard title="Weekday vs weekend" infoKey="weekdayWeekend" onInfo={setActiveInfoChart}>
                    <div style={{ height: 250 }}>
                      <Bar
                        ref={weekdayWeekendChartRef}
                        data={weekdayWeekendChart}
                        options={{
                          ...commonChartOptions,
                          scales: {
                            ...commonChartOptions.scales,
                            y: {
                              ...commonChartOptions.scales.y,
                              title: { display: true, text: "kWh/day", color: TEXT_DIM },
                            },
                          },
                        }}
                      />
                    </div>
                  </SectionCard>

                  <SectionCard title="Peak demand" infoKey="peakDemand" onInfo={setActiveInfoChart} subtitle="Top 5 instantaneous power points">
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {analytics.peaks.map((peak, index) => (
                        <div key={`${peak.ts}-${peak.circuit_id}-${index}`} style={{
                          background: PANEL_BG,
                          border: "1px solid rgba(148,163,184,0.16)",
                          borderRadius: 12,
                          padding: "12px 14px",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                        }}>
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: "#F8FAFC" }}>{formatPower(peak.value)}</div>
                            <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 4 }}>{peak.label}</div>
                          </div>
                          <div style={{ fontSize: 12, color: TEXT_DIM, textAlign: "right" }}>{dateTimeLabel(peak.ts)}</div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </div>

                {analytics.circuitShare.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 18 }}>
                    <SectionCard title="Circuit share" infoKey="circuitShare" onInfo={setActiveInfoChart} subtitle="Subcircuit energy share across the selected window">
                      <div style={{ height: 260 }}>
                        <Doughnut
                          ref={circuitShareChartRef}
                          data={circuitShareChart}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: { display: false },
                              tooltip: commonChartOptions.plugins.tooltip,
                            },
                            cutout: "58%",
                          }}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title="Largest circuit contributors" onInfo={null}>
                      <div style={{ display: "grid", gap: 10 }}>
                        {analytics.circuitShare.map((entry, index) => (
                          <div key={entry.circuitId} style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto auto",
                            gap: 12,
                            alignItems: "center",
                            background: PANEL_BG,
                            border: "1px solid rgba(148,163,184,0.16)",
                            borderRadius: 12,
                            padding: "10px 12px",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 10, height: 10, borderRadius: 999, background: CIRCUIT_COLORS[index % CIRCUIT_COLORS.length] }} />
                              <span style={{ color: "#F8FAFC", fontWeight: 600 }}>{entry.label}</span>
                            </div>
                            <span style={{ color: TEXT_SOFT }}>{formatEnergy(entry.totalKwh)}</span>
                            <span style={{ color: TEXT_DIM }}>{entry.pct.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  </div>
                ) : null}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 18 }}>
                  <SectionCard title="Working vs non-working hours" infoKey="workNonWork" onInfo={setActiveInfoChart}>
                    <div style={{ height: 250 }}>
                      <Bar
                        ref={workChartRef}
                        data={workChart}
                        options={{
                          ...commonChartOptions,
                          scales: {
                            ...commonChartOptions.scales,
                            y: {
                              ...commonChartOptions.scales.y,
                              title: { display: true, text: "kW", color: TEXT_DIM },
                            },
                          },
                        }}
                      />
                    </div>
                  </SectionCard>

                  <SectionCard title="Seasonal comparison" infoKey="seasonal" onInfo={setActiveInfoChart}>
                    <div style={{ height: 250 }}>
                      <Bar
                        ref={seasonalChartRef}
                        data={seasonalChart}
                        options={{
                          ...commonChartOptions,
                          scales: {
                            ...commonChartOptions.scales,
                            y: {
                              ...commonChartOptions.scales.y,
                              title: { display: true, text: "kWh", color: TEXT_DIM },
                            },
                          },
                        }}
                      />
                    </div>
                  </SectionCard>
                </div>

                <SectionCard title="Typical day load profile" infoKey="typicalDay" onInfo={setActiveInfoChart} subtitle="Average 24-hour shape across the selected window">
                  <div style={{ height: 280 }}>
                    <Line
                      ref={typicalDayChartRef}
                      data={typicalDayChart}
                      options={{
                        ...commonChartOptions,
                        scales: {
                          ...commonChartOptions.scales,
                          y: {
                            ...commonChartOptions.scales.y,
                            title: { display: true, text: "kW", color: TEXT_DIM },
                          },
                        },
                      }}
                    />
                  </div>
                </SectionCard>
                  </>
                ) : null}
              </>
            ) : viewMode === "rooms" ? (
              <>
                <SectionCard title="Room conditions" infoKey="roomKpis" onInfo={setActiveInfoChart} subtitle={selectedRoom ? `${selectedRoom.label} • last ${roomRangeHours} hours` : "Choose a room"}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    <MetricTile label="Current temperature" value={formatRoomMetric(roomLatest?.temperature, " °C")} sub={roomLatest ? dateTimeLabel(roomLatest.tsISO) : "No current sample"} accent="#FB7185" />
                    <MetricTile label="Current humidity" value={formatRoomMetric(roomLatest?.humidity, " %RH")} sub={selectedRoom ? `${selectedRoom.sensorCount} sensors` : "No room selected"} accent="#38BDF8" />
                    <MetricTile label="Current CO2" value={formatRoomMetric(roomLatest?.co2, " ppm", 0)} sub={selectedRoom ? selectedRoom.parameters.join(" • ") || "Room telemetry" : "No room selected"} accent="#22C55E" />
                  </div>
                </SectionCard>

                {roomLoading ? <EmptyState title="Loading room trends" detail="Fetching sensor history for the selected room." /> : null}
                {roomError ? <EmptyState title="Room trends unavailable" detail={roomError} /> : null}
                {roomNoData ? <EmptyState title="No room data" detail="No sensor readings were returned for this room and date range." /> : null}

                {!roomLoading && !roomError && roomTrendPoints.length > 0 ? (
                  <>
                    <SectionCard title="Combined room trends" infoKey="roomCombined" onInfo={setActiveInfoChart} subtitle="Temperature, humidity, and CO2 over the same period">
                      <div style={{ height: 300 }}>
                        <Line ref={roomCombinedChartRef} data={roomCombinedChart} options={roomCombinedChartOptions} />
                      </div>
                    </SectionCard>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
                      <SectionCard title="Temperature" infoKey="roomTemperature" onInfo={setActiveInfoChart}>
                        <div style={{ height: 230 }}>
                          <Line
                            ref={roomTempChartRef}
                            data={roomTempChart}
                            options={{
                              ...commonChartOptions,
                              scales: {
                                ...commonChartOptions.scales,
                                y: {
                                  ...commonChartOptions.scales.y,
                                  title: { display: true, text: "°C", color: TEXT_DIM },
                                },
                              },
                            }}
                          />
                        </div>
                      </SectionCard>

                      <SectionCard title="Humidity" infoKey="roomHumidity" onInfo={setActiveInfoChart}>
                        <div style={{ height: 230 }}>
                          <Line
                            ref={roomHumidityChartRef}
                            data={roomHumidityChart}
                            options={{
                              ...commonChartOptions,
                              scales: {
                                ...commonChartOptions.scales,
                                y: {
                                  ...commonChartOptions.scales.y,
                                  title: { display: true, text: "%RH", color: TEXT_DIM },
                                },
                              },
                            }}
                          />
                        </div>
                      </SectionCard>

                      <SectionCard title="CO2" infoKey="roomCo2" onInfo={setActiveInfoChart}>
                        <div style={{ height: 230 }}>
                          <Line
                            ref={roomCo2ChartRef}
                            data={roomCo2Chart}
                            options={{
                              ...commonChartOptions,
                              scales: {
                                ...commonChartOptions.scales,
                                y: {
                                  ...commonChartOptions.scales.y,
                                  title: { display: true, text: "ppm", color: TEXT_DIM },
                                },
                              },
                            }}
                          />
                        </div>
                      </SectionCard>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <SectionCard title="Portfolio summary" infoKey="occupancyMethod" onInfo={setActiveInfoChart} subtitle="Comfort score from current room temperature, humidity, and CO2 conditions">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    <MetricTile label="Average comfort" value={occupancyStats ? `${occupancyStats.avgComfort.toFixed(0)} / 100` : "-"} sub={occupancyStats ? `${occupancyStats.totalRooms} rooms reporting` : "No room data"} accent="#A78BFA" />
                    <MetricTile label="Excellent rooms" value={occupancyStats ? String(occupancyStats.excellent) : "-"} sub={occupancyStats ? `Good ${occupancyStats.good} • Fair ${occupancyStats.fair}` : "-"} accent="#22C55E" />
                    <MetricTile label="Needs attention" value={occupancyStats ? String(occupancyStats.needsAttention) : "-"} sub="comfort score below 50" accent="#F97316" />
                    <MetricTile label="Rooms monitored" value={occupancyStats ? String(occupancyStats.totalRooms) : "-"} sub="latest room snapshots" accent="#38BDF8" />
                  </div>
                </SectionCard>

                {occupancyLoading ? <EmptyState title="Loading room comfort" detail="Fetching the latest room sensor readings for all floors." /> : null}
                {occupancyError ? <EmptyState title="Room comfort unavailable" detail={occupancyError} /> : null}
                {!occupancyLoading && !occupancyError && sortedOccupancyRows.length === 0 ? <EmptyState title="No room data" detail="No room comfort readings were returned from the Gate sensor API." /> : null}

                {!occupancyLoading && !occupancyError && sortedOccupancyRows.length > 0 ? (
                  <SectionCard title="Room comfort" onInfo={null} subtitle="Click column headers to sort">
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", color: "#E2E8F0", fontSize: 12 }}>
                        <thead>
                          <tr>
                            {[
                              ["name", "Room"],
                              ["floor", "Floor"],
                              ["comfort", "Overall comfort"],
                              ["temp", "Temperature"],
                              ["humidity", "Humidity"],
                              ["co2", "CO2"],
                            ].map(([key, label]) => (
                              <th key={key} style={{ textAlign: key === "floor" ? "center" : "left", padding: "10px 8px", borderBottom: "1px solid rgba(148,163,184,0.18)", whiteSpace: "nowrap" }}>
                                <button
                                  onClick={() => toggleOccupancySort(key)}
                                  style={{ background: "none", border: "none", color: "#CBD5E1", cursor: "pointer", fontWeight: 700, padding: 0 }}
                                >
                                  {label}{occupancySortBy === key ? ` ${occupancySortOrder === "asc" ? "↑" : "↓"}` : ""}
                                </button>
                              </th>
                            ))}
                            <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid rgba(148,163,184,0.18)", whiteSpace: "nowrap" }}>Last updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedOccupancyRows.map((room) => {
                            const overallLevel = getComfortLevel(room.overallScore);
                            const tempLevel = getComfortLevel(room.tempScore);
                            const humidityLevel = getComfortLevel(room.humScore);
                            const co2Level = getComfortLevel(room.co2Score);
                            return (
                              <tr key={room.key}>
                                <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                  <div style={{ fontWeight: 700, color: "#F8FAFC" }}>{room.label.split(" • ")[0]}</div>
                                  <div style={{ fontSize: 11, color: TEXT_DIM }}>{room.label.split(" • ")[1] || room.roomId}</div>
                                </td>
                                <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(148,163,184,0.08)", textAlign: "center" }}>{room.floor}</td>
                                <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, background: overallLevel.background, color: overallLevel.color, fontWeight: 700 }}>
                                    <span>{Number.isFinite(room.overallScore) ? room.overallScore.toFixed(0) : "-"}</span>
                                    <span style={{ fontSize: 11 }}>{overallLevel.label}</span>
                                  </div>
                                </td>
                                <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                  <div style={{ color: "#F8FAFC" }}>{formatRoomMetric(room.temperature, "°C")}</div>
                                  <div style={{ fontSize: 11, color: tempLevel.color }}>{Number.isFinite(room.tempScore) ? room.tempScore.toFixed(0) : "-"}</div>
                                </td>
                                <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                  <div style={{ color: "#F8FAFC" }}>{formatRoomMetric(room.humidity, "%")}</div>
                                  <div style={{ fontSize: 11, color: humidityLevel.color }}>{Number.isFinite(room.humScore) ? room.humScore.toFixed(0) : "-"}</div>
                                </td>
                                <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                  <div style={{ color: "#F8FAFC" }}>{formatRoomMetric(room.co2, " ppm", 0)}</div>
                                  <div style={{ fontSize: 11, color: co2Level.color }}>{Number.isFinite(room.co2Score) ? room.co2Score.toFixed(0) : "-"}</div>
                                </td>
                                <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(148,163,184,0.08)", color: TEXT_DIM, whiteSpace: "nowrap" }}>
                                  {room.latestTsISO ? dateTimeLabel(room.latestTsISO) : "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {activeInfoChart && CHART_INFO[activeInfoChart] ? (
        <div
          onClick={() => setActiveInfoChart("")}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3200,
            padding: 20,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              ...BASE_CARD,
              width: "min(520px, 100%)",
              padding: 22,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#F8FAFC" }}>{CHART_INFO[activeInfoChart].title}</div>
              <button
                onClick={() => setActiveInfoChart("")}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: PANEL_BG,
                  color: "#F8FAFC",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 13, color: TEXT_SOFT, lineHeight: 1.6 }}>
              <div style={{ marginBottom: 12 }}><strong>Formula:</strong> {CHART_INFO[activeInfoChart].formula}</div>
              <div><strong>Explanation:</strong> {CHART_INFO[activeInfoChart].text}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
