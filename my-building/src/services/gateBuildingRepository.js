import { gateGet, gateGetAll } from "./gateBuildingApiClient.js";
import {
  ALL_METERS,
  ALL_SOLAR_PARAMS,
  mapAllElectricityResponses,
  mapAllSolarResponses,
  mapSensorFloorResponse,
  aggregateSensorReadingsToRoomRows,
} from "./gateBuildingMappers.js";
import { toSofiaDateParams } from "../utils/timeUtils.js";

let _elecMeta = null;
let _solarMeta = null;
let _sensorMeta = null;

export async function fetchElectricityMeta() {
  if (_elecMeta) return _elecMeta;
  const raw = await gateGet("/electricity/meta");
  _elecMeta = Array.isArray(raw) ? raw : [];
  return _elecMeta;
}

export async function fetchSolarMeta() {
  if (_solarMeta) return _solarMeta;
  const raw = await gateGet("/solar/meta");
  _solarMeta = raw?.parameters ?? {};
  return _solarMeta;
}

export async function fetchSensorMeta() {
  if (_sensorMeta) return _sensorMeta;
  const raw = await gateGet("/sensor/data/meta");
  _sensorMeta = raw?.floors ?? {};
  return _sensorMeta;
}

// one request per meter, all issued in parallel
export async function fetchElectricityPower(dateRange, signal) {
  const params = { meter_type: "Power", ...dateRange };
  const meters = await fetchElectricityMeta()
    .then((meta) => meta.map((m) => m?.meter).filter(Boolean))
    .catch(() => ALL_METERS);

  const responses = await gateGetAll(
    meters.map((meter) => () =>
      gateGet("/electricity/data", { ...params, meter }, { signal })
    )
  );

  return mapAllElectricityResponses(responses, "Power");
}

export async function fetchElectricityEnergy(dateRange, signal) {
  const params = { meter_type: "Energy", ...dateRange };
  const meters = await fetchElectricityMeta()
    .then((meta) => meta.map((m) => m?.meter).filter(Boolean))
    .catch(() => ALL_METERS);

  const responses = await gateGetAll(
    meters.map((meter) => () =>
      gateGet("/electricity/data", { ...params, meter }, { signal })
    )
  );

  return mapAllElectricityResponses(responses, "Energy");
}

// one request per solar parameter, all issued in parallel
export async function fetchSolar(dateRange, signal) {
  const params = { ...dateRange };

  const responses = await gateGetAll(
    ALL_SOLAR_PARAMS.map((parameter) => () =>
      gateGet("/solar/data", { ...params, parameter }, { signal })
    )
  );

  return mapAllSolarResponses(responses);
}

export async function fetchSensorFloor(floor, dateRange, room, signal) {
  const params = { ...(room ? { room } : {}), ...dateRange };
  const raw = await gateGet(`/sensor/data/floor_${floor}/`, params, { signal });
  return mapSensorFloorResponse(raw, floor);
}

export async function fetchAllSensors(dateRange, signal) {
  const responses = await gateGetAll(
    [0, 1, 2, 3].map((floor) => () =>
      gateGet(`/sensor/data/floor_${floor}/`, { ...dateRange }, { signal })
        .then((raw) => mapSensorFloorResponse(raw, floor))
    )
  );

  return responses.filter(Boolean).flat();
}

export async function fetchLiveSnapshot(signal) {
  const [electricity, solar, sensors] = await Promise.allSettled([
    fetchElectricityPower(undefined, signal),
    fetchSolar(undefined, signal),
    fetchAllSensors(undefined, signal),
  ]);

  return {
    electricity: electricity.status === "fulfilled" ? electricity.value : [],
    solar: solar.status === "fulfilled" ? solar.value : [],
    sensors: sensors.status === "fulfilled" ? sensors.value : [],
  };
}

export async function fetchHistoryWindow(hours = 48, signal) {
  const dateRange = toSofiaDateParams(hours);

  const [electricity, solar, sensors] = await Promise.allSettled([
    fetchElectricityPower(dateRange, signal),
    fetchSolar(dateRange, signal),
    fetchAllSensors(dateRange, signal),
  ]);

  const elecData = electricity.status === "fulfilled" ? electricity.value : [];
  const solarData = solar.status === "fulfilled" ? solar.value : [];
  const sensorData = sensors.status === "fulfilled" ? sensors.value : [];

  if (electricity.status === "rejected")
    console.warn("[Repo] Electricity history failed:", electricity.reason?.message);
  if (solar.status === "rejected")
    console.warn("[Repo] Solar history failed:", solar.reason?.message);
  if (sensors.status === "rejected")
    console.warn("[Repo] Sensor history failed:", sensors.reason?.message);

  return {
    electricity: elecData,
    solar: solarData,
    sensors: sensorData,
    roomRows: aggregateSensorReadingsToRoomRows(sensorData),
  };
}

const CIRCUIT_TO_METER = Object.fromEntries(
  Object.entries({
    BuildingMain: "main",
    OVK: "ovk",
    "3D_LED": "3DLED",
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
  }).map(([meter, cid]) => [cid, meter])
);

export async function fetchElectricityForCircuits(circuitIds, dateRange, signal) {
  const meters = circuitIds
    .map((cid) => ({ cid, meter: CIRCUIT_TO_METER[cid] }))
    .filter(({ meter }) => !!meter);

  if (!meters.length) return [];

  const responses = await gateGetAll(
    meters.map(({ meter }) => () =>
      gateGet("/electricity/data", { meter_type: "Power", meter, ...dateRange }, { signal })
    )
  );

  const rows = [];
  responses.forEach((raw, i) => {
    if (!raw) return;
    const items = Array.isArray(raw) ? raw : [raw];
    items.forEach((item) => {
      const readings = Array.isArray(item?.readings) ? item.readings : [];
      readings.forEach((r) => {
        if (r?.value == null) return;
        const tsISO = String(r.timestamp ?? "");
        if (!tsISO || isNaN(Date.parse(tsISO))) return;
        rows.push({
          ts_5min: tsISO,
          value: Number(r.value),
          circuit_id: meters[i].cid,
        });
      });
    });
  });

  return rows.sort((a, b) => a.ts_5min.localeCompare(b.ts_5min));
}

export async function fetchElectricityAndSolarRange(startDate, endDate, signal) {
  const { toSofiaDateString } = await import("../utils/timeUtils.js");
  const dateRange = {
    start_date: toSofiaDateString(startDate),
    end_date: toSofiaDateString(endDate),
  };

  const [electricity, solar] = await Promise.allSettled([
    fetchElectricityPower(dateRange, signal),
    fetchSolar(dateRange, signal),
  ]);

  return {
    electricity: electricity.status === "fulfilled" ? electricity.value : [],
    solar: solar.status === "fulfilled" ? solar.value : [],
  };
}
