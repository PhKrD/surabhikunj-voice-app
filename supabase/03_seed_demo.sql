-- Demo seed for local/dev usage
-- Run after: 01_schema.sql, 02_bootstrap.sql

-- Departments
insert into public.departments (voice_id, name, description, icon, color)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Kitchen', 'Daily prasadam planning and execution', 'UtensilsCrossed', '#f97316'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Sadhana', 'Sadhana standards and reporting support', 'BookOpen', '#d946ef'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Cleanliness', 'Community cleanliness and area maintenance', 'Sparkles', '#16a34a')
on conflict do nothing;

-- Services
insert into public.services (voice_id, name, description, default_time, duration_min, instructions)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Temple Hall Cleaning', 'Daily temple hall cleaning service', '06:30:00', 45, 'Bring broom and cloth. Complete before class.'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Breakfast Assistance', 'Cutting and serving support', '08:00:00', 60, 'Report in clean dress and head cover.'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Evening Aarti Setup', 'Prepare lamps and bhoga table', '18:00:00', 40, 'Coordinate with pujari team.')
on conflict do nothing;

-- Cleaning areas
insert into public.cleaning_areas (voice_id, name, description, floor)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Temple Hall', 'Main kirtan and class area', 'Ground Floor'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Staircase A', 'Main staircase near entrance', 'All Floors'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Kitchen Wash Zone', 'Utensil wash and sink area', 'Ground Floor')
on conflict do nothing;

-- Events
insert into public.events (voice_id, title, description, event_type, start_datetime, end_datetime, venue, is_mandatory, notify_all)
values
  (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Sunday Feast Preparation Meeting',
    'Planning and service delegation for upcoming Sunday feast.',
    'meeting',
    now() + interval '2 day',
    now() + interval '2 day 1 hour',
    'Community Hall',
    false,
    true
  ),
  (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Ekadashi Kirtan Evening',
    'Extended kirtan and shared reflections.',
    'festival',
    now() + interval '5 day',
    now() + interval '5 day 2 hour',
    'Temple Hall',
    true,
    true
  )
on conflict do nothing;
