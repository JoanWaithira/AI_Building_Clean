export const FAULT_SEVERITY = {
  INFO: "info",
  WARNING: "warning",
  ALERT: "alert",
  CRITICAL: "critical",
};

export const FAULT_CATEGORY = {
  HVAC: "hvac",
  ELECTRICAL: "electrical",
  SOLAR: "solar",
  BATTERY: "battery",
  IAQ: "iaq",
};

const NON_ESSENTIAL = [
  "circuit7","circuit9","circuit10","circuit11",
  "circuit12","outsidelighting1","outsidelighting2",
  "3DLED","airconditioner1","airconditioner2",
];

const HVAC_CIRCUITS = ["airconditioner1","airconditioner2","circuit6boiler"];

const isAfterHours = (hour) => hour < 7 || hour >= 21;
const isWeekend = (dow) => dow === 0 || dow === 6;

export const FAULT_RULES = [
  {
    id: "HVAC_OVERCONSUMPTION",
    category: FAULT_CATEGORY.HVAC,
    severity: FAULT_SEVERITY.WARNING,
    label: "HVAC overconsumption",
    description: "AC drawing significantly more than temperature-adjusted baseline.",
    causes: [
      "Refrigerant leak or low charge",
      "Dirty or blocked air filter",
      "Failing compressor",
      "Stuck open damper letting in hot air",
    ],
    actions: [
      "Check AC filter — clean or replace if blocked",
      "Inspect refrigerant pressure",
      "Check outdoor unit for obstructions",
      "Book HVAC service if persists >24h",
    ],
    weeklyWasteCost: (excessKwh, tariff) => excessKwh * 7 * tariff,
  },
  {
    id: "HVAC_AFTER_HOURS",
    category: FAULT_CATEGORY.HVAC,
    severity: FAULT_SEVERITY.WARNING,
    label: "HVAC running after hours",
    description: "Heating or cooling active outside scheduled operating hours.",
    causes: [
      "BMS schedule not configured",
      "Manual override left active",
      "Occupant left thermostat on",
      "Pre-heat/cool window set too early",
    ],
    actions: [
      "Check BMS schedule for HVAC zones",
      "Verify no manual overrides are active",
      "Set auto-off schedule if missing",
    ],
    weeklyWasteCost: (wasteKwh, tariff) => wasteKwh * 7 * tariff,
  },
  {
    id: "BOILER_SHORT_CYCLING",
    category: FAULT_CATEGORY.HVAC,
    severity: FAULT_SEVERITY.WARNING,
    label: "Boiler short cycling",
    description: "Boiler cycling on/off more frequently than normal — indicates control fault.",
    causes: [
      "Aquastat set too close to boiler temperature",
      "Oversized boiler for current load",
      "Air trapped in heating circuit",
      "Faulty thermistor giving erratic readings",
    ],
    actions: [
      "Check aquastat differential setting",
      "Bleed radiators to remove air",
      "Inspect thermistor wiring",
      "Call heating engineer if persists",
    ],
    weeklyWasteCost: () => 0,
  },
  {
    id: "THERMAL_DRIFT",
    category: FAULT_CATEGORY.HVAC,
    severity: FAULT_SEVERITY.ALERT,
    label: "Room temperature drift",
    description: "Room not reaching setpoint despite HVAC running at expected load.",
    causes: [
      "Window or door left open",
      "Excessive solar gain through glazing",
      "HVAC undersized for current conditions",
      "Envelope fault (insulation, seals)",
    ],
    actions: [
      "Check all windows and doors in affected zone",
      "Inspect window seals and door sweeps",
      "Verify HVAC dampers fully open",
      "Check for unusual heat sources",
    ],
    weeklyWasteCost: () => 0,
  },
  {
    id: "CIRCUIT_OVERCONSUMPTION",
    category: FAULT_CATEGORY.ELECTRICAL,
    severity: FAULT_SEVERITY.WARNING,
    label: "Circuit overconsumption",
    description: "Circuit drawing significantly more than its historical baseline for this time of day.",
    causes: [
      "New high-load equipment added to circuit",
      "Equipment fault causing excess draw",
      "Heating element stuck on",
      "Motor running in degraded state",
    ],
    actions: [
      "Check what equipment is on this circuit",
      "Compare to circuit breaker rating",
      "Inspect for signs of overheating",
      "Measure individual outlet loads if possible",
    ],
    weeklyWasteCost: (excessKwh, tariff) => excessKwh * 7 * tariff,
  },
  {
    id: "AFTER_HOURS_LOAD",
    category: FAULT_CATEGORY.ELECTRICAL,
    severity: FAULT_SEVERITY.WARNING,
    label: "After-hours electrical load",
    description: "Non-essential circuits drawing significant power outside operating hours.",
    causes: [
      "Equipment not switched off",
      "Scheduled shutdown not executing",
      "Unauthorized equipment use",
      "Vending machines, displays left on",
    ],
    actions: [
      "Walk the affected floors after hours",
      "Implement automated shutdown schedule",
      "Install smart plugs on non-essential equipment",
      "Add signage reminding staff to power down",
    ],
    weeklyWasteCost: (wasteKwh, tariff) => wasteKwh * 7 * tariff,
  },
  {
    id: "CIRCUIT_FLATLINE",
    category: FAULT_CATEGORY.ELECTRICAL,
    severity: FAULT_SEVERITY.ALERT,
    label: "Circuit not responding",
    description: "Circuit showing zero consumption during expected operating hours — possible supply failure.",
    causes: [
      "Circuit breaker tripped",
      "Metering device fault",
      "Supply cable fault",
      "Main isolator open",
    ],
    actions: [
      "Check circuit breaker in distribution board",
      "Verify metering device connection",
      "Test circuit with known load",
      "Call electrician if breaker keeps tripping",
    ],
    weeklyWasteCost: () => 0,
  },
  {
    id: "DEMAND_SPIKE",
    category: FAULT_CATEGORY.ELECTRICAL,
    severity: FAULT_SEVERITY.INFO,
    label: "Demand charge event",
    description: "Building load exceeding rolling monthly peak — demand charge will increase.",
    causes: [
      "Multiple high-load systems starting together",
      "EV chargers starting simultaneously",
      "Unscheduled equipment operation",
      "Cold start after extended shutdown",
    ],
    actions: [
      "Stagger EV charger start times",
      "Pre-cool building before occupancy",
      "Check for unnecessary simultaneous loads",
      "Consider demand limiting controller",
    ],
    weeklyWasteCost: (peakKw, demandCharge) => peakKw * demandCharge,
  },
  {
    id: "PV_STRING_IMBALANCE",
    category: FAULT_CATEGORY.SOLAR,
    severity: FAULT_SEVERITY.WARNING,
    label: "PV string imbalance",
    description: "PV1 and PV2 strings producing significantly different output under identical conditions.",
    causes: [
      "Soiling or bird droppings on one string",
      "Partial shading (new obstruction)",
      "Cell degradation on affected string",
      "Loose or corroded DC connector",
    ],
    actions: [
      "Inspect PV1 and PV2 panels for soiling",
      "Check for new shading sources (structures, vegetation)",
      "Inspect DC connectors and junction boxes",
      "Book thermal imaging inspection",
    ],
    weeklyWasteCost: (lossKwh, tariff) => lossKwh * 7 * tariff,
  },
  {
    id: "PV_UNDERPERFORMANCE",
    category: FAULT_CATEGORY.SOLAR,
    severity: FAULT_SEVERITY.WARNING,
    label: "Solar underperformance",
    description: "PV yield significantly below weather-adjusted expectation.",
    causes: [
      "Panel soiling reducing output",
      "Inverter operating below rated efficiency",
      "DC wiring resistance increased",
      "Panel degradation beyond normal aging",
    ],
    actions: [
      "Clean solar panels (use deionised water)",
      "Check inverter display for fault codes",
      "Inspect DC cable connections",
      "Compare to installer performance guarantee",
    ],
    weeklyWasteCost: (lossKwh, tariff) => lossKwh * 7 * tariff,
  },
  {
    id: "PV_INVERTER_FAULT",
    category: FAULT_CATEGORY.SOLAR,
    severity: FAULT_SEVERITY.ALERT,
    label: "Solar inverter fault",
    description: "Zero PV output during daylight hours with good irradiance.",
    causes: [
      "Inverter protection tripped",
      "AC contactor fault",
      "Grid voltage out of range",
      "DC isolator left open",
    ],
    actions: [
      "Check inverter display for error code",
      "Try inverter restart sequence",
      "Verify DC isolator is closed",
      "Call solar installer if error persists",
    ],
    weeklyWasteCost: (lossKwh, tariff) => lossKwh * 7 * tariff,
  },
  {
    id: "BATTERY_TEMP_HIGH",
    category: FAULT_CATEGORY.BATTERY,
    severity: FAULT_SEVERITY.CRITICAL,
    label: "Battery high temperature",
    description: "Battery pack temperature above safe operating threshold.",
    causes: [
      "Battery room cooling failure",
      "Overcharge condition",
      "Cell fault causing internal heating",
      "Blocked ventilation around battery",
    ],
    actions: [
      "IMMEDIATELY check battery room cooling",
      "Verify charge controller settings",
      "Ensure adequate ventilation clearance",
      "Call battery service engineer",
      "Consider emergency discharge if >50°C",
    ],
    weeklyWasteCost: () => 0,
  },
  {
    id: "BATTERY_NO_CHARGE",
    category: FAULT_CATEGORY.BATTERY,
    severity: FAULT_SEVERITY.ALERT,
    label: "Battery not charging",
    description: "SOC not increasing during peak solar hours despite available generation.",
    causes: [
      "Charge controller fault or misconfiguration",
      "BMS protection mode active",
      "DC isolator between PV and battery open",
      "Battery fully charged (not a fault)",
    ],
    actions: [
      "Check charge controller display for errors",
      "Verify BMS is not in protection mode",
      "Check DC isolators and fuses",
      "Review charge settings with installer",
    ],
    weeklyWasteCost: (missedKwh, tariff) => missedKwh * 7 * tariff,
  },
  {
    id: "BATTERY_LOW_SOC_PATTERN",
    category: FAULT_CATEGORY.BATTERY,
    severity: FAULT_SEVERITY.WARNING,
    label: "Repeated low SOC",
    description: "Battery regularly depleting to very low levels — may indicate undersized storage or charge fault.",
    causes: [
      "Daily load exceeding battery capacity",
      "Charge controller not reaching full charge",
      "Battery capacity degraded over time",
      "Charge cut-off set too low",
    ],
    actions: [
      "Review daily charge/discharge cycle",
      "Check if charge reaches 100% regularly",
      "Consider battery capacity expansion",
      "Adjust overnight charge schedule",
    ],
    weeklyWasteCost: () => 0,
  },
  {
    id: "CO2_ELEVATED",
    category: FAULT_CATEGORY.IAQ,
    severity: FAULT_SEVERITY.WARNING,
    label: "Elevated CO₂",
    description: "Room CO₂ above 1000 ppm during occupied hours — air quality affecting occupant wellbeing.",
    causes: [
      "Ventilation rate insufficient for occupancy",
      "AHU damper stuck or undersized",
      "Air filter blocked reducing flow",
      "Occupancy higher than design capacity",
    ],
    actions: [
      "Boost ventilation rate for affected room",
      "Open windows if outdoor conditions allow",
      "Inspect AHU filter and damper",
      "Check occupancy against room design capacity",
    ],
    weeklyWasteCost: () => 0,
  },
  {
    id: "CO2_NOT_RECOVERING",
    category: FAULT_CATEGORY.IAQ,
    severity: FAULT_SEVERITY.ALERT,
    label: "CO₂ not recovering",
    description: "Room CO₂ not dropping after occupants leave — ventilation likely not functioning.",
    causes: [
      "Ventilation damper stuck closed",
      "AHU fan fault",
      "Duct obstruction or disconnection",
      "Occupancy schedule not linked to AHU",
    ],
    actions: [
      "Physically inspect ventilation damper",
      "Test AHU fan operation",
      "Check ductwork for blockage",
      "Verify BMS occupancy schedule",
    ],
    weeklyWasteCost: () => 0,
  },
  {
    id: "HUMIDITY_HIGH",
    category: FAULT_CATEGORY.IAQ,
    severity: FAULT_SEVERITY.WARNING,
    label: "High humidity",
    description: "Room humidity above 65% — mould risk and occupant discomfort.",
    causes: [
      "HVAC dehumidification not functioning",
      "Water ingress through envelope",
      "High outdoor humidity with inadequate control",
      "Plumbing leak in ceiling or walls",
    ],
    actions: [
      "Check HVAC dehumidification settings",
      "Inspect for water staining or dampness",
      "Verify no plumbing leaks in vicinity",
      "Increase ventilation to dilute moisture",
    ],
    weeklyWasteCost: () => 0,
  },
];

export function runFaultDetection({
  replayData = {},
  pvData = {},
  climateData = {},
  currentFrame = 0,
  outsideTemp = 20,
  tariff = 0.22,
  demandCharge = 8.50,
}) {
  const allFaults = [];

  const getFrames = (circuitKey, fromFrame, toFrame) => {
    const series = replayData?.[circuitKey] ?? [];
    return series.slice(Math.max(0, fromFrame), Math.min(series.length, toFrame + 1));
  };

  const avgWatts = (frames) => {
    if (!frames.length) return 0;
    return frames.reduce((s, f) => s + (f.watts ?? 0), 0) / frames.length;
  };

  const frameToHour = (fi) => {
    const now = new Date();
    const msAgo = (95 - fi) * 15 * 60 * 1000;
    return new Date(now.getTime() - msAgo).getHours();
  };

  const rule = (id) => FAULT_RULES.find((r) => r.id === id);

  const makeFault = (r, frameIdx, data = {}) => ({
    id: r.id,
    category: r.category,
    severity: data.severity ?? r.severity,
    label: r.label,
    description: r.description,
    causes: r.causes,
    actions: r.actions,
    frameIdx,
    hour: frameToHour(frameIdx),
    detectedAt: Date.now(),
    data,
    weeklyCost: r.weeklyWasteCost?.(data.excessKwh ?? data.wasteKwh ?? data.lossKwh ?? data.missedKwh ?? data.peakKw ?? 0, tariff) ?? 0,
  });

  const CUR_START = Math.max(0, currentFrame - 2);
  const CUR_END = currentFrame;
  const EXT_START = Math.max(0, currentFrame - 7);

  const getBaselineKw = (circuitKey) => {
    const morningFrames = replayData?.[circuitKey]?.slice(0, 24) ?? [];
    return avgWatts(morningFrames) / 1000 || 2;
  };

  if (outsideTemp > 18) {
    ["airconditioner1", "airconditioner2"].forEach((circ) => {
      const curFrames = getFrames(circ, CUR_START, CUR_END);
      const curAvgKw = avgWatts(curFrames) / 1000;
      const hour = frameToHour(currentFrame);
      const baseKw = getBaselineKw(circ);
      const tempFactor = 1 + (outsideTemp - 22) * 0.06;
      const expectedKw = baseKw * tempFactor;
      if (curAvgKw > expectedKw * 1.35 && curFrames.length >= 2 && !isAfterHours(hour)) {
        const excessKwh = (curAvgKw - expectedKw) * 0.75;
        allFaults.push(makeFault(rule("HVAC_OVERCONSUMPTION"), currentFrame, {
          circuit: circ, actual: curAvgKw, expected: expectedKw, excessKwh,
          deviationPct: Math.round((curAvgKw - expectedKw) / expectedKw * 100),
        }));
      }
    });
  }

  {
    const hour = frameToHour(currentFrame);
    const dow = new Date().getDay();
    if (isAfterHours(hour) || isWeekend(dow)) {
      HVAC_CIRCUITS.forEach((circ) => {
        const curFrames = getFrames(circ, CUR_START, CUR_END);
        const curAvgKw = avgWatts(curFrames) / 1000;
        if (curAvgKw > 0.8 && curFrames.length >= 2) {
          allFaults.push(makeFault(rule("HVAC_AFTER_HOURS"), currentFrame, {
            circuit: circ, actual: curAvgKw, wasteKwh: curAvgKw, hour,
          }));
        }
      });
    }
  }

  {
    const boilerFrames = getFrames("circuit6boiler", EXT_START, CUR_END);
    if (boilerFrames.length >= 4) {
      let transitions = 0;
      for (let i = 1; i < boilerFrames.length; i++) {
        const prev = (boilerFrames[i - 1]?.watts ?? 0) > 200;
        const curr = (boilerFrames[i]?.watts ?? 0) > 200;
        if (prev !== curr) transitions++;
      }
      if (transitions > 4) {
        allFaults.push(makeFault(rule("BOILER_SHORT_CYCLING"), currentFrame, {
          transitions, windowFrames: boilerFrames.length,
        }));
      }
    }
  }

  {
    const hour = frameToHour(currentFrame);
    const allCircuitKeys = Object.keys(replayData ?? {}).filter((k) => k !== "main" && k !== "outdoor");
    allCircuitKeys.forEach((circ) => {
      const curFrames = getFrames(circ, CUR_START, CUR_END);
      const curAvgKw = avgWatts(curFrames) / 1000;
      const baseKw = getBaselineKw(circ);
      if (baseKw < 0.1) return;
      if (curAvgKw > baseKw * 1.45 && curFrames.length >= 2 && curAvgKw > 0.5) {
        const excessKwh = (curAvgKw - baseKw) * 0.75;
        allFaults.push(makeFault(rule("CIRCUIT_OVERCONSUMPTION"), currentFrame, {
          circuit: circ, actual: curAvgKw, expected: baseKw, excessKwh,
          deviationPct: Math.round((curAvgKw - baseKw) / baseKw * 100),
        }));
      }
    });
  }

  {
    const hour = frameToHour(currentFrame);
    const dow = new Date().getDay();
    if (isAfterHours(hour) || isWeekend(dow)) {
      NON_ESSENTIAL.forEach((circ) => {
        const curFrames = getFrames(circ, CUR_START, CUR_END);
        const curAvgKw = avgWatts(curFrames) / 1000;
        if (curAvgKw > 0.3) {
          allFaults.push(makeFault(rule("AFTER_HOURS_LOAD"), currentFrame, {
            circuit: circ, actual: curAvgKw, wasteKwh: curAvgKw,
          }));
        }
      });
    }
  }

  {
    const hour = frameToHour(currentFrame);
    if (!isAfterHours(hour)) {
      const expectedActive = ["circuit9","circuit11","elevator","circuit7","circuit8"];
      expectedActive.forEach((circ) => {
        const frames = getFrames(circ, EXT_START, CUR_END);
        const allZero = frames.every((f) => (f.watts ?? 0) < 10);
        if (allZero && frames.length >= 4) {
          allFaults.push(makeFault(rule("CIRCUIT_FLATLINE"), currentFrame, { circuit: circ }));
        }
      });
    }
  }

  {
    const mainSeries = replayData?.["main"] ?? [];
    const allWatts = mainSeries.map((f) => f.watts ?? 0);
    const rollingPeak = Math.max(...allWatts, 1);
    const curMain = getFrames("main", CUR_START, CUR_END);
    const curPeakKw = Math.max(...curMain.map((f) => f.watts ?? 0), 0) / 1000;
    const rollingPeakKw = rollingPeak / 1000;
    if (curPeakKw > rollingPeakKw * 0.95 && curPeakKw > 15) {
      allFaults.push(makeFault(rule("DEMAND_SPIKE"), currentFrame, {
        peakKw: curPeakKw, rollingPeakKw, demandCost: curPeakKw * demandCharge / 1000,
      }));
    }
  }

  {
    const pv1 = pvData?.pv1Power ?? [];
    const pv2 = pvData?.pv2Power ?? [];
    if (pv1.length && pv2.length) {
      const i1 = Math.min(currentFrame, pv1.length - 1);
      const i2 = Math.min(currentFrame, pv2.length - 1);
      const v1 = pv1[i1]?.value ?? 0;
      const v2 = pv2[i2]?.value ?? 0;
      const totalRad = pvData?.pvTotal?.[i1]?.totalRad ?? 0;
      if (totalRad > 300 && (v1 + v2) > 1) {
        const imbalancePct = Math.abs(v1 - v2) / ((v1 + v2) / 2) * 100;
        if (imbalancePct > 22) {
          const lossKwh = Math.abs(v1 - v2) * 0.25;
          allFaults.push(makeFault(rule("PV_STRING_IMBALANCE"), currentFrame, {
            pv1Kw: v1, pv2Kw: v2, imbalancePct: Math.round(imbalancePct), lossKwh,
          }));
        }
      }
    }
  }

  {
    const pvTotal = pvData?.pvTotal ?? [];
    if (pvTotal.length) {
      const idx = Math.min(currentFrame, pvTotal.length - 1);
      const frame = pvTotal[idx] ?? {};
      const actual = frame.value ?? 0;
      const rad = frame.totalRad ?? 0;
      if (rad > 400) {
        const expectedKw = rad * 20 * 0.19 * 0.86 * 0.001;
        if (actual < expectedKw * 0.72) {
          const lossKwh = (expectedKw - actual) * 0.25;
          allFaults.push(makeFault(rule("PV_UNDERPERFORMANCE"), currentFrame, {
            actual, expected: expectedKw, radiation: rad,
            deviationPct: Math.round((expectedKw - actual) / expectedKw * 100), lossKwh,
          }));
        }
      }
    }
  }

  {
    const pvTotal = pvData?.pvTotal ?? [];
    if (pvTotal.length) {
      const idx = Math.min(currentFrame, pvTotal.length - 1);
      const frame = pvTotal[idx] ?? {};
      const rad = frame.totalRad ?? 0;
      const hour = frameToHour(currentFrame);
      if (rad > 200 && hour >= 8 && hour <= 18) {
        const recentPV = pvTotal.slice(Math.max(0, idx - 2), idx + 1);
        if (recentPV.every((f) => (f.value ?? 0) < 0.1)) {
          allFaults.push(makeFault(rule("PV_INVERTER_FAULT"), currentFrame, { radiation: rad, hour }));
        }
      }
    }
  }

  {
    const bmsTemp = pvData?.bmsTemp ?? [];
    if (bmsTemp.length) {
      const idx = Math.min(currentFrame, bmsTemp.length - 1);
      const temp = bmsTemp[idx]?.value ?? 0;
      if (temp > 40) {
        allFaults.push(makeFault(rule("BATTERY_TEMP_HIGH"), currentFrame, {
          temp, isCritical: temp > 45,
          severity: temp > 45 ? FAULT_SEVERITY.CRITICAL : FAULT_SEVERITY.ALERT,
        }));
      }
    }
  }

  {
    const hour = frameToHour(currentFrame);
    if (hour >= 10 && hour <= 15) {
      const pvTotal = pvData?.pvTotal ?? [];
      const socSeries = pvData?.soc ?? [];
      const batSeries = pvData?.pvBattery ?? [];
      if (pvTotal.length && socSeries.length) {
        const idx = Math.min(currentFrame, pvTotal.length - 1);
        const pvKw = pvTotal[idx]?.value ?? 0;
        const socNow = socSeries[idx]?.value ?? 100;
        const batKw = batSeries[idx]?.value ?? 0;
        if (pvKw > 5 && batKw <= 0.1 && socNow < 95) {
          const missedKwh = pvKw * 0.25 * 0.7;
          allFaults.push(makeFault(rule("BATTERY_NO_CHARGE"), currentFrame, {
            pvKw, socNow, batteryKw: batKw, missedKwh,
          }));
        }
      }
    }
  }

  {
    const socSeries = pvData?.soc ?? [];
    if (socSeries.length >= 10) {
      const lowCount = socSeries.slice(0, currentFrame + 1).filter((f) => (f.value ?? 100) < 12).length;
      if (lowCount >= 3) {
        allFaults.push(makeFault(rule("BATTERY_LOW_SOC_PATTERN"), currentFrame, { lowEvents: lowCount }));
      }
    }
  }

  {
    const hour = frameToHour(currentFrame);
    if (!isAfterHours(hour)) {
      const rooms = climateData?.rooms ?? {};
      Object.entries(rooms).forEach(([roomId, frames]) => {
        if (!frames?.length) return;
        const idx = Math.min(currentFrame, frames.length - 1);
        const co2 = frames[idx]?.co2 ?? 0;
        if (co2 > 1000) {
          allFaults.push(makeFault(rule("CO2_ELEVATED"), currentFrame, { room: roomId, co2, threshold: 1000 }));
        }
      });
    }
  }

  {
    const hour = frameToHour(currentFrame);
    if (hour >= 9 && hour <= 20) {
      const rooms = climateData?.rooms ?? {};
      Object.entries(rooms).forEach(([roomId, frames]) => {
        if (frames.length < 4) return;
        const recent = frames.slice(Math.max(0, currentFrame - 3), currentFrame + 1);
        const allHigh = recent.every((f) => (f.co2 ?? 0) > 800);
        const prev = frames.slice(Math.max(0, currentFrame - 7), Math.max(0, currentFrame - 3));
        const wasHigh = prev.every((f) => (f.co2 ?? 0) > 800);
        if (allHigh && wasHigh && recent.length >= 3) {
          allFaults.push(makeFault(rule("CO2_NOT_RECOVERING"), currentFrame, {
            room: roomId, co2: recent[recent.length - 1]?.co2, durationFrames: 8,
          }));
        }
      });
    }
  }

  {
    const rooms = climateData?.rooms ?? {};
    Object.entries(rooms).forEach(([roomId, frames]) => {
      if (!frames?.length) return;
      const idx = Math.min(currentFrame, frames.length - 1);
      const humidity = frames[idx]?.humidity ?? 0;
      if (humidity > 65) {
        allFaults.push(makeFault(rule("HUMIDITY_HIGH"), currentFrame, { room: roomId, humidity, threshold: 65 }));
      }
    });
  }

  const seen = new Set();
  const deduped = allFaults.filter((f) => {
    const key = f.id + (f.data?.circuit ?? "") + (f.data?.room ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const severityOrder = { critical: 0, alert: 1, warning: 2, info: 3 };
  deduped.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  const summary = {
    total: deduped.length,
    critical: deduped.filter((f) => f.severity === "critical").length,
    alert: deduped.filter((f) => f.severity === "alert").length,
    warning: deduped.filter((f) => f.severity === "warning").length,
    info: deduped.filter((f) => f.severity === "info").length,
    byCategory: Object.fromEntries(
      Object.values(FAULT_CATEGORY).map((cat) => [cat, deduped.filter((f) => f.category === cat).length])
    ),
    totalWeeklyCost: deduped.reduce((s, f) => s + (f.weeklyCost ?? 0), 0),
  };

  return { active: deduped, summary };
}
