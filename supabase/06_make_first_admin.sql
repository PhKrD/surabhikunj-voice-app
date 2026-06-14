-- Bootstrap first admin user for a VOICE
-- Run manually in Supabase SQL editor after user has signed up

-- 1) Replace with admin user's email
-- 2) Run this query block

-- Example:
do $$
 declare
   v_email text := 'palanharkrsnadas@gmail.com';
 begin
   update public.profiles p
   set
     role = 'admin'::user_role,
     voice_id = coalesce(p.voice_id, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid),
     updated_at = now()
   from auth.users u
   where p.id = u.id
     and lower(u.email) = lower(v_email);
 end $$;

-- Optional: list users and roles for verification
-- select u.email, p.spiritual_name, p.role, p.voice_id
-- from auth.users u
-- join public.profiles p on p.id = u.id
-- order by u.created_at desc;
