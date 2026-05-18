import {
  bucketQuarterHour,
  bucketHour,
  msToBucketDate,
  msToTimeString,
  msToFractionalHour,
  lastNDayLabels,
} from "./timeUtils.js";

export function downsample(points, targetCount = 96) {
  if (!points?.length) return [];

  const sorted = [...points].sort((a, b) => a.timestampMs - b.timestampMs);
  const minMs = sorted[0].timestampMs;
  const maxMs = sorted[sorted.length - 1].timestampMs;
  const range = maxMs - minMs || 1;
  const bucket = range / targetCount;

  const buckets = Array.from({ length: targetCount }, (_, i) => ({
    center: minMs + (i + 0.5) * bucket,
    sum: 0,
    count: 0,
  }));

  for (const p of sorted) {
    const idx = Math.min(
      Math.floor((p.timestampMs - minMs) / bucket),
      targetCount - 1
    );
    buckets[idx].sum += p.value;
    buckets[idx].count += 1;
  }

  let lastValue = sorted[0].value;

  return buckets.map((b) => {
    if (b.count > 0) lastValue = b.sum / b.count;
    return {
      timestampMs: b.center,
      value: lastValue,
      time: msToTimeString(b.center),
    };
  });
}

export function buildQuarterHourSeries(readings, startMs, endMs) {
  const BUCKET = 15 * 60 * 1000;

  const byBucket = new Map();
  for (const r of readings) {
    const b = bucketQuarterHour(r.timestampMs);
    if (b < startMs - BUCKET || b > endMs + BUCKET) continue;
    if (!byBucket.has(b) || r.timestampMs > byBucket.get(b).timestampMs) {
      byBucket.set(b, r);
    }
  }

  const result = [];
  let lastWatts = 0;
  const startBucket = bucketQuarterHour(startMs);

  for (let t = startBucket; t <= endMs; t += BUCKET) {
    const reading = byBucket.get(t);
    if (reading) lastWatts = reading.value;
    result.push({
      timestampMs: t,
      watts: lastWatts,
      value: lastWatts,
      time: msToTimeString(t),
      hour: msToFractionalHour(t),
    });
  }

  return result;
}

export function buildDailyTotals(readings, type = "Power", days = 30) {
  const now = Date.now();
  const labels = lastNDayLabels(days, new Date(now));
  const totals = Object.fromEntries(labels.map((d) => [d, 0]));

  if (type === "Energy") {
    for (const r of readings) {
      const day = msToBucketDate(r.timestampMs);
      if (day in totals) totals[day] += r.value;
    }
  } else {
    const sorted = [...readings].sort((a, b) => a.timestampMs - b.timestampMs);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const dt = (b.timestampMs - a.timestampMs) / (1000 * 3600);
      if (dt > 2) continue;
      const avgW = (a.value + b.value) / 2;
      const kwh = (avgW / 1000) * dt;
      const day = msToBucketDate(a.timestampMs);
      if (day in totals) totals[day] += kwh;
    }
  }

  return labels.map((d) => ({ date: d, kwh: Math.round(totals[d] * 100) / 100 }));
}

export function buildHourlyProfile(readings) {
  const sums = new Array(24).fill(0);
  const counts = new Array(24).fill(0);

  for (const r of readings) {
    const h = new Date(r.timestampMs).getHours();
    sums[h] += r.value;
    counts[h] += 1;
  }

  return sums.map((s, h) => ({
    hour: h,
    avgWatts: counts[h] > 0 ? Math.round(s / counts[h]) : 0,
  }));
}

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 18;

export function buildWorkHoursAnalysis(readings) {
  let workSum = 0, workCount = 0;
  let offSum = 0, offCount = 0;

  for (const r of readings) {
    const h = new Date(r.timestampMs).getHours();
    if (h >= WORK_START_HOUR && h < WORK_END_HOUR) {
      workSum += r.value; workCount++;
    } else {
      offSum += r.value; offCount++;
    }
  }

  const workHoursAvgW = workCount > 0 ? Math.round(workSum / workCount) : 0;
  const offHoursAvgW = offCount > 0 ? Math.round(offSum / offCount) : 0;

  return {
    workHoursAvgW,
    offHoursAvgW,
    ratio: offHoursAvgW > 0 ? workHoursAvgW / offHoursAvgW : Infinity,
  };
}

export function buildReplayFrameArray(readings, targetFrames = 192) {
  if (!readings?.length) return [];

  const sorted = [...readings].sort((a, b) => a.timestampMs - b.timestampMs);
  const minMs = sorted[0].timestampMs;
  const maxMs = sorted[sorted.length - 1].timestampMs;
  const range = maxMs - minMs || 1;
  const bucket = range / (targetFrames - 1);

  let lastValue = sorted[0].value;

  return Array.from({ length: targetFrames }, (_, i) => {
    const targetMs = minMs + i * bucket;

    const closest = sorted.reduce((best, r) => {
      const dist = Math.abs(r.timestampMs - targetMs);
      return dist < Math.abs((best?.timestampMs ?? Infinity) - targetMs) ? r : best;
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

export function buildReplayFrameMap(seriesByKey, targetFrames = 192) {
  const result = {};
  for (const [key, readings] of Object.entries(seriesByKey)) {
    result[key] = buildReplayFrameArray(readings, targetFrames);
  }
  return result;
}

export function getNearestAtOrBefore(readings, targetMs, maxLookbackMs = 2 * 3600 * 1000) {
  if (!readings?.length) return null;

  let best = null;
  for (const r of readings) {
    if (r.timestampMs <= targetMs) {
      if (!best || r.timestampMs > best.timestampMs) best = r;
    }
  }

  if (!best) return null;
  if (targetMs - best.timestampMs > maxLookbackMs) return null;

  return best;
}

export function averageField(items, field) {
  const valid = items.map((x) => Number(x?.[field])).filter((v) => Number.isFinite(v));
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}
