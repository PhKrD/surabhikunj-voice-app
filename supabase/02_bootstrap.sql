-- SurabhiKunj VOICE bootstrap helpers
-- Run this after 01_schema.sql

create or replace function public.bootstrap_current_user_to_default_voice()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default_voice uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
begin
  update public.profiles
  set
    voice_id = coalesce(voice_id, v_default_voice),
    role = coalesce(role, 'devotee'::user_role),
    updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.bootstrap_current_user_to_default_voice() to authenticated;

-- Optional helper for creating a new tenant VOICE
create or replace function public.create_voice_tenant(
  p_name text,
  p_location text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voice_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admin/vmc/oc can create tenant voices';
  end if;

  insert into public.voices (name, location, description)
  values (p_name, p_location, p_description)
  returning id into v_voice_id;

  return v_voice_id;
end;
$$;

grant execute on function public.create_voice_tenant(text, text, text) to authenticated;
