import { getNearestAtOrBefore } from "./timeSeriesAggregation.js";

export function buildHeatmapFrames(climateFrameMap, metric = "temperature") {
  const allTimestamps = new Set();
  for (const frames of Object.values(climateFrameMap)) {
    for (const f of frames) {
      if (Number.isFinite(f.timestampMs)) allTimestamps.add(f.timestampMs);
    }
  }

  const sortedTs = [...allTimestamps].sort((a, b) => a - b);
  if (!sortedTs.length) return [];

  return sortedTs.map((timestampMs) => ({
    timestampMs,
    rooms: resolveHeatmapRoomsAtTimestamp(climateFrameMap, timestampMs, metric),
  }));
}

export function resolveHeatmapRoomsAtTimestamp(
  climateFrameMap,
  targetMs,
  metric = "temperature",
  maxLookbackMs = 2 * 3600 * 1000
) {
  const rooms = {};

  for (const [room_id, frames] of Object.entries(climateFrameMap)) {
    const reading = getNearestAtOrBefore(frames, targetMs, maxLookbackMs);
    const value = reading?.[metric] ?? null;

    rooms[room_id] = {
      room_id,
      temperature: reading?.temperature ?? null,
      humidity: reading?.humidity ?? null,
      co2: reading?.co2 ?? null,
      value,
      available: value != null,
      readingAtMs: reading?.timestampMs ?? null,
    };
  }

  return rooms;
}

export function apiRoomIdToGeoJsonKey(apiRoomId, overrideMap = {}) {
  if (overrideMap[apiRoomId]) return overrideMap[apiRoomId];
  return apiRoomId.replace(/_/g, " ").trim();
}

export function computeHeatmapDataRange(frames, metric) {
  let min = Infinity;
  let max = -Infinity;

  for (const frame of frames) {
    for (const state of Object.values(frame.rooms ?? {})) {
      const v = state?.[metric];
      if (v == null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  return min <= max ? { min, max } : null;
}
