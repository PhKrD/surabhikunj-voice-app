-- Per-VOICE sadhana scoring configuration.
-- Adds a JSONB `config` column to sadhana_score_config holding overrides that
-- map to DEFAULT_SADHANA_CONFIG keys in src/lib/sadhanaScoring.js, and RLS so
-- members can read their VOICE config and admins can edit it.
-- Run after 01..08.

alter table public.sadhana_score_config
  add column if not exists config jsonb;

alter table public.sadhana_score_config enable row level security;

-- SELECT: any member of the same VOICE (needed by the report form preview)
drop policy if exists "sadhana_config_select" on public.sadhana_score_config;
create policy "sadhana_config_select" on public.sadhana_score_config
  for select using (voice_id = get_my_voice_id());

-- INSERT: admins, for their own VOICE
drop policy if exists "sadhana_config_insert" on public.sadhana_score_config;
create policy "sadhana_config_insert" on public.sadhana_score_config
  for insert with check (voice_id = get_my_voice_id() and is_admin());

-- UPDATE: admins, for their own VOICE
drop policy if exists "sadhana_config_update" on public.sadhana_score_config;
create policy "sadhana_config_update" on public.sadhana_score_config
  for update
  using (voice_id = get_my_voice_id() and is_admin())
  with check (voice_id = get_my_voice_id() and is_admin());
