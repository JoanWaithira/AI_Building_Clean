// roleScenarios.js — shared constants and EPC helpers for scenario modelling

export const CARBON_FACTOR = 0.233;
export const GRID_TARIFF_DEFAULT = 0.22;
export const WORKING_DAYS_MONTH = 22;
export const FLOOR_AREA_M2 = 3200;
export const EU_OFFICE_BENCHMARK = 230;
export const EPC_B_THRESHOLD = 150;

export function epcFromEui(eui) {
  if (eui < 50) return "A+";
  if (eui < 100) return "A";
  if (eui < 150) return "B";
  if (eui < 200) return "C";
  if (eui < 250) return "D";
  if (eui < 350) return "E";
  if (eui < 500) return "F";
  return "G";
}
