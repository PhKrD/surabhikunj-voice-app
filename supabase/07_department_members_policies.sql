-- Department members RLS policies
-- Run after 01..06. Enables reading department membership (for the Residents
-- directory department filter/chips) and admin-managed membership writes.
-- Voice isolation is enforced via the parent department's voice_id.

-- SELECT: any member of the same VOICE can read department membership
drop policy if exists "department_members_select" on public.department_members;
create policy "department_members_select" on public.department_members
  for select
  using (
    exists (
      select 1
      from public.departments d
      where d.id = department_members.department_id
        and d.voice_id = get_my_voice_id()
    )
  );

-- WRITE: admins (admin/vmc/oc) can manage membership within their VOICE,
-- and only for profiles that belong to the same VOICE.
drop policy if exists "department_members_write" on public.department_members;
create policy "department_members_write" on public.department_members
  for all
  using (
    exists (
      select 1
      from public.departments d
      where d.id = department_members.department_id
        and d.voice_id = get_my_voice_id()
    )
    and is_admin()
  )
  with check (
    exists (
      select 1
      from public.departments d
      where d.id = department_members.department_id
        and d.voice_id = get_my_voice_id()
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = department_members.profile_id
        and p.voice_id = get_my_voice_id()
    )
    and is_admin()
  );
