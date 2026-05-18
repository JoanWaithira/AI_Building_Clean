import { getNearestAtOrBefore } from "./timeSeriesAggregation.js";

export function buildRoomLatestState(readings, room_id, floor) {
  let temp = null, tempMs = -Infinity;
  let hum = null, humMs = -Infinity;
  let co2 = null, co2Ms = -Infinity;
  let latestMs = 0;

  for (const r of readings) {
    if (!Number.isFinite(r.timestampMs)) continue;
    latestMs = Math.max(latestMs, r.timestampMs);

    if (r.parameter === "Temp" && r.timestampMs > tempMs) { temp = r.value; tempMs = r.timestampMs; }
    if (r.parameter === "Humidity" && r.timestampMs > humMs) { hum = r.value; humMs = r.timestampMs; }
    if (r.parameter === "CO2" && r.timestampMs > co2Ms) { co2 = r.value; co2Ms = r.timestampMs; }
  }

  return {
    room_id,
    floor,
    temperature: temp,
    humidity: hum,
    co2: co2,
    updatedAtMs: latestMs,
    updatedAtISO: latestMs > 0 ? new Date(latestMs).toISOString() : null,
  };
}

export function buildAllRoomLatestStates(allReadings) {
  const byRoom = new Map();

  for (const r of allReadings) {
    if (!r.room_id) continue;
    if (!byRoom.has(r.room_id)) byRoom.set(r.room_id, []);
    byRoom.get(r.room_id).push(r);
  }

  const result = new Map();
  for (const [room_id, readings] of byRoom) {
    const floor = readings[0]?.floor ?? 0;
    result.set(room_id, buildRoomLatestState(readings, room_id, floor));
  }

  return result;
}

export function buildIndoorAirSnapshot(roomStates) {
  let tempSum = 0, tempCount = 0;
  let humSum = 0, humCount = 0;
  let co2Sum = 0, co2Count = 0;
  let roomCount = 0;

  for (const s of roomStates) {
    if (s.temperature != null) { tempSum += s.temperature; tempCount++; }
    if (s.humidity != null) { humSum += s.humidity; humCount++; }
    if (s.co2 != null) { co2Sum += s.co2; co2Count++; }
    if (s.temperature != null || s.humidity != null || s.co2 != null) roomCount++;
  }

  return {
    temperature: tempCount > 0 ? tempSum / tempCount : null,
    humidity: humCount > 0 ? humSum / humCount : null,
    co2: co2Count > 0 ? co2Sum / co2Count : null,
    roomCount,
  };
}

export function buildRoomHistoricalSeries(readings, room_id, floor) {
  const temperature = [];
  const humidity = [];
  const co2 = [];

  for (const r of readings) {
    if (!Number.isFinite(r.timestampMs)) continue;
    const point = { timestampMs: r.timestampMs, value: r.value };
    if (r.parameter === "Temp") temperature.push(point);
    if (r.parameter === "Humidity") humidity.push(point);
    if (r.parameter === "CO2") co2.push(point);
  }

  const sort = (arr) => arr.sort((a, b) => a.timestampMs - b.timestampMs);

  return {
    room_id,
    floor,
    temperature: sort(temperature),
    humidity: sort(humidity),
    co2: sort(co2),
  };
}

export function resolveRoomStatesAtTimestamp(climateFrameMap, targetMs, maxLookbackMs = 2 * 3600 * 1000) {
  const result = new Map();

  for (const [room_id, frames] of Object.entries(climateFrameMap)) {
    const reading = getNearestAtOrBefore(frames, targetMs, maxLookbackMs);

    result.set(room_id, {
      temperature: reading?.temperature ?? null,
      humidity: reading?.humidity ?? null,
      co2: reading?.co2 ?? null,
      available: !!reading && (reading.temperature != null || reading.humidity != null || reading.co2 != null),
    });
  }

  return result;
}
