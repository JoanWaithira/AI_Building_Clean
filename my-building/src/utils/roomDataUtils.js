// Room Data Utilities - Manages room sensor data via the Gate Building API

import { gateGet } from "../services/gateBuildingApiClient.js";
import {
  mapSensorFloorResponse,
  buildAllRoomLatestStates,
  FLOOR_ROOMS,
} from "../services/gateBuildingMappers.js";
import { fetchAllSensors } from "../services/gateBuildingRepository.js";
import { toSofiaDateString } from "./timeUtils.js";

/**
 * Normalize GeoJSON / BMS room numbers the same way as replay & Cesium (e.g. "302" → "3.02").
 */
export function toReplayRoomKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const asDotted = raw.match(/^(-?\d+)\.(\d+)$/);
  if (asDotted) return `${parseInt(asDotted[1], 10)}.${asDotted[2].padStart(2, "0")}`;
  const compact3 = raw.match(/^(-?\d)(\d{2})$/);
  if (compact3) return `${compact3[1]}.${compact3[2]}`;
  return raw;
}

/** Legacy PDF/training grid rooms → Gate floor + room_id (superseded by GeoJSON role map where they conflict). */
const LEGACY_ROOM_KEY_TO_GATE = {
  "1.02": { floor: 1, room: "hall_sap" },
  "1.04": { floor: 1, room: "training_lab" },
  "1.05": { floor: 1, room: "training_lab" },
  "1.07": { floor: 1, room: "visualisation" },
  "1.09": { floor: 1, room: "meeting_room" },
  "1.10": { floor: 1, room: "visualisation" },
  "2.01": { floor: 1, room: "hall_sap" },
  "2.02": { floor: 1, room: "training_lab" },
  "2.04": { floor: 1, room: "training_lab" },
  "2.05": { floor: 1, room: "visualisation" },
  "2.07": { floor: 1, room: "meeting_room" },
  "2.08": { floor: 2, room: "cabinet_1" },
  "3.01": { floor: 1, room: "hall_sap" },
  "3.02": { floor: 1, room: "training_lab" },
  "3.04": { floor: 1, room: "training_lab" },
  "3.05": { floor: 1, room: "visualisation" },
  "3.07": { floor: 1, room: "meeting_room" },
  "3.08": { floor: 1, room: "visualisation" },
  "4.01": { floor: 1, room: "hall_sap" },
  "4.02": { floor: 1, room: "training_lab" },
  "4.04": { floor: 1, room: "training_lab" },
  "4.05": { floor: 1, room: "visualisation" },
  "4.07": { floor: 1, room: "meeting_room" },
  "4.08": { floor: 2, room: "cabinet_1" },
};

/**
 * Role label → Gate `room_id` when it is not `roleKey.replace(/ /g, "_")`.
 * Aligned with `FLOOR_ROOMS` in gateBuildingMappers.js.
 */
const ROLE_KEY_TO_GATE_ROOM = {
  foyer: "hall_sap",
  "open workspace": "training_lab",
  "training lab": "training_lab",
  "seminar hall": "visualisation",
  "rest room": "recreation_hall",
  "deputy director 1": "assist_director_2",
  "deputy director 2": "assist_director_3",
  "deputy director 3": "assistant",
  "accountant 1": "business",
  "accountant 2": "office_1",
  "office manager": "host",
  "fl3 waiting area": "waiting_area",
  "office 1": "office_1",
  "office 2": "business",
  wardrobe: "hr",
  "pr officer": "assistant",
  "meeting hall": "meeting",
  assistant: "assistant",
  cabinet: "office_1",
  "cabinet 2": "cabinet_3",
  "cabinet 3": "cabinet_5",
  "cabinet 4": "cabinet_6",
  "cabinet 5": "cabinet_7",
  "cabinet 6": "cabinet_8",
  "cabinet 7": "cabinet_9",
  "cabinet 8": "cabinet_8",
  "cabinet 9": "cabinet_9",
};

function apiFloorsForRoomId(roomId) {
  const rid = String(roomId || "").toLowerCase();
  const out = [];
  Object.entries(FLOOR_ROOMS).forEach(([floorStr, rooms]) => {
    if (rooms.some((r) => String(r).toLowerCase() === rid)) out.push(Number(floorStr));
  });
  return out;
}

function resolveApiFloorForRoom(roomId, preferredBuildingFloor) {
  const floors = apiFloorsForRoomId(roomId);
  if (!floors.length) return null;
  if (preferredBuildingFloor != null && floors.includes(preferredBuildingFloor)) return preferredBuildingFloor;
  return floors[0];
}

function defaultGateRoomIdFromRoleKey(roleKey) {
  const k = String(roleKey || "").trim().toLowerCase();
  if (ROLE_KEY_TO_GATE_ROOM[k]) return ROLE_KEY_TO_GATE_ROOM[k];
  return k.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** Build GeoJSON roomNumber → { floor, room } from ROLE_ROOM_MAP + FLOOR_ROOMS. */
function buildRoleRoomKeyToGate(roleRoomMap) {
  const out = {};
  Object.entries(roleRoomMap || {}).forEach(([roleKey, info]) => {
    const rn = String(info?.roomNumber ?? "").trim();
    if (!rn) return;
    const gateRoom = defaultGateRoomIdFromRoleKey(roleKey);
    const floor = resolveApiFloorForRoom(gateRoom, info.floor);
    if (floor == null) return;
    const keys = new Set([rn, toReplayRoomKey(rn)]);
    keys.forEach((k) => {
      if (k) out[k] = { floor, room: gateRoom };
    });
  });
  return out;
}

// Static room metadata (area, type, circuits, etc.) - Data from Rooms_details_GATE.pdf
const ROOM_METADATA = {
  // Floor 1 Rooms
  "1.02": { 
    floor: 1, area: 156.8, occupancy: 12, circuits: ["circuit10", "airconditioner1", "3DLED"], type: "Office/Meeting",
    volume: 440, monthlyHours: 173, avgOccupancy: 12,
    lighting: "32 ceiling lights (LED)", acUnits: 4,
    temperature: 22.5, humidity: 45,
    energy: { lighting: 9.92, plugs: 38.25, ac: 627.5, total: 675.67, perM2: 4.31 }
  },
  "1.04": { 
    floor: 1, area: 89.4, occupancy: 6, circuits: ["circuit11", "airconditioner2"], type: "Office",
    volume: 250, monthlyHours: 173, avgOccupancy: 6,
    lighting: "18 ceiling lights (LED)", acUnits: 3,
    temperature: 23.0, humidity: 42,
    energy: { lighting: 5.58, plugs: 31.88, ac: 357.6, total: 395.06, perM2: 4.42 }
  },
  "1.05": { 
    floor: 1, area: 67.3, occupancy: 4, circuits: ["circuit12", "airconditioner1"], type: "Office",
    volume: 189, monthlyHours: 173, avgOccupancy: 4,
    lighting: "14 ceiling lights (LED)", acUnits: 2,
    temperature: 22.8, humidity: 44,
    energy: { lighting: 4.34, plugs: 17.94, ac: 269.2, total: 291.48, perM2: 4.33 }
  },
  "1.07": { 
    floor: 1, area: 201.5, occupancy: 15, circuits: ["circuit10", "airconditioner2", "3DLED"], type: "Open Office",
    volume: 565, monthlyHours: 173, avgOccupancy: 15,
    lighting: "40 ceiling lights (LED)", acUnits: 5,
    temperature: 23.2, humidity: 43,
    energy: { lighting: 12.4, plugs: 67.28, ac: 806, total: 885.68, perM2: 4.40 }
  },
  "1.09": { 
    floor: 1, area: 38.9, occupancy: 2, circuits: ["circuit7"], type: "Meeting Room",
    volume: 109, monthlyHours: 86.6, avgOccupancy: 2,
    lighting: "8 ceiling lights (LED)", acUnits: 1,
    temperature: 21.5, humidity: 48,
    energy: { lighting: 1.66, plugs: 4.33, ac: 77.8, total: 83.79, perM2: 2.15 }
  },
  "1.10": { 
    floor: 1, area: 78.2, occupancy: 5, circuits: ["circuit8", "airconditioner1"], type: "Office",
    volume: 219, monthlyHours: 173, avgOccupancy: 5,
    lighting: "16 ceiling lights (LED)", acUnits: 2,
    temperature: 22.6, humidity: 43,
    energy: { lighting: 4.96, plugs: 22.41, ac: 312.8, total: 340.17, perM2: 4.35 }
  },
  
  // Floor 2 Rooms
  "2.01": { 
    floor: 2, area: 167.9, occupancy: 13, circuits: ["circuit11", "airconditioner2", "3DLED"], type: "Open Office",
    volume: 471, monthlyHours: 173, avgOccupancy: 13,
    lighting: "34 ceiling lights (LED)", acUnits: 4,
    temperature: 23.1, humidity: 44,
    energy: { lighting: 10.54, plugs: 58.32, ac: 671.6, total: 740.46, perM2: 4.41 }
  },
  "2.02": { 
    floor: 2, area: 94.3, occupancy: 7, circuits: ["circuit12", "airconditioner1"], type: "Office",
    volume: 264, monthlyHours: 173, avgOccupancy: 7,
    lighting: "19 ceiling lights (LED)", acUnits: 3,
    temperature: 22.9, humidity: 45,
    energy: { lighting: 5.89, plugs: 31.38, ac: 377.2, total: 414.47, perM2: 4.40 }
  },
  "2.04": { 
    floor: 2, area: 72.1, occupancy: 5, circuits: ["circuit9", "airconditioner2"], type: "Office",
    volume: 202, monthlyHours: 173, avgOccupancy: 5,
    lighting: "15 ceiling lights (LED)", acUnits: 2,
    temperature: 22.7, humidity: 46,
    energy: { lighting: 4.65, plugs: 22.41, ac: 288.4, total: 315.46, perM2: 4.37 }
  },
  "2.05": { 
    floor: 2, area: 215.3, occupancy: 16, circuits: ["circuit10", "airconditioner1", "3DLED"], type: "Open Office",
    volume: 603, monthlyHours: 173, avgOccupancy: 16,
    lighting: "43 ceiling lights (LED)", acUnits: 5,
    temperature: 23.3, humidity: 42,
    energy: { lighting: 13.33, plugs: 71.74, ac: 861.2, total: 946.27, perM2: 4.39 }
  },
  "2.07": { 
    floor: 2, area: 41.2, occupancy: 2, circuits: ["circuit7"], type: "Meeting Room",
    volume: 115, monthlyHours: 86.6, avgOccupancy: 2,
    lighting: "8 ceiling lights (LED)", acUnits: 1,
    temperature: 21.8, humidity: 47,
    energy: { lighting: 1.66, plugs: 4.33, ac: 82.4, total: 88.39, perM2: 2.15 }
  },
  "2.08": { 
    floor: 2, area: 82.7, occupancy: 6, circuits: ["circuit8", "airconditioner2"], type: "Office",
    volume: 232, monthlyHours: 173, avgOccupancy: 6,
    lighting: "17 ceiling lights (LED)", acUnits: 2,
    temperature: 22.8, humidity: 44,
    energy: { lighting: 5.27, plugs: 26.88, ac: 330.8, total: 362.95, perM2: 4.39 }
  },
  
  // Floor 3 Rooms
  "3.01": { 
    floor: 3, area: 178.4, occupancy: 14, circuits: ["circuit11", "airconditioner1", "3DLED"], type: "Open Office",
    volume: 500, monthlyHours: 173, avgOccupancy: 14,
    lighting: "36 ceiling lights (LED)", acUnits: 4,
    temperature: 23.4, humidity: 41,
    energy: { lighting: 11.16, plugs: 62.78, ac: 713.6, total: 787.54, perM2: 4.41 }
  },
  "3.02": { 
    floor: 3, area: 99.5, occupancy: 8, circuits: ["circuit12", "airconditioner2"], type: "Office",
    volume: 279, monthlyHours: 173, avgOccupancy: 8,
    lighting: "20 ceiling lights (LED)", acUnits: 3,
    temperature: 23.0, humidity: 43,
    energy: { lighting: 6.2, plugs: 35.85, ac: 398, total: 440.05, perM2: 4.42 }
  },
  "3.04": { 
    floor: 3, area: 76.8, occupancy: 5, circuits: ["circuit9", "airconditioner1"], type: "Office",
    volume: 215, monthlyHours: 173, avgOccupancy: 5,
    lighting: "15 ceiling lights (LED)", acUnits: 2,
    temperature: 22.5, humidity: 45,
    energy: { lighting: 4.65, plugs: 22.41, ac: 307.2, total: 334.26, perM2: 4.35 }
  },
  "3.05": { 
    floor: 3, area: 228.6, occupancy: 17, circuits: ["circuit10", "airconditioner2", "3DLED"], type: "Open Office",
    volume: 640, monthlyHours: 173, avgOccupancy: 17,
    lighting: "46 ceiling lights (LED)", acUnits: 6,
    temperature: 23.6, humidity: 40,
    energy: { lighting: 14.26, plugs: 76.21, ac: 914.4, total: 1004.87, perM2: 4.40 }
  },
  "3.07": { 
    floor: 3, area: 44.3, occupancy: 3, circuits: ["circuit7"], type: "Meeting Room",
    volume: 124, monthlyHours: 86.6, avgOccupancy: 3,
    lighting: "9 ceiling lights (LED)", acUnits: 1,
    temperature: 21.6, humidity: 49,
    energy: { lighting: 1.87, plugs: 6.50, ac: 88.6, total: 96.97, perM2: 2.19 }
  },
  "3.08": { 
    floor: 3, area: 88.2, occupancy: 6, circuits: ["circuit8", "airconditioner1"], type: "Office",
    volume: 247, monthlyHours: 173, avgOccupancy: 6,
    lighting: "18 ceiling lights (LED)", acUnits: 2,
    temperature: 22.9, humidity: 44,
    energy: { lighting: 5.58, plugs: 26.88, ac: 352.8, total: 385.26, perM2: 4.37 }
  },
  
  // Floor 4 Rooms
  "4.01": { 
    floor: 4, area: 186.2, occupancy: 15, circuits: ["circuit11", "airconditioner2", "3DLED"], type: "Open Office",
    volume: 522, monthlyHours: 173, avgOccupancy: 15,
    lighting: "37 ceiling lights (LED)", acUnits: 5,
    temperature: 23.5, humidity: 40,
    energy: { lighting: 11.47, plugs: 67.28, ac: 744.8, total: 823.55, perM2: 4.42 }
  },
  "4.02": { 
    floor: 4, area: 104.7, occupancy: 8, circuits: ["circuit12", "airconditioner1"], type: "Office",
    volume: 293, monthlyHours: 173, avgOccupancy: 8,
    lighting: "21 ceiling lights (LED)", acUnits: 3,
    temperature: 23.1, humidity: 42,
    energy: { lighting: 6.51, plugs: 35.85, ac: 418.8, total: 461.16, perM2: 4.40 }
  },
  "4.04": { 
    floor: 4, area: 81.4, occupancy: 6, circuits: ["circuit9", "airconditioner2"], type: "Office",
    volume: 228, monthlyHours: 173, avgOccupancy: 6,
    lighting: "16 ceiling lights (LED)", acUnits: 2,
    temperature: 22.6, humidity: 44,
    energy: { lighting: 4.96, plugs: 26.88, ac: 325.6, total: 357.44, perM2: 4.39 }
  },
  "4.05": { 
    floor: 4, area: 241.8, occupancy: 18, circuits: ["circuit10", "airconditioner1", "3DLED, ovk"], type: "Open Office",
    volume: 678, monthlyHours: 173, avgOccupancy: 18,
    lighting: "48 ceiling lights (LED)", acUnits: 6,
    temperature: 23.7, humidity: 39,
    energy: { lighting: 14.88, plugs: 80.67, ac: 967.2, total: 1062.75, perM2: 4.40 }
  },
  "4.07": { 
    floor: 4, area: 47.6, occupancy: 3, circuits: ["circuit7, ovk"], type: "Meeting Room",
    volume: 133, monthlyHours: 86.6, avgOccupancy: 3,
    lighting: "10 ceiling lights (LED)", acUnits: 1,
    temperature: 21.4, humidity: 50,
    energy: { lighting: 2.08, plugs: 6.50, ac: 95.2, total: 103.78, perM2: 2.18 }
  },
  "4.08": { 
    floor: 4, area: 93.8, occupancy: 7, circuits: ["circuit8", "airconditioner2"], type: "Office",
    volume: 263, monthlyHours: 173, avgOccupancy: 7,
    lighting: "19 ceiling lights (LED)", acUnits: 3,
    temperature: 23.0, humidity: 43,
    energy: { lighting: 5.89, plugs: 31.38, ac: 375.2, total: 412.47, perM2: 4.40 }
  }
};

// Authoritative role-to-room mapping, reconciled with actual GeoJSON geometry data
// Each entry verified against RoomName and RoomNumber in Floorplan_polygon_4326.geojson
export const ROLE_ROOM_MAP = {
  // Floor 0 (BldgLevel 2)
  "lobby":              { roomNumber: "0.01",  floor: 0, geojsonName: "ФОАЙЕ" },
  "conference room":    { roomNumber: "0.02",  floor: 0, geojsonName: "ЗАЛА ЗА КОНФЕРЕНЦИИ" },
  "kitchen":            { roomNumber: "0.04",  floor: 0, geojsonName: "ПРОСТРАНСТВО ЗА ХРАНЕНЕ" },
  
  // Floor 1 (BldgLevel 3) - Training and collaboration spaces
  "foyer":              { roomNumber: "-1.01", floor: 1, geojsonName: "ФОАЙЕ / ЗОНА ЗА ДИСКУСИИ" },
  "open workspace":     { roomNumber: "-1.02", floor: 1, geojsonName: "ОТВОРЕНО ПРОСТРАНСТВО ЗА РАБОТА" },
  "training lab":       { roomNumber: "1.03",  floor: 1, geojsonName: "ЛАБОРАТОРИЯ ЗА ОБУЧЕНИЕ" },
  "seminar hall":       { roomNumber: "1.10",  floor: 1, geojsonName: "ЗАЛА ЗА СЕМИНАРНИ СРЕЩИ" },
  
  // Floor 2 (BldgLevel 4) - Research and management offices
  "research leader 1":  { roomNumber: "2.01",  floor: 2, geojsonName: "РЪКОВОДИТЕЛ НА ИЗСЛЕДОВАТЕЛСКА ГРУПА" },
  "research leader 2":  { roomNumber: "2.02",  floor: 2, geojsonName: "РЪКОВОДИТЕЛ НА ИЗСЛЕДОВАТЕЛСКА ГРУПА" },
  "research leader 3":  { roomNumber: "2.03",  floor: 2, geojsonName: "РЪКОВОДИТЕЛ НА ИЗСЛЕДОВАТЕЛСКА ГРУПА" },
  "research leader 4":  { roomNumber: "2.04",  floor: 2, geojsonName: "РЪКОВОДИТЕЛ НА ИЗСЛЕДОВАТЕЛСКА ГРУПА" },
  "cabinet 1":          { roomNumber: "2.05",  floor: 2, geojsonName: "КАБИНЕТ" },
  "cabinet 2":          { roomNumber: "2.06",  floor: 2, geojsonName: "КАБИНЕТ" },
  "cabinet 3":          { roomNumber: "2.07",  floor: 2, geojsonName: "КАБИНЕТ" },
  "cabinet 4":          { roomNumber: "2.08",  floor: 2, geojsonName: "КАБИНЕТ" },
  "cabinet 5":          { roomNumber: "2.09",  floor: 2, geojsonName: "КАБИНЕТ" },
  "cabinet 6":          { roomNumber: "2.10",  floor: 2, geojsonName: "КАБИНЕТ" },
  "cabinet 7":          { roomNumber: "2.11",  floor: 2, geojsonName: "КАБИНЕТ" },
  "researchers":        { roomNumber: "2.12",  floor: 2, geojsonName: "ИЗСЛЕДОВАТЕЛИ" },
  "cabinet 8":          { roomNumber: "2.13",  floor: 2, geojsonName: "КАБИНЕТ" },
  "cabinet 9":          { roomNumber: "2.14",  floor: 2, geojsonName: "КАБИНЕТ" },
  "discussion room":    { roomNumber: "2.16",  floor: 2, geojsonName: "ЗОНА ЗА ДИСКУСИИ" },
  "rest room":          { roomNumber: "2.19",  floor: 2, geojsonName: "СТАЯ ЗА ПОЧИВКА" },
  "waiting area":       { roomNumber: "2.20",  floor: 2, geojsonName: "ЗОНА ЗА ИЗЧАКВАНЕ" },
  
  // Floor 3 (BldgLevel 5) - Administration
  "director":           { roomNumber: "3.01",  floor: 3, geojsonName: "ДИРЕКТОР" },
  "deputy director 1":  { roomNumber: "3.02",  floor: 3, geojsonName: "ЗАМ. ДИРЕКТОР" },
  "deputy director 2":  { roomNumber: "3.03",  floor: 3, geojsonName: "ЗАМ. ДИРЕКТОР" },
  "deputy director 3":  { roomNumber: "3.04",  floor: 3, geojsonName: "ЗАМ. ДИРЕКТОР" },
  "accountant 1":       { roomNumber: "3.05",  floor: 3, geojsonName: "СЧЕТОВОДИТЕЛ" },
  "office manager":     { roomNumber: "3.06",  floor: 3, geojsonName: "ДЕЛОВОДИТЕЛ И ДОМАКИН" },
  "fl3 waiting area":   { roomNumber: "3.07",  floor: 3, geojsonName: "ЗОНА ЗА ИЗЧАКВАНЕ" },
  "it department":      { roomNumber: "3.10",  floor: 3, geojsonName: "IT ОТДЕЛ" },
  "office 1":           { roomNumber: "3.11",  floor: 3, geojsonName: "ОФИС" },
  "office 2":           { roomNumber: "3.12",  floor: 3, geojsonName: "ОФИС" },
  "business":           { roomNumber: "3.13",  floor: 3, geojsonName: "БИЗНЕС РАЗВИТИЕ" },
  "wardrobe":           { roomNumber: "3.14",  floor: 3, geojsonName: "ГАРДЕРОБ" },
  "hr":                 { roomNumber: "3.15",  floor: 3, geojsonName: "ЧОВЕШКИ РЕСУРСИ" },
  "accountant 2":       { roomNumber: "3.16",  floor: 3, geojsonName: "СЧЕТОВОДИТЕЛ" },
  "lawyer":             { roomNumber: "3.16",  floor: 3, geojsonName: "СЧЕТОВОДИТЕЛ" },
  "pr officer":         { roomNumber: "3.17",  floor: 3, geojsonName: "PR" },
  "meeting hall":       { roomNumber: "3.18",  floor: 3, geojsonName: "ЗАЛА ЗА СРЕЩИ" },
  "assistant":          { roomNumber: "3.19",  floor: 3, geojsonName: "АСИСТЕНТ" },
  "cabinet":            { roomNumber: "3.20",  floor: 3, geojsonName: "КАБИНЕТ" },
  "stairs":             { roomNumber: "3.22",  floor: 3, geojsonName: "СТЪЛБА" },
  "corridor":           { roomNumber: "3.23",  floor: 3, geojsonName: "КОРИДОР" },
  "conference hall":    { roomNumber: "3.24",  floor: 3, geojsonName: "ЗАЛА ЗА КОНФЕРЕНТНИ РАЗГОВОРИ" },
};
export const ROLE_BY_ROOM_NUMBER = Object.fromEntries(
  Object.entries(ROLE_ROOM_MAP).map(([label, info]) => [info.roomNumber, label])
);

/** GeoJSON / BMS room key → Gate API { floor, room }. Role map overwrites legacy keys on conflict. */
export const ROOM_KEY_TO_GATE = {
  ...LEGACY_ROOM_KEY_TO_GATE,
  ...buildRoleRoomKeyToGate(ROLE_ROOM_MAP),
};

export const GATE_ROOM_TO_ROOM_NUMBERS = Object.entries(ROOM_KEY_TO_GATE).reduce((acc, [roomNumber, gate]) => {
  const key = String(gate?.room || "").toLowerCase();
  if (!key) return acc;
  if (!acc[key]) acc[key] = [];
  acc[key].push(roomNumber);
  return acc;
}, {
  lobby: ["0.01"],
  conference_room: ["0.02"],
  kitchen: ["0.04"],
});

export const GATE_ROOM_TO_ROOM_NUMBER = Object.fromEntries(
  Object.entries(GATE_ROOM_TO_ROOM_NUMBERS).map(([roomId, roomNumbers]) => [roomId, roomNumbers[0]])
);

/** Presence map for UI: rooms that resolve to a Gate sensor zone. */
export const ROOM_BMS_ENDPOINTS = Object.fromEntries(
  Object.keys(ROOM_KEY_TO_GATE).map((k) => [k, { hasGateSensor: true }])
);

// Export ROOM_METADATA as MOCK_ROOM_DATA for backward compatibility
export const MOCK_ROOM_DATA = ROOM_METADATA;

function getRoomFallbackSeed(roomName) {
  return String(roomName || "")
    .split("")
    .reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function getRoomFallbackBase(roomName) {
  const meta = ROOM_METADATA[roomName] || ROOM_METADATA[String(roomName || "").trim()] || {};
  const occupancy = Number(meta.occupancy) || 4;
  const seed = getRoomFallbackSeed(roomName);
  return {
    temperature: Number(meta.temperature) || 22 + ((seed % 5) * 0.2),
    humidity: Number(meta.humidity) || 42 + (seed % 8),
    co2: 520 + (occupancy * 35) + (seed % 120),
  };
}

function synthRoomPoint(metric, base, timestampMs, roomName) {
  const dt = new Date(timestampMs);
  const hour = dt.getHours() + (dt.getMinutes() / 60);
  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
  const seed = getRoomFallbackSeed(roomName);
  const phase = (seed % 11) / 10;

  if (metric === 'temp') {
    const daily = Math.sin(((hour - 14) / 24) * Math.PI * 2 + phase) * 1.2;
    return Math.round((base.temperature + daily + (isWeekend ? -0.2 : 0.15)) * 10) / 10;
  }
  if (metric === 'humidity') {
    const daily = Math.cos(((hour - 6) / 24) * Math.PI * 2 + phase) * 5;
    return Math.round((base.humidity + daily + (isWeekend ? 1.5 : 0)) * 10) / 10;
  }
  const occupiedBoost = hour >= 8 && hour <= 18 ? 180 : 25;
  const weekendFactor = isWeekend ? 0.72 : 1;
  return Math.round(base.co2 + (occupiedBoost * weekendFactor) + Math.sin((hour / 24) * Math.PI * 2 + phase) * 55);
}

export function buildFallbackRoomHistory(roomName, days = 7, endIso = null) {
  const parsedEndMs = endIso ? new Date(endIso).getTime() : Date.now();
  const endMs = Number.isFinite(parsedEndMs) ? parsedEndMs : Date.now();
  const stepMs = days <= 2 ? 15 * 60 * 1000 : days <= 7 ? 60 * 60 * 1000 : 4 * 60 * 60 * 1000;
  const totalPoints = Math.max(2, Math.round((days * 24 * 60 * 60 * 1000) / stepMs));
  const startMs = endMs - ((totalPoints - 1) * stepMs);
  const base = getRoomFallbackBase(roomName);
  const temp = [];
  const humidity = [];
  const co2 = [];

  for (let i = 0; i < totalPoints; i += 1) {
    const t = startMs + (i * stepMs);
    temp.push({ t, v: synthRoomPoint('temp', base, t, roomName) });
    humidity.push({ t, v: synthRoomPoint('humidity', base, t, roomName) });
    co2.push({ t, v: synthRoomPoint('co2', base, t, roomName) });
  }

  return { temp, humidity, co2 };
}

export function buildFallbackLatestRoomTelemetry(roomName, timestampMs = Date.now()) {
  const history = buildFallbackRoomHistory(roomName, 2, new Date(timestampMs).toISOString());
  const lastT = history.temp[history.temp.length - 1]?.t ?? timestampMs;
  const iso = Number.isFinite(lastT) ? new Date(lastT).toISOString() : null;
  return {
    temperature: history.temp[history.temp.length - 1]?.v ?? null,
    humidity: history.humidity[history.humidity.length - 1]?.v ?? null,
    co2: history.co2[history.co2.length - 1]?.v ?? null,
    timestampMs: Number.isFinite(lastT) ? lastT : null,
    timestampISO: iso,
    temperatureObservedAtMs: null,
    humidityObservedAtMs: null,
    co2ObservedAtMs: null,
  };
}

// Fetch room data: returns all data from PDF (no API calls for now)
export async function fetchRoomData() {
  console.log('📄 Loading room data from PDF...');
  
  // Return a copy of the metadata with all PDF data (energy, temperature, humidity)
  const roomData = {};
  for (const [roomKey, metadata] of Object.entries(ROOM_METADATA)) {
    roomData[roomKey] = { ...metadata };
  }
  
  console.log(`✅ Loaded ${Object.keys(roomData).length} rooms from PDF data`);
  return roomData;
}

export async function fetchFloorData() {
  const roomData = await fetchRoomData();
  return calculateFloorSummaries(roomData);
}

// Calculate floor summaries from room data
export function calculateFloorSummaries(roomData) {
  const floors = {};
  
  Object.entries(roomData).forEach(([roomName, data]) => {
    const floorNum = data.floor;
    
    if (!floors[floorNum]) {
      floors[floorNum] = {
        floor: floorNum,
        roomCount: 0,
        totalEnergy: 0,
        totalTemperature: 0,
        totalHumidity: 0,
        totalArea: 0,
        totalOccupancy: 0,
        rooms: []
      };
    }
    
    floors[floorNum].roomCount++;
    if (data.energy?.total) floors[floorNum].totalEnergy += data.energy.total;
    if (data.temperature) floors[floorNum].totalTemperature += data.temperature;
    if (data.humidity) floors[floorNum].totalHumidity += data.humidity;
    floors[floorNum].totalArea += data.area;
    floors[floorNum].totalOccupancy += data.occupancy;
    floors[floorNum].rooms.push({ name: roomName, ...data });
  });
  
  // Calculate averages
  Object.values(floors).forEach(floor => {
    floor.avgTemperature = (floor.totalTemperature / floor.roomCount).toFixed(1);
    floor.avgHumidity = Math.round(floor.totalHumidity / floor.roomCount);
    floor.totalEnergy = floor.totalEnergy.toFixed(1);
  });
  
  return floors;
}

// Match Cesium feature name to room data
export function matchRoomData(cesiumName, roomData) {
  const normalized = cesiumName.toLowerCase().trim();
  
  // Extract room pattern like "1.02"
  const roomPattern = normalized.match(/(\d+)\.(\d+)/);
  if (roomPattern) {
    const roomKey = `${roomPattern[1]}.${roomPattern[2]}`;
    if (roomData[roomKey]) {
      return { name: roomKey, ...roomData[roomKey] };
    }
  }
  
  // Try exact match
  for (const [roomName, data] of Object.entries(roomData)) {
    if (roomName.toLowerCase() === normalized) {
      return { name: roomName, ...data };
    }
  }
  
  return null;
}

// Helper functions for UI
export function extractFloorNumber(cesiumName) {
  const normalized = cesiumName.toLowerCase();
  const match = normalized.match(/(?:floor|level)\s*(\d+)/);
  if (match) return parseInt(match[1]);
  const numberMatch = normalized.match(/\d+/);
  return numberMatch ? parseInt(numberMatch[0]) : 1;
}

export function isFloorFeature(cesiumName, category = '') {
  const normalized = cesiumName.toLowerCase();
  const normalizedCategory = category.toLowerCase();
  return normalizedCategory.includes('floor') || normalizedCategory.includes('level') ||
         normalized.includes('floor') || normalized.includes('level') ||
         normalized.match(/^f\d+$/i) || normalized.match(/^level\s*\d+$/i);
}

export function formatEnergy(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} MWh`;
  return `${value.toFixed(1)} kWh`;
}

export function getEnergyStatusColor(energyPerArea) {
  if (energyPerArea < 1.5) return '#27ae60';
  if (energyPerArea < 2.5) return '#f39c12';
  return '#e74c3c';
}

export function getTemperatureStatus(temp) {
  if (temp < 18) return { status: 'Cold', color: '#3498db' };
  if (temp <= 24) return { status: 'Comfortable', color: '#27ae60' };
  return { status: 'Warm', color: '#e74c3c' };
}

export function getHumidityStatus(humidity) {
  if (humidity < 30) return { status: 'Dry', color: '#e74c3c' };
  if (humidity <= 60) return { status: 'Comfortable', color: '#27ae60' };
  return { status: 'Humid', color: '#3498db' };
}

function resolveGateEntry(roomName) {
  const raw = String(roomName ?? "").trim();
  if (!raw) return null;
  return ROOM_KEY_TO_GATE[raw] || ROOM_KEY_TO_GATE[toReplayRoomKey(raw)] || null;
}

function gateRoomIdSetForGeoRoom(roomName) {
  const norm = toReplayRoomKey(String(roomName || "").trim());
  const ids = new Set();
  const direct = resolveGateEntry(roomName);
  if (direct?.room) ids.add(String(direct.room).toLowerCase());
  Object.entries(GATE_ROOM_TO_ROOM_NUMBERS).forEach(([roomId, nums]) => {
    if (nums.some((n) => toReplayRoomKey(n) === norm)) ids.add(String(roomId).toLowerCase());
  });
  return ids;
}

function filterReadingsForGeoRoom(roomName, readings) {
  const want = gateRoomIdSetForGeoRoom(roomName);
  if (!want.size) return [];
  return readings.filter((r) => want.has(String(r.room_id || "").toLowerCase()));
}

function historyFromFilteredReadings(readings) {
  const temp = readings.filter((r) => r.parameter === "Temp")
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((r) => ({ t: r.timestampMs, v: r.value }));
  const humidity = readings.filter((r) => r.parameter === "Humidity")
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((r) => ({ t: r.timestampMs, v: r.value }));
  const co2 = readings.filter((r) => r.parameter === "CO2")
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((r) => ({ t: r.timestampMs, v: r.value }));
  return { temp, humidity, co2 };
}

function historyPointCount(h) {
  return (h.temp?.length || 0) + (h.humidity?.length || 0) + (h.co2?.length || 0);
}

async function fetchRoomHistoryFromAggregate(roomName, days, endIso) {
  const endDate = endIso ? new Date(endIso) : new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const dateRange = {
    start_date: toSofiaDateString(startDate),
    end_date: toSofiaDateString(endDate),
  };
  const allReadings = await fetchAllSensors(dateRange);
  return historyFromFilteredReadings(filterReadingsForGeoRoom(roomName, allReadings));
}

function telemetryFromRoomState(pick) {
  if (!pick) return null;
  const telemetry = {
    temperature: pick.temperature ?? null,
    humidity: pick.humidity ?? null,
    co2: pick.co2 ?? null,
    timestampMs: pick.updatedAtMs ?? null,
    timestampISO: pick.updatedAtISO ?? (Number(pick.updatedAtMs) > 0 ? new Date(pick.updatedAtMs).toISOString() : null),
    temperatureObservedAtMs: pick.temperatureObservedAtMs ?? null,
    humidityObservedAtMs: pick.humidityObservedAtMs ?? null,
    co2ObservedAtMs: pick.co2ObservedAtMs ?? null,
  };
  if (telemetry.temperature == null && telemetry.humidity == null && telemetry.co2 == null) return null;
  return telemetry;
}

async function fetchLatestRoomTelemetryFromAggregate(roomName) {
  const allReadings = await fetchAllSensors(undefined);
  const filtered = filterReadingsForGeoRoom(roomName, allReadings);
  const states = buildAllRoomLatestStates(filtered);
  if (!states.length) return null;
  const latestMs = Math.max(...states.map((s) => Number(s.updatedAtMs) || 0));
  const atLatest = states.filter((s) => (Number(s.updatedAtMs) || 0) === latestMs);
  const pick = atLatest.sort((a, b) => String(a.room_id).localeCompare(String(b.room_id)))[0] || states[0];
  return telemetryFromRoomState(pick);
}

/** Empty series when API has no history and synthetic fallback is disabled. */
export const EMPTY_ROOM_HISTORY = { temp: [], humidity: [], co2: [] };

/**
 * Fetch historical IAQ time-series for a room from the Gate Building API.
 *
 * @param {string}  roomName  - BMS room key, e.g. "1.02"
 * @param {number}  [days=7]  - History window in days
 * @param {string}  [endIso]  - ISO timestamp for window end (defaults to now)
 * @param {object}  [options]
 * @param {boolean} [options.allowSyntheticFallback=true] - If false, returns empty series when API returns nothing (no demo curves).
 * @returns {Promise<{temp: Array<{t:number,v:number}>, humidity: Array<{t:number,v:number}>, co2: Array<{t:number,v:number}>}>}
 */
export async function fetchRoomHistory(roomName, days = 7, endIso = null, options = {}) {
  const { allowSyntheticFallback = true } = options;
  const syntheticHistory = () => buildFallbackRoomHistory(roomName, days, endIso);
  const noData = () => ({ ...EMPTY_ROOM_HISTORY });

  // Same multi-floor Gate pull + room filter as live telemetry — preferred so trends match API.
  let aggregateResult = null;
  try {
    aggregateResult = await fetchRoomHistoryFromAggregate(roomName, days, endIso);
  } catch (e) {
    console.warn("[RoomData] aggregate room history failed:", e?.message || e);
  }
  if (aggregateResult && historyPointCount(aggregateResult) > 0) {
    return aggregateResult;
  }

  const gate = resolveGateEntry(roomName);
  if (!gate) {
    return allowSyntheticFallback ? syntheticHistory() : noData();
  }

  try {
    const endDate = endIso ? new Date(endIso) : new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const dateRange = {
      start_date: toSofiaDateString(startDate),
      end_date: toSofiaDateString(endDate),
    };
    const raw = await gateGet(`/sensor/data/floor_${gate.floor}/`, { room: gate.room, ...dateRange });
    const readings = mapSensorFloorResponse(raw, gate.floor).filter((r) => r.room_id === gate.room);
    const direct = historyFromFilteredReadings(readings);
    if (historyPointCount(direct) > 0) return direct;
  } catch (error) {
    console.error(`[RoomData] fetchRoomHistory direct path failed for ${roomName}:`, error);
  }
  return allowSyntheticFallback ? syntheticHistory() : noData();
}

/**
 * Fetch the latest IAQ readings for a room from the Gate Building API.
 *
 * @param {string}  roomName  - BMS room key, e.g. "1.02"
 * @returns {Promise<{temperature: number|null, humidity: number|null, co2: number|null, timestampMs: number|null, timestampISO: string|null, temperatureObservedAtMs: number|null, humidityObservedAtMs: number|null, co2ObservedAtMs: number|null}>}
 */
export async function fetchLatestRoomTelemetry(roomName) {
  const gate = resolveGateEntry(roomName);
  const synthetic = () => buildFallbackLatestRoomTelemetry(roomName);

  if (!gate) {
    try {
      const agg = await fetchLatestRoomTelemetryFromAggregate(roomName);
      if (agg) return agg;
    } catch (e) {
      console.warn("[RoomData] aggregate live (no direct gate mapping) failed:", e?.message || e);
    }
    return synthetic();
  }

  try {
    const raw = await gateGet(`/sensor/data/floor_${gate.floor}/`, { room: gate.room });
    const readings = mapSensorFloorResponse(raw, gate.floor).filter((r) => r.room_id === gate.room);
    const states = buildAllRoomLatestStates(readings);
    const state = states.find((s) => s.room_id === gate.room);
    if (state) {
      const telemetry = telemetryFromRoomState(state);
      if (telemetry) return telemetry;
    }
    const agg = await fetchLatestRoomTelemetryFromAggregate(roomName);
    if (agg) return agg;
    return synthetic();
  } catch (error) {
    console.error(`[RoomData] fetchLatestRoomTelemetry failed for ${roomName}:`, error);
    try {
      const agg = await fetchLatestRoomTelemetryFromAggregate(roomName);
      if (agg) return agg;
    } catch { /* ignore */ }
    return synthetic();
  }
}
