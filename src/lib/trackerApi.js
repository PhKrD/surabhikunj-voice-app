// =====================================================================
// trackerApi.js — resilient fetch for a tracker's full configuration.
//
// Tries the `get_tracker_config` RPC first (requires migration 49 to
// have been applied).  If the function doesn't exist yet it falls back
// to querying the underlying tables directly, which works with the
// pre-migration schema and returns empty arrays for tables that don't
// exist yet.
// =====================================================================
import { supabase } from '@/lib/supabase'

/**
 * Fetch the full config for a tracker.
 * Returns { tracker, fields, groups, rules, calculated_columns } or throws.
 */
export async function fetchTrackerConfig(trackerId) {
  // --- Attempt 1: use the fast RPC (post-migration) ---
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'get_tracker_config',
    { p_tracker_id: trackerId },
  )

  if (!rpcError) {
    const d = rpcData ?? {}
    return {
      tracker: d.tracker ?? null,
      fields: d.fields ?? [],
      groups: d.groups ?? [],
      rules: d.rules ?? [],
      calculated_columns: d.calculated_columns ?? [],
    }
  }

  // Only fall back on "function not found" / "schema cache" errors.
  // Any other RPC error (network, RLS, etc.) should still surface.
  const isNotFound =
    rpcError.code === 'PGRST202' ||
    (rpcError.message ?? '').toLowerCase().includes('schema cache') ||
    (rpcError.message ?? '').toLowerCase().includes('could not find the function')

  if (!isNotFound) throw rpcError

  // --- Fallback: query tables individually (pre-migration schema) ---
  const [trackerRes, fieldsRes, rulesRes, groupsRes, columnsRes] =
    await Promise.all([
      supabase
        .from('tracker_definitions')
        .select('*')
        .eq('id', trackerId)
        .maybeSingle(),
      supabase
        .from('tracker_fields')
        .select('*')
        .eq('tracker_id', trackerId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('tracker_scoring_rules')
        .select('*')
        .eq('tracker_id', trackerId)
        .order('sort_order', { ascending: true }),
      // These tables only exist after migration 49.  Supabase returns an
      // error when the table is absent; treat that as empty rather than
      // crashing.
      supabase
        .from('tracker_field_groups')
        .select('*')
        .eq('tracker_id', trackerId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('tracker_calculated_columns')
        .select('*')
        .eq('tracker_id', trackerId)
        .order('sort_order', { ascending: true }),
    ])

  if (trackerRes.error) throw trackerRes.error
  if (fieldsRes.error) throw fieldsRes.error
  if (rulesRes.error) throw rulesRes.error

  // groups / calculated_columns silently degrade to []
  return {
    tracker: trackerRes.data,
    fields: fieldsRes.data ?? [],
    groups: groupsRes.error ? [] : (groupsRes.data ?? []),
    rules: rulesRes.data ?? [],
    calculated_columns: columnsRes.error ? [] : (columnsRes.data ?? []),
  }
}
