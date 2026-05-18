export const METER_TO_CIRCUIT_ID = {
  BuildingMain: "main",
  OVK: "ovk",
  "3D_LED": "3DLED",
  AC_Elevator: "elevator",
  TAC_Elevator: "elevator",
  OutsideLighting_1: "outsidelighting1",
  OutsideLighting_2: "outsidelighting2",
  VehicleCharging_1: "vehiclecharging1",
  VehicleCharging_2: "vehiclecharging2",
  AirConditioner_1: "airconditioner1",
  AirConditioner_2: "airconditioner2",
  Circuit_7: "circuit7",
  Circuit_8: "circuit8",
  Circuit_9: "circuit9",
  Circuit_10: "circuit10",
  Circuit_11: "circuit11",
  Circuit_12: "circuit12",
  Boiler_Circuit_6: "circuit6boiler",
};

export const ALL_METERS = [
  "BuildingMain",
  "OVK",
  "3D_LED",
  "TAC_Elevator",
  "OutsideLighting_1",
  "OutsideLighting_2",
  "VehicleCharging_1",
  "VehicleCharging_2",
  "AirConditioner_1",
  "AirConditioner_2",
  "Circuit_7",
  "Circuit_8",
  "Circuit_9",
  "Circuit_10",
  "Circuit_11",
  "Circuit_12",
  "Boiler_Circuit_6",
];

export const ALL_SOLAR_PARAMS = [
  "PpvInput",
  "Battery_P",
  "SOC",
  "Temperature1",
  "PmeterTotal",
  "Pload",
];

export const SOLAR_PARAM_TO_APP_KEY = Object.fromEntries(
  ALL_SOLAR_PARAMS.map((p) => [p, p.toLowerCase()])
);

export const FLOOR_ROOMS = {
  0: ["conference_room", "kitchen", "lobby"],
  1: ["hall_sap", "meeting_room", "training_lab", "visualisation"],
  2: [
    "cabinet_1", "cabinet_3", "cabinet_5", "cabinet_6", "cabinet_7",
    "cabinet_8", "cabinet_9", "discussion_room", "recreation_hall",
    "research_leader_1", "research_leader_2", "research_leader_3",
    "research_leader_4", "researchers", "waiting_area",
  ],
  3: [
    "assist_director_2", "assist_director_3", "assistant", "business",
    "director", "host", "hr", "it_department", "lawyer", "meeting",
    "office_1", "waiting_area",
  ],
};

export function mapElectricityResponse(raw, meterName) {
  if (!raw || typeof raw !== "object") return [];

  const item = Array.isArray(raw) ? raw[0] : raw;
  if (!item) return [];

  const meter = String(item.meter ?? meterName ?? "");
  const circuitId = METER_TO_CIRCUIT_ID[meter] ?? meter.toLowerCase();
  const meterType = String(item.meter_type ?? "Power");
  const unit = String(item.unit ?? "W");
  const readings = Array.isArray(item.readings) ? item.readings : [];

  return readings
    .map((r) => {
      if (!r || r.value === undefined || r.value === null) return null;
      const tsISO = String(r.timestamp ?? "");
      const ms = Date.parse(tsISO);
      if (!tsISO || isNaN(ms)) return null;
      return {
        meter,
        circuit_id: circuitId,
        meter_type: meterType,
        value: Number(r.value),
        unit,
        timestampMs: ms,
        tsISO,
      };
    })
    .filter(Boolean);
}

export function mapAllElectricityResponses(responses, meterType = "Power") {
  const flat = [];
  responses.forEach((raw, i) => {
    if (!raw) return;
    const meterName = ALL_METERS[i];
    const items = Array.isArray(raw) ? raw : [raw];
    items.forEach((item) => {
      flat.push(...mapElectricityResponse(item, meterName));
    });
  });
  return flat.map((r) => ({ ...r, meter_type: meterType }));
}

export function mapSolarResponse(raw, paramName) {
  if (!raw || typeof raw !== "object") return [];

  const param = String(raw.parameter ?? paramName ?? "");
  const unit = String(raw.unit ?? "");
  const readings = Array.isArray(raw.readings) ? raw.readings : [];
  const appKey = (SOLAR_PARAM_TO_APP_KEY[param] ?? param).toLowerCase();

  return readings
    .map((r) => {
      if (!r || r.value === undefined || r.value === null) return null;
      const tsISO = String(r.timestamp ?? "");
      const ms = Date.parse(tsISO);
      if (!tsISO || isNaN(ms)) return null;
      return {
        parameter: param,
        value: Number(r.value),
        unit,
        timestampMs: ms,
        tsISO,
        appKey,
      };
    })
    .filter(Boolean);
}

export function mapAllSolarResponses(responses) {
  const flat = [];
  responses.forEach((raw, i) => {
    if (!raw) return;
    flat.push(...mapSolarResponse(raw, ALL_SOLAR_PARAMS[i]));
  });
  return flat;
}

export function mapSensorFloorResponse(raw, floor) {
  if (!Array.isArray(raw)) return [];

  const out = [];

  for (const roomData of raw) {
    if (!roomData || typeof roomData !== "object") continue;
    const room_id = String(roomData.room ?? "");
    if (!room_id) continue;

    const sensors = Array.isArray(roomData.sensors) ? roomData.sensors : [];

    for (const sensor of sensors) {
      const sensor_id = String(sensor?.sensor_id ?? "");
      const readings = Array.isArray(sensor?.readings) ? sensor.readings : [];

      for (const reading of readings) {
        if (!reading || reading.value === undefined || reading.value === null) continue;
        const tsISO = String(reading.timestamp ?? "");
        const ms = Date.parse(tsISO);
        if (!tsISO || isNaN(ms)) continue;

        out.push({
          room_id,
          floor,
          sensor_id,
          parameter: String(reading.parameter ?? ""),
          value: Number(reading.value),
          unit: String(reading.unit ?? ""),
          timestampMs: ms,
          tsISO,
        });
      }
    }
  }

  return out;
}

export function aggregateSensorReadingsToRoomRows(readings) {
  const BUCKET_MS = 15 * 60 * 1000;

  const byRoom = new Map();

  for (const r of readings) {
    const { room_id, floor, parameter, value, timestampMs, tsISO } = r;
    if (!room_id || !parameter) continue;

    const bucket = Math.floor(timestampMs / BUCKET_MS) * BUCKET_MS;
    const tsKey = `${room_id}::${bucket}`;

    if (!byRoom.has(tsKey)) {
      byRoom.set(tsKey, {
        room_id,
        floor,
        bucket,
        ts: tsISO,
        temp_sum: 0, temp_count: 0,
        humidity_sum: 0, humidity_count: 0,
        co2_sum: 0, co2_count: 0,
      });
    }

    const entry = byRoom.get(tsKey);

    if (parameter === "Temp") {
      entry.temp_sum += value; entry.temp_count++;
    } else if (parameter === "Humidity") {
      entry.humidity_sum += value; entry.humidity_count++;
    } else if (parameter === "CO2") {
      entry.co2_sum += value; entry.co2_count++;
    }
  }

  return Array.from(byRoom.values()).map((e) => ({
    room_id: e.room_id,
    floor: e.floor,
    temp_c: e.temp_count > 0 ? e.temp_sum / e.temp_count : null,
    humidity_rh: e.humidity_count > 0 ? e.humidity_sum / e.humidity_count : null,
    co2_ppm: e.co2_count > 0 ? e.co2_sum / e.co2_count : null,
    ts: e.ts,
    timestampMs: e.bucket,
  }));
}

export function buildBuildingSnapshot(elecReadings, solarReadings, roomRows) {
  const latestByCircuit = {};
  for (const r of elecReadings) {
    const prev = latestByCircuit[r.circuit_id];
    if (!prev || r.timestampMs > prev.timestampMs) {
      latestByCircuit[r.circuit_id] = r;
    }
  }

  const mainReading = latestByCircuit["main"];

  const latestBySolarParam = {};
  for (const r of solarReadings) {
    const prev = latestBySolarParam[r.parameter];
    if (!prev || r.timestampMs > prev.timestampMs) {
      latestBySolarParam[r.parameter] = r;
    }
  }

  let tempSum = 0, tempCount = 0;
  let humSum = 0, humCount = 0;
  let co2Sum = 0, co2Count = 0;

  const roomsWithData = new Set();

  for (const row of roomRows) {
    if (row.temp_c != null) { tempSum += row.temp_c; tempCount++; roomsWithData.add(row.room_id); }
    if (row.humidity_rh != null) { humSum += row.humidity_rh; humCount++; roomsWithData.add(row.room_id); }
    if (row.co2_ppm != null) { co2Sum += row.co2_ppm; co2Count++; roomsWithData.add(row.room_id); }
  }

  return {
    buildingLoadW: mainReading ? mainReading.value : 0,
    circuitsReporting: Object.keys(latestByCircuit).length,
    solarPvW: latestBySolarParam["PpvInput"] ? latestBySolarParam["PpvInput"].value : 0,
    solarSocPct: latestBySolarParam["SOC"] ? latestBySolarParam["SOC"].value : 0,
    solarBattW: latestBySolarParam["Battery_P"] ? latestBySolarParam["Battery_P"].value : 0,
    roomsReporting: roomsWithData.size,
    indoorTempC: tempCount > 0 ? tempSum / tempCount : 0,
    indoorHumidityPct: humCount > 0 ? humSum / humCount : 0,
    indoorCo2Ppm: co2Count > 0 ? co2Sum / co2Count : 0,
    updatedAtMs: Date.now(),
  };
}

export function buildAllRoomLatestStates(readings) {
  const byRoom = {};

  for (const r of readings) {
    if (!r.room_id || !r.parameter) continue;
    if (!byRoom[r.room_id]) {
      byRoom[r.room_id] = { room_id: r.room_id, floor: r.floor, latestMs: 0 };
    }
    const state = byRoom[r.room_id];

    if (r.parameter === "Temp" && (!state._tempMs || r.timestampMs > state._tempMs)) {
      state.temperature = r.value;
      state._tempMs = r.timestampMs;
    }
    if (r.parameter === "Humidity" && (!state._humMs || r.timestampMs > state._humMs)) {
      state.humidity = r.value;
      state._humMs = r.timestampMs;
    }
    if (r.parameter === "CO2" && (!state._co2Ms || r.timestampMs > state._co2Ms)) {
      state.co2 = r.value;
      state._co2Ms = r.timestampMs;
    }

    state.latestMs = Math.max(state.latestMs, r.timestampMs);
  }

  return Object.values(byRoom).map((s) => ({
    room_id: s.room_id,
    floor: s.floor,
    temperature: s.temperature ?? null,
    humidity: s.humidity ?? null,
    co2: s.co2 ?? null,
    updatedAtMs: s.latestMs > 0 ? s.latestMs : null,
    updatedAtISO: s.latestMs > 0 ? new Date(s.latestMs).toISOString() : null,
    temperatureObservedAtMs: s._tempMs > 0 ? s._tempMs : null,
    humidityObservedAtMs: s._humMs > 0 ? s._humMs : null,
    co2ObservedAtMs: s._co2Ms > 0 ? s._co2Ms : null,
  }));
}

export function buildRoomHistoricalSeries(readings) {
  const byRoom = {};

  for (const r of readings) {
    if (!r.room_id) continue;
    if (!byRoom[r.room_id]) {
      byRoom[r.room_id] = {
        room_id: r.room_id,
        floor: r.floor,
        temperature: [],
        humidity: [],
        co2: [],
      };
    }
    const series = byRoom[r.room_id];
    const point = { timestampMs: r.timestampMs, value: r.value };

    if (r.parameter === "Temp") series.temperature.push(point);
    else if (r.parameter === "Humidity") series.humidity.push(point);
    else if (r.parameter === "CO2") series.co2.push(point);
  }

  for (const s of Object.values(byRoom)) {
    s.temperature.sort((a, b) => a.timestampMs - b.timestampMs);
    s.humidity.sort((a, b) => a.timestampMs - b.timestampMs);
    s.co2.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  return Object.values(byRoom);
}
