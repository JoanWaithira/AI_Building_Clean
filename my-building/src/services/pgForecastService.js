// src/services/pgForecastService.js

/**
 * Fetch forecasts for a given circuit_id from the backend PostgreSQL API endpoint.
 * @param {string} circuitId
 * @returns {Promise<Array>} Array of forecast records
 */
export async function fetchPgLocalShortTermForecasts(circuitId) {
  const url = `/pg-forecasts/local/short?circuit_id=${encodeURIComponent(circuitId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch from PostgreSQL: ${res.status}`);
  const payload = await res.json();
  return payload.data || [];
}
