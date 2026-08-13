// =====================================================================
// counsellorApi.js — data access for the Counsellor Management system.
//
// Every function here is a thin wrapper around Supabase RPCs/queries
// defined in supabase/51_counsellor_management.sql. All authorization
// (who may see which member's data) is enforced by RLS/SECURITY DEFINER
// functions on the backend — this file does not implement any access
// control itself, it only calls the already-scoped endpoints.
// =====================================================================
import { supabase } from '@/lib/supabase'
import { aggregatePeriod, calculateEntryScore, hasValue } from '@/lib/trackerScoring'
import { format } from 'date-fns'

function toISO(d) { return format(d, 'yyyy-MM-dd') }

// ---------------------------------------------------------------------
// Counsellor <-> Counselli relationships
// ---------------------------------------------------------------------

export async function myMentees(typeId = null) {
  const { data, error } = await supabase.rpc('my_mentees', { p_type_id: typeId })
  if (error) throw error
  return data ?? []
}

export async function adminMentorshipOverview(typeId = null) {
  const { data, error } = await supabase.rpc('admin_mentorship_overview', { p_type_id: typeId })
  if (error) throw error
  return data ?? []
}

export async function mentorRelationships(mentorId, typeId = null) {
  const { data, error } = await supabase.rpc('mentor_relationships', { p_mentor_id: mentorId, p_type_id: typeId })
  if (error) throw error
  return data ?? []
}

export async function adminMenteeSearch(query = '', typeId = null) {
  const { data, error } = await supabase.rpc('admin_mentee_search', { p_query: query, p_type_id: typeId })
  if (error) throw error
  return data ?? []
}

export async function assignMentee({ menteeId, mentorId, typeId = null, notes = null }) {
  const { data, error } = await supabase.rpc('assign_mentee', {
    p_mentee_id: menteeId, p_mentor_id: mentorId, p_type_id: typeId, p_notes: notes,
  })
  if (error) throw error
  return data
}

export async function endMentorship(relationshipId) {
  const { error } = await supabase.rpc('end_mentorship', { p_relationship_id: relationshipId })
  if (error) throw error
}

export async function menteeAssignmentHistory(menteeId) {
  const { data, error } = await supabase.rpc('mentee_assignment_history', { p_mentee_id: menteeId })
  if (error) throw error
  return data ?? []
}

export async function getCounsellorType() {
  const { data, error } = await supabase
    .from('mentorship_types')
    .select('*')
    .eq('name', 'Counsellor')
    .maybeSingle()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------
// Role management (additive — does not disturb the member's other roles)
// ---------------------------------------------------------------------

export async function ensureCounsellorRole() {
  const { data, error } = await supabase.rpc('ensure_counsellor_role')
  if (error) throw error
  return data
}

export async function addMemberRole(userId, roleId) {
  const { error } = await supabase.rpc('add_member_role', { p_user_id: userId, p_role_id: roleId })
  if (error) throw error
}

export async function removeMemberRole(userId, roleId) {
  const { error } = await supabase.rpc('remove_member_role', { p_user_id: userId, p_role_id: roleId })
  if (error) throw error
}

// ---------------------------------------------------------------------
// Sadhana — reuse the SAME entries + scoring engine as the member's own
// TrackersPage, scoped to a mentee via the RLS extension in migration 51.
// ---------------------------------------------------------------------

/** Load tracker_entries + field_values for one member across a date range. */
export async function fetchEntriesByDate({ trackerId, userId, startDate, endDate, fields }) {
  const startISO = toISO(startDate)
  const endISO = toISO(endDate)
  const { data: entries, error } = await supabase
    .from('tracker_entries')
    .select('id, period_date, score')
    .eq('tracker_id', trackerId)
    .eq('user_id', userId)
    .gte('period_date', startISO)
    .lte('period_date', endISO)
  if (error) throw error

  const byDate = {}
  const ids = (entries ?? []).map((e) => e.id)
  if (ids.length) {
    const { data: vals, error: valErr } = await supabase
      .from('tracker_field_values')
      .select('entry_id, field_key, value_text')
      .in('entry_id', ids)
    if (valErr) throw valErr
    const byEntry = {}
    for (const v of vals ?? []) {
      byEntry[v.entry_id] = byEntry[v.entry_id] ?? {}
      const f = fields.find((ff) => ff.key === v.field_key)
      byEntry[v.entry_id][v.field_key] = f?.field_type === 'boolean'
        ? (v.value_text === 'true' || v.value_text === '1')
        : v.value_text
    }
    for (const e of entries ?? []) byDate[e.period_date] = byEntry[e.id] ?? {}
  }
  return byDate
}

/** Aggregate a member's Sadhana score for an arbitrary date range (reuses aggregatePeriod). */
export async function menteePeriodScore({ trackerId, userId, startDate, endDate, fields, groups, rules, calculatedColumns }) {
  const entriesByDate = await fetchEntriesByDate({ trackerId, userId, startDate, endDate, fields })
  return aggregatePeriod({ rules, fields, groups, calculatedColumns, entriesByDate })
}

/** Per-day scores across a range (for trends / needs-attention detection). */
export function dailyScoresFromEntries(days, entriesByDate, { rules, fields, groups, calculatedColumns }) {
  return days.map((d) => {
    const iso = toISO(d)
    const values = entriesByDate[iso] ?? {}
    const any = Object.values(values).some((v) => hasValue(v))
    const result = any ? calculateEntryScore({ rules, fields, groups, calculatedColumns, fieldValues: values }) : null
    return { date: d, iso, score: result?.score ?? null, hasEntry: any }
  })
}

// ---------------------------------------------------------------------
// Cleanliness / Seva — reuse the task engine via my_assignments('mentee' scope)
// ---------------------------------------------------------------------

export async function fetchMenteeAssignments({ userId, moduleKey }) {
  const { data, error } = await supabase.rpc('my_assignments', {
    p_module: moduleKey, p_scope: 'mentee', p_user_id: userId,
  })
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------
// Notes & follow-ups
// ---------------------------------------------------------------------

export async function fetchNotes(menteeId) {
  const { data, error } = await supabase
    .from('mentorship_notes')
    .select('*, author:author_id(display_name, spiritual_name, legal_name)')
    .eq('mentee_id', menteeId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function addNote(menteeId, orgId, authorId, body) {
  const { error } = await supabase.from('mentorship_notes').insert({
    org_id: orgId, mentee_id: menteeId, author_id: authorId, body,
  })
  if (error) throw error
}

export async function deleteNote(noteId) {
  const { error } = await supabase.from('mentorship_notes').delete().eq('id', noteId)
  if (error) throw error
}

export async function fetchFollowups(menteeId) {
  const { data, error } = await supabase
    .from('mentorship_followups')
    .select('*')
    .eq('mentee_id', menteeId)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

export async function addFollowup(menteeId, orgId, createdBy, title, dueDate) {
  const { error } = await supabase.from('mentorship_followups').insert({
    org_id: orgId, mentee_id: menteeId, created_by: createdBy, title, due_date: dueDate,
  })
  if (error) throw error
}

export async function setFollowupStatus(followupId, status) {
  const { error } = await supabase.from('mentorship_followups').update({ status }).eq('id', followupId)
  if (error) throw error
}

export async function deleteFollowup(followupId) {
  const { error } = await supabase.from('mentorship_followups').delete().eq('id', followupId)
  if (error) throw error
}
