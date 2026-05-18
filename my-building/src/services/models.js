/**
 * @typedef {Object} SensorReading
 * @property {string}  room_id
 * @property {number}  floor
 * @property {string}  sensor_id
 * @property {string}  parameter  - "CO2" | "Humidity" | "Temp"
 * @property {number}  value
 * @property {string}  unit
 * @property {number}  timestampMs
 * @property {string}  tsISO
 */

/**
 * @typedef {Object} RoomLatestState
 * @property {string}       room_id
 * @property {number}       floor
 * @property {number|null}  temperature
 * @property {number|null}  humidity
 * @property {number|null}  co2
 * @property {number}       updatedAtMs
 * @property {string}       updatedAtISO
 */

/**
 * @typedef {Object} RoomHistoricalSeries
 * @property {string}  room_id
 * @property {number}  floor
 * @property {{ timestampMs: number, value: number }[]}  temperature
 * @property {{ timestampMs: number, value: number }[]}  humidity
 * @property {{ timestampMs: number, value: number }[]}  co2
 */

/**
 * @typedef {Object} ElectricityReading
 * @property {string}  meter
 * @property {string}  circuit_id
 * @property {string}  meter_type  - "Power" | "Energy"
 * @property {number}  value
 * @property {string}  unit
 * @property {number}  timestampMs
 * @property {string}  tsISO
 */

/**
 * @typedef {Object} SolarReading
 * @property {string}  parameter
 * @property {number}  value
 * @property {string}  unit
 * @property {number}  timestampMs
 * @property {string}  tsISO
 * @property {string}  appKey
 */

/**
 * @typedef {Object} BuildingSnapshot
 * @property {number}  buildingLoadW
 * @property {number}  circuitsReporting
 * @property {number}  solarPvW
 * @property {number}  solarSocPct
 * @property {number}  solarBattW
 * @property {number}  roomsReporting
 * @property {number}  indoorTempC
 * @property {number}  indoorHumidityPct
 * @property {number}  indoorCo2Ppm
 * @property {number}  updatedAtMs
 */

/**
 * @typedef {Object} ReplayFrame
 * @property {number}  timestampMs
 * @property {string}  time
 * @property {number}  hour
 * @property {number}  value
 * @property {number}  watts
 */

/**
 * @typedef {Object.<string, ReplayFrame[]>} ReplayFrameMap
 */

/**
 * @typedef {Object} HeatmapRoomState
 * @property {string}       room_id
 * @property {number|null}  temperature
 * @property {number|null}  humidity
 * @property {number|null}  co2
 * @property {boolean}      available
 * @property {number|null}  readingAtMs
 */

/**
 * @typedef {Object} HeatmapFrame
 * @property {number}  timestampMs
 * @property {Object.<string, HeatmapRoomState>}  rooms
 */

export {};
