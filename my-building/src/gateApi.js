
import {
  fetchElectricityPower,
  fetchSolar,
  fetchAllSensors,
  fetchLiveSnapshot,
  fetchHistoryWindow,
} from "./services/gateBuildingRepository.js";

import {
  aggregateSensorReadingsToRoomRows,
} from "./services/gateBuildingMappers.js";

import {
  toSofiaDateString,
  toSofiaDateParams,
} from "./utils/timeUtils.js";

import {
  buildClimateReplayFrames as buildGateClimateReplayFramesFromRepo,
  buildPvDataRef,
  toLegacyElecRows,
  toLegacySolarRows,
} from "./utils/replayEngine.js";

export { buildGateClimateReplayFramesFromRepo as buildClimateReplayFrames };
export { buildPvDataRef };

export { toSofiaDateString };

export function getDateRangeForHours(hours, endDate = new Date()) {
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  const safeEnd = Number.isFinite(end.getTime()) ? end : new Date();
  const start = new Date(safeEnd.getTime() - hours * 60 * 60 * 1000);
  return {
    start_date: toSofiaDateString(start),
    end_date: toSofiaDateString(safeEnd),
  };
}

export function getLast48hRange() {
  return getDateRangeForHours(48);
}

export async function fetchElectricityHistory(dateRange = getLast48hRange()) {
  const readings = await fetchElectricityPower(dateRange);
  return toLegacyElecRows(readings);
}

export async function fetchSolarHistory(dateRange = getLast48hRange()) {
  const readings = await fetchSolar(dateRange);
  return toLegacySolarRows(readings);
}

export async function fetchAllSensorsHistory(dateRange = getLast48hRange()) {
  const readings = await fetchAllSensors(dateRange);
  return aggregateSensorReadingsToRoomRows(readings);
}

export async function fetchElectricityLive() {
  const readings = await fetchElectricityPower(undefined);
  return toLegacyElecRows(readings);
}

export async function fetchSolarLive() {
  const readings = await fetchSolar(undefined);
  return toLegacySolarRows(readings);
}

export async function fetchAllSensorsLive() {
  const readings = await fetchAllSensors(undefined);
  return aggregateSensorReadingsToRoomRows(readings);
}

export async function fetchAllLive() {
  const { electricity, solar, sensors } = await fetchLiveSnapshot();
  return {
    electricity: toLegacyElecRows(electricity),
    solar: toLegacySolarRows(solar),
    rooms: aggregateSensorReadingsToRoomRows(sensors),
  };
}

// kept for backward compat with CEsiumGeoJsonViewer.jsx:
//   buildReplayFrames(elecRows, "circuit_id", "value", REPLAY_FRAMES)
//   buildReplayFrames(solarRows, "appKey", "value", REPLAY_FRAMES)
export function buildReplayFrames(
  readings,
  keyField,
  valueField = "value",
  targetFrames = 192
) {
  if (!readings?.length) return {};

  const fmt15 = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const fmtHr = (ms) => {
    const d = new Date(ms);
    return d.getHours() + d.getMinutes() / 60;
  };

  const byKey = {};
  for (const r of readings) {
    const key = r[keyField];
    const val = Number(r[valueField] ?? r.value ?? 0);
    const ts = r.ts ?? r.timestamp;
    const ms = new Date(ts).getTime();
    if (!key || isNaN(ms)) continue;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ timestampMs: ms, value: val });
  }

  if (!Object.keys(byKey).length) return {};

  const allMs = Object.values(byKey).flat().map((r) => r.timestampMs).filter(Number.isFinite);
  if (!allMs.length) return {};

  const minMs = Math.min(...allMs);
  const maxMs = Math.max(...allMs);
  const range = maxMs - minMs || 1;
  const bucket = range / (targetFrames - 1);

  const result = {};

  for (const [key, rows] of Object.entries(byKey)) {
    const sorted = [...rows].sort((a, b) => a.timestampMs - b.timestampMs);
    let lastValue = sorted[0]?.value ?? 0;

    result[key] = Array.from({ length: targetFrames }, (_, i) => {
      const targetMs = minMs + i * bucket;

      const closest = sorted.reduce((best, r) => {
        return Math.abs(r.timestampMs - targetMs) < Math.abs((best?.timestampMs ?? Infinity) - targetMs)
          ? r : best;
      }, null);

      if (closest && Math.abs(closest.timestampMs - targetMs) <= bucket * 1.5) {
        lastValue = closest.value;
      }

      return {
        value: lastValue,
        watts: lastValue,
        ts: new Date(targetMs).toISOString(),
        time: fmt15(targetMs),
        hour: fmtHr(targetMs),
        timestampMs: targetMs,
      };
    });
  }

  return result;
}
