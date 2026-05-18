export const FONT = '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif';
export const CARBON_FACTOR = 0.233; // kg CO₂ per kWh (Bulgarian grid avg)
export const WORKING_DAYS_MONTH = 22;
export const FLOOR_AREA_M2 = 3200;

export const CIRCUIT_COLORS = {
  main:"#60A5FA",circuit6boiler:"#F87171",circuit7:"#FBBF24",elevator:"#A78BFA",
  circuit8:"#34D399",circuit9:"#22D3EE",circuit10:"#FB923C",circuit11:"#F472B6",
  circuit12:"#A3E635",airconditioner1:"#38BDF8",airconditioner2:"#0EA5E9",
  outsidelighting1:"#FDE68A",outsidelighting2:"#FCD34D",
  vehiclecharging1:"#4ADE80",vehiclecharging2:"#16A34A",
  "3DLED":"#FF6B9D",ovk:"#E879F9",
};

export const CIRCUIT_LABELS = {
  main:"Main",circuit6boiler:"Boiler",circuit7:"Circuit 7",elevator:"Elevator",
  circuit8:"Circuit 8",circuit9:"Circuit 9",circuit10:"Circuit 10",
  circuit11:"Circuit 11",circuit12:"Circuit 12",airconditioner1:"Air Cond. 1",
  airconditioner2:"Air Cond. 2",outsidelighting1:"Outside Light N",
  outsidelighting2:"Outside Light S",vehiclecharging1:"EV Charger 1",
  vehiclecharging2:"EV Charger 2","3DLED":"3D LED Display",ovk:"OVK",
};

export const ROLES = {
  director: {
    id:"director", emoji:"🏢", label:"Building Director",
    tagline:"Costs, sustainability and compliance",
    color:"#818CF8", accentBg:"rgba(99,102,241,0.15)",
    accentBorder:"rgba(129,140,248,0.4)",
  },
  facilities: {
    id:"facilities", emoji:"🔧", label:"Facilities Manager",
    tagline:"Faults, waste and equipment health",
    color:"#34D399", accentBg:"rgba(52,211,153,0.12)",
    accentBorder:"rgba(52,211,153,0.4)",
  },
  it: {
    id:"it", emoji:"💻", label:"IT / Technical",
    tagline:"Precise data, circuits and server room",
    color:"#60A5FA", accentBg:"rgba(96,165,250,0.12)",
    accentBorder:"rgba(96,165,250,0.4)",
  },
  sustainability: {
    id:"sustainability", emoji:"🌿", label:"Sustainability Officer",
    tagline:"Carbon, solar and EU reporting",
    color:"#4ADE80", accentBg:"rgba(74,222,128,0.12)",
    accentBorder:"rgba(74,222,128,0.4)",
  },
  worker: {
    id:"worker", emoji:"👤", label:"Office Worker",
    tagline:"My floor, my room, my comfort",
    color:"#FBBF24", accentBg:"rgba(251,191,36,0.12)",
    accentBorder:"rgba(251,191,36,0.4)",
  },
  // ev: {
  //   id:"ev", emoji:"🚗", label:"EV Driver",
  //   tagline:"Charging cost and best time to plug in",
  //   color:"#38BDF8", accentBg:"rgba(56,189,248,0.12)",
  //   accentBorder:"rgba(56,189,248,0.4)",
  // },
  visitor: {
    id:"visitor", emoji:"👋", label:"Visitor",
    tagline:"Explore this smart building",
    color:"#F9A8D4", accentBg:"rgba(249,168,212,0.12)",
    accentBorder:"rgba(249,168,212,0.4)",
  },
};

export const ROLE_ENTRY_ACTIONS = {
  director: [{ action:"reset_view" }, { action:"show_heatmap", metric:"temperature" }],
  facilities: [{ action:"reset_view" }, { action:"show_alerts" }],
  it: [{ action:"reset_view" }],
  sustainability: [{ action:"reset_view" }, { action:"show_heatmap", metric:"co2" }],
  worker: [{ action:"reset_view" }],
  // ev: [{ action:"reset_view" }],
  visitor: [{ action:"reset_view" }],
};

export const ROLE_ENTRY_MESSAGE = {
  director: "Showing building overview with temperature heatmap",
  facilities: "Showing all active alerts across the building",
  it: "Showing server room and technical circuits",
  sustainability: "Showing CO₂ levels across the building",
  worker: "Showing your floor — select your room below",
  // ev: "Showing EV charging area",
  visitor: "Welcome! Explore this smart building",
};

export function dispatchCmd(action, extra = {}) {
  window.dispatchEvent(new CustomEvent("cesium-command", {
    detail: { type:"cesium", action, ...extra },
  }));
}

export function computeBaseline(replayData, tariff) {
  const frames = replayData["main"] || [];
  if (!frames.length) return null;
  const totalKwh = frames.reduce((s, f) => s + (f.watts/1000)*0.25, 0);
  const watts = frames.map(f => f.watts);
  const peakW = Math.max(...watts);
  const avgW = watts.reduce((a,b) => a+b, 0) / watts.length;
  const afterHoursKwh = frames.filter(f => f.hour >= 20 || f.hour < 7)
    .reduce((s, f) => s + (f.watts/1000)*0.25, 0);
  const dailyKwh = totalKwh / 2;
  const monthlyKwh = dailyKwh * WORKING_DAYS_MONTH;
  const annualKwh = monthlyKwh * 12;
  const eui = annualKwh / FLOOR_AREA_M2;
  const monthlyCost = monthlyKwh * tariff;
  const carbonKgDay = dailyKwh * CARBON_FACTOR;
  const carbonTonYear = (annualKwh * CARBON_FACTOR) / 1000;
  const afterHoursRatio = totalKwh > 0 ? (afterHoursKwh/totalKwh)*100 : 0;
  const peakFactor = avgW > 0 ? peakW / avgW : 0;
  const loadFactor = peakW > 0 ? avgW / peakW : 0;

  let epcRating = "G";
  if      (eui < 50)  epcRating = "A+";
  else if (eui < 100) epcRating = "A";
  else if (eui < 150) epcRating = "B";
  else if (eui < 200) epcRating = "C";
  else if (eui < 250) epcRating = "D";
  else if (eui < 350) epcRating = "E";
  else if (eui < 500) epcRating = "F";

  return { totalKwh, dailyKwh, monthlyKwh, annualKwh, peakW, avgW, peakFactor, loadFactor, afterHoursKwh, afterHoursRatio, monthlyCost, carbonKgDay, carbonTonYear, eui, epcRating };
}

export function circuitStats(replayData, circuitId) {
  const frames = replayData[circuitId] || [];
  if (!frames.length) return { current: 0, peak: 0, avg: 0, kwh48: 0 };
  const watts = frames.map(f => f.watts);
  const current = (frames[frames.length-1] || frames[0])?.watts ?? 0;
  return {
    current,
    peak: Math.max(...watts),
    avg: watts.reduce((a,b) => a+b,0) / watts.length,
    kwh48: frames.reduce((s,f) => s + (f.watts/1000)*0.25, 0),
  };
}

export function fmtEur(v) { return `€${Math.abs(v ?? 0).toFixed(0)}`; }
export function fmtW(w) { return w >= 1000 ? `${(w/1000).toFixed(1)} kW` : `${Math.round(w)} W`; }

const CIRCUIT_FALLBACK_PROFILES = {
  main: { base: 8200, peak: 18200, peakHour: 13, weekendFactor: 0.72 },
  circuit6boiler: { base: 3200, peak: 8500, peakHour: 7, weekendFactor: 0.86 },
  circuit7: { base: 400, peak: 2800, peakHour: 11, weekendFactor: 0.35 },
  elevator: { base: 250, peak: 1500, peakHour: 12, weekendFactor: 0.3 },
  circuit8: { base: 2100, peak: 4800, peakHour: 14, weekendFactor: 0.65 },
  circuit9: { base: 1800, peak: 5200, peakHour: 10, weekendFactor: 0.48 },
  circuit10: { base: 2400, peak: 6100, peakHour: 13, weekendFactor: 0.52 },
  circuit11: { base: 1600, peak: 3900, peakHour: 10, weekendFactor: 0.46 },
  circuit12: { base: 900, peak: 2200, peakHour: 12, weekendFactor: 0.42 },
  airconditioner1: { base: 1400, peak: 4500, peakHour: 15, weekendFactor: 0.6 },
  airconditioner2: { base: 1300, peak: 4200, peakHour: 15, weekendFactor: 0.58 },
  outsidelighting1: { base: 150, peak: 1100, peakHour: 21, weekendFactor: 0.95 },
  outsidelighting2: { base: 180, peak: 1250, peakHour: 21, weekendFactor: 0.95 },
  vehiclecharging1: { base: 0, peak: 7000, peakHour: 18, weekendFactor: 0.7 },
  vehiclecharging2: { base: 0, peak: 6500, peakHour: 19, weekendFactor: 0.7 },
  "3DLED": { base: 300, peak: 1800, peakHour: 16, weekendFactor: 0.8 },
  ovk: { base: 900, peak: 3000, peakHour: 14, weekendFactor: 0.74 },
};

function getCircuitFallbackProfile(circuitId) {
  return CIRCUIT_FALLBACK_PROFILES[circuitId] || { base: 1000, peak: 3000, peakHour: 12, weekendFactor: 0.6 };
}

function synthCircuitWatts(circuitId, timestampMs) {
  const profile = getCircuitFallbackProfile(circuitId);
  const dt = new Date(timestampMs);
  const hour = dt.getHours() + (dt.getMinutes() / 60);
  const day = dt.getDay();
  const isWeekend = day === 0 || day === 6;
  const sigma = 3.2;
  const gaussian = Math.exp(-Math.pow(hour - profile.peakHour, 2) / (2 * sigma * sigma));
  const workHoursBoost = hour >= 7 && hour <= 20 ? 1 : 0.28;
  const nightLightingBoost =
    circuitId.startsWith("outsidelighting") ? (hour >= 18 || hour <= 6 ? 1.15 : 0.18) : 1;
  const evChargingBoost =
    circuitId.startsWith("vehiclecharging") ? ((hour >= 17 && hour <= 22) || (hour >= 7 && hour <= 9) ? 1 : 0.08) : 1;
  const weekendFactor = isWeekend ? profile.weekendFactor : 1;
  const harmonic = 0.08 * Math.sin((timestampMs / 3600000) * 0.9 + circuitId.length);
  const watts =
    (profile.base + (profile.peak - profile.base) * gaussian) *
    workHoursBoost *
    nightLightingBoost *
    evChargingBoost *
    weekendFactor *
    (1 + harmonic);
  return Math.max(0, Math.round(watts));
}

export function buildCircuitHistoryRows(circuitId, days = 7, replayData = {}) {
  const sourceFrames = Array.isArray(replayData?.[circuitId]) ? replayData[circuitId] : [];
  const stepMs = 15 * 60 * 1000;
  const totalPoints = Math.max(2, Math.round((days * 24 * 60) / 15));
  const endMs = Date.now();
  const startMs = endMs - ((totalPoints - 1) * stepMs);

  if (sourceFrames.length >= 2) {
    return Array.from({ length: totalPoints }, (_, index) => {
      const frame = sourceFrames[index % sourceFrames.length] || sourceFrames[sourceFrames.length - 1];
      return {
        ts_5min: new Date(startMs + (index * stepMs)).toISOString(),
        value: Number(frame?.watts) || 0,
        circuit_id: circuitId === "3DLED" ? "x3dled" : circuitId,
      };
    });
  }

  return Array.from({ length: totalPoints }, (_, index) => {
    const timestampMs = startMs + (index * stepMs);
    return {
      ts_5min: new Date(timestampMs).toISOString(),
      value: synthCircuitWatts(circuitId, timestampMs),
      circuit_id: circuitId === "3DLED" ? "x3dled" : circuitId,
    };
  });
}

export function buildCircuitHistoryMap(circuitIds, days = 7, replayData = {}) {
  return Object.fromEntries(
    (circuitIds || []).map((id) => [id, buildCircuitHistoryRows(id, days, replayData)])
  );
}

export function epcColor(r) {
  if (r === "A+" || r === "A") return "#4ADE80";
  if (r === "B"  || r === "C") return "#FBBF24";
  if (r === "D"  || r === "E") return "#FB923C";
  return "#EF4444";
}

export function comfortStatus(temp, co2, humidity) {
  const warnings = [];
  if (temp > 25) warnings.push("warm");
  if (temp < 18) warnings.push("cold");
  if (co2  > 1000) warnings.push("stuffy");
  if (humidity < 25 || humidity > 75) warnings.push("dry/humid");
  if (!warnings.length) return { label:"✓ Comfortable right now", color:"#4ADE80" };
  if (co2 > 1000)       return { label:"💨 Air feels a bit stale — try opening a window", color:"#FBBF24" };
  if (temp > 25)        return { label:"🌡 A bit warm — AC may need adjustment", color:"#FB923C" };
  if (warnings.length === 1) return { label:`⚠ Mostly comfortable (${warnings[0]})`, color:"#FBBF24" };
  return { label:"Contact facilities: Room needs attention", color:"#EF4444" };
}
