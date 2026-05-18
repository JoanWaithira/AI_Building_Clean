import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import EnergyAnalyticsPanel from "./EnergyAnalyticsPanel.jsx";
import SolarPanel from "./SolarPanel.jsx";
import * as Cesium from "cesium";
import {
  fetchElectricityHistory,
  fetchSolarHistory,
  fetchAllSensorsHistory,
  fetchElectricityLive,
  fetchAllSensorsLive,
  buildReplayFrames,
  buildPvDataRef,
  buildClimateReplayFrames as buildGateClimateReplayFrames,
  getDateRangeForHours,
} from "../gateApi.js";
import { ROLES } from "./roleHelpers.js";
import ScenarioPanel from "./ScenariosComplex.jsx";
import RolePanel from "./RolePanel.jsx";
import ForecastPanel from "./ForecastPanel.jsx";
import FaultPanel from "./FaultPanel.jsx";
import { useFaultDetection } from "../hooks/useFaultDetection.js";
import { fetchElectricityForCircuits } from "../services/gateBuildingRepository.js";
import { toSofiaDateString } from "../utils/timeUtils.js";
import {
  ROLE_ROOM_MAP,
  GATE_ROOM_TO_ROOM_NUMBER,
  GATE_ROOM_TO_ROOM_NUMBERS,
} from "../utils/roomDataUtils.js";

const ION_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlNDgxNjNjYS1kMTY1LTRhOTQtODFiZC1mYWMyNzY4OWVjN2YiLCJpZCI6MzQzOTQwLCJpYXQiOjE3NTg2MzQ0MTR9.pQiAchoUyxCsz38HgMWMnBs4ua7xTKPcbTE2s5EnbK4";
const I3S_URL =
  "https://tiles-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/Gate_export_20241104_r23_reduced_20241114_notex/SceneServer";
const GEOJSON_URL = `${import.meta.env.BASE_URL}floorplans/Floorplan_polygon_4326.geojson`;
const WORLD_IMAGERY_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const ORTHOPHOTO_URL = import.meta.env.VITE_ORTHOPHOTO_URL || WORLD_IMAGERY_URL;
const REPLAY_WINDOW_HOURS = 48;
const REPLAY_FRAMES = 192;

const CIRCUIT_CONFIGS = {
  main: { label: "Main", color: "#60A5FA" },
  circuit6boiler: { label: "Boiler", color: "#F87171" },
  circuit7: { label: "Circuit 7", color: "#FBBF24" },
  elevator: { label: "Elevator", color: "#A78BFA" },
  circuit8: { label: "Circuit 8", color: "#34D399" },
  circuit9: { label: "Circuit 9", color: "#22D3EE" },
  circuit10: { label: "Circuit 10", color: "#FB923C" },
  circuit11: { label: "Circuit 11", color: "#F472B6" },
  circuit12: { label: "Circuit 12", color: "#A3E635" },
  airconditioner1: { label: "Air Cond. 1", color: "#38BDF8" },
  airconditioner2: { label: "Air Cond. 2", color: "#0EA5E9" },
  outsidelighting1: { label: "Outside Light N", color: "#FDE68A" },
  outsidelighting2: { label: "Outside Light S", color: "#FCD34D" },
  vehiclecharging1: { label: "EV Charger 1", color: "#4ADE80" },
  vehiclecharging2: { label: "EV Charger 2", color: "#16A34A" },
  "3DLED": { label: "3D LED Display", color: "#FF6B9D" },
  ovk: { label: "OVK", color: "#E879F9" },
};

const CIRCUIT_CAM = {
  main: { lon: 23.330494, lat: 42.673775, h: 620, heading: 0, pitch: -45 },
  circuit6boiler: {
    lon: 23.330494,
    lat: 42.673775,
    h: 620,
    heading: 0,
    pitch: -45,
  },
  circuit7: { lon: 23.330494, lat: 42.673775, h: 620, heading: 0, pitch: -45 },
  elevator: { lon: 23.330494, lat: 42.673775, h: 620, heading: 0, pitch: -45 },
  circuit8: { lon: 23.3306, lat: 42.67375, h: 615, heading: 0, pitch: -50 },
  circuit9: { lon: 23.330494, lat: 42.673775, h: 620, heading: 0, pitch: -45 },
  circuit10: { lon: 23.3304, lat: 42.6737, h: 619, heading: 45, pitch: -50 },
  circuit11: { lon: 23.330494, lat: 42.673775, h: 620, heading: 0, pitch: -45 },
  circuit12: { lon: 23.33055, lat: 42.6738, h: 617, heading: 0, pitch: -50 },
  airconditioner1: {
    lon: 23.3307,
    lat: 42.6739,
    h: 625,
    heading: 180,
    pitch: -55,
  },
  airconditioner2: {
    lon: 23.3307,
    lat: 42.6739,
    h: 625,
    heading: 180,
    pitch: -55,
  },
  outsidelighting1: {
    lon: 23.33045,
    lat: 42.67392,
    h: 610,
    heading: 180,
    pitch: -60,
  },
  outsidelighting2: {
    lon: 23.33045,
    lat: 42.67352,
    h: 610,
    heading: 0,
    pitch: -60,
  },
  vehiclecharging1: {
    lon: 23.33025,
    lat: 42.6738,
    h: 608,
    heading: 270,
    pitch: -65,
  },
  vehiclecharging2: {
    lon: 23.33075,
    lat: 42.67365,
    h: 608,
    heading: 90,
    pitch: -65,
  },
  "3DLED": { lon: 23.33035, lat: 42.67375, h: 608, heading: 270, pitch: -55 },
  ovk: { lon: 23.330494, lat: 42.673775, h: 620, heading: 0, pitch: -45 },
};

const SITE_MARKERS = {
  vehicleChargers: [
    { lon: 23.33033, lat: 42.67399, circuitId: "vehiclecharging1" },
    { lon: 23.33036, lat: 42.67395, circuitId: "vehiclecharging2" },
  ],
  outsideLightsNorth: [
    [23.33079, 42.67409],
    [23.33083, 42.67404],
    [23.33079, 42.67402],
    [23.33076, 42.67408],
    [23.33077, 42.67412],
    [23.33072, 42.6741],
    [23.33067, 42.67409],
    [23.3306, 42.67406],
    [23.33057, 42.67405],
    [23.3305, 42.67403],
    [23.33047, 42.67408],
    [23.33046, 42.67401],
    [23.33039, 42.67399],
  ],
  outsideLightsSouth: [
    [23.33083, 42.67397],
    [23.33087, 42.67398],
    [23.33087, 42.67391],
    [23.3309, 42.67392],
    [23.33094, 42.67387],
    [23.33087, 42.67384],
    [23.33084, 42.67383],
    [23.33078, 42.67381],
    [23.33074, 42.67379],
    [23.33068, 42.67377],
    [23.33064, 42.67376],
    [23.33057, 42.67373],
  ],
};

const HOME_CAMERA = {
  lon: 23.330494,
  lat: 42.6725,
  height: 700,
  heading: Cesium.Math.toRadians(0),
  pitch: Cesium.Math.toRadians(-40),
  roll: 0,
};

const CAM_PRESETS = {
  overview: { lon: 23.330494, lat: 42.6728, h: 450, heading: 0, pitch: -45 },
  north_facade: {
    lon: 23.330494,
    lat: 42.6741,
    h: 560,
    heading: 180,
    pitch: -20,
  },
  south_facade: {
    lon: 23.330494,
    lat: 42.6734,
    h: 560,
    heading: 0,
    pitch: -20,
  },
  roof: { lon: 23.330494, lat: 42.673775, h: 580, heading: 0, pitch: -89 },
  interior_fl0: {
    lon: 23.330494,
    lat: 42.673775,
    h: 610,
    heading: 0,
    pitch: -55,
  },
  interior_fl1: {
    lon: 23.330494,
    lat: 42.673775,
    h: 613,
    heading: 0,
    pitch: -55,
  },
  interior_fl2: {
    lon: 23.330494,
    lat: 42.673775,
    h: 616,
    heading: 0,
    pitch: -55,
  },
  interior_fl3: {
    lon: 23.330494,
    lat: 42.673775,
    h: 619,
    heading: 0,
    pitch: -55,
  },
  interior_fl4: {
    lon: 23.330494,
    lat: 42.673775,
    h: 622,
    heading: 0,
    pitch: -55,
  },
};

const ALERT_THRESHOLDS = {
  co2: { op: "gt", value: 1000, color: "#EF4444" },
  temperature: { op: "gt", value: 26, color: "#F97316" },
  humidity_lo: { op: "lt", value: 30, color: "#60A5FA" },
  humidity_hi: { op: "gt", value: 65, color: "#06B6D4" },
};

// function generateReplayData(circuitId) {
//   const profiles = {
//     main: { base: 18000, peak: 42000, peakHour: 10 },
//     circuit6boiler: { base: 3200, peak: 8500, peakHour: 7 },
//     circuit7: { base: 400, peak: 2800, peakHour: 11 },
//     elevator: { base: 600, peak: 3200, peakHour: 9 },
//     circuit8: { base: 2100, peak: 4800, peakHour: 14 },
//     circuit9: { base: 1800, peak: 5200, peakHour: 10 },
//     circuit10: { base: 2400, peak: 6100, peakHour: 13 },
//     circuit11: { base: 1600, peak: 3900, peakHour: 10 },
//     circuit12: { base: 900, peak: 2200, peakHour: 12 },
//     airconditioner1: { base: 1200, peak: 7800, peakHour: 14 },
//     airconditioner2: { base: 1100, peak: 7200, peakHour: 15 },
//     outsidelighting1: { base: 320, peak: 640, peakHour: 20 },
//     outsidelighting2: { base: 320, peak: 640, peakHour: 20 },
//     vehiclecharging1: { base: 0, peak: 7200, peakHour: 18 },
//     vehiclecharging2: { base: 0, peak: 7200, peakHour: 19 },
//     "3DLED": { base: 800, peak: 2400, peakHour: 10 },
//     ovk: { base: 3000, peak: 9000, peakHour: 8 },
//   };
//   const p = profiles[circuitId] || { base: 1000, peak: 4000, peakHour: 10 };

//   return Array.from({ length: 96 }, (_, i) => {
//     const hour = i / 4;
//     const nightScale = hour < 6 || hour > 22 ? 0.15 : 1;
//     const bell = Math.exp(-0.5 * Math.pow((hour - p.peakHour) / 3, 2));
//     const noise = 0.88 + Math.random() * 0.24;
//     const watts = Math.round((p.base + (p.peak - p.base) * bell) * nightScale * noise);
//     const hh = String(Math.floor(hour)).padStart(2, "0");
//     const mm = ["00", "15", "30", "45"][i % 4];
//     return { time: `${hh}:${mm}`, hour, watts };
//   });
// }

function normalizeCircuitId(raw) {
  if (raw == null) return "";
  const v = String(raw).trim();
  if (CIRCUIT_CONFIGS[v]) return v;
  const lower = v.toLowerCase().replace(/\s+/g, "");
  const compact = v.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (CIRCUIT_CONFIGS[lower]) return lower;
  if (CIRCUIT_CONFIGS[compact]) return compact;
  if (compact === "3dled" || compact === "x3dled") return "3DLED";
  const digits = compact.match(/^\d+$/);
  if (digits) {
    const c = `circuit${digits[0]}`;
    if (CIRCUIT_CONFIGS[c]) return c;
  }
  const cm = compact.match(/^circuit(\d+)$/);
  if (cm) {
    const c = `circuit${cm[1]}`;
    if (CIRCUIT_CONFIGS[c]) return c;
  }
  return v;
}

const normStr = (v) =>
  String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

// Normalize room queries from UI/API forms such as "conference_room", "Conference-Room", "room 1.02".
const normRoomQuery = (v) => normStr(v).replace(/[_-]+/g, " ");

function extractRoomNum(value) {
  const text = normStr(value);
  const dm = text.match(/(?:room[-\s]?)?(-?\d+\.\d+)/i);
  if (dm) {
    const p = dm[1].split(".");
    return `${parseInt(p[0], 10)}.${p[1].padStart(2, "0")}`;
  }
  const pm = text.match(/(?:room[-\s]?)?(-?\d+)/i);
  return pm ? pm[1].replace(/^0+(?=\d)/, "") : "";
}

function interpolateColorStops(t, stops) {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i],
      b = stops[i + 1];
    if (c >= a.t && c <= b.t) {
      const f = (c - a.t) / (b.t - a.t);
      return new Cesium.Color(
        (a.r + f * (b.r - a.r)) / 255,
        (a.g + f * (b.g - a.g)) / 255,
        (a.b + f * (b.b - a.b)) / 255,
        0.88,
      );
    }
  }
  const last = stops[stops.length - 1];
  return new Cesium.Color(last.r / 255, last.g / 255, last.b / 255, 0.88);
}

const tempToColor = (v) =>
  interpolateColorStops((v - 15) / 15, [
    { t: 0, r: 59, g: 130, b: 246 },
    { t: 0.45, r: 34, g: 197, b: 94 },
    { t: 0.75, r: 251, g: 146, b: 60 },
    { t: 1, r: 239, g: 68, b: 68 },
  ]);

const co2ToColor = (v) =>
  interpolateColorStops((v - 400) / 800, [
    { t: 0, r: 34, g: 197, b: 94 },
    { t: 0.5, r: 250, g: 204, b: 21 },
    { t: 1, r: 239, g: 68, b: 68 },
  ]);

const humidityToColor = (v) =>
  interpolateColorStops((v - 20) / 60, [
    { t: 0, r: 239, g: 68, b: 68 },
    { t: 0.5, r: 34, g: 197, b: 94 },
    { t: 1, r: 59, g: 130, b: 246 },
  ]);

const occupancyToColor = (v) =>
  interpolateColorStops(v / 10, [
    { t: 0, r: 240, g: 240, b: 240 },
    { t: 0.5, r: 251, g: 146, b: 60 },
    { t: 1, r: 239, g: 68, b: 68 },
  ]);

const HEATMAP_METRICS = [
  { key: "temperature", icon: "🌡", label: "Temp" },
  { key: "co2", icon: "🫧", label: "CO₂" },
  { key: "humidity", icon: "💧", label: "Humid" },
];

const HEATMAP_METRIC_SET = new Set(HEATMAP_METRICS.map(({ key }) => key));

function normalizeHeatmapMetric(metric, fallback = null) {
  return HEATMAP_METRIC_SET.has(metric) ? metric : fallback;
}

function metricToColor(metric, value) {
  if (metric === "temperature") return tempToColor(value);
  if (metric === "co2") return co2ToColor(value);
  if (metric === "humidity") return humidityToColor(value);
  if (metric === "occupancy") return occupancyToColor(value);
  return Cesium.Color.fromCssColorString("#4DA3FF").withAlpha(0.72);
}

function evaluateOp(v, op, thr) {
  return op === "gt"
    ? v > thr
    : op === "lt"
      ? v < thr
      : op === "gte"
        ? v >= thr
        : op === "lte"
          ? v <= thr
          : op === "eq"
            ? v === thr
            : false;
}

function getRoomColor(roomName) {
  const n = (roomName || "").toUpperCase();
  if (n.includes("WC") || n.includes("TOILET"))
    return Cesium.Color.fromCssColorString("#FFFFFF").withAlpha(0.88);
  if (n.includes("STAIRCASE") || n.includes("СТЪЛБА"))
    return Cesium.Color.fromCssColorString("#7A7A7A").withAlpha(0.92);
  if (n.includes("ELEVATOR") || n.includes("АСАНСЬОР"))
    return Cesium.Color.fromCssColorString("#5C5C5C").withAlpha(0.92);
  if (n.includes("CORRIDOR") || n.includes("КОРИДОР"))
    return Cesium.Color.fromCssColorString("#E8E8E8").withAlpha(0.78);
  if (n.includes("MEETING") || n.includes("CONFERENCE") || n.includes("ЗАЛА"))
    return Cesium.Color.fromCssColorString("#D4A373").withAlpha(0.85);
  if (n.includes("DIRECTOR") || n.includes("ДИРЕКТОР"))
    return Cesium.Color.fromCssColorString("#8B4513").withAlpha(0.88);
  if (n.includes("IT") || n.includes("TECHNICAL") || n.includes("ЕЛЕКТРО"))
    return Cesium.Color.fromCssColorString("#B0B0B0").withAlpha(0.85);
  return Cesium.Color.fromCssColorString("#4DA3FF").withAlpha(0.72);
}

function normalizeBgName(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function translateRoomName(bg) {
  const name = String(bg || "")
    .normalize("NFC")
    .trim();
  if (!name) return "";
  if (!/[\u0400-\u04FF]/.test(name)) return name;

  const key = normalizeBgName(name);
  const exactMap = new Map([
    ["ЗОНА ЗА ИЗЧАКВАНЕ", "Waiting Zone"],
    ["КОРИДОР", "Corridor"],
    ["ИЗСЛЕДОВАТЕЛИ", "Researchers"],
    ["КАБИНЕТ", "Office"],
    ["WC ЖЕНИ", "Women's WC"],
    ["WC МЪЖЕ", "Men's WC"],
    ["WC ЗА ХОРА В НЕРАВНОСТОЙНО ПОЛОЖЕНИЕ", "Accessible WC"],
    ["СТЪЛБА", "Staircase"],
    ["ЕВАКУАЦИОННА СТЪЛБА", "Emergency Staircase"],
    ["АСАНСЬОР И ШАХТА", "Elevator Shaft"],
    ["АСАНСЬОР", "Elevator"],
    ["АСАНСЬОРНА ШАХТА", "Elevator Shaft"],
    ["ПОМЕЩЕНИЕ ЕЛ", "Electrical Room"],
    ["ПОМЕЩЕНИЕ UPS", "UPS Room"],
    ["ПОМЕЩЕНИЕ", "Room"],
    ["ТЕХНИЧЕСКА СТАЯ", "Technical Room"],
    ["ТЕХНОЛОГИЧНА СТАЯ", "Technical Room"],
    ["СЪРВЪРНО ПОМЕЩЕНИЕ", "Server Room"],
    ["АБОНАТНА СТАНЦИЯ", "Subscriber Station"],
    ["ГРТ", "Gas Regulation Station"],
    ["IT ОТДЕЛ", "IT Department"],
    ["ОФИС", "Office"],
    ["БИЗНЕС РАЗВИТИЕ", "Business Development"],
    ["ГАРДЕРОБ", "Wardrobe"],
    ["ЧОВЕШКИ РЕСУРСИ", "Human Resources"],
    ["СЧЕТОВОДИТЕЛ", "Accountant"],
    ["ДИРЕКТОР", "Director"],
    ["АСИСТЕНТ", "Assistant"],
    ["ЗАМ. ДИРЕКТОР", "Deputy Director"],
    ["ДЕЛОВОДИТЕЛ И ДОМАКИН", "Administrator"],
    ["РЪКОВОДИТЕЛ НА ИЗСЛЕДОВАТЕЛСКА ГРУПА", "Research Group Leader"],
    ["ЗАЛА ЗА СРЕЩИ", "Meeting Room"],
    ["ЗАЛА ЗА КОНФЕРЕНЦИИ", "Conference Hall"],
    ["ЗАЛА ЗА КОНФЕРЕНТНИ РАЗГОВОРИ", "Conference Room"],
    ["ЗАЛА ЗА СЕМИНАРНИ СРЕЩИ", "Seminar Room"],
    ["ЗАЛА ЗА ВИЗУАЛИЗАЦИЯ", "Visualization Hall"],
    ["ЗАЛА SAP", "SAP Hall"],
    ["ПРОСТРАНСТВО ЗА ХРАНЕНЕ", "Dining Area"],
    ["ОТВОРЕНО ПРОСТРАНСТВО ЗА РАБОТА", "Open Work Space"],
    ["ФОАЙЕ", "Foyer"],
    ["ФОАЙЕ / ЗОНА ЗА ДИСКУСИИ", "Foyer / Discussion Zone"],
    ["ВИНДФАНГ", "Vestibule"],
    ["СТАЯ ЗА ПОЧИВКА", "Break Room"],
    ["СТОЛОВА", "Cafeteria"],
    ["КУХНЯ", "Kitchen"],
    ["СКЛАДОВА БАЗА", "Storage Room"],
    ["СКЛАД", "Storage"],
    ["АРХИВ", "Archive"],
    ["КОПИРНА", "Copy Room"],
    ["КАСИЕР", "Cashier"],
    ["РЕЦЕПЦИЯ", "Reception"],
    ["ЛАБОРАТОРИЯ ЗА ОБУЧЕНИЕ", "Training Laboratory"],
    ["ЗАЛА", "Hall"],
    ["САНИТАРЕН ВЪЗЕЛ", "Restroom"],
    ["БАНЯ", "Bathroom"],
    ["PR", "PR Officer"],
    ["ЗОНА ЗА ДИСКУСИИ", "Discussion Zone"],
  ]);

  if (exactMap.has(key)) return exactMap.get(key);

  for (const [bgName, english] of exactMap.entries()) {
    if (key.includes(bgName)) return english;
  }

  return name;
}

function getRoomData(roomName) {
  const n = (roomName || "").toUpperCase();
  if (n.includes("WC") || n.includes("TOILET"))
    return { temp: 20, humidity: 55, occupancy: 0, co2: 400 };
  if (n.includes("MEETING") || n.includes("CONFERENCE") || n.includes("ЗАЛА"))
    return { temp: 23, humidity: 42, occupancy: 8, co2: 600 };
  return {
    temp: 22 + Math.floor(Math.random() * 3),
    humidity: 40 + Math.floor(Math.random() * 10),
    occupancy: Math.floor(Math.random() * 4),
    co2: 450 + Math.floor(Math.random() * 300),
  };
}

function getRoomCircuitIds(roomNumber, roomName, floorLevel) {
  const n = (roomName || "").toLowerCase(),
    s = (roomNumber || "").toString();
  const ids = [];
  if (
    n.includes("elevator") ||
    n.includes("shaft") ||
    n.includes("асансьор") ||
    n.includes("шахта")
  )
    ids.push("elevator");
  if (
    floorLevel === 1 ||
    n.includes("абонатн") ||
    n.includes("грт") ||
    ["14", "15", "16", "006", "107", "42", "68"].includes(s)
  )
    ids.push("circuit6boiler");
  if (
    n.includes("ups") ||
    n.includes("power") ||
    n.includes("ел") ||
    s === "16"
  )
    ids.push("circuit10");
  if (
    n.includes("човешки ресурси") ||
    n.includes("human resources") ||
    n.includes("it отдел") ||
    n.includes("it department") ||
    s === "315" ||
    s === "310"
  )
    ids.push("circuit11");
  if (n.includes("server") || n.includes("сървър") || s === "17")
    ids.push("circuit8");
  if (
    n.includes("склад") ||
    n.includes("storage") ||
    ["-13", "22", "007", "29"].includes(s)
  )
    ids.push("circuit12");
  if (floorLevel === 1 || floorLevel === 2) ids.push("airconditioner1");
  if (floorLevel === 3 || floorLevel === 4 || floorLevel === 5)
    ids.push("airconditioner2");
  if (
    n.includes("conference") ||
    n.includes("meeting") ||
    n.includes("конференц") ||
    n.includes("срещ") ||
    n.includes("visualization") ||
    n.includes("sap") ||
    n.includes("зала") ||
    ["002", "-01", "-02", "110"].includes(s)
  )
    ids.push("circuit7");
  if (
    n.includes("office") ||
    n.includes("офис") ||
    n.includes("workspace") ||
    n.includes("работ") ||
    n.includes("open") ||
    n.includes("отворен") ||
    n.includes("лаборатория") ||
    n.includes("director") ||
    n.includes("директор") ||
    n.includes("изследовател") ||
    n.includes("кабинет") ||
    n.includes("бизнес") ||
    n.includes("счетоводител") ||
    n.includes("асистент")
  )
    ids.push("circuit9");
  ids.push("main");
  return [...new Set(ids)];
}

function geometryToPolygons(geometry, baseElev) {
  if (!geometry) return [];
  const ringToPos = (ring) =>
    ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, baseElev));
  if (geometry.type === "Polygon") {
    const o = geometry.coordinates?.[0];
    if (!Array.isArray(o) || o.length < 3) return [];
    return [ringToPos(o)];
  }
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates
      .map((p) => p?.[0])
      .filter((r) => Array.isArray(r) && r.length >= 3)
      .map(ringToPos);
  return [];
}

function getBoundingSphere(entities) {
  const positions = [];
  entities.forEach((e) => {
    if (e.polygon?.hierarchy?.getValue) {
      const h = e.polygon.hierarchy.getValue(Cesium.JulianDate.now());
      if (h?.positions) positions.push(...h.positions);
    } else if (e.position?.getValue) {
      const p = e.position.getValue(Cesium.JulianDate.now());
      if (p) positions.push(p);
    }
  });
  return positions.length ? Cesium.BoundingSphere.fromPoints(positions) : null;
}
//fmtW => format watt values into a more human-readable form, converting values of 1000 watts or more into kilowatts with one decimal place.

function fmtW(w) {
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${w} W`;
}

const UI_FONT_STACK =
  '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif';

async function getBuildingJson(path, params = {}) {
  // Static GeoJSON files are served from the public/ directory.
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(`/${cleanPath}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.append(key, value);
  });
  const response = await fetch(url.toString());
  if (!response.ok)
    throw new Error(
      `[getBuildingJson] ${response.status} ${response.statusText}`,
    );
  return response.json();
}

function toReplayRoomKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const asDotted = raw.match(/^(-?\d+)\.(\d+)$/);
  if (asDotted)
    return `${parseInt(asDotted[1], 10)}.${asDotted[2].padStart(2, "0")}`;

  const compact3 = raw.match(/^(-?\d)(\d{2})$/);
  if (compact3) return `${compact3[1]}.${compact3[2]}`;

  const extracted = extractRoomNum(raw);
  const extractedCompact3 = extracted.match(/^(-?\d)(\d{2})$/);
  if (extractedCompact3)
    return `${extractedCompact3[1]}.${extractedCompact3[2]}`;

  return extracted || raw;
}

function formatReplayTimeFromTimestamp(timestampMs) {
  if (!Number.isFinite(timestampMs)) return "--:--";
  const date = new Date(timestampMs);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** X-axis ticks for energy / IAQ replay sparklines — quintiles of wall time across the loaded frame series (e.g. 48h). */
function formatReplaySparkAxisTicks(samples) {
  if (!Array.isArray(samples) || !samples.length) {
    return ["—", "—", "—", "—", "—"];
  }
  if (samples.length < 2) {
    const s = samples[0];
    const one = Number.isFinite(s?.timestampMs)
      ? formatReplayTimeFromTimestamp(s.timestampMs)
      : (s?.time ?? "—");
    return [one, one, one, one, one];
  }
  const n = samples.length - 1;
  const pickIdx = (t) => Math.min(n, Math.max(0, Math.round(t)));
  const msStart = samples[0]?.timestampMs;
  const msEnd = samples[n]?.timestampMs;
  const spanMs =
    Number.isFinite(msStart) && Number.isFinite(msEnd) ? msEnd - msStart : 0;
  const showDate = spanMs > 26 * 60 * 60 * 1000;
  const fmtMs = (ms) => {
    if (!Number.isFinite(ms)) return "—";
    const d = new Date(ms);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (!showDate) return hm;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hm}`;
  };
  return [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const i = pickIdx(frac * n);
    const ms = samples[i]?.timestampMs;
    if (Number.isFinite(ms)) return fmtMs(ms);
    return samples[i]?.time ?? "—";
  });
}

/** Quintile labels for heatmap scrubber; prefix D1/D2 when timeline is longer than 24h of 15-min steps. */
function buildHeatmapScrubTicks(frames) {
  if (!frames?.length) return ["—", "—", "—", "—", "—"];
  const n = frames.length - 1;
  const pickIdx = (t) => Math.min(n, Math.max(0, Math.round(t)));
  const multiDay = frames.length > 96;
  return [0, n * 0.25, n * 0.5, n * 0.75, n].map((t) => {
    const idx = pickIdx(t);
    const lab = frames[idx]?.label ?? "—";
    if (!multiDay) return lab;
    const day = idx < frames.length / 2 ? "D1" : "D2";
    return `${day} ${lab}`;
  });
}

function getLatestRowTimestampMs(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((latest, row) => {
    const ms = Date.parse(row?.ts ?? row?.timestamp ?? row?.ts_5min ?? "");
    return Number.isFinite(ms) && ms > latest ? ms : latest;
  }, Number.NaN);
}

function pickLatestAndIntervalSample(samples, intervalMs) {
  const sorted = (Array.isArray(samples) ? samples : [])
    .filter((sample) => Number.isFinite(sample?.timestampMs))
    .sort((a, b) => b.timestampMs - a.timestampMs);

  if (!sorted.length)
    return { latest: null, previous: null, secondPrevious: null };

  const latest = sorted[0];
  const targetTimestamp = latest.timestampMs - intervalMs;
  const previous =
    sorted.slice(1).reduce((best, sample) => {
      const deltaToTarget = Math.abs(sample.timestampMs - targetTimestamp);
      if (!best) return { sample, deltaToTarget };
      if (deltaToTarget < best.deltaToTarget) return { sample, deltaToTarget };
      return best;
    }, null)?.sample || null;

  const secondPrevious = sorted.length > 2 ? sorted[2] : null;

  return { latest, previous, secondPrevious };
}

function resolveGateRoomNumbers(roomId) {
  const rawRoomId = String(roomId || "").trim();
  const roomLookupKey = rawRoomId.toLowerCase();
  const mappedRooms = GATE_ROOM_TO_ROOM_NUMBERS[roomLookupKey] || [];
  const fallbackRoom =
    GATE_ROOM_TO_ROOM_NUMBER[roomLookupKey] ||
    ROLE_ROOM_MAP[roomLookupKey]?.roomNumber ||
    rawRoomId;
  return Array.from(new Set([...mappedRooms, fallbackRoom].filter(Boolean)));
}

function fmtClimate(metric, value) {
  if (metric === "temperature") return `${value.toFixed(1)} C`;
  if (metric === "humidity") return `${Math.round(value)} %`;
  if (metric === "co2") return `${Math.round(value)} ppm`;
  return `${value}`;
}

function metricLabel(metric) {
  if (metric === "temperature") return "Temperature";
  if (metric === "humidity") return "Humidity";
  if (metric === "co2") return "CO2";
  return metric;
}

export default function CesiumGeoJsonViewer({ onFeatureClick }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const showRoomLabelForEntityRef = useRef(() => {});
  const hideAllRoomLabelsRef = useRef(() => {});
  const i3sRef = useRef(null);
  const roomEntitiesRef = useRef([]);
  const circuitEntitiesRef = useRef([]);
  const sensorEntitiesRef = useRef([]);
  const homeDestRef = useRef(null);
  const floorsRef = useRef([]);
  const timeWindowRef = useRef({ start: null, end: null });
  const pvDataRef = useRef({});
  const animFramesRef = useRef([]);
  const animIntervalRef = useRef(null);
  const activeHeatmapRef = useRef(null);
  const liveFrameDataRef = useRef(new Map()); // Map<roomNumber, {temperature,humidity,co2,occupancy}>
  const replayRafRef = useRef(null);
  const replayDataRef = useRef({});
  const replayEnergyWindowRef = useRef({}); // { [circuitId]: { startMs, endMs } } from raw Gate rows
  const replayPlayingRef = useRef(false);
  const replayFrameRef = useRef(0);
  const replaySpeedRef = useRef(1);
  const climateReplayTimerRef = useRef(null);
  const climateReplayDataRef = useRef({});
  const replayLoadPromiseRef = useRef(null);
  const climateReplayPlayingRef = useRef(false);
  const climateReplayFrameRef = useRef(0);
  const climateReplaySpeedRef = useRef(1);

  const [loading, setLoading] = useState(true);
  const [i3sAvailable, setI3sAvailable] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [availableFloors, setAvailableFloors] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState("");
  const [selectedCircuit, setSelectedCircuit] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeHeatmap, setActiveHeatmap] = useState(null);
  const [activeMode, setActiveMode] = useState("default");
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayMode, setReplayMode] = useState("energy");
  const [replayCircuit, setReplayCircuit] = useState("main");
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayFrame, setReplayFrame] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState(null);
  const [replayDataAge, setReplayDataAge] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(null);
  const [liveView, setLiveView] = useState("circuits");
  const [liveClockMs, setLiveClockMs] = useState(() => Date.now());
  const [liveSnapshot, setLiveSnapshot] = useState({
    electricity: [],
    rooms: [],
  });
  const [liveRoomsFloorFilter, setLiveRoomsFloorFilter] = useState("all");
  const [climateReplayRoom, setClimateReplayRoom] = useState("");
  const [climateReplayMetric, setClimateReplayMetric] = useState("temperature");
  const [climateApplyToBuilding, setClimateApplyToBuilding] = useState(false);
  const [climateReplayPlaying, setClimateReplayPlaying] = useState(false);
  const [climateReplayFrame, setClimateReplayFrame] = useState(0);
  const [climateReplaySpeed, setClimateReplaySpeed] = useState(1);
  const [compareRoom, setCompareRoom] = useState("");
  const [signalA, setSignalA] = useState("main");
  const [signalB, setSignalB] = useState("circuit8");
  const [compareDataTick, setCompareDataTick] = useState(0);
  const [outsideTempSeries, setOutsideTempSeries] = useState([]);
  const outsideTempRef = useRef([]);
  const [scenarioGoal, setScenarioGoal] = useState(null);
  const [appliedScenarios, setAppliedScenarios] = useState([]);
  const [scenarioResult, setScenarioResult] = useState(null);
  const [tariffRate, setTariffRate] = useState(0.22);
  const [occupancyLevel, setOccupancyLevel] = useState(100);
  const [carbonPrice, setCarbonPrice] = useState(25);
  const [showRolePanel, setShowRolePanel] = useState(false);
  const [activeRole, setActiveRole] = useState(null);
  const [expertMode, setExpertMode] = useState(false);
  const [faultPanelOpen, setFaultPanelOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const [animFrame, setAnimFrame] = useState(0);
  const [animFrameCount, setAnimFrameCount] = useState(REPLAY_FRAMES);
  const [animTickLabels, setAnimTickLabels] = useState([
    "00:00",
    "12:00",
    "24:00",
    "36:00",
    "47:45",
  ]);
  const animFrameRef = useRef(0);
  const [animPlaying, setAnimPlaying] = useState(false);
  const [animReady, setAnimReady] = useState(false);
  const [buildingSummary, setBuildingSummary] = useState(null);

  const {
    faults,
    summary: faultSummary,
    faultHistory,
    clearHistory: clearFaultHistory,
  } = useFaultDetection({
    replayDataRef,
    pvDataRef,
    climateReplayDataRef,
    currentFrame: animFrame,
    outsideTempRef,
    tariff: tariffRate || 0.22,
    enabled: activeRole === "director" || activeRole === "facilities",
  });

  useEffect(() => {
    localStorage.removeItem("dtwin_role");
    if (localStorage.getItem("dtwin_expert") === "1") setExpertMode(true);
    else setShowRolePanel(true);
  }, []);

  useEffect(() => {
    activeHeatmapRef.current = activeHeatmap;
  }, [activeHeatmap]);

  useEffect(() => {
    animFrameRef.current = animFrame;
  }, [animFrame]);

  const rolePanelVisible = expertMode
    ? showRolePanel
    : showRolePanel && !loading;
  const showOriginalPanels = expertMode;
  const replayAvailable = !loading;

  const resetStyles = useCallback(() => {
    [...roomEntitiesRef.current, ...circuitEntitiesRef.current].forEach((e) => {
      if (e.polygon && e.originalMaterial) {
        e.polygon.material = e.originalMaterial;
        e.polygon.outlineColor = Cesium.Color.BLACK.withAlpha(0.85);
        e.polygon.outlineWidth = 2;
      }
      if (e.box && e.originalMaterial) e.box.material = e.originalMaterial;
      if (e.cylinder && e.originalMaterial)
        e.cylinder.material = e.originalMaterial;
      if (e.ellipsoid && e.originalMaterial)
        e.ellipsoid.material = e.originalMaterial;
      if (e.labelEntity?.label) {
        e.labelEntity.label.pixelOffset = new Cesium.Cartesian2(0, -12);
        e.labelEntity.show = false;
      }
    });
    setActiveHeatmap(null);
    activeHeatmapRef.current = null;
    setBuildingSummary(null);
    setAnimPlaying(false);
  }, []);

  const clearFloorCompare = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const compareEntities = viewer._compareEntities || [];
    compareEntities.forEach((e) => {
      try {
        viewer.entities.remove(e);
      } catch {
        /* ignore remove errors */
      }
    });
    viewer._compareEntities = [];
    const overlay = document.getElementById("compare-overlay");
    if (overlay) overlay.style.display = "none";
  }, []);

  const showOnly = useCallback((pred) => {
    [...roomEntitiesRef.current, ...circuitEntitiesRef.current].forEach((e) => {
      e.show = pred(e);
      if (e.labelEntity) e.labelEntity.show = false;
    });
  }, []);

  const zoomToEntities = useCallback((entities, mult = 2.5, min = 25) => {
    const viewer = viewerRef.current;
    if (!viewer || !entities.length) return;
    const sphere = getBoundingSphere(entities);
    if (!sphere) return;
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-45),
        Math.max(sphere.radius * mult, min),
      ),
    });
  }, []);

  const stopReplay = useCallback(() => {
    if (replayRafRef.current) clearTimeout(replayRafRef.current);
    replayRafRef.current = null;
    replayPlayingRef.current = false;
    setReplayPlaying(false);
  }, []);

  const loadReplayData = useCallback(async () => {
    if (replayLoadPromiseRef.current) return replayLoadPromiseRef.current;

    replayLoadPromiseRef.current = (async () => {
      setReplayLoading(true);
      setReplayError(null);

      try {
        console.log("[Replay] Loading last 48h from Gate API...");

        const [liveElecResult, liveRoomsResult] = await Promise.allSettled([
          fetchElectricityLive(),
          fetchAllSensorsLive(),
        ]);

        const liveElecRows =
          liveElecResult.status === "fulfilled" ? liveElecResult.value : [];
        const liveRoomRows =
          liveRoomsResult.status === "fulfilled" ? liveRoomsResult.value : [];

        const latestSampleMs = Math.max(
          getLatestRowTimestampMs(liveElecRows),
          getLatestRowTimestampMs(liveRoomRows),
        );
        const historyRange = Number.isFinite(latestSampleMs)
          ? getDateRangeForHours(REPLAY_WINDOW_HOURS, new Date(latestSampleMs))
          : getDateRangeForHours(REPLAY_WINDOW_HOURS);

        if (Number.isFinite(latestSampleMs)) {
          console.log(
            "[Replay] Anchoring 48h window to latest sample:",
            new Date(latestSampleMs).toISOString(),
          );
        }

        const [elecResult, solarResult, roomsResult] = await Promise.allSettled(
          [
            fetchElectricityHistory(historyRange),
            fetchSolarHistory(historyRange),
            fetchAllSensorsHistory(historyRange),
          ],
        );

        if (elecResult.status === "rejected") {
          console.warn(
            "[Replay] Electricity history:",
            elecResult.reason?.message,
          );
        }
        if (solarResult.status === "rejected") {
          console.warn("[Replay] Solar history:", solarResult.reason?.message);
        }
        if (roomsResult.status === "rejected") {
          console.warn(
            "[Replay] Room sensor history:",
            roomsResult.reason?.message,
          );
        }

        const elecRows =
          elecResult.status === "fulfilled" ? elecResult.value : [];
        const solarRows =
          solarResult.status === "fulfilled" ? solarResult.value : [];
        const roomRows =
          roomsResult.status === "fulfilled" ? roomsResult.value : [];

        const emptyEnergy = Object.fromEntries(
          Object.keys(CIRCUIT_CONFIGS).map((id) => [id, []]),
        );

        if (elecRows.length > 0) {
          const energyWindowByCircuit = {};
          elecRows.forEach((row) => {
            const circuitId = normalizeCircuitId(row?.circuit_id);
            const tsMs = Date.parse(row?.ts);
            if (
              !circuitId ||
              !CIRCUIT_CONFIGS[circuitId] ||
              !Number.isFinite(tsMs)
            )
              return;
            const existing = energyWindowByCircuit[circuitId];
            if (!existing) {
              energyWindowByCircuit[circuitId] = { startMs: tsMs, endMs: tsMs };
              return;
            }
            if (tsMs < existing.startMs) existing.startMs = tsMs;
            if (tsMs > existing.endMs) existing.endMs = tsMs;
          });
          replayEnergyWindowRef.current = energyWindowByCircuit;

          const elecFrames = buildReplayFrames(
            elecRows,
            "circuit_id",
            "value",
            REPLAY_FRAMES,
          );
          replayDataRef.current = {
            ...emptyEnergy,
            ...elecFrames,
          };
          console.log(
            "[Replay] Electricity frames built:",
            Object.keys(elecFrames).length,
            "circuits,",
            Object.values(elecFrames)[0]?.length,
            "frames each",
          );
        } else {
          console.warn(
            "[Replay] No electricity history — energy tab will be empty",
          );
          replayDataRef.current = emptyEnergy;
          replayEnergyWindowRef.current = {};
        }

        pvDataRef.current = buildPvDataRef(solarRows, REPLAY_FRAMES);
        console.log(
          "[Replay] Solar frames built:",
          Object.keys(pvDataRef.current?.byEndpoint || {}).length,
          "parameters,",
          pvDataRef.current?.pvTotal?.length || 0,
          "frames for pvTotal",
        );

        if (roomRows.length > 0) {
          const climateFramesRaw = buildGateClimateReplayFrames(
            roomRows,
            REPLAY_FRAMES,
          );
          const climateFrames = {};
          Object.entries(climateFramesRaw).forEach(([roomId, frames]) => {
            // Gate API returns room names (e.g. "kitchen"); translate to GeoJSON RoomNumber (e.g. "004")
            resolveGateRoomNumbers(roomId).forEach((mappedRoomNumber) => {
              const key = toReplayRoomKey(mappedRoomNumber);
              if (!key) return;
              climateFrames[key] = frames;
            });
          });
          climateReplayDataRef.current = climateFrames;
          console.log(
            "[Replay] Climate frames built:",
            Object.keys(climateFrames).length,
            "rooms:",
            Object.keys(climateFrames).join(", "),
          );
        } else {
          console.warn(
            "[Replay] No room sensor history — IAQ tab will be empty",
          );
          climateReplayDataRef.current = {};
        }

        const now = new Date();
        setReplayDataAge(now);
        setCompareDataTick((t) => t + 1);
        console.log("[Replay] Last 48h loaded at", now.toLocaleTimeString());
      } catch (error) {
        const message = error?.message || "Failed to load replay data";
        console.error("[Replay] Failed to load history:", message);
        setReplayError(message);
      } finally {
        setReplayLoading(false);
        replayLoadPromiseRef.current = null;
      }
    })();

    return replayLoadPromiseRef.current;
  }, []);

  const loadEnergyReplayData = useCallback(async () => {
    await loadReplayData();
    return replayDataRef.current;
  }, [loadReplayData]);

  const loadLiveData = useCallback(async () => {
    setLiveLoading(true);
    setLiveError(null);

    try {
      const [electricityResult, roomsResult] = await Promise.allSettled([
        fetchElectricityLive(),
        fetchAllSensorsLive(),
      ]);

      const electricity =
        electricityResult.status === "fulfilled" ? electricityResult.value : [];
      const rooms = roomsResult.status === "fulfilled" ? roomsResult.value : [];

      if (electricityResult.status === "rejected") {
        console.warn(
          "[Live] Electricity fetch failed:",
          electricityResult.reason?.message,
        );
      }
      if (roomsResult.status === "rejected") {
        console.warn(
          "[Live] Sensor fetch failed:",
          roomsResult.reason?.message,
        );
      }

      const errorMessages = [
        electricityResult.status === "rejected"
          ? electricityResult.reason?.message
          : null,
        roomsResult.status === "rejected" ? roomsResult.reason?.message : null,
      ].filter(Boolean);

      setLiveSnapshot({ electricity, rooms });

      if (!electricity.length && !rooms.length) {
        setLiveError(
          errorMessages.length
            ? `Live data unavailable. ${errorMessages.join(" | ")}`
            : "Live data unavailable. The Gate API returned no electricity or room telemetry.",
        );
      } else if (errorMessages.length) {
        setLiveError(`Partial live data loaded. ${errorMessages.join(" | ")}`);
      }
    } catch (error) {
      const message = error?.message || "Failed to load live data";
      setLiveError(message);
    } finally {
      setLiveLoading(false);
    }
  }, []);

  const liveRoomsViewRows = useMemo(() => {
    const roomMetaByKey = new Map(
      availableRooms.map((room) => [toReplayRoomKey(room.roomNumber), room]),
    );
    const samplesByRoom = new Map();

    (liveSnapshot.rooms || []).forEach((row, index) => {
      const timestampMs = Number.isFinite(Date.parse(row.ts))
        ? Date.parse(row.ts)
        : -1;
      resolveGateRoomNumbers(row.room_id).forEach((mappedRoomNumber) => {
        const roomKey =
          toReplayRoomKey(mappedRoomNumber) ||
          String(mappedRoomNumber || `room-${index}`);
        const sample = { row, roomKey, timestampMs, index, mappedRoomNumber };
        const existing = samplesByRoom.get(roomKey) || [];
        existing.push(sample);
        samplesByRoom.set(roomKey, existing);
      });
    });

    return Array.from(samplesByRoom.values())
      .map((samples) => {
        const { latest, previous } = pickLatestAndIntervalSample(
          samples,
          15 * 60 * 1000,
        );
        if (!latest) return null;
        const { row, roomKey, timestampMs, index, mappedRoomNumber } = latest;
        const meta = roomMetaByKey.get(roomKey);
        const displayRoomNumber =
          meta?.roomNumber || mappedRoomNumber || row.room_id || roomKey;
        return {
          id: String(displayRoomNumber || `room-${index}`),
          label: meta?.roomName || `Room ${displayRoomNumber || index + 1}`,
          secondary: meta?.roomNumber ? `Room ${meta.roomNumber}` : null,
          floorLevel: meta?.floorLevel ?? meta?.floor ?? null,
          temp: Number(row.temp_c),
          humidity: Number(row.humidity_rh),
          co2: Number(row.co2_ppm),
          timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
          previousTemp: Number(previous?.row?.temp_c),
          previousHumidity: Number(previous?.row?.humidity_rh),
          previousCo2: Number(previous?.row?.co2_ppm),
          previousTimestampMs: Number.isFinite(previous?.timestampMs)
            ? previous.timestampMs
            : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        String(a.label).localeCompare(String(b.label), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [availableRooms, liveSnapshot.rooms]);

  const liveRoomFloorOptions = useMemo(() => {
    const floors = Array.from(
      new Set(
        liveRoomsViewRows
          .map((room) => room.floorLevel)
          .filter((floor) => Number.isFinite(Number(floor)))
          .map((floor) => Number(floor)),
      ),
    ).sort((a, b) => a - b);
    return floors;
  }, [liveRoomsViewRows]);

  const filteredLiveRoomsViewRows = useMemo(() => {
    if (liveRoomsFloorFilter === "all") return liveRoomsViewRows;
    return liveRoomsViewRows.filter(
      (room) => String(room.floorLevel) === String(liveRoomsFloorFilter),
    );
  }, [liveRoomsFloorFilter, liveRoomsViewRows]);

  const liveCircuitsViewRows = useMemo(() => {
    const samplesByCircuit = new Map();

    (liveSnapshot.electricity || []).forEach((row, index) => {
      const id =
        normalizeCircuitId(row.circuit_id) ||
        String(row.circuit_id || `circuit-${index}`);
      const timestampMs = Number.isFinite(Date.parse(row.ts))
        ? Date.parse(row.ts)
        : -1;
      const sample = { row, id, timestampMs, index };
      const existing = samplesByCircuit.get(id) || [];
      existing.push(sample);
      samplesByCircuit.set(id, existing);
    });

    return Array.from(samplesByCircuit.values())
      .map((samples) => {
        const { latest, previous, secondPrevious } =
          pickLatestAndIntervalSample(samples, 60 * 60 * 1000);
        if (!latest) return null;
        const { row, id, timestampMs, index } = latest;
        return {
          id: id || `circuit-${index}`,
          label: CIRCUIT_CONFIGS[id]?.label || row.circuit_id || id,
          color: CIRCUIT_CONFIGS[id]?.color || "#60A5FA",
          watts: Number(row.value) || 0,
          timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
          previousWatts: Number(previous?.row?.value) || 0,
          previousTimestampMs: Number.isFinite(previous?.timestampMs)
            ? previous.timestampMs
            : null,
          secondPreviousWatts: Number(secondPrevious?.row?.value) || 0,
          secondPreviousTimestampMs: Number.isFinite(
            secondPrevious?.timestampMs,
          )
            ? secondPrevious.timestampMs
            : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.watts - a.watts);
  }, [liveSnapshot.electricity]);

  const liveCircuitsLatestTs = useMemo(() => {
    const values = liveCircuitsViewRows
      .map((row) => row.timestampMs)
      .filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  }, [liveCircuitsViewRows]);

  const liveRoomsLatestTs = useMemo(() => {
    const values = liveRoomsViewRows
      .map((row) => row.timestampMs)
      .filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  }, [liveRoomsViewRows]);

  const loadOutsideTemperature = useCallback(async () => {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);

      const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
      weatherUrl.searchParams.set("latitude", String(HOME_CAMERA.lat));
      weatherUrl.searchParams.set("longitude", String(HOME_CAMERA.lon));
      weatherUrl.searchParams.set("hourly", "temperature_2m");
      weatherUrl.searchParams.set("past_days", "3");
      weatherUrl.searchParams.set("forecast_days", "1");
      weatherUrl.searchParams.set("timezone", "Europe/Sofia");

      const res = await fetch(weatherUrl.toString());
      if (!res.ok)
        throw new Error(`Outside weather request failed (${res.status})`);

      const json = await res.json();
      const times = Array.isArray(json?.hourly?.time) ? json.hourly.time : [];
      const temps = Array.isArray(json?.hourly?.temperature_2m)
        ? json.hourly.temperature_2m
        : [];

      const series = times
        .map((ts, i) => {
          const timestampMs = Date.parse(ts);
          const temp = Number(temps[i]);
          if (!Number.isFinite(timestampMs) || !Number.isFinite(temp))
            return null;
          if (timestampMs < start.getTime() || timestampMs > end.getTime())
            return null;
          const d = new Date(timestampMs);
          return {
            timestampMs,
            temp,
            hour: d.getHours() + d.getMinutes() / 60,
            time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.timestampMs - b.timestampMs);

      outsideTempRef.current = series;
      setOutsideTempSeries(series);
    } catch (error) {
      console.warn(
        "[OutsideTemp] Failed to load trend:",
        error?.message || error,
      );
      outsideTempRef.current = [];
      setOutsideTempSeries([]);
    }
  }, []);

  const tickReplay = useCallback(() => {
    if (!replayPlayingRef.current) return;
    const allData = replayDataRef.current;
    const circuits = Object.keys(allData);
    if (!circuits.length) return;
    const totalFrames = allData[circuits[0]]?.length || REPLAY_FRAMES;
    let frame = (replayFrameRef.current + 1) % totalFrames;
    replayFrameRef.current = frame;
    setReplayFrame(frame);
    replayRafRef.current = setTimeout(tickReplay, 500 / replaySpeedRef.current);
  }, []);

  const startReplay = useCallback(async () => {
    stopReplay();
    const data = await loadEnergyReplayData();
    const firstCircuit =
      Object.keys(CIRCUIT_CONFIGS).find((id) => data[id]?.length) || "main";
    if (!data[firstCircuit]?.length) return;
    replayFrameRef.current = 0;
    setReplayFrame(0);
    if (i3sRef.current) i3sRef.current.show = false;
    resetStyles();
    roomEntitiesRef.current.forEach((e) => {
      e.show = true;
    });
    replayPlayingRef.current = true;
    setReplayPlaying(true);
    replayRafRef.current = setTimeout(tickReplay, 0);
  }, [stopReplay, loadEnergyReplayData, tickReplay, resetStyles]);

  const seekReplay = useCallback((frame) => {
    replayFrameRef.current = frame;
    setReplayFrame(frame);
  }, []);

  const changeSpeed = useCallback((s) => {
    replaySpeedRef.current = s;
    setReplaySpeed(s);
  }, []);

  const stopClimateReplay = useCallback(() => {
    if (climateReplayTimerRef.current)
      clearTimeout(climateReplayTimerRef.current);
    climateReplayTimerRef.current = null;
    climateReplayPlayingRef.current = false;
    setClimateReplayPlaying(false);
  }, []);

  const applyClimateFrame = useCallback(
    (
      frame,
      metric = climateReplayMetric,
      targetRoom = climateReplayRoom,
      scope = "room",
    ) => {
      const data = climateReplayDataRef.current;
      if (!Object.keys(data).length) return;
      if (i3sRef.current) i3sRef.current.show = false;
      const focusRoom = toReplayRoomKey(targetRoom);
      const showWholeBuilding = scope === "building";
      const focusSingleRoom = Boolean(
        !showWholeBuilding && focusRoom && data[focusRoom],
      );
      roomEntitiesRef.current.forEach((e) => {
        const rn = e.properties?.roomNumber?.getValue?.();
        const roomKey = toReplayRoomKey(rn);
        const sample = data[roomKey]?.[frame];
        const matchesFocus = !focusSingleRoom || roomKey === focusRoom;
        e.show = showWholeBuilding ? Boolean(sample) : matchesFocus;
        if (!e.show) {
          if (e.labelEntity) e.labelEntity.show = false;
          return;
        }
        if (!sample) return;
        const v = Number(sample[metric] ?? 0);
        if (e.polygon) {
          const color = metricToColor(metric, v);
          e.polygon.material = color;
          e.polygon.outlineColor = color.brighten(0.15, new Cesium.Color());
          e.polygon.outlineWidth =
            focusRoom && roomKey === focusRoom
              ? 5
              : showWholeBuilding
                ? 2.5
                : 3;
        }
        if (e.labelEntity) e.labelEntity.show = false;
      });
      circuitEntitiesRef.current.forEach((e) => {
        e.show = false;
      });
    },
    [climateReplayMetric, climateReplayRoom],
  );

  const tickClimateReplay = useCallback(() => {
    if (!climateReplayPlayingRef.current) return;
    const allData = climateReplayDataRef.current;
    const rooms = Object.keys(allData);
    if (!rooms.length) return;
    const activeRoomKey = toReplayRoomKey(climateReplayRoom);
    const totalFrames =
      allData[activeRoomKey]?.length ||
      allData[rooms[0]]?.length ||
      REPLAY_FRAMES;
    const frame = (climateReplayFrameRef.current + 1) % totalFrames;
    climateReplayFrameRef.current = frame;
    setClimateReplayFrame(frame);
    applyClimateFrame(
      frame,
      climateReplayMetric,
      climateReplayRoom,
      climateApplyToBuilding ? "building" : "room",
    );
    climateReplayTimerRef.current = setTimeout(
      tickClimateReplay,
      550 / climateReplaySpeedRef.current,
    );
  }, [
    applyClimateFrame,
    climateApplyToBuilding,
    climateReplayMetric,
    climateReplayRoom,
  ]);

  const ensureClimateReplayData = useCallback(
    async (roomNumber) => {
      const roomKey = toReplayRoomKey(roomNumber);
      if (!roomKey) return [];
      if (
        Array.isArray(climateReplayDataRef.current[roomKey]) &&
        climateReplayDataRef.current[roomKey].length
      ) {
        return climateReplayDataRef.current[roomKey];
      }
      await loadReplayData();
      return climateReplayDataRef.current[roomKey] || [];
    },
    [loadReplayData],
  );

  const ensureAllClimateReplayData = useCallback(async () => {
    await loadReplayData();
    return climateReplayDataRef.current;
  }, [loadReplayData]);

  const focusClimateRoom = useCallback(
    (roomNumber) => {
      const rawRoom = String(roomNumber ?? "").trim();
      const roomId = toReplayRoomKey(rawRoom);
      if (!roomId) return false;
      // Prefer exact room-number matches first to avoid collapsing multiple rooms
      // that normalize to the same key (e.g., 110 and 1.10).
      let matches = roomEntitiesRef.current.filter((e) => {
        const rn = String(e.properties?.roomNumber?.getValue?.() ?? "").trim();
        return rn && rawRoom && rn === rawRoom;
      });
      if (!matches.length) {
        matches = roomEntitiesRef.current.filter(
          (e) =>
            toReplayRoomKey(e.properties?.roomNumber?.getValue?.()) === roomId,
        );
      }
      if (!matches.length) return false;
      setSelectedRoom(
        matches[0].properties?.roomNumber?.getValue?.() ?? roomId,
      );
      if (i3sRef.current) i3sRef.current.show = false;
      zoomToEntities(matches, matches.length > 1 ? 2.8 : 4, 15);
      return true;
    },
    [zoomToEntities],
  );

  const startClimateReplay = useCallback(async () => {
    stopReplay();
    stopClimateReplay();
    const roomKey = toReplayRoomKey(climateReplayRoom);
    if (!roomKey) return;
    const frames = await ensureClimateReplayData(roomKey);
    if (!frames.length) return;
    climateReplayFrameRef.current = 0;
    setClimateReplayFrame(0);
    climateReplayPlayingRef.current = true;
    setClimateReplayPlaying(true);
    resetStyles();
    focusClimateRoom(climateReplayRoom || roomKey);
    applyClimateFrame(
      0,
      climateReplayMetric,
      climateReplayRoom || roomKey,
      climateApplyToBuilding ? "building" : "room",
    );
    climateReplayTimerRef.current = setTimeout(tickClimateReplay, 0);
  }, [
    stopReplay,
    stopClimateReplay,
    ensureClimateReplayData,
    resetStyles,
    applyClimateFrame,
    climateApplyToBuilding,
    climateReplayMetric,
    climateReplayRoom,
    tickClimateReplay,
    focusClimateRoom,
  ]);

  const seekClimateReplay = useCallback(
    async (frame) => {
      const roomKey = toReplayRoomKey(climateReplayRoom);
      await ensureClimateReplayData(roomKey);
      climateReplayFrameRef.current = frame;
      setClimateReplayFrame(frame);
      applyClimateFrame(
        frame,
        climateReplayMetric,
        climateReplayRoom,
        climateApplyToBuilding ? "building" : "room",
      );
    },
    [
      ensureClimateReplayData,
      applyClimateFrame,
      climateApplyToBuilding,
      climateReplayMetric,
      climateReplayRoom,
    ],
  );

  const changeClimateSpeed = useCallback((s) => {
    climateReplaySpeedRef.current = s;
    setClimateReplaySpeed(s);
  }, []);

  const hydrateLatestRoomTelemetry = useCallback(async () => {
    // Replay/live room telemetry now comes from Gate API history loader.
    // Keep this as a no-op to avoid legacy PostgREST startup calls.
    return;
  }, []);

  const getLatestClimateSampleForRoom = useCallback((roomNumber) => {
    const roomKey = toReplayRoomKey(roomNumber);
    if (!roomKey) return null;
    const frames = climateReplayDataRef.current[roomKey];
    if (!Array.isArray(frames) || !frames.length) return null;
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const sample = frames[index];
      if (
        sample?.temperature != null ||
        sample?.humidity != null ||
        sample?.co2 != null
      ) {
        return sample;
      }
    }
    return null;
  }, []);

  const getHeatmapMetricValue = useCallback(
    (entity, metric) => {
      const roomNumber = entity?.properties?.roomNumber?.getValue?.();
      const fromTimeline = liveFrameDataRef.current.get(roomNumber)?.[metric];
      if (fromTimeline != null) return fromTimeline;
      const climateValue = getLatestClimateSampleForRoom(roomNumber)?.[metric];
      if (climateValue != null) return climateValue;
      return entity?.properties?.[metric]?.getValue?.() ?? null;
    },
    [getLatestClimateSampleForRoom],
  );

  const hideAllRoomLabels = useCallback(() => {
    roomEntitiesRef.current.forEach((x) => {
      if (x.labelEntity?.label) {
        x.labelEntity.show = false;
        x.labelEntity.label.pixelOffset = new Cesium.Cartesian2(0, -12);
      }
    });
  }, []);

  /** Show one room label (after map click). Does not run for programmatic zoom/search. */
  const showRoomLabelForEntity = useCallback(
    (entity) => {
      if (
        !entity?.properties?.roomNumber?.getValue ||
        !entity.labelEntity?.label
      )
        return;
      hideAllRoomLabels();
      const le = entity.labelEntity;
      const roomName = entity.properties.roomName?.getValue?.() ?? "";
      const roomNumber = entity.properties.roomNumber?.getValue?.() ?? "";
      const circuits = entity.properties.circuit_id?.getValue?.();
      const circStr = Array.isArray(circuits)
        ? circuits.join(", ")
        : String(circuits ?? "");
      const temp = Number(getHeatmapMetricValue(entity, "temperature"));
      const hum = Number(getHeatmapMetricValue(entity, "humidity"));
      const co2 = Number(getHeatmapMetricValue(entity, "co2"));
      const tempDisp = Number.isFinite(temp) ? temp.toFixed(1) : "—";
      const humDisp = Number.isFinite(hum) ? Math.round(hum) : "—";
      const lines = [roomName, roomNumber, `Circuits: ${circStr}`];
      if (Number.isFinite(temp)) lines.push(`🌡 ${tempDisp}°C`);
      if (Number.isFinite(hum)) lines.push(`💧 ${humDisp}%`);
      if (Number.isFinite(co2)) lines.push(`CO₂ ${Math.round(co2)} ppm`);
      let alertLine = "";
      if (Number.isFinite(co2) && co2 > ALERT_THRESHOLDS.co2.value)
        alertLine = `⚠ CO₂ ${Math.round(co2)} ppm`;
      else if (
        Number.isFinite(temp) &&
        temp > ALERT_THRESHOLDS.temperature.value
      )
        alertLine = `🌡 High temp ${tempDisp}°C`;
      else if (Number.isFinite(hum) && hum < ALERT_THRESHOLDS.humidity_lo.value)
        alertLine = `💧 Dry ${humDisp}%`;
      else if (Number.isFinite(hum) && hum > ALERT_THRESHOLDS.humidity_hi.value)
        alertLine = `💧 Humid ${humDisp}%`;
      if (alertLine) lines.push(alertLine);
      le.label.text = lines.join("\n");
      le.label.font = "700 13px 'Courier New',monospace";
      le.label.outlineWidth = 3;
      le.label.backgroundColor = Cesium.Color.BLACK.withAlpha(0.84);
      le.label.pixelOffset = new Cesium.Cartesian2(0, -12);
      le.show = true;
    },
    [getHeatmapMetricValue, hideAllRoomLabels],
  );

  showRoomLabelForEntityRef.current = showRoomLabelForEntity;
  hideAllRoomLabelsRef.current = hideAllRoomLabels;

  const applyHeatmapColors = useCallback(
    (metric) => {
      if (!metric) return;
      roomEntitiesRef.current.forEach((entity) => {
        if (!entity.show) return;
        const value = getHeatmapMetricValue(entity, metric);
        if (value != null && entity.polygon) {
          entity.polygon.material = metricToColor(metric, Number(value));
          entity.polygon.outlineColor = Cesium.Color.BLACK.withAlpha(0.5);
          entity.polygon.outlineWidth = 1;
        }
      });
    },
    [getHeatmapMetricValue],
  );

  const computeBuildingSummary = useCallback(
    (metric) => {
      if (!metric) {
        setBuildingSummary(null);
        return;
      }
      const UNITS = {
        temperature: "°C",
        co2: " ppm",
        humidity: "%",
        occupancy: "",
      };
      const unit = UNITS[metric] ?? "";
      const seen = new Set();
      const vals = [];
      const byRoom = [];
      roomEntitiesRef.current.forEach((e) => {
        if (!e.show) return;
        const rn = e.properties?.roomNumber?.getValue?.();
        if (seen.has(rn)) return;
        seen.add(rn);
        const raw = getHeatmapMetricValue(e, metric);
        if (raw == null) return;
        const v = Number(raw);
        vals.push(v);
        byRoom.push({
          rn,
          name: e.properties?.roomName?.getValue?.() ?? rn,
          floor: e.properties?.floorLevel?.getValue?.() ?? "-",
          v,
        });
      });
      if (!vals.length) {
        setBuildingSummary(null);
        return;
      }
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...byRoom].sort((a, b) => a.v - b.v);
      const worst = sorted[sorted.length - 1];
      const best = sorted[0];
      let alertCount = 0;
      if (metric === "temperature")
        alertCount = vals.filter((v) => v > 26).length;
      else if (metric === "co2")
        alertCount = vals.filter((v) => v > 1000).length;
      else if (metric === "humidity")
        alertCount = vals.filter((v) => v < 30 || v > 65).length;
      setBuildingSummary({
        min: Math.min(...vals),
        max: Math.max(...vals),
        avg,
        alertCount,
        unit,
        worst,
        best,
        metric,
        byRoom: sorted,
      });
    },
    [getHeatmapMetricValue],
  );

  const generateAnimFrames = useCallback(
    (entities) => {
      const roomBases = new Map();
      entities.forEach((e) => {
        const rn = e.properties?.roomNumber?.getValue?.();
        const climateSample = getLatestClimateSampleForRoom(rn);
        if (rn && !roomBases.has(rn)) {
          roomBases.set(rn, {
            temperature: Number(
              climateSample?.temperature ??
                e.properties.temperature?.getValue?.() ??
                22,
            ),
            humidity: Number(
              climateSample?.humidity ??
                e.properties.humidity?.getValue?.() ??
                45,
            ),
            co2: Number(
              climateSample?.co2 ?? e.properties.co2?.getValue?.() ?? 450,
            ),
            occupancy: Number(e.properties.occupancy?.getValue?.() ?? 0),
          });
        }
      });

      const climate = climateReplayDataRef.current;
      let maxLen = 0;
      roomBases.forEach((_, rn) => {
        const rk = toReplayRoomKey(rn);
        const len = rk && Array.isArray(climate[rk]) ? climate[rk].length : 0;
        if (len > maxLen) maxLen = len;
      });

      const frames = [];
      if (maxLen > 0) {
        for (let i = 0; i < maxLen; i += 1) {
          const roomData = new Map();
          let label = "";
          roomBases.forEach((base, rn) => {
            const rk = toReplayRoomKey(rn);
            const sample = rk ? climate[rk]?.[i] : null;
            if (sample?.time && !label) label = sample.time;
            roomData.set(rn, {
              temperature:
                sample?.temperature != null
                  ? Number(sample.temperature)
                  : base.temperature,
              humidity:
                sample?.humidity != null
                  ? Number(sample.humidity)
                  : base.humidity,
              co2: sample?.co2 != null ? Number(sample.co2) : base.co2,
              occupancy: base.occupancy,
            });
          });
          const h = Math.floor(i / 4);
          const m = (i % 4) * 15;
          frames.push({
            label:
              label ||
              `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
            minute: i * 15,
            roomData,
          });
        }
        setAnimTickLabels(buildHeatmapScrubTicks(frames));
      } else {
        for (let i = 0; i < REPLAY_FRAMES; i += 1) {
          const h = Math.floor(i / 4);
          const m = (i % 4) * 15;
          const hod = h % 24;
          const isWork = hod >= 8 && hod <= 18;
          const isPeak = (hod >= 10 && hod <= 12) || (hod >= 14 && hod <= 16);
          const sway = Math.sin((i / REPLAY_FRAMES) * 2 * Math.PI * 3);
          const roomData = new Map();
          roomBases.forEach((base, rn) => {
            const seed = (rn.charCodeAt(0) + i) % 7;
            roomData.set(rn, {
              temperature: +(
                base.temperature +
                (isPeak ? 3 : isWork ? 1.5 : -1) +
                sway * 0.4 +
                (seed * 0.1 - 0.3)
              ).toFixed(1),
              humidity: +(
                base.humidity +
                (isWork ? -4 : 3) +
                sway * 1.5 +
                (seed * 0.2 - 0.7)
              ).toFixed(1),
              co2: Math.round(
                base.co2 +
                  (isPeak ? 350 : isWork ? 150 : 0) +
                  sway * 30 +
                  seed * 8 -
                  20,
              ),
              occupancy: Math.max(
                0,
                Math.round(
                  base.occupancy + (isPeak ? 3 : isWork ? 1 : 0) + (seed % 2),
                ),
              ),
            });
          });
          frames.push({
            label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
            minute: i * 15,
            roomData,
          });
        }
        setAnimTickLabels(buildHeatmapScrubTicks(frames));
      }

      const capped = Math.max(
        0,
        Math.min(animFrameRef.current, frames.length - 1),
      );
      liveFrameDataRef.current = frames[capped]?.roomData ?? new Map(roomBases);
      animFramesRef.current = frames;
      setAnimFrameCount(frames.length);
      if (animFrameRef.current !== capped) setAnimFrame(capped);
      setAnimReady(true);
    },
    [getLatestClimateSampleForRoom],
  );

  const applyAnimFrame = useCallback(
    (frameIdx) => {
      const frames = animFramesRef.current;
      if (!frames.length) return;
      const frame = frames[Math.max(0, Math.min(frameIdx, frames.length - 1))];
      liveFrameDataRef.current = frame.roomData;
      if (activeHeatmapRef.current) {
        applyHeatmapColors(activeHeatmapRef.current);
        computeBuildingSummary(activeHeatmapRef.current);
      }
    },
    [applyHeatmapColors, computeBuildingSummary],
  );

  const hideSensorMarkers = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    sensorEntitiesRef.current.forEach((e) => {
      try {
        viewer.entities.remove(e);
      } catch {
        /* ignore */
      }
    });
    sensorEntitiesRef.current = [];
  }, []);

  /** Per-room Cesium label (shared by polygon fragments). Reset text to default and hide so heatmap isn’t covered by alert/highlight copy. */
  const hideAndRestoreRoomLabelsForHeatmap = useCallback(() => {
    const seen = new WeakSet();
    roomEntitiesRef.current.forEach((entity) => {
      const le = entity.labelEntity;
      if (!le?.label || seen.has(le)) return;
      seen.add(le);
      const roomName = entity.properties?.roomName?.getValue?.() ?? "";
      const roomNumber = entity.properties?.roomNumber?.getValue?.() ?? "";
      const circuits = entity.properties?.circuit_id?.getValue?.();
      const circStr = Array.isArray(circuits)
        ? circuits.join(", ")
        : String(circuits ?? "");
      le.label.text = `${roomName}\n${roomNumber}\nCircuits: ${circStr}`;
      le.label.pixelOffset = new Cesium.Cartesian2(0, -12);
      le.show = false;
    });
  }, []);

  const showHeatmap = useCallback(
    (metric) => {
      const normalizedMetric = normalizeHeatmapMetric(metric);
      if (!normalizedMetric) return;
      if (i3sRef.current) i3sRef.current.show = false;
      resetStyles();
      hideSensorMarkers();
      roomEntitiesRef.current.forEach((entity) => {
        entity.show = true;
        const value = getHeatmapMetricValue(entity, normalizedMetric);
        if (value != null && entity.polygon)
          entity.polygon.material = metricToColor(
            normalizedMetric,
            Number(value),
          );
      });
      hideAndRestoreRoomLabelsForHeatmap();
      setActiveHeatmap(normalizedMetric);
      activeHeatmapRef.current = normalizedMetric;
      computeBuildingSummary(normalizedMetric);
    },
    [
      resetStyles,
      hideSensorMarkers,
      hideAndRestoreRoomLabelsForHeatmap,
      getHeatmapMetricValue,
      computeBuildingSummary,
    ],
  );

  const highlightByQuery = useCallback(
    (queries, color = "cyan") => {
      if (!Array.isArray(queries) || !queries.length) return;
      const css = Cesium.Color.fromCssColorString(color).withAlpha(0.92);
      if (i3sRef.current) i3sRef.current.show = false;
      resetStyles();
      const matched = [];
      queries.forEach((query) => {
        const nq = normStr(query),
          nrn = extractRoomNum(query);
        roomEntitiesRef.current
          .filter((e) => {
            const en = extractRoomNum(e.properties?.roomNumber?.getValue?.());
            if (nrn) return en === nrn;
            const rn = normStr(e.properties?.roomName?.getValue?.()),
              ro = normStr(e.properties?.roomNameOriginal?.getValue?.());
            return rn.includes(nq) || ro.includes(nq);
          })
          .forEach((entity) => {
            entity.show = true;
            if (entity.polygon) {
              entity.polygon.material = css;
              entity.polygon.outlineColor = css;
              entity.polygon.outlineWidth = 3;
            }
            matched.push(entity);
          });
      });
      roomEntitiesRef.current.forEach((e) => {
        if (!matched.includes(e)) e.show = false;
      });
      if (matched.length) zoomToEntities(matched, 2.8, 15);
    },
    [resetStyles, zoomToEntities],
  );

  const highlightByThreshold = useCallback(
    (metric, op, threshold, color = "red") => {
      if (!metric || !op || threshold === undefined) return;
      const css = Cesium.Color.fromCssColorString(color).withAlpha(0.92);
      if (i3sRef.current) i3sRef.current.show = false;
      resetStyles();
      const matched = [];
      roomEntitiesRef.current.forEach((entity) => {
        entity.show = true;
        const raw = getHeatmapMetricValue(entity, metric);
        if (raw == null) return;
        const v = Number(raw);
        if (!isNaN(v) && evaluateOp(v, op, threshold)) {
          if (entity.polygon) {
            entity.polygon.material = css;
            entity.polygon.outlineColor = css;
            entity.polygon.outlineWidth = 3;
          }
          matched.push(entity);
        }
      });
      if (matched.length) zoomToEntities(matched, 2.8, 20);
    },
    [resetStyles, getHeatmapMetricValue, zoomToEntities],
  );

  const showAlerts = useCallback(() => {
    if (i3sRef.current) i3sRef.current.show = false;
    resetStyles();
    const alertEntities = [];
    roomEntitiesRef.current.forEach((entity) => {
      entity.show = true;
      const temp = Number(getHeatmapMetricValue(entity, "temperature") ?? 0);
      const co2 = Number(getHeatmapMetricValue(entity, "co2") ?? 0);
      const humidity = Number(getHeatmapMetricValue(entity, "humidity") ?? 50);
      let alertColor = null;
      if (co2 > ALERT_THRESHOLDS.co2.value) {
        alertColor = Cesium.Color.fromCssColorString(
          ALERT_THRESHOLDS.co2.color,
        ).withAlpha(0.92);
      } else if (temp > ALERT_THRESHOLDS.temperature.value) {
        alertColor = Cesium.Color.fromCssColorString(
          ALERT_THRESHOLDS.temperature.color,
        ).withAlpha(0.92);
      } else if (humidity < ALERT_THRESHOLDS.humidity_lo.value) {
        alertColor = Cesium.Color.fromCssColorString(
          ALERT_THRESHOLDS.humidity_lo.color,
        ).withAlpha(0.88);
      } else if (humidity > ALERT_THRESHOLDS.humidity_hi.value) {
        alertColor = Cesium.Color.fromCssColorString(
          ALERT_THRESHOLDS.humidity_hi.color,
        ).withAlpha(0.88);
      }
      if (alertColor && entity.polygon) {
        entity.polygon.material = alertColor;
        entity.polygon.outlineColor = alertColor;
        entity.polygon.outlineWidth = 4;
        alertEntities.push(entity);
      }
    });
    if (alertEntities.length) zoomToEntities(alertEntities, 2.8, 20);
  }, [resetStyles, getHeatmapMetricValue, zoomToEntities]);

  const zoomToBuilding = useCallback(() => {
    setSelectedCircuit("");
    const viewer = viewerRef.current;
    if (!viewer) return;
    resetStyles();
    hideSensorMarkers();
    [...roomEntitiesRef.current, ...circuitEntitiesRef.current].forEach((e) => {
      e.show = false;
      if (e.labelEntity) e.labelEntity.show = false;
    });
    if (i3sRef.current) i3sRef.current.show = true;
    // Center on actual building geometry when available
    const allEntities = [
      ...roomEntitiesRef.current,
      ...circuitEntitiesRef.current,
    ];
    const sphere = allEntities.length ? getBoundingSphere(allEntities) : null;
    if (sphere) {
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(
          HOME_CAMERA.heading,
          HOME_CAMERA.pitch,
          Math.max(sphere.radius * 3, 80),
        ),
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    } else {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          HOME_CAMERA.lon,
          HOME_CAMERA.lat,
          HOME_CAMERA.height,
        ),
        orientation: {
          heading: HOME_CAMERA.heading,
          pitch: HOME_CAMERA.pitch,
          roll: HOME_CAMERA.roll,
        },
        duration: 1.5,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    }
    if (!i3sRef.current) {
      roomEntitiesRef.current.forEach((e) => {
        e.show = true;
      });
    }
  }, [resetStyles, hideSensorMarkers]);

  const showExteriorModel = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    resetStyles();
    hideSensorMarkers();
    roomEntitiesRef.current.forEach((e) => {
      e.show = false;
      if (e.labelEntity) e.labelEntity.show = false;
    });
    circuitEntitiesRef.current.forEach((e) => {
      e.show = false;
    });
    if (i3sRef.current?.boundingSphere) {
      i3sRef.current.show = true;
      i3sRef.current.show = true;
      viewer.camera.flyToBoundingSphere(i3sRef.current.boundingSphere, {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(
          HOME_CAMERA.heading,
          HOME_CAMERA.pitch,
          Math.max(i3sRef.current.boundingSphere.radius * 2.5, 120),
        ),
      });
      return;
    }
    if (i3sRef.current?.extent) {
      i3sRef.current.show = true;
      const center = Cesium.Rectangle.center(i3sRef.current.extent);
      center.height = 240;
      viewer.camera.flyTo({
        destination: Cesium.Ellipsoid.WGS84.cartographicToCartesian(center),
        duration: 1.2,
      });
      return;
    }
    roomEntitiesRef.current.forEach((e) => {
      e.show = true;
    });
    zoomToEntities(roomEntitiesRef.current, 2.8, 30);
  }, [resetStyles, hideSensorMarkers, zoomToEntities]);

  const showSensorMarkers = useCallback(
    (sensorType = "all") => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      hideSensorMarkers();
      // group GeoJSON entities by roomNumber
      const grouped = new Map();
      roomEntitiesRef.current.forEach((e) => {
        const rn = e.properties?.roomNumber?.getValue?.();
        if (!rn) return;
        if (!grouped.has(rn)) grouped.set(rn, []);
        grouped.get(rn).push(e);
      });
      grouped.forEach((entities) => {
        const sphere = getBoundingSphere(entities);
        if (!sphere) return;
        const carto = Cesium.Cartographic.fromCartesian(sphere.center);
        const first = entities[0];
        const elev =
          (first.polygon?.extrudedHeight?.getValue?.() ?? 0) - 3.5 + 2.5;
        const temp = Number(first.properties?.temperature?.getValue?.() ?? 22);
        const co2 = Number(first.properties?.co2?.getValue?.() ?? 400);
        const hum = Number(first.properties?.humidity?.getValue?.() ?? 45);
        // decide what text to show
        const icons = { temperature: "🌡", co2: "🫧", humidity: "💧" };
        let labelText, bgColor;
        if (sensorType === "all") {
          labelText = `${temp.toFixed(1)}° ${Math.round(co2)}ppm ${Math.round(hum)}%`;
          const tempBad = temp > 27 || temp < 17,
            co2Bad = co2 > 1000,
            humBad = hum > 70 || hum < 30;
          bgColor =
            co2Bad || tempBad
              ? Cesium.Color.fromCssColorString("#7F1D1D").withAlpha(0.9)
              : humBad
                ? Cesium.Color.fromCssColorString("#1E3A5F").withAlpha(0.9) // blue — humidity
                : Cesium.Color.fromCssColorString("#1E293B").withAlpha(0.85); // slate — normal
        } else {
          const valMap = { temperature: temp, co2, humidity: hum };
          const unitMap = { temperature: "°C", co2: "ppm", humidity: "%" };
          const raw = valMap[sensorType] ?? 0;
          const formatted =
            sensorType === "temperature" ? raw.toFixed(1) : Math.round(raw);
          labelText = `${icons[sensorType] || "\u2022"} ${formatted}${unitMap[sensorType] || ""}`;
          bgColor = Cesium.Color.fromCssColorString("#1E293B").withAlpha(0.88);
        }
        sensorEntitiesRef.current.push(
          viewer.entities.add({
            position: Cesium.Cartesian3.fromRadians(
              carto.longitude,
              carto.latitude,
              elev,
            ),
            label: {
              text: labelText,
              font: "600 11px 'Inter',ui-sans-serif,sans-serif",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -6),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              showBackground: true,
              backgroundColor: bgColor,
              backgroundPadding: new Cesium.Cartesian2(7, 4),
              // shrink as you zoom out so distant labels don't overlap
              scaleByDistance: new Cesium.NearFarScalar(40, 1.0, 400, 0.65),
              // fade completely at long range — keeps the overview uncluttered
              translucencyByDistance: new Cesium.NearFarScalar(
                80,
                1.0,
                500,
                0.0,
              ),
            },
          }),
        );
      });
    },
    [hideSensorMarkers],
  );

  const zoomToRoom = useCallback(
    (roomQuery) => {
      clearFloorCompare();
      setSelectedCircuit("");
      const query = String(roomQuery ?? "").trim();
      if (!query) return;
      const nq = normRoomQuery(query),
        nrn = extractRoomNum(query);
      let matches = roomEntitiesRef.current.filter((e) => {
        const en = extractRoomNum(e.properties?.roomNumber?.getValue?.());
        if (nrn) return en === nrn;
        return normRoomQuery(e.properties?.roomNumber?.getValue?.()) === nq;
      });
      if (!matches.length) {
        matches = roomEntitiesRef.current.filter((e) => {
          const rn = normRoomQuery(e.properties?.roomName?.getValue?.()),
            ro = normRoomQuery(e.properties?.roomNameOriginal?.getValue?.());
          return rn === nq || ro === nq || rn.includes(nq) || ro.includes(nq);
        });
      }
      if (!matches.length) return;
      if (i3sRef.current) i3sRef.current.show = false;
      resetStyles();
      showOnly((e) => matches.includes(e));
      matches.forEach((e) => {
        if (e.polygon) e.polygon.material = Cesium.Color.CYAN.withAlpha(0.9);
      });
      zoomToEntities(matches, matches.length > 1 ? 2.8 : 4, 15);
      const first = matches[0];
      if (onFeatureClick && first)
        onFeatureClick({
          roomNumber: first.properties.roomNumber?.getValue(),
          roomName: first.properties.roomName?.getValue(),
          floor: first.properties.floorLevel?.getValue(),
          temperature: first.properties.temperature?.getValue(),
          humidity: first.properties.humidity?.getValue(),
          co2: first.properties.co2?.getValue(),
          occupancy: first.properties.occupancy?.getValue(),
          circuitIds: first.properties.circuit_id?.getValue?.() ?? [],
        });
    },
    [clearFloorCompare, resetStyles, showOnly, zoomToEntities, onFeatureClick],
  );

  const zoomToFloor = useCallback(
    (floor) => {
      clearFloorCompare();
      setSelectedCircuit("");
      const available = floorsRef.current.map(Number).filter(Number.isFinite);
      if (!available.length) return;
      const str = String(floor ?? "").trim();
      let target = Number(str);
      if (!Number.isFinite(target) || !available.includes(target)) {
        if (available.includes(target + 1)) target = target + 1;
        else if (available.includes(target - 1)) target = target - 1;
        else if (str.toUpperCase() === "ROOF") target = Math.max(...available);
        else return;
      }
      const matches = roomEntitiesRef.current.filter(
        (e) => Number(e.properties?.floorLevel?.getValue?.()) === target,
      );
      if (!matches.length) return;
      if (i3sRef.current) i3sRef.current.show = false;
      resetStyles();
      showOnly(
        (e) => Number(e.properties?.floorLevel?.getValue?.()) === target,
      );
      zoomToEntities(matches, 2.6, 30);
    },
    [clearFloorCompare, resetStyles, showOnly, zoomToEntities],
  );

  const zoomToCircuit = useCallback(
    (circuitId) => {
      clearFloorCompare();
      const id = normalizeCircuitId(circuitId),
        viewer = viewerRef.current;
      console.log(
        "[zoomToCircuit] called with:",
        circuitId,
        "→ normalized:",
        id,
      );
      if (!viewer || !id) {
        console.warn("[zoomToCircuit] abort: no viewer or id");
        return false;
      }
      setSelectedCircuit(id);
      const cfg = CIRCUIT_CONFIGS[id],
        color = Cesium.Color.fromCssColorString(cfg?.color || "#22C55E");
      if (i3sRef.current) i3sRef.current.show = false;
      resetStyles();
      const all = [...roomEntitiesRef.current, ...circuitEntitiesRef.current];
      const matches = all.filter((e) => {
        const v = e.properties?.circuit_id?.getValue?.();
        return Array.isArray(v)
          ? v.map(normalizeCircuitId).includes(id)
          : normalizeCircuitId(v) === id;
      });
      console.log(
        "[zoomToCircuit] matched entities:",
        matches.length,
        "for circuit:",
        id,
      );
      if (matches.length) {
        all.forEach((e) => {
          e.show = false;
          if (e.labelEntity) e.labelEntity.show = false;
        });
        matches.forEach((e) => {
          e.show = true;
          if (e.polygon) {
            e.polygon.material = color.withAlpha(0.92);
            e.polygon.outlineColor = color;
            e.polygon.outlineWidth = 4;
          }
          if (e.cylinder) e.cylinder.material = color.withAlpha(0.95);
          if (e.ellipsoid) e.ellipsoid.material = color.withAlpha(0.8);
        });
      }
      if (matches.length) {
        // Always center on the actual matched rooms
        const sphere = getBoundingSphere(matches);
        if (sphere) {
          const preset = CIRCUIT_CAM[id];
          const heading = preset ? Cesium.Math.toRadians(preset.heading) : 0;
          const pitch = preset
            ? Cesium.Math.toRadians(preset.pitch)
            : Cesium.Math.toRadians(-45);
          const range = Math.max(sphere.radius * 2.5, 25);
          viewer.camera.flyToBoundingSphere(sphere, {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(heading, pitch, range),
            easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
          });
        } else {
          zoomToEntities(matches, 2.5, 25);
        }
      } else {
        const preset = CIRCUIT_CAM[id];
        if (preset) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              preset.lon,
              preset.lat,
              preset.h,
            ),
            orientation: {
              heading: Cesium.Math.toRadians(preset.heading),
              pitch: Cesium.Math.toRadians(preset.pitch),
              roll: 0,
            },
            duration: 1.5,
            easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
          });
        } else {
          const centers = [];
          roomEntitiesRef.current.forEach((entity) => {
            const circuits = entity.properties?.circuit_id?.getValue?.();
            if (!circuits) return;
            const ids = Array.isArray(circuits) ? circuits : [circuits];
            if (!ids.map(normalizeCircuitId).includes(id)) return;
            const sphere = getBoundingSphere([entity]);
            if (sphere) centers.push(sphere.center);
          });
          if (centers.length) {
            let x = 0,
              y = 0,
              z = 0;
            centers.forEach((p) => {
              x += p.x;
              y += p.y;
              z += p.z;
            });
            const avg = new Cesium.Cartesian3(
              x / centers.length,
              y / centers.length,
              z / centers.length,
            );
            const carto = Cesium.Cartographic.fromCartesian(avg);
            carto.height += 6;
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromRadians(
                carto.longitude,
                carto.latitude,
                carto.height,
              ),
              orientation: {
                heading: 0,
                pitch: Cesium.Math.toRadians(-45),
                roll: 0,
              },
              duration: 1.5,
            });
          } else {
            console.warn(
              "[zoomToCircuit] no matches, no preset, no geometry for:",
              id,
            );
            return false;
          }
        }
      }
      return true;
    },
    [clearFloorCompare, resetStyles, zoomToEntities],
  );

  const zoomToName = useCallback(
    (rawQuery) => {
      clearFloorCompare();
      const terms = [normRoomQuery(rawQuery)].filter(Boolean);
      if (!terms.length) return false;
      setSelectedCircuit("");
      if (i3sRef.current) i3sRef.current.show = false;
      resetStyles();
      const all = [...roomEntitiesRef.current, ...circuitEntitiesRef.current];
      const matches = all.filter((e) => {
        const hay = [
          normRoomQuery(e.properties?.roomName?.getValue?.()),
          normRoomQuery(e.properties?.roomNameOriginal?.getValue?.()),
          normRoomQuery(e.properties?.roomNumber?.getValue?.()),
          normRoomQuery(e.name),
        ].join(" ");
        return terms.some((t) => hay.includes(t));
      });
      if (!matches.length) return false;
      showOnly((e) => matches.includes(e));
      matches.forEach((e) => {
        if (e.polygon) e.polygon.material = Cesium.Color.CYAN.withAlpha(0.9);
        if (e.box) e.box.material = Cesium.Color.CYAN.withAlpha(0.85);
        if (e.cylinder) e.cylinder.material = Cesium.Color.CYAN.withAlpha(0.85);
        if (e.ellipsoid)
          e.ellipsoid.material = Cesium.Color.CYAN.withAlpha(0.75);
      });
      zoomToEntities(matches, matches.length > 1 ? 2.8 : 4, 20);
      return true;
    },
    [clearFloorCompare, resetStyles, showOnly, zoomToEntities],
  );

  const searchAndNavigate = useCallback(
    (rawQuery) => {
      const query = String(rawQuery ?? "").trim();
      if (!query) return false;
      const normQuery = normalizeCircuitId(query);
      if (CIRCUIT_CONFIGS[normQuery]) return zoomToCircuit(normQuery);
      const lower = normRoomQuery(query);
      const byLabel = Object.entries(CIRCUIT_CONFIGS).find(([id, cfg]) => {
        const idText = normStr(id);
        const labelText = normStr(cfg?.label);
        return (
          idText === lower ||
          labelText === lower ||
          idText.includes(lower) ||
          labelText.includes(lower)
        );
      });
      if (byLabel) return zoomToCircuit(byLabel[0]);
      const roomNum = extractRoomNum(query);
      if (roomNum) {
        const matched = availableRooms.find(
          (r) => extractRoomNum(r.roomNumber) === roomNum,
        );
        if (matched) {
          setSelectedRoom(matched.roomNumber);
          zoomToRoom(matched.roomNumber);
          return true;
        }
      }
      const matchedRoom = availableRooms.find((r) => {
        const roomNumberText = normRoomQuery(r.roomNumber);
        const roomNameText = normRoomQuery(r.roomName);
        return (
          roomNumberText === lower ||
          roomNameText === lower ||
          roomNumberText.includes(lower) ||
          roomNameText.includes(lower)
        );
      });
      if (matchedRoom) {
        setSelectedRoom(matchedRoom.roomNumber);
        zoomToRoom(matchedRoom.roomNumber);
        return true;
      }
      return zoomToName(query);
    },
    [availableRooms, zoomToCircuit, zoomToRoom, zoomToName],
  );

  const setVisualizationMode = useCallback(
    (mode) => {
      setActiveMode(mode);
      switch (mode) {
        case "default":
          resetStyles();
          showOnly(() => false);
          if (i3sRef.current) i3sRef.current.show = true;
          hideSensorMarkers();
          break;
        case "rooms":
          if (i3sRef.current) i3sRef.current.show = false;
          resetStyles();
          roomEntitiesRef.current.forEach((e) => {
            e.show = true;
          });
          circuitEntitiesRef.current.forEach((e) => {
            e.show = false;
          });
          break;
        case "circuits":
          if (i3sRef.current) i3sRef.current.show = false;
          resetStyles();
          showOnly(() => true);
          break;
        case "heatmap":
          showHeatmap(activeHeatmap || "temperature");
          break;
        case "energy":
          if (i3sRef.current) i3sRef.current.show = false;
          resetStyles();
          roomEntitiesRef.current.forEach((e) => {
            e.show = true;
          });
          break;
        case "sensors":
          if (i3sRef.current) i3sRef.current.show = false;
          resetStyles();
          roomEntitiesRef.current.forEach((e) => {
            e.show = true;
          });
          showSensorMarkers("all");
          break;
        case "alerts":
          showAlerts();
          break;
        default:
          break;
      }
    },
    [
      resetStyles,
      showOnly,
      hideSensorMarkers,
      showHeatmap,
      activeHeatmap,
      showSensorMarkers,
      showAlerts,
    ],
  );

  const toggleLayer = useCallback(
    (layer, visible) => {
      const vis = Boolean(visible);
      switch (layer) {
        case "rooms":
          roomEntitiesRef.current.forEach((e) => {
            e.show = vis;
          });
          break;
        case "circuits":
          circuitEntitiesRef.current.forEach((e) => {
            e.show = vis;
          });
          break;
        case "sensors":
          sensorEntitiesRef.current.forEach((e) => {
            e.show = vis;
          });
          break;
        case "labels":
          roomEntitiesRef.current.forEach((e) => {
            if (e.labelEntity) e.labelEntity.show = vis;
          });
          break;
        case "exterior":
          if (i3sRef.current) i3sRef.current.show = vis;
          break;
        case "alerts":
          if (vis) showAlerts();
          else resetStyles();
          break;
        default:
          break;
      }
    },
    [showAlerts, resetStyles],
  );

  const flyToCoordinates = useCallback((lat, lon, height = 500) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      duration: 1.5,
    });
  }, []);

  const flyToCameraPreset = useCallback((preset) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const p = CAM_PRESETS[preset];
    if (!p) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.h),
      orientation: {
        heading: Cesium.Math.toRadians(p.heading),
        pitch: Cesium.Math.toRadians(p.pitch),
        roll: 0,
      },
      duration: 1.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, []);

  const setTimeWindow = useCallback(
    (startIso, endIso = null) => {
      timeWindowRef.current = {
        start: startIso ? new Date(startIso) : null,
        end: endIso ? new Date(endIso) : new Date(),
      };
      if (activeHeatmap) showHeatmap(activeHeatmap);
    },
    [activeHeatmap, showHeatmap],
  );

  const resetTimeWindow = useCallback(() => {
    timeWindowRef.current = { start: null, end: null };
    if (activeHeatmap) showHeatmap(activeHeatmap);
  }, [activeHeatmap, showHeatmap]);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;
    let destroyed = false;
    const init = async () => {
      try {
        window.__cesiumViewerReady = false;
        Cesium.Ion.defaultAccessToken = ION_TOKEN;
        const terrain = new Cesium.Terrain(
          Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
            "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
          ),
        );
        const viewer = new Cesium.Viewer(containerRef.current, {
          terrain,
          animation: false,
          timeline: false,
          baseLayer: false,
          baseLayerPicker: false,
          geocoder: false,
          sceneModePicker: false,
          infoBox: false,
          selectionIndicator: false,
          shadows: false,
          homeButton: true,
        });
        viewerRef.current = viewer;
        viewer.shadows = false;
        viewer.terrainShadows = Cesium.ShadowMode.DISABLED;
        viewer.scene.globe.enableLighting = true;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.highDynamicRange = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.0001;
        viewer.scene.fog.minimumBrightness = 0.8;
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

        try {
          const worldImagery =
            await Cesium.ArcGisMapServerImageryProvider.fromUrl(
              WORLD_IMAGERY_URL,
            );
          if (destroyed) return;
          viewer.imageryLayers.addImageryProvider(worldImagery);
        } catch (worldImageryError) {
          console.warn(
            "World imagery base layer could not be loaded:",
            worldImageryError,
          );
        }

        try {
          const orthophoto =
            await Cesium.ArcGisMapServerImageryProvider.fromUrl(ORTHOPHOTO_URL);
          if (destroyed) return;
          const orthophotoLayer =
            viewer.imageryLayers.addImageryProvider(orthophoto);
          orthophotoLayer.alpha = 1;
        } catch (orthophotoError) {
          console.warn(
            "Orthophoto layer could not be loaded:",
            orthophotoError,
          );
        }

        let i3sProvider = null;
        try {
          i3sProvider = await Cesium.I3SDataProvider.fromUrl(I3S_URL, {
            adjustMaterialAlphaMode: true,
            showFeatures: true,
            applySymbology: true,
            calculateNormals: true,
          });
          if (destroyed) return;
          viewer.scene.primitives.add(i3sProvider);
          i3sRef.current = i3sProvider;
          setI3sAvailable(true);
        } catch (modelErr) {
          console.warn(
            "I3S model could not be loaded, falling back to room geometry:",
            modelErr,
          );
          i3sRef.current = null;
          setI3sAvailable(false);
        }

        const response = await fetch(GEOJSON_URL);
        const geojson = await response.json();
        if (destroyed) return;

        const createdRooms = [],
          createdCircuits = [],
          floorsSet = new Set(),
          roomList = [];
        geojson.features.forEach((feature, idx) => {
          const props = feature.properties || {};
          const floorLevel = Number(props.BldgLevel ?? 0);
          const floorLabel = String(
            props.BldgLevel_Desc ||
              props.BldgLevel_Name ||
              props.BldgLevel ||
              "",
          ).trim();
          const roomNumber = props.RoomNumber || `Room-${idx}`;
          const roomNameBG = props.RoomName || "";
          const roomName = translateRoomName(roomNameBG);
          const baseElev = Number(props.BldgLevel_Elev ?? 0);
          const area = props.SourceArea;
          floorsSet.add(floorLevel);
          if (!roomList.find((r) => r.roomNumber === roomNumber))
            roomList.push({ roomNumber, roomName, floorLevel, floorLabel });
          const roomData = getRoomData(roomName);
          const circuitIds = getRoomCircuitIds(
            roomNumber,
            roomName,
            floorLevel,
          );
          const polygons = geometryToPolygons(feature.geometry, baseElev);
          polygons.forEach((positions, pi) => {
            const entity = viewer.entities.add({
              id: `${roomNumber}-${pi}`,
              name: roomNumber,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: getRoomColor(roomName),
                extrudedHeight: baseElev + 3.5,
                perPositionHeight: true,
                outline: true,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
                outlineWidth: 2,
                shadows: Cesium.ShadowMode.DISABLED,
              },
              properties: {
                roomNumber,
                roomName,
                roomNameOriginal: roomNameBG,
                floorLevel,
                area,
                temperature: roomData.temp,
                humidity: roomData.humidity,
                co2: roomData.co2,
                occupancy: roomData.occupancy,
                circuit_id: circuitIds,
              },
              show: false,
            });
            entity.originalMaterial = entity.polygon.material;
            createdRooms.push(entity);
          });
        });

        // Labels
        const grouped = new Map();
        createdRooms.forEach((e) => {
          const rn = e.properties.roomNumber.getValue();
          if (!grouped.has(rn)) grouped.set(rn, []);
          grouped.get(rn).push(e);
        });
        grouped.forEach((entities) => {
          const sphere = getBoundingSphere(entities);
          if (!sphere) return;
          const first = entities[0],
            carto = Cesium.Cartographic.fromCartesian(sphere.center);
          const baseElev = first.polygon.extrudedHeight.getValue() - 3.5;
          const circuits = first.properties.circuit_id.getValue();
          const labelEnt = viewer.entities.add({
            position: Cesium.Cartesian3.fromRadians(
              carto.longitude,
              carto.latitude,
              baseElev + 4.1,
            ),
            label: {
              text: `${first.properties.roomName.getValue()}\n${first.properties.roomNumber.getValue()}\nCircuits: ${Array.isArray(circuits) ? circuits.join(", ") : circuits}`,
              font: "700 13px 'Courier New',monospace",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -12),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              showBackground: true,
              backgroundColor: Cesium.Color.BLACK.withAlpha(0.84),
              backgroundPadding: new Cesium.Cartesian2(9, 7),
            },
            show: false,
          });
          entities.forEach((e) => {
            e.labelEntity = labelEnt;
          });
        });

        // External circuit entities
        const addCirc = (entity, key = "cylinder") => {
          if (entity[key]?.material)
            entity.originalMaterial = entity[key].material;
          createdCircuits.push(entity);
        };

        SITE_MARKERS.vehicleChargers.forEach(({ lon, lat, circuitId: cid }) => {
          addCirc(
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 605),
              cylinder: {
                length: 1.5,
                topRadius: 0.3,
                bottomRadius: 0.3,
                material: Cesium.Color.fromCssColorString("#AED6F1"),
                outline: true,
                outlineColor: Cesium.Color.BLACK,
              },
              properties: { circuit_id: cid, type: "EV Charger" },
              show: false,
            }),
            "cylinder",
          );
          addCirc(
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 606.2),
              box: {
                dimensions: new Cesium.Cartesian3(0.4, 0.05, 0.6),
                material: Cesium.Color.fromCssColorString("#2C3E50"),
                outline: true,
                outlineColor: Cesium.Color.CYAN,
              },
              properties: { circuit_id: cid, type: "EV Charger" },
              show: false,
            }),
            "box",
          );
        });

        SITE_MARKERS.outsideLightsNorth.forEach(([lon, lat]) => {
          addCirc(
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 605),
              cylinder: {
                length: 5,
                topRadius: 0.08,
                bottomRadius: 0.12,
                material: Cesium.Color.DARKGRAY,
              },
              properties: { circuit_id: "outsidelighting1" },
              show: false,
            }),
            "cylinder",
          );
          addCirc(
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 607.5),
              ellipsoid: {
                radii: new Cesium.Cartesian3(0.25, 0.25, 0.15),
                material:
                  Cesium.Color.fromCssColorString("#F9E79F").withAlpha(0.95),
              },
              properties: { circuit_id: "outsidelighting1" },
              show: false,
            }),
            "ellipsoid",
          );
        });

        SITE_MARKERS.outsideLightsSouth.forEach(([lon, lat]) => {
          addCirc(
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 605),
              cylinder: {
                length: 5,
                topRadius: 0.08,
                bottomRadius: 0.12,
                material: Cesium.Color.DARKGRAY,
              },
              properties: { circuit_id: "outsidelighting2" },
              show: false,
            }),
            "cylinder",
          );
          addCirc(
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 607.5),
              ellipsoid: {
                radii: new Cesium.Cartesian3(0.25, 0.25, 0.15),
                material:
                  Cesium.Color.fromCssColorString("#FAD7A0").withAlpha(0.95),
              },
              properties: { circuit_id: "outsidelighting2" },
              show: false,
            }),
            "ellipsoid",
          );
        });

        addCirc(
          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(23.330534, 42.67387, 608),
            box: {
              dimensions: new Cesium.Cartesian3(4.0, 0.4, 2.5),
              material: Cesium.Color.fromCssColorString("#2C3E50"),
              outline: true,
              outlineColor: Cesium.Color.BLACK,
            },
            properties: { circuit_id: "3DLED", type: "LED Display" },
            show: false,
          }),
          "box",
        );
        addCirc(
          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(23.330534, 42.67387, 608),
            box: {
              dimensions: new Cesium.Cartesian3(3.6, 0.2, 2.2),
              material:
                Cesium.Color.fromCssColorString("#FF6B6B").withAlpha(0.9),
              outline: true,
              outlineColor: Cesium.Color.RED,
            },
            properties: { circuit_id: "3DLED", type: "LED Display" },
            show: false,
          }),
          "box",
        );

        roomEntitiesRef.current = createdRooms;
        circuitEntitiesRef.current = createdCircuits;

        const sortedFloors = Array.from(floorsSet).sort((a, b) => a - b);
        floorsRef.current = sortedFloors;
        setAvailableFloors(sortedFloors);

        const sortedRooms = roomList.sort((a, b) => {
          if (a.floorLevel !== b.floorLevel) return a.floorLevel - b.floorLevel;
          return String(a.roomNumber).localeCompare(
            String(b.roomNumber),
            undefined,
            { numeric: true, sensitivity: "base" },
          );
        });
        setAvailableRooms(sortedRooms);
        setClimateReplayRoom((prev) => {
          if (prev && toReplayRoomKey(prev)) return prev;
          const firstMapped = sortedRooms.find((r) =>
            toReplayRoomKey(r.roomNumber),
          );
          return firstMapped ? String(firstMapped.roomNumber) : "";
        });
        setCompareRoom((prev) => {
          if (prev && toReplayRoomKey(prev)) return prev;
          const firstMapped = sortedRooms.find((r) =>
            toReplayRoomKey(r.roomNumber),
          );
          return firstMapped ? String(firstMapped.roomNumber) : "";
        });

        void hydrateLatestRoomTelemetry();
        void loadOutsideTemperature();

        const homePos = Cesium.Cartesian3.fromDegrees(
          HOME_CAMERA.lon,
          HOME_CAMERA.lat,
          HOME_CAMERA.height,
        );
        homeDestRef.current = homePos;

        // Center on actual building geometry when entities are available
        const allLoaded = [
          ...roomEntitiesRef.current,
          ...circuitEntitiesRef.current,
        ];
        const initSphere = allLoaded.length
          ? getBoundingSphere(allLoaded)
          : null;
        if (initSphere) {
          viewer.camera.viewBoundingSphere(
            initSphere,
            new Cesium.HeadingPitchRange(
              HOME_CAMERA.heading,
              HOME_CAMERA.pitch,
              Math.max(initSphere.radius * 3, 80),
            ),
          );
        } else {
          viewer.camera.setView({
            destination: homePos,
            orientation: {
              heading: HOME_CAMERA.heading,
              pitch: HOME_CAMERA.pitch,
              roll: HOME_CAMERA.roll,
            },
          });
        }

        if (!i3sProvider) {
          roomEntitiesRef.current.forEach((e) => {
            e.show = true;
          });
        }

        viewer.homeButton.viewModel.command.beforeExecute.addEventListener(
          (ev) => {
            ev.cancel = true;
            zoomToBuilding();
          },
        );

        viewer.screenSpaceEventHandler.setInputAction((click) => {
          const picked = viewer.scene.pick(click.position);
          if (!Cesium.defined(picked) || !picked.id) {
            hideAllRoomLabelsRef.current();
            return;
          }
          const e = picked.id;
          const rn = e.properties?.roomNumber?.getValue?.(),
            cv = e.properties?.circuit_id?.getValue?.();
          if (rn) {
            zoomToRoom(rn);
            showRoomLabelForEntityRef.current(e);
            return;
          }
          hideAllRoomLabelsRef.current();
          if (typeof cv === "string") zoomToCircuit(cv);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Generate 48-hour animation frames from room telemetry (API or synthetic fallback)
        generateAnimFrames(createdRooms);

        setLoading(false);
        window.__cesiumViewerReady = true;
        const pending = Array.isArray(window.__pendingCesiumCommands)
          ? window.__pendingCesiumCommands
          : [];
        if (pending.length) {
          pending.forEach((cmd) =>
            window.dispatchEvent(
              new CustomEvent("cesium-command", { detail: cmd }),
            ),
          );
          window.__pendingCesiumCommands = [];
        }
      } catch (e) {
        console.error("Viewer init failed:", e);
        setLoading(false);
        window.__cesiumViewerReady = false;
      }
    };
    init();
    return () => {
      destroyed = true;
      stopReplay();
      stopClimateReplay();
      window.__cesiumViewerReady = false;
      if (animIntervalRef.current) clearInterval(animIntervalRef.current);
      animIntervalRef.current = null;
      if (viewerRef.current && !viewerRef.current.isDestroyed())
        viewerRef.current.destroy();
      viewerRef.current = null;
      i3sRef.current = null;
      roomEntitiesRef.current = [];
      circuitEntitiesRef.current = [];
      sensorEntitiesRef.current = [];
    };
    // Viewer mounts once; listing zoomTo* here would destroy/recreate Cesium when callbacks change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stopReplay,
    stopClimateReplay,
    zoomToEntities,
    hydrateLatestRoomTelemetry,
    loadOutsideTemperature,
    generateAnimFrames,
  ]);

  useEffect(() => {
    const listener = (event) => {
      const cmd = event.detail,
        viewer = viewerRef.current;
      if (!viewer || cmd?.type !== "cesium") return;
      switch (cmd.action) {
        case "fly_to_coordinates":
          flyToCoordinates(cmd.lat, cmd.lon, cmd.height ?? 500);
          break;
        case "zoom_to_room":
          zoomToRoom(
            cmd.room_query ||
              cmd.room_number ||
              cmd.room_name ||
              cmd.room ||
              cmd.name,
          );
          break;
        case "zoom_to_floor":
          zoomToFloor(cmd.floor);
          break;
        case "zoom_to_building":
        case "reset_view":
          zoomToBuilding();
          break;
        case "zoom_to_circuit":
          if (!zoomToCircuit(cmd.circuit_id || cmd.circuit))
            zoomToName(cmd.circuit_id || cmd.circuit || "");
          break;
        case "zoom_to_name":
        case "zoom_to_entity":
          zoomToName(cmd.name || cmd.query || cmd.entity_id || "");
          break;
        case "show_building":
          if (i3sRef.current) i3sRef.current.show = true;
          break;
        case "hide_building":
          if (i3sRef.current) i3sRef.current.show = false;
          break;
        case "show_all_rooms":
          roomEntitiesRef.current.forEach((e) => {
            e.show = true;
          });
          break;
        case "hide_all_rooms":
          roomEntitiesRef.current.forEach((e) => {
            e.show = false;
          });
          break;
        case "show_heatmap":
          showHeatmap(cmd.metric);
          break;
        case "clear_heatmap":
        case "clear_highlights":
          resetStyles();
          showOnly(() => false);
          if (i3sRef.current) i3sRef.current.show = true;
          break;
        case "highlight_rooms":
          highlightByQuery(cmd.room_queries, cmd.color);
          break;
        case "highlight_rooms_by_threshold":
          highlightByThreshold(
            cmd.metric,
            cmd.operator,
            cmd.threshold,
            cmd.color,
          );
          break;
        case "highlight_entities":
          highlightByQuery(cmd.entity_ids, cmd.color);
          break;
        case "show_alerts":
          showAlerts();
          break;
        case "toggle_layer":
          toggleLayer(cmd.layer, cmd.visible);
          break;
        case "set_visualization_mode":
          setVisualizationMode(cmd.mode);
          break;
        case "compare_floors": {
          if (i3sRef.current) i3sRef.current.show = false;
          resetStyles();

          const metric = normalizeHeatmapMetric(cmd.metric, "temperature");
          const floorA = Number(cmd.floor_a);
          const floorB = Number(cmd.floor_b);
          // Shared elevation — place both floors at the same height
          const SHARED_ELEV = 605;
          // How far apart to offset them (meters, east-west)
          const OFFSET_DEG = 0.0018; // ~150m apart

          const allVals = [];
          roomEntitiesRef.current.forEach((e) => {
            const f = Number(e.properties?.floorLevel?.getValue?.());
            if (f !== floorA && f !== floorB) return;
            const v = Number(getHeatmapMetricValue(e, metric));
            if (Number.isFinite(v)) allVals.push(v);
          });

          const minV = allVals.length ? Math.min(...allVals) : 0;
          const maxV = allVals.length ? Math.max(...allVals) : 1;

          // Remove old comparison entities if any
          if (!viewerRef.current._compareEntities)
            viewerRef.current._compareEntities = [];
          viewerRef.current._compareEntities.forEach((e) => {
            try {
              viewerRef.current.entities.remove(e);
            } catch {
              /* ignore */
            }
          });
          viewerRef.current._compareEntities = [];

          roomEntitiesRef.current.forEach((e) => {
            const f = Number(e.properties?.floorLevel?.getValue?.());
            const isA = f === floorA;
            const isB = f === floorB;
            e.show = false; // hide original

            if (!isA && !isB) return;

            // Get original polygon positions
            const hierarchy = e.polygon?.hierarchy?.getValue?.(
              Cesium.JulianDate.now(),
            );
            if (!hierarchy?.positions?.length) return;

            const v = Number(getHeatmapMetricValue(e, metric) ?? 0);
            const color = metricToColor(metric, v);

            // Offset floor A to the left, floor B to the right
            const lonOffset = isA ? -OFFSET_DEG / 2 : OFFSET_DEG / 2;

            // Reproject positions to shared elevation + horizontal offset
            const newPositions = hierarchy.positions.map((pos) => {
              const carto = Cesium.Cartographic.fromCartesian(pos);
              return Cesium.Cartesian3.fromRadians(
                carto.longitude + Cesium.Math.toRadians(lonOffset),
                carto.latitude,
                SHARED_ELEV,
              );
            });

            const clonedEntity = viewerRef.current.entities.add({
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(newPositions),
                material: color,
                extrudedHeight: SHARED_ELEV + 3.5,
                perPositionHeight: false,
                outline: true,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
                outlineWidth: 1.5,
              },
            });
            viewerRef.current._compareEntities.push(clonedEntity);
          });

          // Fly to fit both side-by-side floors in view
          const compareEntities = viewerRef.current._compareEntities || [];
          const compareSphere = getBoundingSphere(compareEntities);
          if (compareSphere && viewerRef.current) {
            viewerRef.current.camera.flyToBoundingSphere(compareSphere, {
              duration: 1.5,
              offset: new Cesium.HeadingPitchRange(
                0,
                Cesium.Math.toRadians(-70),
                Math.max(compareSphere.radius * 1.2, 30),
              ),
            });
          }

          // Update overlay labels
          const overlay = document.getElementById("compare-overlay");
          if (overlay) {
            overlay.style.display = "block";
            const elA = document.getElementById("compare-label-a");
            const elB = document.getElementById("compare-label-b");
            const elMin = document.getElementById("compare-legend-min");
            const elMax = document.getElementById("compare-legend-max");
            if (elA) elA.textContent = `Floor ${floorA} — ${metric}`;
            if (elB) elB.textContent = `Floor ${floorB} — ${metric}`;
            if (elMin) elMin.textContent = `${minV.toFixed(1)}`;
            if (elMax) elMax.textContent = `${maxV.toFixed(1)}`;
          }

          setActiveHeatmap(metric);
          activeHeatmapRef.current = metric;
          computeBuildingSummary(metric);
          break;
        }
        case "compare_rooms": {
          if (!Array.isArray(cmd.room_queries) || !cmd.room_queries.length)
            break;
          if (i3sRef.current) i3sRef.current.show = false;
          resetStyles();
          const m = normalizeHeatmapMetric(cmd.metric, "co2");
          const candidates = cmd.room_queries.flatMap((q) => {
            const nrn = extractRoomNum(q);
            return roomEntitiesRef.current.filter((e) => {
              const en = extractRoomNum(e.properties?.roomNumber?.getValue?.());
              return nrn
                ? en === nrn
                : normStr(e.properties?.roomName?.getValue?.()).includes(
                    normStr(q),
                  );
            });
          });
          roomEntitiesRef.current.forEach((e) => {
            e.show = false;
          });
          candidates.forEach((e) => {
            e.show = true;
            const v = Number(getHeatmapMetricValue(e, m) ?? 0);
            if (e.polygon) e.polygon.material = metricToColor(m, v);
          });
          break;
        }
        case "show_sensor_markers":
          showSensorMarkers(cmd.sensor_type ?? "all");
          break;
        case "hide_sensor_markers":
          hideSensorMarkers();
          break;
        case "set_camera_preset":
          flyToCameraPreset(cmd.preset);
          break;
        case "set_time_window":
          setTimeWindow(cmd.start_iso, cmd.end_iso);
          break;
        case "reset_time_window":
          resetTimeWindow();
          break;
        default:
          break;
      }
    };
    window.addEventListener("cesium-command", listener);
    return () => window.removeEventListener("cesium-command", listener);
  }, [
    activeHeatmap,
    flyToCoordinates,
    zoomToRoom,
    zoomToFloor,
    zoomToBuilding,
    zoomToCircuit,
    zoomToName,
    showHeatmap,
    resetStyles,
    showOnly,
    highlightByQuery,
    highlightByThreshold,
    showAlerts,
    toggleLayer,
    setVisualizationMode,
    showSensorMarkers,
    hideSensorMarkers,
    flyToCameraPreset,
    setTimeWindow,
    resetTimeWindow,
    getHeatmapMetricValue,
    computeBuildingSummary,
  ]);

  //  ANIMATION PLAYBACK
  useEffect(() => {
    if (animPlaying) {
      animIntervalRef.current = setInterval(() => {
        setAnimFrame((prev) => {
          const len = animFramesRef.current.length || REPLAY_FRAMES;
          const next = (prev + 1) % len;
          applyAnimFrame(next);
          return next;
        });
      }, 600);
    } else {
      if (animIntervalRef.current) {
        clearInterval(animIntervalRef.current);
        animIntervalRef.current = null;
      }
    }
    return () => {
      if (animIntervalRef.current) {
        clearInterval(animIntervalRef.current);
        animIntervalRef.current = null;
      }
    };
  }, [animPlaying, applyAnimFrame]);

  useEffect(() => {
    void loadReplayData();
  }, [loadReplayData]);

  useEffect(() => {
    if (replayMode !== "live") return;
    void loadLiveData();
    let timer = null;

    const scheduleRefresh = () => {
      const now = new Date();
      const next = new Date(now);

      if (liveView === "circuits") {
        next.setMinutes(0, 0, 0);
        next.setHours(next.getHours() + 1);
      } else {
        next.setSeconds(0, 0);
        next.setMinutes(Math.floor(next.getMinutes() / 15) * 15 + 15);
      }

      const delay = Math.max(1000, next.getTime() - Date.now() + 250);
      timer = setTimeout(async () => {
        await loadLiveData();
        scheduleRefresh();
      }, delay);
    };

    scheduleRefresh();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [liveView, replayMode, loadLiveData]);

  useEffect(() => {
    const timer = setInterval(() => setLiveClockMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleReplayTabChange = useCallback(
    (newMode) => {
      setReplayMode(newMode);

      if (newMode === "live") {
        void loadLiveData();
        return;
      }

      if (newMode !== "live") {
        const ageMs = replayDataAge
          ? Date.now() - replayDataAge.getTime()
          : Infinity;
        const STALE_THRESHOLD = 20 * 60 * 1000;

        if (ageMs > STALE_THRESHOLD) {
          console.log("[Replay] Data stale — refreshing...");
          void loadReplayData();
        }
      }
    },
    [loadReplayData, replayDataAge, loadLiveData],
  );

  // replayDataRef and climateReplayDataRef are refs — bumping compareDataTick triggers the re-render with fresh data.
  useEffect(() => {
    if (replayMode !== "compare") return;
    let cancelled = false;
    (async () => {
      await loadReplayData();
      if (!cancelled) setCompareDataTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [replayMode, compareRoom, climateReplayRoom, loadReplayData]);

  useEffect(() => {
    const climateDataNow = climateReplayDataRef.current;
    const roomsWithFrames = availableRooms.filter((r) => {
      const key = toReplayRoomKey(r.roomNumber);
      return (
        !!key &&
        Array.isArray(climateDataNow[key]) &&
        climateDataNow[key].length > 0
      );
    });
    if (!roomsWithFrames.length) return;

    const currentKey = toReplayRoomKey(climateReplayRoom);
    const currentHasFrames =
      !!currentKey &&
      Array.isArray(climateDataNow[currentKey]) &&
      climateDataNow[currentKey].length > 0;
    if (!currentHasFrames) {
      setClimateReplayRoom(String(roomsWithFrames[0].roomNumber));
    }
  }, [availableRooms, climateReplayRoom, compareDataTick]);

  useEffect(() => {
    if (!replayDataAge) return;
    void loadOutsideTemperature();
  }, [replayDataAge, loadOutsideTemperature]);

  useEffect(() => {
    if (!replayDataAge || !roomEntitiesRef.current.length) return;
    generateAnimFrames(roomEntitiesRef.current);
    if (activeHeatmapRef.current) {
      applyHeatmapColors(activeHeatmapRef.current);
      computeBuildingSummary(activeHeatmapRef.current);
    }
  }, [
    replayDataAge,
    generateAnimFrames,
    applyHeatmapColors,
    computeBuildingSummary,
  ]);

  const allCircIds = Object.keys(CIRCUIT_CONFIGS);

  // compareDataTick is bumped by the Compare useEffect after async data loads,
  // forcing a re-render so the charts read fresh ref data.
  void compareDataTick;

  const replayData = replayDataRef.current;
  const totalFrames = replayData[replayCircuit]?.length || REPLAY_FRAMES;
  const currentSample = replayData[replayCircuit]?.[replayFrame];
  const climateData = climateReplayDataRef.current;
  const activeClimateRoomKey = toReplayRoomKey(climateReplayRoom);
  const climateRoomOptions = (() => {
    const keyed = availableRooms.filter((r) => {
      const k = toReplayRoomKey(r.roomNumber);
      return !!k && Array.isArray(climateData[k]) && climateData[k].length > 0;
    });
    return keyed.length ? keyed : availableRooms;
  })();
  const climateTotalFrames =
    climateData[activeClimateRoomKey]?.length || REPLAY_FRAMES;
  const climateCurrentSample =
    climateData[activeClimateRoomKey]?.[climateReplayFrame];

  const fmtReplayDateTime = (ms) => {
    if (!Number.isFinite(ms)) return "--";
    const d = new Date(ms);
    return d.toLocaleString("en-GB", {
      timeZone: "Europe/Sofia",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const energySamples = replayData[replayCircuit] || [];
  const selectedEnergyWindow = replayEnergyWindowRef.current?.[replayCircuit];
  const energyEndMs =
    selectedEnergyWindow?.endMs ??
    energySamples[energySamples.length - 1]?.timestampMs;
  const energyStartMs = Number.isFinite(energyEndMs)
    ? energyEndMs - REPLAY_WINDOW_HOURS * 60 * 60 * 1000
    : (selectedEnergyWindow?.startMs ?? energySamples[0]?.timestampMs);
  const energyLatestGateMs = selectedEnergyWindow?.endMs;
  const energyCurrentMs = currentSample?.timestampMs;

  const climateSamples = climateData[activeClimateRoomKey] || [];
  const climateStartMs = climateSamples[0]?.timestampMs;
  const climateEndMs = climateSamples[climateSamples.length - 1]?.timestampMs;
  const climateCurrentMs = climateCurrentSample?.timestampMs;

  const PS = {
    // panel style
    background: "rgba(10,18,32,0.96)",
    border: "1px solid rgba(125,211,252,0.2)",
    borderRadius: 12,
    boxShadow:
      "0 12px 40px rgba(2,6,23,0.6),inset 0 1px 0 rgba(255,255,255,0.05)",
    backdropFilter: "blur(20px)",
    color: "#D1E8FF",
    fontFamily: UI_FONT_STACK,
    fontSize: 12,
  };

  const Btn = ({
    children,
    onClick,
    style = {},
    active = false,
    danger = false,
    accent = false,
    full = false,
  }) => (
    <button
      onClick={onClick}
      style={{
        borderRadius: 6,
        border: "1px solid rgba(125,211,252,0.28)",
        cursor: "pointer",
        fontFamily: UI_FONT_STACK,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.01em",
        transition: "all 0.15s ease",
        padding: "7px 10px",
        width: full ? "100%" : undefined,
        background: danger
          ? "rgba(220,38,38,0.24)"
          : active
            ? "rgba(37,99,235,0.35)"
            : accent
              ? "rgba(14,165,233,0.24)"
              : "rgba(255,255,255,0.08)",
        color: danger
          ? "#FECACA"
          : active
            ? "#DBEAFE"
            : accent
              ? "#CFFAFE"
              : "#DDEFFF",
        borderColor: danger
          ? "rgba(248,113,113,0.58)"
          : active
            ? "rgba(147,197,253,0.72)"
            : accent
              ? "rgba(125,211,252,0.6)"
              : "rgba(186,230,253,0.35)",
        ...style,
      }}
    >
      {children}
    </button>
  );

  const SL = ({ children }) => (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "#A5C8EC",
        marginBottom: 5,
        marginTop: 12,
      }}
    >
      {children}
    </div>
  );

  const Hr = () => (
    <div
      style={{
        height: 1,
        background: "rgba(147,197,253,0.2)",
        margin: "10px 0",
      }}
    />
  );

  const selectStyle = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    marginBottom: 6,
    background: "rgba(15,23,42,0.92)",
    color: "#E2F1FF",
    border: "1px solid rgba(125,211,252,0.42)",
    fontFamily: UI_FONT_STACK,
    fontSize: 12,
    outline: "none",
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <style>{`
        @keyframes dot-pulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:0.3; transform:scale(0.7) } }
        @keyframes faultPulse { 0%,100% { box-shadow:0 0 0 0 rgba(239,68,68,0.5) } 70% { box-shadow:0 0 0 6px rgba(239,68,68,0) } }
        ::-webkit-scrollbar { width:5px }
        ::-webkit-scrollbar-track { background:rgba(15,23,42,0.3); border-radius:3px }
        ::-webkit-scrollbar-thumb { background:rgba(96,165,250,0.22); border-radius:3px }
        ::-webkit-scrollbar-thumb:hover { background:rgba(96,165,250,0.4) }
        * { scroll-behavior:smooth }
      `}</style>

      {/* Loading */}
      {loading && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            ...PS,
            padding: "12px 20px",
            fontSize: 13,
            color: "#60A5FA",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#3B82F6",
              animation: "dot-pulse 1.2s infinite",
              boxShadow: "0 0 8px #3B82F6",
            }}
          />
          Initialising digital twin...
        </div>
      )}

      {/* Mode badge */}
      {activeMode !== "default" && !loading && (
        <div
          style={{
            position: "absolute",
            zIndex: 18,
            top: 16,
            right: replayOpen ? 312 : 16,
            ...PS,
            padding: "6px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            transition: "right 0.3s ease",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#3B82F6",
              boxShadow: "0 0 6px #3B82F6",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: "#334155",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Mode
          </span>
          <span style={{ color: "#93C5FD", fontWeight: 700 }}>
            {activeMode}
          </span>
          {activeHeatmap && (
            <>
              <span style={{ color: "#1E293B" }}>·</span>
              <span style={{ color: "#FBBF24" }}>{activeHeatmap}</span>
            </>
          )}
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          zIndex: 10,
          background:
            "linear-gradient(135deg,rgba(10,15,26,0.95),rgba(15,23,42,0.92))",
          backdropFilter: "blur(10px)",
          padding: "8px 16px",
          borderTopRightRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderTop: "1px solid rgba(96,165,250,0.15)",
          borderRight: "1px solid rgba(96,165,250,0.15)",
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#3B82F6,#8B5CF6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 800,
            color: "#fff",
            flexShrink: 0,
            letterSpacing: "-0.02em",
          }}
        >
          JW
        </div>
        <div style={{ lineHeight: 1.25 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#E2F1FF",
              letterSpacing: "0.02em",
            }}
          >
            Made by:{" "}
            <a
              href="https://www.linkedin.com/in/joan-waithira/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#93C5FD", textDecoration: "none" }}
            >
              Joan Waithira
            </a>
          </div>
          <div
            style={{ fontSize: 8.5, color: "#64748B", letterSpacing: "0.03em" }}
          >
            University of Twente — ITC &nbsp;|&nbsp; GATE Institute
          </div>
        </div>
      </div>

      {!loading && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 14,
            ...PS,
            padding: "8px 24px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: 16 }}>⬡</span>
          <span
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: "#F1F5F9",
              letterSpacing: "0.01em",
            }}
          >
            Gate Digital Twin
          </span>
        </div>
      )}

      {/* Toggle controls button — only in expert mode */}
      {showOriginalPanels && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: showControls ? 264 : 16,
            zIndex: 16,
            display: "flex",
            gap: 6,
            transition: "left 0.3s ease",
          }}
        >
          <button
            onClick={() => setShowControls((p) => !p)}
            style={{
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.10)",
              cursor: "pointer",
              fontFamily: UI_FONT_STACK,
              fontSize: 12,
              fontWeight: 600,
              padding: "10px 14px",
              background: "rgba(55,60,68,0.82)",
              color: "#93C5FD",
              boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
              backdropFilter: "blur(16px)",
            }}
          >
            {showControls ? "← Hide" : "☰"}
          </button>
          <button
            onClick={() => setShowRolePanel((p) => !p)}
            style={{
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: UI_FONT_STACK,
              fontSize: 12,
              fontWeight: 600,
              padding: "10px 14px",
              background: activeRole
                ? "rgba(99,102,241,0.25)"
                : "rgba(55,60,68,0.82)",
              color: activeRole ? "#C7D2FE" : "#CBD5E1",
              border: "1px solid rgba(255,255,255,0.14)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
              backdropFilter: "blur(16px)",
            }}
          >
            {activeRole
              ? `${{ director: "🏢", facilities: "🔧", it: "💻", sustainability: "🌿", worker: "👤", ev: "🚗", visitor: "👋" }[activeRole] || "👤"} ${{ director: "Director", facilities: "Facilities", it: "IT", sustainability: "Sustainability", worker: "Worker", ev: "EV", visitor: "Visitor" }[activeRole] || "Role"}`
              : "👤 My Role"}
          </button>
          {(activeRole === "director" || activeRole === "facilities") && (
            <button
              onClick={() => setFaultPanelOpen((p) => !p)}
              style={{
                position: "relative",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
                padding: "10px 12px",
                background: faultPanelOpen
                  ? "rgba(239,68,68,0.22)"
                  : "rgba(55,60,68,0.82)",
                color: faultPanelOpen ? "#FCA5A5" : "#CBD5E1",
                border: `1px solid ${faultPanelOpen ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.14)"}`,
                boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
                backdropFilter: "blur(16px)",
                animation: faults.some((f) => f.severity === "critical")
                  ? "faultPulse 1.5s infinite"
                  : "none",
              }}
            >
              🚨 Faults
              {faults.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    background: faults.some((f) => f.severity === "critical")
                      ? "#EF4444"
                      : "#FBBF24",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                  }}
                >
                  {faults.length}
                </span>
              )}
            </button>
          )}
          {(activeRole === "director" ||
            activeRole === "facilities" ||
            activeRole === "it" ||
            activeRole === "sustainability") && (
            <button
              onClick={() => setAnalyticsOpen(true)}
              style={{
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
                padding: "10px 12px",
                background: "rgba(55,60,68,0.82)",
                color: "#CBD5E1",
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
                backdropFilter: "blur(16px)",
              }}
            >
              📊 Analytics
            </button>
          )}
        </div>
      )}

      {/* Role toggle when not in expert mode — top left alongside nothing */}
      {!showOriginalPanels && !loading && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={() => setShowRolePanel((p) => !p)}
            style={{
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: UI_FONT_STACK,
              fontSize: 12,
              fontWeight: 600,
              padding: "10px 14px",
              background: activeRole
                ? "rgba(99,102,241,0.25)"
                : "rgba(55,60,68,0.82)",
              color: activeRole ? "#C7D2FE" : "#CBD5E1",
              border: "1px solid rgba(255,255,255,0.14)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
              backdropFilter: "blur(16px)",
            }}
          >
            {activeRole
              ? `${{ director: "🏢", facilities: "🔧", it: "💻", sustainability: "🌿", worker: "👤", ev: "🚗", visitor: "👋" }[activeRole] || "👤"} ${{ director: "Director", facilities: "Facilities", it: "IT", sustainability: "Sustainability", worker: "Worker", ev: "EV", visitor: "Visitor" }[activeRole] || "Role"}`
              : "👤 My Role"}
          </button>
          {(activeRole === "director" || activeRole === "facilities") && (
            <button
              onClick={() => setFaultPanelOpen((p) => !p)}
              style={{
                position: "relative",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
                padding: "10px 12px",
                background: faultPanelOpen
                  ? "rgba(239,68,68,0.22)"
                  : "rgba(55,60,68,0.82)",
                color: faultPanelOpen ? "#FCA5A5" : "#CBD5E1",
                border: `1px solid ${faultPanelOpen ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.14)"}`,
                boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
                backdropFilter: "blur(16px)",
                animation: faults.some((f) => f.severity === "critical")
                  ? "faultPulse 1.5s infinite"
                  : "none",
              }}
            >
              🚨 Faults
              {faults.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    background: faults.some((f) => f.severity === "critical")
                      ? "#EF4444"
                      : "#FBBF24",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                  }}
                >
                  {faults.length}
                </span>
              )}
            </button>
          )}
          {(activeRole === "director" ||
            activeRole === "facilities" ||
            activeRole === "it" ||
            activeRole === "sustainability") && (
            <button
              onClick={() => setAnalyticsOpen(true)}
              style={{
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
                padding: "10px 12px",
                background: "rgba(55,60,68,0.82)",
                color: "#CBD5E1",
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
                backdropFilter: "blur(16px)",
              }}
            >
              📊 Analytics
            </button>
          )}
        </div>
      )}

      {/* Toggle replay button — visible for ALL roles */}
      {replayAvailable && !replayOpen && (
        <button
          onClick={() => setReplayOpen(true)}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 16,
            borderRadius: 6,
            border: "1px solid rgba(165,180,252,0.2)",
            cursor: "pointer",
            fontFamily: UI_FONT_STACK,
            fontSize: 12,
            fontWeight: 600,
            padding: "10px 14px",
            background: "rgba(55,60,68,0.82)",
            color: "#C4B5FD",
            boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
            backdropFilter: "blur(16px)",
          }}
        >
          ▶ More Information + Replay
        </button>
      )}

      {/* Expert mode toggle (shown when expert mode is on) */}
      {expertMode && (
        <button
          onClick={() => {
            setExpertMode(false);
            localStorage.removeItem("dtwin_expert");
          }}
          style={{
            position: "absolute",
            top: 16,
            right: replayOpen ? 368 : 16,
            zIndex: 16,
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: UI_FONT_STACK,
            fontSize: 11,
            fontWeight: 600,
            padding: "6px 10px",
            background: "rgba(99,102,241,0.18)",
            color: "#A5B4FC",
            border: "1px solid rgba(129,140,248,0.35)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            transition: "right 0.3s ease",
          }}
        >
          🔬 Expert — Exit
        </button>
      )}

      {/* REPLAY PANEL (visible for ALL roles)  */}
      {replayAvailable && replayOpen && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 15,
            width: 430,
            maxHeight: "calc(100% - 32px)",
            overflow: "auto",
            ...PS,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 2,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14, color: "#E2E8F0" }}>
              {" "}
              More Information + Replay
            </span>
            <button
              onClick={() => {
                void loadReplayData();
              }}
              disabled={replayLoading}
              title="Reload last 48h from Gate API"
              style={{
                marginLeft: "auto",
                marginRight: 6,
                padding: "3px 8px",
                fontSize: 9,
                borderRadius: 4,
                border: "1px solid rgba(125,211,252,0.25)",
                background: replayLoading
                  ? "rgba(125,211,252,0.05)"
                  : "rgba(125,211,252,0.1)",
                color: "#7DD3FC",
                cursor: replayLoading ? "wait" : "pointer",
              }}
            >
              {replayLoading ? "Loading..." : "↺ Refresh data"}
            </button>
            <button
              onClick={() => setReplayOpen(false)}
              style={{
                background: "rgba(99,102,241,0.25)",
                border: "1px solid rgba(165,180,252,0.25)",
                borderRadius: 5,
                color: "#C4B5FD",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 10px",
                fontFamily: UI_FONT_STACK,
              }}
            >
              ✕ Close
            </button>
          </div>
          <div
            style={{
              fontSize: 10,
              color: replayError ? "#EF4444" : "#475569",
              marginTop: 2,
              marginBottom: 8,
            }}
          >
            {replayLoading
              ? "⏳ Loading last 48h from Gate Sofia API..."
              : replayError
                ? `⚠ ${replayError}`
                : replayDataAge
                  ? `Last 48h · Gate Sofia API · loaded ${replayDataAge.toLocaleTimeString()}`
                  : "Loading building data..."}
          </div>

          {/* Role-aware banner */}
          {activeRole === "director" &&
            replayMode === "energy" &&
            (() => {
              const r = ROLES.director;
              const mainData = replayData["main"] || [];
              const totalKwh = mainData.reduce(
                (s, f) => s + (f.watts / 1000) * 0.25,
                0,
              );
              const cost = ((totalKwh / 2) * tariffRate).toFixed(0);
              return (
                <div
                  style={{
                    background: r.accentBg,
                    borderLeft: `3px solid ${r.color}`,
                    borderRadius: "0 6px 6px 0",
                    padding: "6px 10px",
                    fontSize: 10,
                    color: r.color,
                    marginBottom: 8,
                  }}
                >
                  💰 Your estimated cost this period: €{cost}
                </div>
              );
            })()}
          {activeRole === "facilities" &&
            replayMode === "energy" &&
            (() => {
              const r = ROLES.facilities;
              const overloaded = Object.keys(CIRCUIT_CONFIGS).filter((id) => {
                const d = replayData[id];
                if (!d || !d.length) return false;
                const peak = Math.max(...d.map((f) => f.watts));
                const avg = d.reduce((s, f) => s + f.watts, 0) / d.length;
                return avg / peak > 0.8;
              }).length;
              return (
                <div
                  style={{
                    background: r.accentBg,
                    borderLeft: `3px solid ${r.color}`,
                    borderRadius: "0 6px 6px 0",
                    padding: "6px 10px",
                    fontSize: 10,
                    color: r.color,
                    marginBottom: 8,
                  }}
                >
                  ⚠ {overloaded} circuits above 80% peak load
                </div>
              );
            })()}
          {activeRole === "sustainability" &&
            replayMode === "energy" &&
            (() => {
              const r = ROLES.sustainability;
              const mainNow = replayData["main"]?.[replayFrame]?.watts || 0;
              const carbonHr = ((mainNow / 1000) * 0.233).toFixed(1);
              return (
                <div
                  style={{
                    background: r.accentBg,
                    borderLeft: `3px solid ${r.color}`,
                    borderRadius: "0 6px 6px 0",
                    padding: "6px 10px",
                    fontSize: 10,
                    color: r.color,
                    marginBottom: 8,
                  }}
                >
                  🌿 Carbon intensity now: {carbonHr} kg/hr
                </div>
              );
            })()}
          {activeRole === "worker" &&
            replayMode === "climate" &&
            climateReplayRoom &&
            (() => {
              const r = ROLES.worker;
              const roomMeta = availableRooms.find(
                (rm) => rm.roomNumber === climateReplayRoom,
              );
              return (
                <div
                  style={{
                    background: r.accentBg,
                    borderLeft: `3px solid ${r.color}`,
                    borderRadius: "0 6px 6px 0",
                    padding: "6px 10px",
                    fontSize: 10,
                    color: r.color,
                    marginBottom: 8,
                  }}
                >
                  👤 Showing your room:{" "}
                  {roomMeta?.roomName || climateReplayRoom}
                </div>
              );
            })()}
          {activeRole === "visitor" &&
            replayMode === "energy" &&
            (() => {
              const r = ROLES.visitor;
              const mainNow = replayData["main"]?.[replayFrame]?.watts || 0;
              return (
                <div
                  style={{
                    background: r.accentBg,
                    borderLeft: `3px solid ${r.color}`,
                    borderRadius: "0 6px 6px 0",
                    padding: "6px 10px",
                    fontSize: 10,
                    color: r.color,
                    marginBottom: 8,
                  }}
                >
                  👀 Building load now: {fmtW(Math.round(mainNow))}
                </div>
              );
            })()}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6,1fr)",
              gap: 4,
              marginBottom: 10,
            }}
          >
            <Btn
              active={replayMode === "live"}
              onClick={() => handleReplayTabChange("live")}
            >
              🟢 Live
            </Btn>
            <Btn
              active={replayMode === "energy"}
              onClick={() => handleReplayTabChange("energy")}
            >
              ⚡ Energy
            </Btn>
            <Btn
              active={replayMode === "climate"}
              onClick={() => handleReplayTabChange("climate")}
            >
              🌡 IAQ Rooms
            </Btn>
            <Btn
              active={replayMode === "solar"}
              onClick={() => handleReplayTabChange("solar")}
            >
              ☀ Solar
            </Btn>
            <Btn
              active={replayMode === "scenarios"}
              onClick={() => handleReplayTabChange("scenarios")}
            >
              ⚡ Scenarios
            </Btn>
            <Btn
              active={replayMode === "forecast"}
              onClick={() => handleReplayTabChange("forecast")}
            >
              🔮 Forecast
            </Btn>
          </div>

          {replayMode === "live" &&
            (() => {
              const now = new Date(liveClockMs);
              const circuitsUpdatedAt = liveCircuitsLatestTs
                ? new Date(liveCircuitsLatestTs)
                : null;
              const roomsUpdatedAt = liveRoomsLatestTs
                ? new Date(liveRoomsLatestTs)
                : null;

              const circuitsNextAt = new Date(now);
              circuitsNextAt.setMinutes(0, 0, 0);
              circuitsNextAt.setHours(circuitsNextAt.getHours() + 1);

              const roomsNextAt = new Date(now);
              roomsNextAt.setSeconds(0, 0);
              roomsNextAt.setMinutes(
                Math.floor(roomsNextAt.getMinutes() / 15) * 15 + 15,
              );

              const currentUpdatedAt =
                liveView === "circuits" ? circuitsUpdatedAt : roomsUpdatedAt;
              const currentNextAt =
                liveView === "circuits" ? circuitsNextAt : roomsNextAt;
              const remainingMs = Math.max(
                0,
                currentNextAt.getTime() - liveClockMs,
              );
              const hh = String(Math.floor(remainingMs / 3600000)).padStart(
                2,
                "0",
              );
              const mm = String(
                Math.floor((remainingMs % 3600000) / 60000),
              ).padStart(2, "0");
              const ss = String(
                Math.floor((remainingMs % 60000) / 1000),
              ).padStart(2, "0");
              const countdown = `${hh}:${mm}:${ss}`;

              return (
                <div
                  style={{
                    borderRadius: 10,
                    border: "1px solid rgba(96,165,250,0.18)",
                    background:
                      "linear-gradient(180deg, rgba(7,14,28,0.96), rgba(10,18,32,0.92))",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 28px rgba(2,8,23,0.24)",
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                      marginBottom: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: "#E2F1FF",
                          letterSpacing: "0.04em",
                        }}
                      >
                        LIVE SNAPSHOT
                      </div>
                      <div
                        style={{ fontSize: 10, color: "#9AB8D7", marginTop: 4 }}
                      >
                        Last updated:{" "}
                        {currentUpdatedAt
                          ? currentUpdatedAt.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "--:--"}
                      </div>
                      <div
                        style={{ fontSize: 10, color: "#9AB8D7", marginTop: 2 }}
                      >
                        Next refresh in: {countdown}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 4,
                          padding: 3,
                          borderRadius: 999,
                          background: "rgba(15,23,42,0.86)",
                          border: "1px solid rgba(96,165,250,0.22)",
                        }}
                      >
                        <button
                          onClick={() => setLiveView("circuits")}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            border: "none",
                            cursor: "pointer",
                            fontFamily: UI_FONT_STACK,
                            fontSize: 10,
                            fontWeight: 700,
                            background:
                              liveView === "circuits"
                                ? "rgba(59,130,246,0.3)"
                                : "transparent",
                            color:
                              liveView === "circuits" ? "#DBEAFE" : "#7C93B3",
                          }}
                        >
                          Circuits
                        </button>
                        <button
                          onClick={() => setLiveView("rooms")}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            border: "none",
                            cursor: "pointer",
                            fontFamily: UI_FONT_STACK,
                            fontSize: 10,
                            fontWeight: 700,
                            background:
                              liveView === "rooms"
                                ? "rgba(59,130,246,0.3)"
                                : "transparent",
                            color: liveView === "rooms" ? "#DBEAFE" : "#7C93B3",
                          }}
                        >
                          Rooms
                        </button>
                      </div>

                      <Btn
                        onClick={() => {
                          void loadLiveData();
                        }}
                        style={{ padding: "4px 8px", fontSize: 10 }}
                      >
                        ↺ Refresh
                      </Btn>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 10,
                      color: liveError ? "#EF4444" : "#9AB8D7",
                      marginBottom: 10,
                    }}
                  >
                    {liveLoading
                      ? "Loading live snapshot from Gate API..."
                      : liveError
                        ? `⚠ ${liveError}`
                        : liveView === "circuits"
                          ? `ALL CIRCUITS @ ${currentUpdatedAt ? currentUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"} · Updates every hour · Next update ${currentNextAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Time remaining ${countdown}`
                          : `ALL ROOMS @ ${currentUpdatedAt ? currentUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"} · Updates every 15 minutes · Next update ${currentNextAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Time remaining ${countdown}`}
                  </div>

                  {liveView === "circuits" ? (
                    <>
                      <SL>
                        All Circuits @{" "}
                        {currentUpdatedAt
                          ? currentUpdatedAt.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "--:--"}
                      </SL>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#64748B",
                          marginBottom: 8,
                        }}
                      >
                        Updates every hour
                      </div>
                      {liveCircuitsViewRows.length ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          {liveCircuitsViewRows.map((row) => {
                            const maxW = Math.max(
                              ...liveCircuitsViewRows.map((item) => item.watts),
                              1,
                            );
                            const pct = (row.watts / maxW) * 100;
                            return (
                              <div
                                key={row.id}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 7,
                                }}
                              >
                                <div
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: row.color,
                                    flexShrink: 0,
                                    boxShadow: `0 0 4px ${row.color}`,
                                  }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: 10,
                                      color: "#CBD5E1",
                                      overflow: "hidden",
                                      whiteSpace: "nowrap",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {row.label}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 9,
                                      color: "#7C93B3",
                                      marginTop: 2,
                                    }}
                                  >
                                    Last:{" "}
                                    {formatReplayTimeFromTimestamp(
                                      row.timestampMs,
                                    )}{" "}
                                    ({fmtW(Math.round(row.watts))}){" "}
                                    {row.previousTimestampMs
                                      ? `· 2nd-last: ${formatReplayTimeFromTimestamp(row.previousTimestampMs)} (${fmtW(Math.round(row.previousWatts))})`
                                      : ""}
                                  </div>
                                </div>
                                <div
                                  style={{
                                    display: "grid",
                                    gap: 4,
                                    minWidth: 92,
                                    justifyItems: "end",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 56,
                                      height: 3,
                                      background: "rgba(255,255,255,0.05)",
                                      borderRadius: 2,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: `${pct}%`,
                                        height: "100%",
                                        background: row.color,
                                        borderRadius: 2,
                                        transition: "width 0.35s ease",
                                      }}
                                    />
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 10,
                                      color: "#94A3B8",
                                      textAlign: "right",
                                    }}
                                  >
                                    {fmtW(Math.round(row.watts))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div
                          style={{
                            padding: "12px",
                            borderRadius: 8,
                            background: "rgba(10,15,26,0.45)",
                            border: "1px dashed rgba(125,211,252,0.18)",
                            fontSize: 10,
                            color: "#94A3B8",
                          }}
                        >
                          No live circuit telemetry is available right now. Use
                          Refresh to retry, and check that the Gate API key is
                          configured.
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <SL>
                        All Rooms @{" "}
                        {currentUpdatedAt
                          ? currentUpdatedAt.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "--:--"}
                      </SL>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontSize: 10, color: "#64748B" }}>
                          Updates every 15 minutes
                        </div>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 10,
                            color: "#9AB8D7",
                          }}
                        >
                          <span>Floor</span>
                          <select
                            value={liveRoomsFloorFilter}
                            onChange={(e) =>
                              setLiveRoomsFloorFilter(e.target.value)
                            }
                            style={{
                              background: "rgba(15,23,42,0.9)",
                              color: "#E2F1FF",
                              border: "1px solid rgba(125,211,252,0.18)",
                              borderRadius: 6,
                              padding: "4px 8px",
                              fontSize: 10,
                              fontFamily: UI_FONT_STACK,
                              outline: "none",
                            }}
                          >
                            <option value="all">All floors</option>
                            {liveRoomFloorOptions.map((floor) => (
                              <option key={floor} value={String(floor)}>
                                Floor {floor}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {filteredLiveRoomsViewRows.map((room) => (
                          <div
                            key={room.id}
                            style={{
                              padding: "10px 12px",
                              borderRadius: 8,
                              background: "rgba(10,15,26,0.7)",
                              border: "1px solid rgba(125,211,252,0.16)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: "#E2F1FF",
                                marginBottom: 4,
                              }}
                            >
                              {room.label}
                              {room.secondary ? (
                                <span
                                  style={{ color: "#64748B", fontWeight: 500 }}
                                >
                                  {" "}
                                  {room.secondary}
                                </span>
                              ) : null}
                            </div>
                            <div
                              style={{
                                fontSize: 9,
                                color: "#7C93B3",
                                marginBottom: 4,
                              }}
                            >
                              Latest{" "}
                              {formatReplayTimeFromTimestamp(room.timestampMs)}{" "}
                              · Prev 15m{" "}
                              {formatReplayTimeFromTimestamp(
                                room.previousTimestampMs,
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: "#CBD5E1" }}>
                              🌡{" "}
                              {Number.isFinite(room.temp)
                                ? `${room.temp.toFixed(1)} °C`
                                : "—"}
                              {" · "}
                              💧{" "}
                              {Number.isFinite(room.humidity)
                                ? `${room.humidity.toFixed(0)} %`
                                : "—"}
                              {" · "}
                              🫧{" "}
                              {Number.isFinite(room.co2)
                                ? `${room.co2.toFixed(0)} ppm`
                                : "—"}
                            </div>
                            <div
                              style={{
                                fontSize: 9,
                                color: "#7C93B3",
                                marginTop: 4,
                              }}
                            >
                              Prev 15m values:{" "}
                              {room.previousTimestampMs &&
                              Number.isFinite(room.previousTemp)
                                ? `${room.previousTemp.toFixed(1)} °C`
                                : "—"}{" "}
                              ·{" "}
                              {room.previousTimestampMs &&
                              Number.isFinite(room.previousHumidity)
                                ? `${room.previousHumidity.toFixed(0)} %`
                                : "—"}{" "}
                              ·{" "}
                              {room.previousTimestampMs &&
                              Number.isFinite(room.previousCo2)
                                ? `${room.previousCo2.toFixed(0)} ppm`
                                : "—"}
                            </div>
                          </div>
                        ))}
                        {!filteredLiveRoomsViewRows.length && (
                          <div
                            style={{
                              padding: "12px",
                              borderRadius: 8,
                              background: "rgba(10,15,26,0.45)",
                              border: "1px dashed rgba(125,211,252,0.18)",
                              fontSize: 10,
                              color: "#94A3B8",
                            }}
                          >
                            No live room telemetry is available for this floor
                            right now.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

          {replayMode === "energy" && (
            <>
              {Object.values(replayDataRef.current ?? {})[0]?.length < 10 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "12px",
                    background: "rgba(251,191,36,0.06)",
                    border: "1px solid rgba(251,191,36,0.2)",
                    borderRadius: 8,
                    fontSize: 11,
                    color: "#FDE68A",
                    margin: "8px 0",
                  }}
                >
                  ⚡ Live energy data available — 48h history from the
                  electricity API is pending. IAQ room data has full 48h
                  history.
                </div>
              )}

              <div style={{ marginBottom: 4 }}>
                <SL>Circuit</SL>
                <select
                  value={replayCircuit}
                  onChange={(e) => setReplayCircuit(e.target.value)}
                  style={selectStyle}
                >
                  {allCircIds.map((id) => (
                    <option key={id} value={id}>
                      {CIRCUIT_CONFIGS[id]?.label || id}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sparkline */}
              {replayData[replayCircuit] &&
                (() => {
                  const samples = replayData[replayCircuit];
                  const maxW = Math.max(...samples.map((s) => s.watts));
                  const W = 1000,
                    H = 54;
                  const pts = samples
                    .map(
                      (s, i) =>
                        `${(i / (samples.length - 1)) * W},${H - (s.watts / maxW) * H}`,
                    )
                    .join(" ");
                  const curX = (replayFrame / (samples.length - 1)) * W;
                  const curY =
                    H - ((samples[replayFrame]?.watts || 0) / maxW) * H;
                  const circColor =
                    CIRCUIT_CONFIGS[replayCircuit]?.color || "#60A5FA";
                  const otSeries = outsideTempRef.current;
                  let otPts = "";
                  if (otSeries.length >= 2) {
                    const otTemps = otSeries.map((d) => d.temp);
                    const minOT = Math.min(...otTemps),
                      maxOT = Math.max(...otTemps);
                    const rangeOT = Math.max(0.001, maxOT - minOT);
                    const interpOT = (idx) => {
                      const t =
                        (idx / (samples.length - 1)) * (otSeries.length - 1);
                      const lo = Math.floor(t),
                        hi = Math.min(Math.ceil(t), otSeries.length - 1),
                        frac = t - lo;
                      return (
                        otSeries[lo].temp * (1 - frac) +
                        otSeries[hi].temp * frac
                      );
                    };
                    otPts = samples
                      .map((_, i) => {
                        const temp = interpOT(i);
                        const y =
                          H * 0.1 + H * 0.8 * (1 - (temp - minOT) / rangeOT);
                        return `${(i / (samples.length - 1)) * W},${y}`;
                      })
                      .join(" ");
                  }
                  return (
                    <div style={{ marginBottom: 10 }}>
                      <svg
                        viewBox={`0 0 ${W} ${H + 2}`}
                        preserveAspectRatio="none"
                        style={{
                          display: "block",
                          width: "100%",
                          height: H + 2,
                          borderRadius: 4,
                          background: "rgba(10,15,26,0.7)",
                          border: "1px solid rgba(96,165,250,0.06)",
                        }}
                      >
                        <defs>
                          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="0%"
                              stopColor={circColor}
                              stopOpacity="0.5"
                            />
                            <stop
                              offset="100%"
                              stopColor={circColor}
                              stopOpacity="0.02"
                            />
                          </linearGradient>
                        </defs>
                        <polyline
                          points={`0,${H} ${pts} ${W},${H}`}
                          fill="url(#sg)"
                          stroke="none"
                        />
                        <polyline
                          points={pts}
                          fill="none"
                          stroke={circColor}
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                        {otPts && (
                          <polyline
                            points={otPts}
                            fill="none"
                            stroke="#FFA040"
                            strokeWidth="1"
                            strokeDasharray="3,2"
                            strokeLinejoin="round"
                            opacity="0.75"
                          />
                        )}
                        <line
                          x1={curX}
                          y1={0}
                          x2={curX}
                          y2={H}
                          stroke="white"
                          strokeWidth={1}
                          strokeOpacity={0.35}
                          strokeDasharray="3,3"
                        />
                        <circle
                          cx={curX}
                          cy={curY}
                          r={3}
                          fill="white"
                          stroke={circColor}
                          strokeWidth={2}
                        />
                      </svg>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 9,
                          color: "#334155",
                          marginTop: 3,
                          gap: 4,
                        }}
                      >
                        {formatReplaySparkAxisTicks(samples).map((lab, i) => (
                          <span
                            key={i}
                            style={{
                              flex: 1,
                              textAlign:
                                i === 0 ? "left" : i === 4 ? "right" : "center",
                              minWidth: 0,
                            }}
                          >
                            {lab}
                          </span>
                        ))}
                      </div>
                      {otSeries.length >= 2 && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 9,
                            color: "#9AB8D7",
                            marginTop: 2,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: 16,
                              height: 1,
                              borderTop: "1px dashed #FFA040",
                              opacity: 0.75,
                            }}
                          />
                          <span style={{ color: "#FFA040" }}>Outdoor temp</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* Current value */}
              {(() => {
                const otSeries2 = outsideTempRef.current;
                let eOutdoorT = null;
                if (otSeries2.length >= 2) {
                  const t =
                    (replayFrame / (totalFrames - 1)) * (otSeries2.length - 1);
                  const lo = Math.floor(t),
                    hi = Math.min(Math.ceil(t), otSeries2.length - 1),
                    frac = t - lo;
                  eOutdoorT = (
                    otSeries2[lo].temp * (1 - frac) +
                    otSeries2[hi].temp * frac
                  ).toFixed(1);
                }
                return (
                  <div
                    style={{
                      background: "rgba(10,15,26,0.7)",
                      border: "1px solid rgba(96,165,250,0.2)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#334155",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          marginBottom: 2,
                        }}
                      >
                        {currentSample?.time || "--:--"}
                      </div>
                      <div
                        style={{
                          fontSize: 22,
                          fontWeight: 700,
                          color:
                            CIRCUIT_CONFIGS[replayCircuit]?.color || "#60A5FA",
                          letterSpacing: "-0.02em",
                        }}
                      >
                        {currentSample ? fmtW(currentSample.watts) : "—"}
                      </div>
                      {eOutdoorT !== null && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "#FFA040",
                            marginTop: 3,
                          }}
                        >
                          Outdoor: {eOutdoorT} °C
                        </div>
                      )}
                      <div
                        style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}
                      >
                        Timestamp: {fmtReplayDateTime(energyCurrentMs)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#334155",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        Frame
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          color: "#475569",
                          fontWeight: 700,
                        }}
                      >
                        {replayFrame + 1}/{totalFrames}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 8 }}>
                Data window: {fmtReplayDateTime(energyStartMs)} →{" "}
                {fmtReplayDateTime(energyEndMs)}
              </div>
              <div style={{ fontSize: 9, color: "#94A3B8", marginBottom: 8 }}>
                Latest GATE sample:{" "}
                {fmtReplayDateTime(energyLatestGateMs ?? energyEndMs)}{" "}
                (Europe/Sofia)
              </div>

              {/* Scrubber */}
              <input
                type="range"
                min={0}
                max={totalFrames - 1}
                value={replayFrame}
                onChange={(e) => seekReplay(Number(e.target.value))}
                style={{
                  width: "100%",
                  accentColor:
                    CIRCUIT_CONFIGS[replayCircuit]?.color || "#3B82F6",
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              />

              {/* Playback controls */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 5,
                  marginBottom: 8,
                }}
              >
                <Btn onClick={() => seekReplay(Math.max(0, replayFrame - 4))}>
                  ◀◀ -1h
                </Btn>
                <Btn
                  onClick={() => (replayPlaying ? stopReplay() : startReplay())}
                  accent={!replayPlaying}
                  active={replayPlaying}
                >
                  {replayPlaying ? "⏸ Pause" : "▶ Play"}
                </Btn>
                <Btn
                  onClick={() =>
                    seekReplay(Math.min(totalFrames - 1, replayFrame + 4))
                  }
                >
                  +1h ▶▶
                </Btn>
              </div>

              <SL>Speed</SL>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 4,
                  marginBottom: 12,
                }}
              >
                {[0.5, 1, 2, 4].map((s) => (
                  <Btn
                    key={s}
                    onClick={() => changeSpeed(s)}
                    active={replaySpeed === s}
                  >
                    {s}×
                  </Btn>
                ))}
              </div>

              <Hr />

              {/* All-circuit live bar chart */}
              {Object.keys(replayData).length > 0 && (
                <>
                  <SL>All Circuits @ {currentSample?.time || "--:--"}</SL>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    {allCircIds.map((id) => {
                      const sample = replayData[id]?.[replayFrame];
                      if (!sample) return null;
                      const maxW = Math.max(
                        ...(replayData[id]?.map((s) => s.watts) || [1]),
                      );
                      const pct = (sample.watts / maxW) * 100;
                      return (
                        <div
                          key={id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: CIRCUIT_CONFIGS[id]?.color || "#888",
                              flexShrink: 0,
                              boxShadow: `0 0 4px ${CIRCUIT_CONFIGS[id]?.color || "#888"}`,
                            }}
                          />
                          <div
                            style={{
                              flex: 1,
                              fontSize: 10,
                              color: "#475569",
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {CIRCUIT_CONFIGS[id]?.label || id}
                          </div>
                          <div
                            style={{
                              width: 56,
                              height: 3,
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: 2,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                background:
                                  CIRCUIT_CONFIGS[id]?.color || "#888",
                                borderRadius: 2,
                                transition: "width 0.35s ease",
                              }}
                            />
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "#64748B",
                              minWidth: 46,
                              textAlign: "right",
                            }}
                          >
                            {fmtW(sample.watts)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {replayMode === "climate" && (
            <>
              <SL>Room</SL>
              <select
                value={climateReplayRoom}
                onChange={async (e) => {
                  const nextRoom = e.target.value;
                  setClimateReplayRoom(nextRoom);
                  const roomKey = toReplayRoomKey(nextRoom);
                  if (roomKey) {
                    await ensureClimateReplayData(roomKey);
                    focusClimateRoom(nextRoom);
                    applyClimateFrame(
                      climateReplayFrame,
                      climateReplayMetric,
                      nextRoom,
                      climateApplyToBuilding ? "building" : "room",
                    );
                  }
                }}
                style={selectStyle}
              >
                <option value="">Select room...</option>
                {climateRoomOptions.map((r) => (
                  <option
                    key={`${r.roomNumber}-${r.floorLevel}`}
                    value={r.roomNumber}
                  >
                    {r.roomNumber} - {r.roomName}
                  </option>
                ))}
              </select>

              <SL>Metric</SL>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 4,
                  marginBottom: 8,
                }}
              >
                {["temperature", "humidity", "co2"].map((m) => (
                  <Btn
                    key={m}
                    active={climateReplayMetric === m}
                    onClick={() => {
                      setClimateReplayMetric(m);
                      applyClimateFrame(
                        climateReplayFrame,
                        m,
                        climateReplayRoom,
                        climateApplyToBuilding ? "building" : "room",
                      );
                    }}
                  >
                    {metricLabel(m)}
                  </Btn>
                ))}
              </div>

              {activeClimateRoomKey &&
                climateData[activeClimateRoomKey] &&
                (() => {
                  const samples = climateData[activeClimateRoomKey];
                  const metric = climateReplayMetric;
                  const vals = samples.map((s) => Number(s[metric] ?? 0));
                  const minV = Math.min(...vals),
                    maxV = Math.max(...vals);
                  const range = Math.max(0.001, maxV - minV);
                  const W = 1000,
                    H = 54;
                  const pts = samples
                    .map((s, i) => {
                      const v = Number(s[metric] ?? 0);
                      const y = H - ((v - minV) / range) * H;
                      return `${(i / (samples.length - 1)) * W},${y}`;
                    })
                    .join(" ");
                  const curX = (climateReplayFrame / (samples.length - 1)) * W;
                  const curV = Number(
                    samples[climateReplayFrame]?.[metric] ?? 0,
                  );
                  const curY = H - ((curV - minV) / range) * H;
                  const color =
                    metric === "temperature"
                      ? "#FB923C"
                      : metric === "humidity"
                        ? "#38BDF8"
                        : "#EF4444";
                  const iotSeries = outsideTempRef.current;
                  let iotPts = "";
                  if (iotSeries.length >= 2) {
                    const iotTemps = iotSeries.map((d) => d.temp);
                    const minIOT = Math.min(...iotTemps),
                      maxIOT = Math.max(...iotTemps),
                      rangeIOT = Math.max(0.001, maxIOT - minIOT);
                    iotPts = samples
                      .map((_, i) => {
                        const t =
                          (i / (samples.length - 1)) * (iotSeries.length - 1);
                        const lo = Math.floor(t),
                          hi = Math.min(Math.ceil(t), iotSeries.length - 1),
                          frac = t - lo;
                        const temp =
                          iotSeries[lo].temp * (1 - frac) +
                          iotSeries[hi].temp * frac;
                        const y =
                          H * 0.1 + H * 0.8 * (1 - (temp - minIOT) / rangeIOT);
                        return `${(i / (samples.length - 1)) * W},${y}`;
                      })
                      .join(" ");
                  }
                  return (
                    <div style={{ marginBottom: 10 }}>
                      <svg
                        viewBox={`0 0 ${W} ${H + 2}`}
                        preserveAspectRatio="none"
                        style={{
                          display: "block",
                          width: "100%",
                          height: H + 2,
                          borderRadius: 4,
                          background: "rgba(10,15,26,0.7)",
                          border: "1px solid rgba(125,211,252,0.14)",
                        }}
                      >
                        <defs>
                          <linearGradient
                            id="climate-sg"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={color}
                              stopOpacity="0.5"
                            />
                            <stop
                              offset="100%"
                              stopColor={color}
                              stopOpacity="0.03"
                            />
                          </linearGradient>
                        </defs>
                        <polyline
                          points={`0,${H} ${pts} ${W},${H}`}
                          fill="url(#climate-sg)"
                          stroke="none"
                        />
                        <polyline
                          points={pts}
                          fill="none"
                          stroke={color}
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                        {iotPts && (
                          <polyline
                            points={iotPts}
                            fill="none"
                            stroke="#FFA040"
                            strokeWidth="1"
                            strokeDasharray="3,2"
                            strokeLinejoin="round"
                            opacity="0.75"
                          />
                        )}
                        <line
                          x1={curX}
                          y1={0}
                          x2={curX}
                          y2={H}
                          stroke="white"
                          strokeWidth={1}
                          strokeOpacity={0.35}
                          strokeDasharray="3,3"
                        />
                        <circle
                          cx={curX}
                          cy={curY}
                          r={3}
                          fill="white"
                          stroke={color}
                          strokeWidth={2}
                        />
                      </svg>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 9,
                          color: "#9AB8D7",
                          marginTop: 3,
                          gap: 4,
                        }}
                      >
                        {formatReplaySparkAxisTicks(samples).map((lab, i) => (
                          <span
                            key={i}
                            style={{
                              flex: 1,
                              textAlign:
                                i === 0 ? "left" : i === 4 ? "right" : "center",
                              minWidth: 0,
                            }}
                          >
                            {lab}
                          </span>
                        ))}
                      </div>
                      {iotSeries.length >= 2 && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 9,
                            color: "#9AB8D7",
                            marginTop: 2,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: 16,
                              height: 1,
                              borderTop: "1px dashed #FFA040",
                              opacity: 0.75,
                            }}
                          />
                          <span style={{ color: "#FFA040" }}>Outdoor temp</span>
                          <span
                            style={{
                              marginLeft: "auto",
                              color: "#64748B",
                              fontSize: 8,
                            }}
                          >
                            (
                            {new Date(
                              iotSeries[0].timestampMs,
                            ).toLocaleDateString()}{" "}
                            period)
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}

              {(() => {
                const ciotSeries = outsideTempRef.current;
                let cOutdoorT = null;
                if (ciotSeries.length >= 2) {
                  const t =
                    (climateReplayFrame / (climateTotalFrames - 1)) *
                    (ciotSeries.length - 1);
                  const lo = Math.floor(t),
                    hi = Math.min(Math.ceil(t), ciotSeries.length - 1),
                    frac = t - lo;
                  cOutdoorT = (
                    ciotSeries[lo].temp * (1 - frac) +
                    ciotSeries[hi].temp * frac
                  ).toFixed(1);
                }
                return (
                  <div
                    style={{
                      background: "rgba(10,15,26,0.7)",
                      border: "1px solid rgba(125,211,252,0.2)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#9AB8D7",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          marginBottom: 2,
                        }}
                      >
                        {climateCurrentSample?.time || "--:--"}
                      </div>
                      <div
                        style={{
                          fontSize: 21,
                          fontWeight: 700,
                          color:
                            climateReplayMetric === "temperature"
                              ? "#FB923C"
                              : climateReplayMetric === "humidity"
                                ? "#38BDF8"
                                : "#F87171",
                          letterSpacing: "-0.02em",
                        }}
                      >
                        {climateCurrentSample
                          ? fmtClimate(
                              climateReplayMetric,
                              Number(
                                climateCurrentSample[climateReplayMetric] ?? 0,
                              ),
                            )
                          : "-"}
                      </div>
                      {cOutdoorT !== null && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "#FFA040",
                            marginTop: 3,
                          }}
                        >
                          🌡 {cOutdoorT} °C outdoor
                        </div>
                      )}
                      <div
                        style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}
                      >
                        Timestamp: {fmtReplayDateTime(climateCurrentMs)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#9AB8D7",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        Frame
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          color: "#CFE8FF",
                          fontWeight: 700,
                        }}
                      >
                        {climateReplayFrame + 1}/{climateTotalFrames}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ fontSize: 10, color: "#9AB8D7", marginBottom: 8 }}>
                Data window: {fmtReplayDateTime(climateStartMs)} →{" "}
                {fmtReplayDateTime(climateEndMs)}
              </div>

              <input
                type="range"
                min={0}
                max={climateTotalFrames - 1}
                value={climateReplayFrame}
                onChange={(e) => seekClimateReplay(Number(e.target.value))}
                style={{
                  width: "100%",
                  accentColor:
                    climateReplayMetric === "temperature"
                      ? "#FB923C"
                      : climateReplayMetric === "humidity"
                        ? "#38BDF8"
                        : "#EF4444",
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 5,
                  marginBottom: 8,
                }}
              >
                <Btn
                  onClick={() =>
                    seekClimateReplay(Math.max(0, climateReplayFrame - 4))
                  }
                >
                  ◀◀ -1h
                </Btn>
                <Btn
                  onClick={() =>
                    climateReplayPlaying
                      ? stopClimateReplay()
                      : startClimateReplay()
                  }
                  accent={!climateReplayPlaying}
                  active={climateReplayPlaying}
                >
                  {climateReplayPlaying ? "⏸ Pause" : "▶ Play"}
                </Btn>
                <Btn
                  onClick={() =>
                    seekClimateReplay(
                      Math.min(climateTotalFrames - 1, climateReplayFrame + 4),
                    )
                  }
                >
                  +1h ▶▶
                </Btn>
              </div>

              <SL>Speed</SL>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 4,
                  marginBottom: 10,
                }}
              >
                {[0.5, 1, 2, 4].map((s) => (
                  <Btn
                    key={s}
                    onClick={() => changeClimateSpeed(s)}
                    active={climateReplaySpeed === s}
                  >
                    {s}x
                  </Btn>
                ))}
              </div>

              <Btn
                full
                accent
                active={climateApplyToBuilding}
                onClick={async () => {
                  const nextApplyToBuilding = !climateApplyToBuilding;
                  setClimateApplyToBuilding(nextApplyToBuilding);
                  if (nextApplyToBuilding) {
                    await ensureAllClimateReplayData();
                    if (activeClimateRoomKey)
                      focusClimateRoom(activeClimateRoomKey);
                    applyClimateFrame(
                      climateReplayFrame,
                      climateReplayMetric,
                      climateReplayRoom,
                      "building",
                    );
                  } else {
                    applyClimateFrame(
                      climateReplayFrame,
                      climateReplayMetric,
                      climateReplayRoom,
                      "room",
                    );
                  }
                }}
              >
                {climateApplyToBuilding
                  ? "Applied to Building"
                  : "Apply to Building"}
              </Btn>

              <div
                style={{
                  fontSize: 10,
                  color: "#9AB8D7",
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                Replays Gate API room telemetry (last 48h) for temperature,
                humidity, and CO2. Use Apply to Building to keep the whole
                floorplan shaded as you switch metrics.
              </div>
            </>
          )}

          {replayMode === "solar" && (
            <SolarPanel
              replayData={replayDataRef.current}
              replayDataRef={replayDataRef}
              tariffRate={tariffRate}
              pvDataRef={pvDataRef}
              getBuildingJson={getBuildingJson}
              activeRole={activeRole}
            />
          )}

          {replayMode === "compare" &&
            (() => {
              // Plain-English names for signals
              const CNAMES = {
                main: "Total building load",
                circuit6boiler: "Boiler",
                airconditioner1: "Air conditioning (floors 1-2)",
                airconditioner2: "Air conditioning (floors 3-5)",
                circuit7: "Conference floor",
                circuit8: "Server room",
                circuit9: "Office floor 1",
                circuit10: "Electrical room",
                circuit11: "Office floor 2",
                circuit12: "Storage areas",
                outsidelighting1: "Outside lights (north)",
                outsidelighting2: "Outside lights (south)",
                vehiclecharging1: "EV charger 1",
                vehiclecharging2: "EV charger 2",
                elevator: "Elevator",
                "3DLED": "LED display",
                ovk: "Ventilation (OVK)",
                outdoor_temp: "Outdoor temperature",
                co2_avg: "Average CO\u2082 (all rooms)",
              };

              const hasReplayData = Object.keys(replayData || {}).some(
                (k) => replayData[k]?.length > 0,
              );
              if (!hasReplayData)
                return (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "24px 0",
                      color: "#334155",
                      fontSize: 11,
                    }}
                  >
                    Play the Energy tab first to load building data
                  </div>
                );

              const signalOptions = [
                ...Object.keys(CIRCUIT_CONFIGS),
                "outdoor_temp",
                "co2_avg",
              ];

              const getSeriesValues = (sigId) => {
                if (!sigId) return [];
                if (replayData[sigId])
                  return replayData[sigId].map((f) => f.watts ?? 0);
                if (sigId === "outdoor_temp")
                  return outsideTempSeries.map((f) => f.temp ?? 0);
                if (sigId === "co2_avg") {
                  const rooms = Object.values(climateData || {});
                  if (!rooms.length) return [];
                  const len = rooms[0]?.length || 0;
                  return Array.from({ length: len }, (_, i) => {
                    const vals = rooms
                      .map((r) => r[i]?.co2)
                      .filter(Number.isFinite);
                    return vals.length
                      ? vals.reduce((a, b) => a + b) / vals.length
                      : 0;
                  });
                }
                return [];
              };

              const serA = getSeriesValues(signalA);
              const serB = getSeriesValues(signalB);
              const minLen = Math.min(serA.length, serB.length);
              const corrPts =
                minLen < 2
                  ? []
                  : Array.from({ length: minLen }, (_, i) => ({
                      x: serA[i],
                      y: serB[i],
                    })).filter(
                      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
                    );
              const corr = pearsonCorrelation(corrPts);
              const labelA = CNAMES[signalA] || signalA;
              const labelB = CNAMES[signalB] || signalB;

              const describeCorrelation = (r, la, lb) => {
                if (!Number.isFinite(r))
                  return `${la} and ${lb} — not enough data to compare.`;
                const abs = Math.abs(r);
                if (abs < 0.2) return `${la} and ${lb} are not related.`;
                if (abs < 0.4)
                  return `When ${la} is high, ${lb} tends to be slightly ${r > 0 ? "higher" : "lower"} too — but the link is weak.`;
                if (abs < 0.6)
                  return `There is a moderate link — when ${la} ${r > 0 ? "rises" : "drops"}, ${lb} often ${r > 0 ? "rises" : "falls"} too.`;
                if (abs < 0.8)
                  return `Strong link — ${la} and ${lb} move together most of the time.`;
                return `Very strong link — ${la} and ${lb} almost always move together.`;
              };

              const hasChart = serA.length > 1 && serB.length > 1;
              const CW = 1000,
                CH = 72;
              const chartLineA = hasChart
                ? (() => {
                    const minA = Math.min(...serA),
                      rangeA = Math.max(0.001, Math.max(...serA) - minA);
                    return serA
                      .map(
                        (v, i) =>
                          `${(i / (serA.length - 1)) * CW},${CH - ((v - minA) / rangeA) * CH}`,
                      )
                      .join(" ");
                  })()
                : "";
              const chartLineB = hasChart
                ? (() => {
                    const minB = Math.min(...serB),
                      rangeB = Math.max(0.001, Math.max(...serB) - minB);
                    return serB
                      .map(
                        (v, i) =>
                          `${(i / (serB.length - 1)) * CW},${CH - ((v - minB) / rangeB) * CH}`,
                      )
                      .join(" ");
                  })()
                : "";

              const circuitTotals = Object.entries(replayData || {})
                .filter(([key]) => key !== "main")
                .map(([key, frames]) => ({
                  id: key,
                  label: CNAMES[key] || key,
                  kwh: (frames || []).reduce(
                    (s, f) => s + ((f.watts ?? 0) / 1000) * 0.25,
                    0,
                  ),
                }))
                .filter((c) => c.kwh > 0.1)
                .sort((a, b) => b.kwh - a.kwh)
                .slice(0, 8);
              const maxKwh = circuitTotals[0]?.kwh ?? 1;
              const totalKwh = circuitTotals.reduce((s, c) => s + c.kwh, 0);

              const mainFrames = replayData?.main ?? [];
              const yesterdayKwh = mainFrames
                .slice(0, 48)
                .reduce((s, f) => s + ((f.watts ?? 0) / 1000) * 0.25, 0);
              const todayKwh = mainFrames
                .slice(48)
                .reduce((s, f) => s + ((f.watts ?? 0) / 1000) * 0.25, 0);
              const diffPct =
                yesterdayKwh > 0
                  ? ((todayKwh - yesterdayKwh) / yesterdayKwh) * 100
                  : 0;
              const diffKwh = todayKwh - yesterdayKwh;
              const diffCost = Math.abs(diffKwh) * tariffRate;
              const todayVsLine =
                Math.abs(diffPct) < 3
                  ? "About the same as yesterday."
                  : diffPct < 0
                    ? `Using ${Math.abs(diffPct).toFixed(0)}% less than yesterday — saving \u20AC${diffCost.toFixed(2)} so far.`
                    : `Using ${diffPct.toFixed(0)}% more than yesterday — \u20AC${diffCost.toFixed(2)} extra so far.`;

              return (
                <>
                  {/* Dropdowns on one row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: "#475569",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Compare
                    </span>
                    <select
                      value={signalA}
                      onChange={(e) => setSignalA(e.target.value)}
                      style={{
                        ...selectStyle,
                        flex: 1,
                        marginBottom: 0,
                        minWidth: 80,
                      }}
                    >
                      {signalOptions.map((id) => (
                        <option key={id} value={id}>
                          {CNAMES[id] || id}
                        </option>
                      ))}
                    </select>
                    <span
                      style={{
                        fontSize: 10,
                        color: "#475569",
                        whiteSpace: "nowrap",
                      }}
                    >
                      with
                    </span>
                    <select
                      value={signalB}
                      onChange={(e) => setSignalB(e.target.value)}
                      style={{
                        ...selectStyle,
                        flex: 1,
                        marginBottom: 0,
                        minWidth: 80,
                      }}
                    >
                      {signalOptions.map((id) => (
                        <option key={id} value={id}>
                          {CNAMES[id] || id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Plain English answer */}
                  <div
                    style={{
                      background: "rgba(125,211,252,0.06)",
                      borderLeft: "3px solid #7DD3FC",
                      borderRadius: "0 6px 6px 0",
                      padding: "8px 12px",
                      fontSize: 12,
                      color: "#CBD5E1",
                      marginBottom: 10,
                      lineHeight: 1.5,
                    }}
                  >
                    {describeCorrelation(corr, labelA, labelB)}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "#334155",
                      textAlign: "right",
                      marginTop: -6,
                      marginBottom: 8,
                    }}
                  >
                    correlation:{" "}
                    {Number.isFinite(corr) ? corr.toFixed(2) : "n/a"}
                  </div>

                  {/* Dual-line chart */}
                  {hasChart && (
                    <>
                      <svg
                        viewBox={`0 0 ${CW} ${CH + 2}`}
                        preserveAspectRatio="none"
                        style={{
                          display: "block",
                          width: "100%",
                          height: CH + 2,
                          borderRadius: 4,
                          background: "rgba(10,15,26,0.7)",
                          border: "1px solid rgba(125,211,252,0.14)",
                          marginBottom: 6,
                        }}
                      >
                        <polyline
                          points={chartLineA}
                          fill="none"
                          stroke="#7DD3FC"
                          strokeWidth="1.6"
                        />
                        <polyline
                          points={chartLineB}
                          fill="none"
                          stroke="#F97316"
                          strokeWidth="1.6"
                        />
                      </svg>
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          fontSize: 9,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ color: "#7DD3FC" }}>
                          \u25A0 {labelA}
                        </span>
                        <span style={{ color: "#F97316" }}>
                          \u25A0 {labelB}
                        </span>
                      </div>
                    </>
                  )}

                  <div
                    style={{
                      borderTop: "1px solid rgba(255,255,255,0.05)",
                      margin: "14px 0",
                    }}
                  />
                  <div
                    style={{
                      fontSize: 9,
                      color: "#334155",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Circuit energy ranking
                  </div>
                  <div
                    style={{ fontSize: 11, color: "#64748B", marginBottom: 8 }}
                  >
                    Which circuit uses the most energy?
                  </div>

                  {circuitTotals.map((circuit, i) => (
                    <div
                      key={circuit.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 5,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          color: i === 0 ? "#FBBF24" : "#334155",
                          minWidth: 12,
                          textAlign: "right",
                          fontWeight: i === 0 ? 700 : 400,
                        }}
                      >
                        {i + 1}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: i === 0 ? "#F1F5F9" : "#64748B",
                          minWidth: 100,
                          maxWidth: 100,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontWeight: i === 0 ? 600 : 400,
                        }}
                      >
                        {circuit.label}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${(circuit.kwh / maxKwh) * 100}%`,
                            height: "100%",
                            background:
                              i === 0
                                ? "#FBBF24"
                                : i < 3
                                  ? "#7DD3FC"
                                  : "#334155",
                            borderRadius: 3,
                            transition: "width 0.6s ease",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 9,
                          color: i === 0 ? "#FBBF24" : "#475569",
                          minWidth: 40,
                          textAlign: "right",
                          fontWeight: i === 0 ? 600 : 400,
                        }}
                      >
                        {circuit.kwh.toFixed(1)} kWh
                      </span>
                    </div>
                  ))}

                  {circuitTotals.length > 0 && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "#475569",
                        marginTop: 8,
                        textAlign: "center",
                      }}
                    >
                      {circuitTotals[0].label} used{" "}
                      {((circuitTotals[0].kwh / totalKwh) * 100).toFixed(0)}% of
                      total circuit energy in the last 48h
                    </div>
                  )}

                  <div
                    style={{
                      borderTop: "1px solid rgba(255,255,255,0.05)",
                      margin: "14px 0",
                    }}
                  />
                  <div
                    style={{
                      fontSize: 9,
                      color: "#334155",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Daily comparison
                  </div>
                  <div
                    style={{ fontSize: 11, color: "#64748B", marginBottom: 8 }}
                  >
                    How does today compare to yesterday?
                  </div>

                  {mainFrames.length < 2 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "16px 0",
                        color: "#334155",
                        fontSize: 11,
                      }}
                    >
                      Play the Energy tab first to load building data
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <div
                          style={{
                            flex: 1,
                            background: "rgba(15,23,42,0.6)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            borderRadius: 8,
                            padding: 12,
                            textAlign: "center",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 9,
                              color: "#334155",
                              textTransform: "uppercase",
                            }}
                          >
                            Yesterday
                          </div>
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 700,
                              color: "#64748B",
                              marginTop: 4,
                            }}
                          >
                            {yesterdayKwh.toFixed(0)} kWh
                          </div>
                          <div style={{ fontSize: 10, color: "#475569" }}>
                            \u20AC{(yesterdayKwh * tariffRate).toFixed(2)}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0 8px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 20,
                              color:
                                diffPct < 0
                                  ? "#4ADE80"
                                  : diffPct > 10
                                    ? "#EF4444"
                                    : "#FBBF24",
                            }}
                          >
                            {diffPct < -2 ? "↓" : diffPct > 2 ? "↑" : "→"}
                          </div>
                          <div
                            style={{
                              fontSize: 9,
                              color:
                                diffPct < 0
                                  ? "#4ADE80"
                                  : diffPct > 0
                                    ? "#EF4444"
                                    : "#475569",
                              fontWeight: 600,
                            }}
                          >
                            {Math.abs(diffPct).toFixed(0)}%
                          </div>
                        </div>

                        <div
                          style={{
                            flex: 1,
                            background: "rgba(15,23,42,0.6)",
                            border: "1px solid rgba(125,211,252,0.15)",
                            borderRadius: 8,
                            padding: 12,
                            textAlign: "center",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 9,
                              color: "#7DD3FC",
                              textTransform: "uppercase",
                            }}
                          >
                            Today (so far)
                          </div>
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 700,
                              color:
                                todayKwh < yesterdayKwh ? "#4ADE80" : "#F8FAFC",
                              marginTop: 4,
                            }}
                          >
                            {todayKwh.toFixed(0)} kWh
                          </div>
                          <div style={{ fontSize: 10, color: "#475569" }}>
                            \u20AC{(todayKwh * tariffRate).toFixed(2)}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          color: "#64748B",
                          textAlign: "center",
                          marginTop: 8,
                          lineHeight: 1.5,
                        }}
                      >
                        {todayVsLine}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

          {replayMode === "scenarios" && (
            <ScenarioPanel
              replayDataRef={replayDataRef}
              pvDataRef={pvDataRef}
              tariffRate={tariffRate}
              setTariffRate={setTariffRate}
              occupancyLevel={occupancyLevel}
              setOccupancyLevel={setOccupancyLevel}
              carbonPrice={carbonPrice}
              setCarbonPrice={setCarbonPrice}
              scenarioGoal={scenarioGoal}
              setScenarioGoal={setScenarioGoal}
              appliedScenarios={appliedScenarios}
              setAppliedScenarios={setAppliedScenarios}
              scenarioResult={scenarioResult}
              setScenarioResult={setScenarioResult}
              activeRoleProp={activeRole}
            />
          )}

          {replayMode === "forecast" && (
            <ForecastPanel
              getPowerJson={getPowerJson}
              circuitConfigs={CIRCUIT_CONFIGS}
              selectStyle={selectStyle}
            />
          )}
        </div>
      )}

      {showOriginalPanels && showControls && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 15,
            width: 240,
            maxHeight: "calc(100% - 32px)",
            overflow: "auto",
            ...PS,
            padding: 14,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: "#E2E8F0",
              marginBottom: 12,
            }}
          >
            Building Twin
          </div>
          <Btn onClick={zoomToBuilding} full>
            ↺ Whole Building
          </Btn>
          <Btn onClick={showExteriorModel} full accent style={{ marginTop: 6 }}>
            🧱 Show 3D Model
          </Btn>
          {!i3sAvailable && (
            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                lineHeight: 1.5,
                color: "#FCA5A5",
                background: "rgba(127,29,29,0.25)",
                border: "1px solid rgba(248,113,113,0.45)",
                borderRadius: 6,
                padding: "6px 8px",
              }}
            >
              3D model source is unavailable right now. Showing room geometry
              fallback.
            </div>
          )}
          <SL>Heatmap</SL>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              marginBottom: 5,
            }}
          >
            {HEATMAP_METRICS.map(({ key, icon, label }) => (
              <Btn
                key={key}
                onClick={() => showHeatmap(key)}
                active={activeHeatmap === key}
              >
                {icon} {label}
              </Btn>
            ))}
          </div>
          <Btn
            onClick={() => {
              resetStyles();
              showOnly(() => false);
              if (i3sRef.current) {
                i3sRef.current.show = true;
              } else {
                roomEntitiesRef.current.forEach((e) => {
                  e.show = true;
                });
              }
            }}
            full
            style={{ marginBottom: 6 }}
          >
            {" "}
            Clear
          </Btn>
          <Hr />
          <Btn onClick={showAlerts} danger full style={{ marginBottom: 6 }}>
            ⚠ Show Alerts
          </Btn>
          <SL>Sensors</SL>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <Btn onClick={() => showSensorMarkers("all")} accent>
              📡 Show
            </Btn>
            <Btn onClick={hideSensorMarkers}>✕ Hide</Btn>
          </div>
          <Hr />
          <SL>Floors</SL>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 3,
              marginBottom: 4,
            }}
          >
            {availableFloors.map((floor) => (
              <Btn key={floor} onClick={() => zoomToFloor(floor)}>
                FL {floor}
              </Btn>
            ))}
          </div>
          <SL>Room</SL>
          <input
            type="text"
            value={searchQuery}
            placeholder="Search room or circuit..."
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") searchAndNavigate(searchQuery);
            }}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              marginBottom: 6,
              background: "rgba(15,23,42,0.92)",
              color: "#E2F1FF",
              border: "1px solid rgba(125,211,252,0.42)",
              fontFamily: UI_FONT_STACK,
              fontSize: 12,
              outline: "none",
            }}
          />
          <Btn
            onClick={() => searchAndNavigate(searchQuery)}
            full
            accent
            style={{ marginBottom: 6 }}
          >
            Search
          </Btn>
          <select
            value={selectedRoom}
            onChange={(e) => setSelectedRoom(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select room...</option>
            {availableRooms.map((r) => (
              <option
                key={`${r.roomNumber}-${r.floorLevel}`}
                value={r.roomNumber}
              >
                {r.roomNumber} — {r.roomName} (F{r.floorLevel})
              </option>
            ))}
          </select>
          <Btn
            onClick={() => {
              if (selectedRoom) zoomToRoom(selectedRoom);
            }}
            full
            active={!!selectedRoom}
            style={{
              opacity: selectedRoom ? 1 : 0.4,
              cursor: selectedRoom ? "pointer" : "not-allowed",
              marginBottom: 4,
            }}
          >
            Zoom to Room
          </Btn>
          <SL>Circuit</SL>
          <select
            value={selectedCircuit}
            onChange={(e) => setSelectedCircuit(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select circuit...</option>
            {Object.entries(CIRCUIT_CONFIGS).map(([id, cfg]) => (
              <option key={id} value={id}>
                {cfg.label}
              </option>
            ))}
          </select>
          <Btn
            onClick={() => {
              if (selectedCircuit) zoomToCircuit(selectedCircuit);
            }}
            full
            active={!!selectedCircuit}
            style={{
              opacity: selectedCircuit ? 1 : 0.4,
              cursor: selectedCircuit ? "pointer" : "not-allowed",
            }}
          >
            Zoom to Circuit
          </Btn>
          <Hr />
        </div>
      )}

      <RolePanel
        replayData={replayDataRef.current}
        climateData={climateReplayDataRef.current}
        pvData={pvDataRef.current}
        outsideTemp={outsideTempRef.current}
        availableRooms={availableRooms}
        availableFloors={availableFloors}
        onClose={() => setShowRolePanel(false)}
        tariffRate={tariffRate || 0.22}
        visible={rolePanelVisible}
        onRoleChange={(roleId) => setActiveRole(roleId)}
        onExpertMode={() => {
          setExpertMode(true);
          setShowRolePanel(false);
          localStorage.setItem("dtwin_expert", "1");
        }}
        onZoomToCircuit={zoomToCircuit}
        initialRole={activeRole}
        leftOffset={showOriginalPanels && showControls ? 272 : 16}
        activeHeatmap={activeHeatmap}
      />

      {faultPanelOpen &&
        (activeRole === "director" || activeRole === "facilities") && (
          <div style={{ position: "absolute", top: 60, left: 16, zIndex: 25 }}>
            <FaultPanel
              faults={faults}
              summary={faultSummary}
              faultHistory={faultHistory}
              clearHistory={clearFaultHistory}
              replayFrame={animFrame}
              onClose={() => setFaultPanelOpen(false)}
            />
          </div>
        )}

      {analyticsOpen && (
        <EnergyAnalyticsPanel
          onClose={() => setAnalyticsOpen(false)}
          getPowerJson={getPowerJson}
          circuitConfigs={CIRCUIT_CONFIGS}
        />
      )}

      {buildingSummary &&
        activeHeatmap &&
        (() => {
          const dp =
            buildingSummary.metric === "co2" ||
            buildingSummary.metric === "occupancy"
              ? 0
              : 1;
          const fmt = (v) => Number(v).toFixed(dp) + buildingSummary.unit;
          const { min, max, avg, alertCount, best, worst } = buildingSummary;
          const fi = Math.min(animFrame, Math.max(0, animFrameCount - 1));
          const ts = animFramesRef.current[fi]?.label;
          const dayLbl =
            animFrameCount > 96
              ? fi < animFrameCount / 2
                ? "Day 1"
                : "Day 2"
              : null;
          return (
            <div
              style={{
                position: "absolute",
                bottom: 116,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 20,
                pointerEvents: "none",
                background: "rgba(10,15,30,0.92)",
                border: "1px solid rgba(125,211,252,0.2)",
                borderRadius: 8,
                padding: "6px 12px",
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                display: "flex",
                gap: 6,
                alignItems: "stretch",
              }}
            >
              {/* MIN */}
              <div
                style={{
                  textAlign: "center",
                  minWidth: 110,
                  background: "rgba(16,185,129,0.08)",
                  border: "1px solid rgba(52,211,153,0.25)",
                  borderRadius: 6,
                  padding: "5px 8px",
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: "#6EE7B7",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: 1,
                  }}
                >
                  ▼ Min Room
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#34D399",
                    lineHeight: 1.2,
                  }}
                >
                  {fmt(min)}
                </div>
                <div
                  style={{
                    fontSize: 8,
                    color: "#6EE7B7",
                    marginTop: 2,
                    maxWidth: 106,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                  }}
                >
                  {best?.name ?? "—"}
                </div>
                <div style={{ fontSize: 7, color: "#334155", marginTop: 1 }}>
                  Floor {best?.floor ?? "-"}
                </div>
              </div>
              {/* AVG */}
              <div
                style={{
                  textAlign: "center",
                  minWidth: 90,
                  background: "rgba(37,99,235,0.1)",
                  border: "1px solid rgba(96,165,250,0.25)",
                  borderRadius: 6,
                  padding: "5px 8px",
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: "#93C5FD",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: 1,
                  }}
                >
                  ≈ Avg
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#60A5FA",
                    lineHeight: 1.2,
                  }}
                >
                  {fmt(avg)}
                </div>
                <div style={{ fontSize: 7, color: "#475569", marginTop: 2 }}>
                  35 rooms
                </div>
              </div>
              {/* MAX */}
              <div
                style={{
                  textAlign: "center",
                  minWidth: 110,
                  background: "rgba(220,38,38,0.08)",
                  border: "1px solid rgba(248,113,113,0.25)",
                  borderRadius: 6,
                  padding: "5px 8px",
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: "#FCA5A5",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: 1,
                  }}
                >
                  ▲ Max Room
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#F87171",
                    lineHeight: 1.2,
                  }}
                >
                  {fmt(max)}
                </div>
                <div
                  style={{
                    fontSize: 8,
                    color: "#FCA5A5",
                    marginTop: 2,
                    maxWidth: 106,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                  }}
                >
                  {worst?.name ?? "—"}
                </div>
                <div style={{ fontSize: 7, color: "#334155", marginTop: 1 }}>
                  Floor {worst?.floor ?? "-"}
                </div>
              </div>
              {/* ALERTS */}
              <div
                style={{
                  textAlign: "center",
                  minWidth: 60,
                  background:
                    alertCount > 0
                      ? "rgba(180,83,9,0.13)"
                      : "rgba(16,185,129,0.07)",
                  border: `1px solid ${alertCount > 0 ? "rgba(251,191,36,0.35)" : "rgba(74,222,128,0.2)"}`,
                  borderRadius: 6,
                  padding: "5px 8px",
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: alertCount > 0 ? "#FCD34D" : "#86EFAC",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: 1,
                  }}
                >
                  ⚠ Alerts
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: alertCount > 0 ? "#FBBF24" : "#4ADE80",
                    lineHeight: 1.2,
                  }}
                >
                  {alertCount}
                </div>
                <div style={{ fontSize: 7, color: "#475569", marginTop: 2 }}>
                  rooms
                </div>
              </div>
              {/* Timestamp */}
              {ts && (
                <div
                  style={{
                    textAlign: "center",
                    minWidth: 52,
                    background: "rgba(30,58,138,0.18)",
                    border: "1px solid rgba(96,165,250,0.2)",
                    borderRadius: 6,
                    padding: "5px 8px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                  }}
                >
                  {dayLbl && (
                    <div
                      style={{
                        fontSize: 7,
                        color: "#93C5FD",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        marginBottom: 2,
                        fontWeight: 700,
                      }}
                    >
                      {dayLbl}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 7,
                      color: "#60A5FA",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      marginBottom: 2,
                    }}
                  >
                    Time
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#BAE6FD",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {ts}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      {activeHeatmap &&
        (() => {
          const LEGENDS = {
            temperature: {
              stops: ["#3B82F6", "#22C55E", "#FB923C", "#EF4444"],
              min: "15°C",
              mid: "22°C",
              max: "30°C",
              label: "Temperature",
            },
            co2: {
              stops: ["#22C55E", "#FACC15", "#EF4444"],
              min: "400",
              mid: "800",
              max: "1200 ppm",
              label: "CO₂",
            },
            humidity: {
              stops: ["#EF4444", "#22C55E", "#3B82F6"],
              min: "20%",
              mid: "50%",
              max: "80%",
              label: "Humidity",
            },
          };
          const leg = LEGENDS[activeHeatmap];
          if (!leg) return null;
          const gradId = `lg-${activeHeatmap}`;
          return (
            <div
              style={{
                position: "absolute",
                bottom: buildingSummary ? 192 : 116,
                right: 16,
                zIndex: 20,
                background: "rgba(10,15,30,0.90)",
                border: "1px solid rgba(125,211,252,0.2)",
                borderRadius: 8,
                padding: "10px 12px",
                backdropFilter: "blur(10px)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
                minWidth: 130,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "#7DD3FC",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {leg.label}
              </div>
              <svg
                width="106"
                height="14"
                style={{ display: "block", borderRadius: 3, marginBottom: 4 }}
              >
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                    {leg.stops.map((c, i) => (
                      <stop
                        key={i}
                        offset={`${(i / (leg.stops.length - 1)) * 100}%`}
                        stopColor={c}
                      />
                    ))}
                  </linearGradient>
                </defs>
                <rect
                  x="0"
                  y="0"
                  width="106"
                  height="14"
                  fill={`url(#${gradId})`}
                  rx="2"
                />
              </svg>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 9,
                  color: "#94A3B8",
                }}
              >
                <span>{leg.min}</span>
                <span>{leg.mid}</span>
                <span>{leg.max}</span>
              </div>
            </div>
          );
        })()}

      {animReady && activeHeatmap && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            background: "rgba(10,15,30,0.92)",
            border: "1px solid rgba(125,211,252,0.22)",
            borderRadius: 12,
            padding: "10px 16px",
            backdropFilter: "blur(12px)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "center",
            minWidth: 420,
          }}
        >
          {/* Row 1 — metric selector */}
          <div
            style={{
              display: "flex",
              gap: 6,
              width: "100%",
              justifyContent: "center",
            }}
          >
            {HEATMAP_METRICS.map(({ key, icon, label }) => (
              <button
                key={key}
                onClick={() => showHeatmap(key)}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  border: `1px solid ${activeHeatmap === key ? "rgba(125,211,252,0.7)" : "rgba(125,211,252,0.18)"}`,
                  background:
                    activeHeatmap === key
                      ? "rgba(37,99,235,0.4)"
                      : "rgba(255,255,255,0.07)",
                  color: activeHeatmap === key ? "#BAE6FD" : "#94A3B8",
                  transition: "all 0.15s",
                }}
              >
                {icon} {label}
              </button>
            ))}
            {activeHeatmap && (
              <button
                onClick={() => {
                  resetStyles();
                  showOnly(() => false);
                  if (i3sRef.current) {
                    i3sRef.current.show = true;
                  } else {
                    roomEntitiesRef.current.forEach((e) => {
                      e.show = true;
                    });
                  }
                }}
                style={{
                  padding: "5px 10px",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  border: "1px solid rgba(248,113,113,0.35)",
                  background: "rgba(127,29,29,0.25)",
                  color: "#FCA5A5",
                }}
              >
                ✖
              </button>
            )}
          </div>
          {/* Row 2 — playback controls + scrubber + timestamp */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
            }}
          >
            <button
              onClick={() => setAnimPlaying((p) => !p)}
              style={{
                background: animPlaying
                  ? "rgba(59,130,246,0.4)"
                  : "rgba(255,255,255,0.1)",
                border: `1px solid ${animPlaying ? "rgba(96,165,250,0.6)" : "rgba(125,211,252,0.3)"}`,
                borderRadius: 7,
                color: "#E2F1FF",
                fontSize: 15,
                width: 34,
                height: 28,
                cursor: "pointer",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {animPlaying ? "⏸" : "▶"}
            </button>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <input
                type="range"
                min={0}
                max={Math.max(0, animFrameCount - 1)}
                value={Math.min(animFrame, Math.max(0, animFrameCount - 1))}
                onChange={(e) => {
                  const f = Number(e.target.value);
                  setAnimFrame(f);
                  applyAnimFrame(f);
                }}
                style={{
                  width: "100%",
                  accentColor: "#3B82F6",
                  cursor: "pointer",
                  margin: 0,
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 9,
                  color: "#475569",
                  paddingLeft: 2,
                  paddingRight: 2,
                }}
              >
                {animTickLabels.map((t, i) => (
                  <span key={`${i}-${t}`}>{t}</span>
                ))}
              </div>
            </div>
            {/* Timestamp badge — Day 1 / Day 2 when timeline is longer than 24h (15-min steps) */}
            <div
              style={{
                background: "rgba(30,58,138,0.5)",
                border: "1px solid rgba(96,165,250,0.4)",
                borderRadius: 7,
                padding: "4px 10px",
                textAlign: "center",
                flexShrink: 0,
                minWidth: 56,
              }}
            >
              {(() => {
                const n = animFrameCount;
                const f = Math.min(animFrame, Math.max(0, n - 1));
                const showDay = n > 96;
                const dayPart = showDay
                  ? f < n / 2
                    ? "Day 1"
                    : "Day 2"
                  : null;
                return (
                  <>
                    {dayPart && (
                      <div
                        style={{
                          fontSize: 8,
                          color: "#93C5FD",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          marginBottom: 2,
                          fontWeight: 700,
                        }}
                      >
                        {dayPart}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 9,
                        color: "#60A5FA",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        marginBottom: 1,
                      }}
                    >
                      Time
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#E2F1FF",
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {animFramesRef.current[f]?.label ?? "00:00"}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Compare floors overlay */}
      <div
        id="compare-overlay"
        style={{
          display: "none",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 19,
        }}
      >
        {/* Centre divider */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 2,
            height: "100%",
            background: "rgba(255,255,255,0.45)",
          }}
        />

        <div
          id="compare-label-a"
          style={{
            position: "absolute",
            top: 60,
            left: 16,
            background: "rgba(0,0,0,0.65)",
            color: "#7DD3FC",
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            border: "1px solid rgba(125,211,252,0.3)",
          }}
        />

        <div
          id="compare-label-b"
          style={{
            position: "absolute",
            top: 60,
            right: 16,
            background: "rgba(0,0,0,0.65)",
            color: "#7DD3FC",
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            border: "1px solid rgba(125,211,252,0.3)",
          }}
        />

        {/* Legend + exit */}
        <div
          style={{
            position: "absolute",
            bottom: 76,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(10,15,30,0.9)",
            color: "#E2F1FF",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid rgba(125,211,252,0.25)",
            pointerEvents: "auto",
          }}
        >
          <span
            id="compare-legend-min"
            style={{ color: "#3B82F6", fontWeight: 700 }}
          />
          <div
            style={{
              width: 80,
              height: 8,
              borderRadius: 4,
              background:
                "linear-gradient(to right,#3B82F6,#22C55E,#FB923C,#EF4444)",
            }}
          />
          <span
            id="compare-legend-max"
            style={{ color: "#EF4444", fontWeight: 700 }}
          />
          <button
            type="button"
            onClick={() => {
              document.getElementById("compare-overlay").style.display = "none";
              // Remove the cloned side-by-side entities
              if (viewerRef.current?._compareEntities) {
                viewerRef.current._compareEntities.forEach((e) => {
                  try {
                    viewerRef.current.entities.remove(e);
                  } catch {
                    /* ignore */
                  }
                });
                viewerRef.current._compareEntities = [];
              }
              resetStyles();
              roomEntitiesRef.current.forEach((e) => {
                e.show = false;
              });
              if (i3sRef.current) i3sRef.current.show = true;
            }}
            style={{
              marginLeft: 8,
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              padding: "4px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: UI_FONT_STACK,
            }}
          >
            ✖ Exit comparison
          </button>
        </div>
      </div>
    </div>
  );
}

async function getPowerJson(path, params = {}) {
  if (path !== "power_5min") return []; // forecast tables not available in Gate API

  const cidParam = String(params.circuit_id || "");
  let circuitIds = [];
  if (cidParam.startsWith("eq.")) {
    const raw = cidParam.slice(3);
    circuitIds = [raw === "x3dled" ? "3DLED" : raw];
  } else if (cidParam.startsWith("in.(")) {
    circuitIds = cidParam
      .slice(4, -1)
      .split(",")
      .map((id) => id.trim())
      .map((id) => (id === "x3dled" ? "3DLED" : id));
  }

  if (!circuitIds.length) {
    // Query without circuit filter (e.g. "get latest ts") — return current timestamp
    return [{ ts_5min: new Date().toISOString() }];
  }

  // Parse date range from the "and" parameter: "(ts_5min.gte.ISO,ts_5min.lte.ISO)"
  let startDate = new Date(Date.now() - 24 * 3600 * 1000);
  let endDate = new Date();
  const andStr = String(params.and || "");
  const gteMatch = andStr.match(/ts_5min\.gte\.([^,)]+)/);
  const lteMatch = andStr.match(/ts_5min\.lte\.([^,)]+)/);
  if (gteMatch) startDate = new Date(gteMatch[1]);
  if (lteMatch) endDate = new Date(lteMatch[1]);

  const dateRange = {
    start_date: toSofiaDateString(startDate),
    end_date: toSofiaDateString(endDate),
  };

  try {
    return await fetchElectricityForCircuits(circuitIds, dateRange);
  } catch (e) {
    console.warn("[getPowerJson] Gate API fetch failed:", e.message);
    return [];
  }
}

function pearsonCorrelation(points) {
  const clean = (Array.isArray(points) ? points : []).filter(
    (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y),
  );
  const n = clean.length;
  if (n < 2) return NaN;
  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumYY = 0,
    sumXY = 0;
  clean.forEach(({ x, y }) => {
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
  });
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  return den ? num / den : NaN;
}
