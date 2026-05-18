import {
  msToTimeString,
  msToFractionalHour,
} from "./timeUtils.js";
import { getNearestAtOrBefore } from "./timeSeriesAggregation.js";

// 192 frames = 48h at ~15-min cadence
export const DEFAULT_FRAMES = 192;

export function buildElectricityReplayFrames(readings, circuitIds, targetFrames = DEFAULT_FRAMES) {
  if (!readings?.length) {
    return Object.fromEntries(circuitIds.map((id) => [id, []]));
  }

  const byCircuit = {};
  for (const r of readings) {
    if (!r.circuit_id || !Number.isFinite(r.timestampMs)) continue;
    if (!byCircuit[r.circuit_id]) byCircuit[r.circuit_id] = [];
    byCircuit[r.circuit_id].push(r);
  }
  for (const arr of Object.values(byCircuit)) {
    arr.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  const allMs = readings.map((r) => r.timestampMs).filter(Number.isFinite);
  if (!allMs.length) return Object.fromEntries(circuitIds.map((id) => [id, []]));

  const minMs = Math.min(...allMs);
  const maxMs = Math.max(...allMs);
  const range = maxMs - minMs || 1;
  const bucket = range / (targetFrames - 1);

  const result = {};

  for (const circuitId of circuitIds) {
    const rows = byCircuit[circuitId] ?? [];
    let lastValue = 0;

    result[circuitId] = Array.from({ length: targetFrames }, (_, i) => {
      const targetMs = minMs + i * bucket;

      if (rows.length > 0) {
        const closest = rows.reduce((best, r) => {
          return Math.abs(r.timestampMs - targetMs) < Math.abs((best?.timestampMs ?? Infinity) - targetMs)
            ? r : best;
        }, null);

        if (closest && Math.abs(closest.timestampMs - targetMs) <= bucket * 1.5) {
          lastValue = closest.value;
        }
      }

      return {
        timestampMs: targetMs,
        value: lastValue,
        watts: lastValue,
        time: msToTimeString(targetMs),
        hour: msToFractionalHour(targetMs),
      };
    });
  }

  return result;
}

export function buildSolarReplayFrames(readings, targetFrames = DEFAULT_FRAMES) {
  if (!readings?.length) return {};

  const byParam = {};
  for (const r of readings) {
    const key = r.appKey ?? r.parameter?.toLowerCase() ?? "unknown";
    if (!byParam[key]) byParam[key] = [];
    byParam[key].push(r);
  }
  for (const arr of Object.values(byParam)) {
    arr.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  const allMs = readings.map((r) => r.timestampMs).filter(Number.isFinite);
  if (!allMs.length) return {};

  const minMs = Math.min(...allMs);
  const maxMs = Math.max(...allMs);
  const range = maxMs - minMs || 1;
  const bucket = range / (targetFrames - 1);

  const result = {};

  for (const [key, rows] of Object.entries(byParam)) {
    let lastValue = 0;

    result[key] = Array.from({ length: targetFrames }, (_, i) => {
      const targetMs = minMs + i * bucket;

      const closest = rows.reduce((best, r) => {
        return Math.abs(r.timestampMs - targetMs) < Math.abs((best?.timestampMs ?? Infinity) - targetMs)
          ? r : best;
      }, null);

      if (closest && Math.abs(closest.timestampMs - targetMs) <= bucket * 1.5) {
        lastValue = closest.value;
      }

      return {
        timestampMs: targetMs,
        value: lastValue,
        watts: lastValue,
        time: msToTimeString(targetMs),
        hour: msToFractionalHour(targetMs),
      };
    });
  }

  return result;
}

export function buildClimateReplayFrames(roomRows, targetFrames = DEFAULT_FRAMES, windowStartMs, windowEndMs) {
  if (!roomRows?.length) return {};

  const byRoom = {};
  for (const r of roomRows) {
    if (!r.room_id || !Number.isFinite(r.timestampMs)) continue;
    if (!byRoom[r.room_id]) byRoom[r.room_id] = [];
    byRoom[r.room_id].push(r);
  }
  for (const arr of Object.values(byRoom)) {
    arr.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  const allMs = roomRows.map((r) => r.timestampMs).filter(Number.isFinite);
  if (!allMs.length) return {};

  const minMs = windowStartMs ?? Math.min(...allMs);
  const maxMs = windowEndMs ?? Math.max(...allMs);
  const range = maxMs - minMs || 1;
  const bucket = range / (targetFrames - 1);

  const result = {};

  for (const [roomId, rows] of Object.entries(byRoom)) {
    let lastTemp = null;
    let lastHum = null;
    let lastCo2 = null;

    result[roomId] = Array.from({ length: targetFrames }, (_, i) => {
      const targetMs = minMs + i * bucket;

      const closest = rows.reduce((best, r) => {
        return Math.abs(r.timestampMs - targetMs) < Math.abs((best?.timestampMs ?? Infinity) - targetMs)
          ? r : best;
      }, null);

      if (closest && Math.abs(closest.timestampMs - targetMs) <= bucket * 1.5) {
        if (closest.temp_c != null) lastTemp = closest.temp_c;
        if (closest.humidity_rh != null) lastHum = closest.humidity_rh;
        if (closest.co2_ppm != null) lastCo2 = closest.co2_ppm;
      }

      return {
        timestampMs: targetMs,
        temperature: lastTemp,
        humidity: lastHum,
        co2: lastCo2,
        time: msToTimeString(targetMs),
        hour: msToFractionalHour(targetMs),
      };
    });
  }

  return result;
}

export function buildPvDataRef(solarReadings, targetFrames = DEFAULT_FRAMES) {
  const frames = buildSolarReplayFrames(solarReadings, targetFrames);

  const pick = (...needles) => {
    const key = Object.keys(frames).find((k) =>
      needles.every((n) => k.toLowerCase().includes(n.toLowerCase()))
    );
    return key ? frames[key] : [];
  };

  return {
    byEndpoint: frames,
    pvTotal: pick("ppvinput"),
    pvBattery: pick("battery_p"),
    soc: pick("soc"),
    bmsTemp: pick("temperature1"),
    threePhaseMeter: pick("pmetertotal"),
    pLoad: pick("pload"),
    // not available from Gate API
    pv1Power: [],
    pv2Power: [],
    backupA: [],
    backupB: [],
    backupC: [],
    dailyPv: [],
    dailyLoad: [],
    dailyPurchased: [],
    gridExport: [],
    gridImport: [],
  };
}

export function resolveRoomsAtTimestamp(climateFrameMap, targetMs, maxLookbackMs = 2 * 3600 * 1000) {
  const rooms = {};

  for (const [room_id, frames] of Object.entries(climateFrameMap)) {
    const reading = getNearestAtOrBefore(frames, targetMs, maxLookbackMs);

    if (!reading) {
      rooms[room_id] = {
        room_id,
        temperature: null,
        humidity: null,
        co2: null,
        available: false,
        readingAtMs: null,
      };
    } else {
      rooms[room_id] = {
        room_id,
        temperature: reading.temperature,
        humidity: reading.humidity,
        co2: reading.co2,
        available: reading.temperature != null || reading.humidity != null || reading.co2 != null,
        readingAtMs: reading.timestampMs,
      };
    }
  }

  return { timestampMs: targetMs, rooms };
}

// legacy format converters — used by gateApi.js facade
export function toLegacyElecRows(readings) {
  return readings.map((r) => ({
    circuit_id: r.circuit_id,
    value: r.value,
    ts: r.tsISO,
    unit: r.unit,
  }));
}

export function toLegacySolarRows(readings) {
  return readings.map((r) => ({
    appKey: r.appKey,
    value: r.value,
    ts: r.tsISO,
  }));
}

export function toLegacyRoomRows(roomRows) {
  return roomRows;
}
