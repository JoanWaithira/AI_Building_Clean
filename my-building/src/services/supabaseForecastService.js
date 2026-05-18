// src/services/supabaseForecastService.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://heqpmvtphdqhfntpwndx.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_4UXHmu-F5nRslGAoaX1rlw_ghMXrdCA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Fetch forecasts for a given circuit_id from unified_local_short_term table.
 * circuit_id is lowercased to match how the inference pipeline stores it.
 * @param {string} circuitId
 * @returns {Promise<Array>} Array of forecast records
 */
export async function fetchLocalShortTermForecasts(circuitId) {
  const { data, error } = await supabase
    .from('unified_local_short_term')
    .select('*')
    .ilike('circuit_id', circuitId);
  if (error) throw error;
  return data;
}

/**
 * Fetch long-term forecasts for a given circuit_id from unified_local_long_term table.
 * circuit_id is lowercased to match how the inference pipeline stores it.
 * @param {string} circuitId
 * @returns {Promise<Array>} Array of forecast records
 */
export async function fetchLocalLongTermForecasts(circuitId) {
  const { data, error } = await supabase
    .from('unified_local_long_term')
    .select('*')
    .ilike('circuit_id', circuitId);
  if (error) throw error;
  return data;
}
