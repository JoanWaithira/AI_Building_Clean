const SOFIA_TIMEZONE = "Europe/Sofia";

// sv-SE locale produces "YYYY-MM-DD HH:MM:SS" — matches the Gate API's expected format
export function toSofiaDateString(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: SOFIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function toSofiaDateParams(hours, now = new Date()) {
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return {
    start_date: toSofiaDateString(start),
    end_date: toSofiaDateString(now),
  };
}

export function rangeToDates(range, now = new Date()) {
  const MAP = { "24h": 24, "48h": 48, "7d": 168, "30d": 720 };
  const hours = MAP[range] ?? 48;
  return toSofiaDateParams(hours, now);
}

export function parseTimestampMs(tsISO) {
  if (!tsISO) return NaN;
  const ms = Date.parse(String(tsISO));
  return isNaN(ms) ? NaN : ms;
}

export function msToBucketDate(ms) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: SOFIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function msToTimeString(ms) {
  if (!Number.isFinite(ms)) return "--:--";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: SOFIA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function msToFractionalHour(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SOFIA_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));

  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function bucketQuarterHour(ms) {
  const BUCKET = 15 * 60 * 1000;
  return Math.floor(ms / BUCKET) * BUCKET;
}

export function bucketHour(ms) {
  const BUCKET = 60 * 60 * 1000;
  return Math.floor(ms / BUCKET) * BUCKET;
}

export function bucketDay(ms) {
  const dateStr = msToBucketDate(ms);
  const midnight = Date.parse(`${dateStr}T00:00:00`);
  return midnight;
}

export function isSameSofiaDay(ms1, ms2) {
  return msToBucketDate(ms1) === msToBucketDate(ms2);
}

export function lastNDayLabels(days, now = new Date()) {
  const labels = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    labels.push(msToBucketDate(d.getTime()));
  }
  return labels;
}
