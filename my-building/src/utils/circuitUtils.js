function getCircuitFallbackSeed(circuitId) {
  return String(circuitId || "")
    .split("")
    .reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

export function buildFallbackCircuitSample(circuitId, timestampMs = Date.now()) {
  const seed = getCircuitFallbackSeed(circuitId);
  const dt = new Date(timestampMs);
  const hour = dt.getHours() + dt.getMinutes() / 60;
  const base = 0.5 + (seed % 50) / 10;
  const daily = Math.sin(((hour - 13) / 24) * Math.PI * 2 + (seed % 7)) * 1.2;
  const value = Math.max(0, Math.round((base + daily) * 100) / 100);
  return {
    circuitId,
    value,
    timestampMs,
    fallback: true,
  };
}

export function buildFallbackCircuitHistory(circuitId, days = 2, endIso = null) {
  const parsedEndMs = endIso ? new Date(endIso).getTime() : Date.now();
  const endMs = Number.isFinite(parsedEndMs) ? parsedEndMs : Date.now();
  const stepMs = days <= 2 ? 15 * 60 * 1000 : 60 * 60 * 1000;
  const totalPoints = Math.max(2, Math.round((days * 24 * 60 * 60 * 1000) / stepMs));
  const startMs = endMs - ((totalPoints - 1) * stepMs);
  const samples = [];
  for (let i = 0; i < totalPoints; i += 1) {
    const t = startMs + i * stepMs;
    samples.push(buildFallbackCircuitSample(circuitId, t));
  }
  return samples;
}
