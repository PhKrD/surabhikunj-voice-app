-- CHUNK 4 (schema files)

-- FILE: 21_memberships.sql
-- =====================================================================
-- 21. MEMBERSHIPS — Users belong to MANY organizations
-- =====================================================================
-- Splits the overloaded `profiles` table into two concepts:
--
--   profiles     = global identity  (one row per human, org-agnostic)
--   memberships  = identity IN an org (one row per human per org)
--
-- Org-specific data (display name, approval state, custom fields like
-- "initiated" or "room number") moves onto the membership, so the same
-- person can be "Palanhar Krsna Das" in one org and "P. Taur" in another.
--
-- EXPAND phase: profiles keeps its old columns; they are dropped in the
-- contract migration once the frontend reads from memberships.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Global identity columns on profiles
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill the org-neutral name from the Surabhikunj-specific column
UPDATE public.profiles
SET display_name = COALESCE(NULLIF(trim(spiritual_name), ''), 'Member')
WHERE display_name IS NULL;

ALTER TABLE public.profiles ALTER COLUMN display_name SET NOT NULL;

-- spiritual_name must stop being mandatory — it is now an org custom field
ALTER TABLE public.profiles ALTER COLUMN spiritual_name DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 2. MEMBERSHIPS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memberships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,

  -- Name shown inside THIS org (may differ per org)
  display_name TEXT,

  status       TEXT NOT NULL DEFAULT 'pending',

  -- Values for this org's custom member fields (see member_field_definitions)
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,

  invited_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  joined_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, user_id)
);

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'left'));

CREATE INDEX IF NOT EXISTS idx_memberships_org    ON public.memberships (org_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_user   ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_attrs  ON public.memberships USING GIN (attributes);

-- ---------------------------------------------------------------------
-- 3. CUSTOM MEMBER FIELDS — orgs define their own member profile schema
-- ---------------------------------------------------------------------
-- Replaces hardcoded columns like `initiated`, `room_number`, `legal_name`.
-- An NGO can instead define "employee_id" or "blood_group" with no migration.

CREATE TABLE IF NOT EXISTS public.member_field_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  field_type  TEXT NOT NULL DEFAULT 'text',
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- for select/multiselect
  help_text   TEXT,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_private  BOOLEAN NOT NULL DEFAULT FALSE,      -- visible only to admins
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, key)
);

ALTER TABLE public.member_field_definitions
  DROP CONSTRAINT IF EXISTS member_field_definitions_type_check;
ALTER TABLE public.member_field_definitions
  ADD CONSTRAINT member_field_definitions_type_check
  CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'boolean',
                        'select', 'multiselect', 'email', 'phone', 'url'));

-- ---------------------------------------------------------------------
-- 4. BACKFILL — every existing profile becomes a membership
-- ---------------------------------------------------------------------

INSERT INTO public.memberships (org_id, user_id, display_name, status, attributes, joined_at)
SELECT
  p.org_id,
  p.id,
  COALESCE(NULLIF(trim(p.spiritual_name), ''), p.display_name),
  CASE WHEN p.is_approved THEN 'active' ELSE 'pending' END,
  -- Preserve the temple-specific fields as org custom attributes
  jsonb_strip_nulls(jsonb_build_object(
    'spiritual_name', p.spiritual_name,
    'legal_name',     p.legal_name,
    'initiated',      p.initiated,
    'room_number',    p.room_number,
    'joined_date',    p.joined_date
  )),
  COALESCE(p.joined_date::timestamptz, p.created_at)
FROM public.profiles p
WHERE p.org_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Register those attributes as real, editable field definitions for any org
-- that actually has data in them, so they render in the member form.
INSERT INTO public.member_field_definitions (org_id, key, label, field_type, sort_order)
SELECT DISTINCT o.id, d.key, d.label, d.field_type, d.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('spiritual_name', 'Spiritual Name', 'text',    10),
  ('legal_name',     'Legal Name',     'text',    20),
  ('initiated',      'Initiated',      'boolean', 30),
  ('room_number',    'Room Number',    'text',    40),
  ('joined_date',    'Joined Date',    'date',    50)
) AS d(key, label, field_type, sort_order)
WHERE EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.org_id = o.id AND m.attributes ? d.key
)
ON CONFLICT (org_id, key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. HELPERS
-- ---------------------------------------------------------------------

-- The caller's membership in their currently active org.
CREATE OR REPLACE FUNCTION public.current_membership_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT m.id
  FROM public.memberships m
  WHERE m.user_id = auth.uid()
    AND m.org_id  = public.current_org_id()
  LIMIT 1;
$$;

-- Is the caller an active member of the given org?
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND org_id = p_org_id AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_membership_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID)     TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Keep memberships in sync while `profiles` is still the write path
-- ---------------------------------------------------------------------
-- During the expand phase the app still writes profiles.org_id /
-- is_approved. Mirror those onto memberships so both stay consistent.

CREATE OR REPLACE FUNCTION public.sync_membership_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.memberships (org_id, user_id, display_name, status, joined_at)
  VALUES (
    NEW.org_id,
    NEW.id,
    COALESCE(NULLIF(trim(NEW.spiritual_name), ''), NEW.display_name),
    CASE WHEN NEW.is_approved THEN 'active' ELSE 'pending' END,
    NOW()
  )
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET status     = CASE WHEN NEW.is_approved THEN 'active' ELSE 'pending' END,
        updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_membership ON public.profiles;
CREATE TRIGGER trg_sync_membership
  AFTER INSERT OR UPDATE OF org_id, is_approved ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_membership_from_profile();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.memberships              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_field_definitions ENABLE ROW LEVEL SECURITY;

-- See fellow members of orgs you belong to; always see your own rows.
DROP POLICY IF EXISTS "memberships_select" ON public.memberships;
CREATE POLICY "memberships_select" ON public.memberships
  FOR SELECT USING (
    user_id = auth.uid() OR org_id = public.current_org_id()
  );

-- A user may create their own PENDING membership (self sign-up / join).
DROP POLICY IF EXISTS "memberships_insert_self" ON public.memberships;
CREATE POLICY "memberships_insert_self" ON public.memberships
  FOR INSERT WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- Tightened to the members.manage permission in migration 24.
DROP POLICY IF EXISTS "memberships_admin_write" ON public.memberships;
CREATE POLICY "memberships_admin_write" ON public.memberships
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

DROP POLICY IF EXISTS "member_fields_select" ON public.member_field_definitions;
CREATE POLICY "member_fields_select" ON public.member_field_definitions
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "member_fields_write" ON public.member_field_definitions;
CREATE POLICY "member_fields_write" ON public.member_field_definitions
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_memberships_updated_at ON public.memberships;
CREATE TRIGGER trg_memberships_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 22_rbac.sql
-- =====================================================================
-- 22. RBAC — Unlimited custom roles with granular permissions
-- =====================================================================
-- Replaces the fixed `user_role` ENUM (devotee/counsellor/vmc/oc/...) with
-- data an organization owns and edits:
--
--   permissions       global catalog of capabilities  ('events.create')
--   roles             org-defined roles               ('Kitchen Head')
--   role_permissions  which capabilities a role grants
--   membership_roles  which roles a member holds      (many-to-many)
--
-- A member's effective permissions = union of all their roles' permissions.
-- The '*' permission is a wildcard meaning "everything" (org owner).
--
-- The ENUM column is left in place during EXPAND and dropped in contract.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERMISSION CATALOG (global — defines what the platform can do)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permissions (
  key         TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.permissions (key, module, label, description, sort_order) VALUES
  -- Organization
  ('*',                    'core',          'Full Access',            'Every permission, present and future', 0),
  ('org.settings.manage',  'core',          'Manage Settings',        'Edit org name, branding, terminology', 10),
  ('org.modules.manage',   'core',          'Manage Modules',         'Enable or disable features',           11),
  ('org.billing.manage',   'core',          'Manage Billing',         'Change plan and payment details',      12),
  ('org.audit.view',       'core',          'View Audit Log',         'See who changed what',                 13),

  -- Members
  ('members.view',         'members',       'View Members',           'See the member directory',             20),
  ('members.invite',       'members',       'Invite Members',         'Send invitations to join',             21),
  ('members.approve',      'members',       'Approve Members',        'Approve or reject join requests',      22),
  ('members.manage',       'members',       'Manage Members',         'Edit member details and attributes',   23),
  ('members.remove',       'members',       'Remove Members',         'Suspend or remove members',            24),

  -- Roles
  ('roles.view',           'roles',         'View Roles',             'See roles and their permissions',      30),
  ('roles.manage',         'roles',         'Manage Roles',           'Create, edit and delete roles',        31),
  ('roles.assign',         'roles',         'Assign Roles',           'Grant or revoke roles for members',    32),

  -- Departments / teams
  ('departments.view',     'departments',   'View Departments',       'See departments and their members',    40),
  ('departments.manage',   'departments',   'Manage Departments',     'Create, rename and delete departments',41),
  ('departments.assign',   'departments',   'Assign to Departments',  'Add or remove department members',     42),

  -- Hierarchy
  ('hierarchy.view',       'hierarchy',     'View Org Structure',     'See the organization chart',           50),
  ('hierarchy.manage',     'hierarchy',     'Manage Org Structure',   'Define positions and reporting lines', 51),

  -- Events
  ('events.view',          'events',        'View Events',            'See the events calendar',              60),
  ('events.create',        'events',        'Create Events',          'Add new events',                       61),
  ('events.manage',        'events',        'Manage Events',          'Edit or delete any event',             62),
  ('events.attendance',    'events',        'Manage Attendance',      'Record and edit attendance',           63),

  -- Trackers (generalises Sadhana)
  ('trackers.submit',      'trackers',      'Submit Entries',         'Submit your own tracker entries',      70),
  ('trackers.view_own',    'trackers',      'View Own Entries',       'See your own history and scores',      71),
  ('trackers.view_all',    'trackers',      'View All Entries',       'See every member''s entries',          72),
  ('trackers.manage',      'trackers',      'Manage Trackers',        'Define trackers, fields and scoring',  73),

  -- Tasks (generalises Cleanliness + Services)
  ('tasks.view_own',       'tasks',         'View Own Tasks',         'See tasks assigned to you',            80),
  ('tasks.view_all',       'tasks',         'View All Tasks',         'See every assignment',                 81),
  ('tasks.assign',         'tasks',         'Assign Tasks',           'Allocate tasks to members',            82),
  ('tasks.manage',         'tasks',         'Manage Tasks',           'Define task types and schedules',      83),
  ('tasks.verify',         'tasks',         'Verify Completion',      'Confirm or reject completed tasks',    84),

  -- Resources (generalises Kitchen / meal plans)
  ('resources.view',       'resources',     'View Plans',             'See resource and meal plans',          90),
  ('resources.manage',     'resources',     'Manage Plans',           'Create and edit plans',                91),

  -- Mentorship (generalises Counsellor)
  ('mentorship.view_own',  'mentorship',    'View Own Mentees',       'See members assigned to you',          100),
  ('mentorship.view_all',  'mentorship',    'View All Relationships', 'See every mentor-mentee link',         101),
  ('mentorship.manage',    'mentorship',    'Manage Relationships',   'Assign mentors to members',            102),

  -- Announcements & notifications
  ('announcements.view',   'announcements', 'View Announcements',     'Read announcements',                   110),
  ('announcements.manage', 'announcements', 'Manage Announcements',   'Post, edit and delete announcements',  111),
  ('notifications.send',   'announcements', 'Send Notifications',     'Push notifications to members',        112),

  -- Reporting
  ('reports.view',         'reports',       'View Reports',           'Access dashboards and analytics',      120),
  ('reports.export',       'reports',       'Export Reports',         'Download data as CSV or PDF',          121)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      label  = EXCLUDED.label,
      description = EXCLUDED.description,
      sort_order  = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 2. ROLES (owned by each organization)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,

  -- Protected roles cannot be deleted (every org needs an owner + a default)
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Auto-assigned to new members when they join
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Higher wins when resolving display/precedence
  priority    INTEGER NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, key)
);

CREATE INDEX IF NOT EXISTS idx_roles_org ON public.roles (org_id);

-- Exactly one default role per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_one_default
  ON public.roles (org_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id        UUID NOT NULL REFERENCES public.roles(id)       ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS public.membership_roles (
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES public.roles(id)       ON DELETE CASCADE,
  assigned_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (membership_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_roles_role ON public.membership_roles (role_id);

-- ---------------------------------------------------------------------
-- 3. DEFAULT ROLE TEMPLATES for every organization
-- ---------------------------------------------------------------------
-- Starting point only. Orgs rename, delete and extend these freely.

CREATE OR REPLACE FUNCTION public.seed_default_roles(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id UUID;
  r         RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('owner',   'Owner',   'Full control of the organization', TRUE,  FALSE, 100, '#dc2626'),
      ('admin',   'Admin',   'Manages members, settings and content', TRUE,  FALSE, 80,  '#ea580c'),
      ('manager', 'Manager', 'Runs day-to-day operations',       FALSE, FALSE, 60,  '#2563eb'),
      ('member',  'Member',  'Standard access',                  TRUE,  TRUE,  10,  '#64748b')
    ) AS t(key, name, description, is_system, is_default, priority, color)
  LOOP
    INSERT INTO public.roles (org_id, key, name, description, is_system, is_default, priority, color)
    VALUES (p_org_id, r.key, r.name, r.description, r.is_system, r.is_default, r.priority, r.color)
    ON CONFLICT (org_id, key) DO NOTHING;
  END LOOP;

  -- Owner: wildcard
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'owner';
  INSERT INTO public.role_permissions (role_id, permission_key)
  VALUES (v_role_id, '*')
  ON CONFLICT DO NOTHING;

  -- Admin: everything except billing and the wildcard itself
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'admin';
  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_role_id, key FROM public.permissions
  WHERE key NOT IN ('*', 'org.billing.manage')
  ON CONFLICT DO NOTHING;

  -- Manager: operational, not structural
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'manager';
  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_role_id, key FROM public.permissions WHERE key IN (
    'members.view', 'departments.view', 'departments.assign', 'hierarchy.view',
    'events.view', 'events.create', 'events.attendance',
    'trackers.submit', 'trackers.view_own', 'trackers.view_all',
    'tasks.view_own', 'tasks.view_all', 'tasks.assign', 'tasks.verify',
    'resources.view', 'resources.manage',
    'announcements.view', 'announcements.manage', 'notifications.send',
    'reports.view'
  )
  ON CONFLICT DO NOTHING;

  -- Member: participate, see own data
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'member';
  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_role_id, key FROM public.permissions WHERE key IN (
    'members.view', 'departments.view', 'hierarchy.view',
    'events.view', 'trackers.submit', 'trackers.view_own',
    'tasks.view_own', 'resources.view', 'announcements.view'
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- Apply to every existing organization
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_roles(o.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. MIGRATE the old ENUM roles into real, editable role rows
-- ---------------------------------------------------------------------
-- Each legacy role becomes a genuine role the org can now rename or delete.

DO $$
DECLARE
  o         RECORD;
  r         RECORD;
  v_role_id UUID;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    FOR r IN
      SELECT * FROM (VALUES
        ('counsellor',       'Counsellor',       'Guides and reviews assigned members', 40, '#0891b2'),
        ('sadhana_incharge', 'Sadhana Incharge', 'Oversees practice tracking',          50, '#db2777'),
        ('dept_incharge',    'Dept. Incharge',   'Leads a department',                  45, '#f97316'),
        ('im',               'IM',               'Coordinates service allocation',      45, '#06b6d4'),
        ('kitchen_team',     'Kitchen Team',     'Plans and prepares meals',            30, '#f59e0b'),
        ('vmc',              'VMC',              'Senior management committee',         85, '#16a34a'),
        ('oc',               'OC',               'Operations committee',                85, '#4f46e5')
      ) AS t(key, name, description, priority, color)
    LOOP
      INSERT INTO public.roles (org_id, key, name, description, priority, color, is_system)
      VALUES (o.id, r.key, r.name, r.description, r.priority, r.color, FALSE)
      ON CONFLICT (org_id, key) DO NOTHING;
    END LOOP;

    -- Grant each legacy role a sensible permission set
    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'counsellor';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'mentorship.view_own', 'trackers.view_all', 'trackers.view_own',
      'trackers.submit', 'events.view', 'announcements.view', 'reports.view',
      'departments.view', 'hierarchy.view', 'tasks.view_own', 'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'sadhana_incharge';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'trackers.view_all', 'trackers.view_own', 'trackers.submit',
      'trackers.manage', 'mentorship.view_all', 'reports.view', 'reports.export',
      'events.view', 'announcements.view', 'departments.view', 'hierarchy.view',
      'tasks.view_own', 'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'dept_incharge';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'departments.view', 'departments.assign', 'hierarchy.view',
      'events.view', 'events.create', 'tasks.view_all', 'tasks.assign', 'tasks.verify',
      'trackers.submit', 'trackers.view_own', 'announcements.view', 'reports.view',
      'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'im';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'tasks.view_all', 'tasks.assign', 'tasks.manage', 'tasks.verify',
      'departments.view', 'hierarchy.view', 'events.view', 'trackers.submit',
      'trackers.view_own', 'announcements.view', 'reports.view', 'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'kitchen_team';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'resources.view', 'resources.manage', 'departments.view',
      'hierarchy.view', 'events.view', 'trackers.submit', 'trackers.view_own',
      'tasks.view_own', 'announcements.view'
    ) ON CONFLICT DO NOTHING;

    -- VMC and OC were treated as admins by the old is_admin()
    FOR r IN SELECT id FROM public.roles WHERE org_id = o.id AND key IN ('vmc', 'oc') LOOP
      INSERT INTO public.role_permissions (role_id, permission_key)
      SELECT r.id, key FROM public.permissions WHERE key NOT IN ('*', 'org.billing.manage')
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. ASSIGN roles to existing members based on their old ENUM value
-- ---------------------------------------------------------------------

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT m.id, r.id
FROM public.memberships m
JOIN public.profiles p ON p.id = m.user_id AND p.org_id = m.org_id
JOIN public.roles    r ON r.org_id = m.org_id
                      AND r.key = CASE p.role::text
                                    WHEN 'admin'   THEN 'owner'
                                    WHEN 'devotee' THEN 'member'
                                    ELSE p.role::text
                                  END
ON CONFLICT DO NOTHING;

-- Safety net: anyone with no role at all gets the org default
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT m.id, r.id
FROM public.memberships m
JOIN public.roles r ON r.org_id = m.org_id AND r.is_default
WHERE NOT EXISTS (
  SELECT 1 FROM public.membership_roles mr WHERE mr.membership_id = m.id
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. PERMISSION RESOLUTION
-- ---------------------------------------------------------------------
-- my_permissions() does the join once; has_permission() is a cheap array
-- lookup. Both are STABLE so Postgres reuses the result within a statement,
-- which matters because RLS calls them per row.

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS TEXT[]
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT rp.permission_key), ARRAY[]::TEXT[])
  FROM public.memberships m
  JOIN public.membership_roles mr ON mr.membership_id = m.id
  JOIN public.role_permissions rp ON rp.role_id = mr.role_id
  WHERE m.user_id = auth.uid()
    AND m.org_id  = public.current_org_id()
    AND m.status  = 'active';
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(public.my_permissions()) AS perm
    WHERE perm = p_key OR perm = '*'
  );
$$;

-- Any of the given permissions
CREATE OR REPLACE FUNCTION public.has_any_permission(p_keys TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(public.my_permissions()) AS perm
    WHERE perm = ANY(p_keys) OR perm = '*'
  );
$$;

GRANT EXECUTE ON FUNCTION public.my_permissions()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_permission(TEXT[])  TO authenticated;

-- Redefine the legacy is_admin() on top of permissions so every existing
-- policy keeps working while migration 24 swaps them over one by one.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT public.has_any_permission(ARRAY['org.settings.manage', 'members.manage']);
$$;

-- ---------------------------------------------------------------------
-- 7. New members automatically receive the org's default role
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role_id UUID;
BEGIN
  SELECT id INTO v_role_id
  FROM public.roles WHERE org_id = NEW.org_id AND is_default
  LIMIT 1;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (NEW.id, v_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_default_role ON public.memberships;
CREATE TRIGGER trg_assign_default_role
  AFTER INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();

-- A newly created org gets its role set immediately
CREATE OR REPLACE FUNCTION public.seed_roles_for_new_org()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_roles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_roles_for_new_org ON public.organizations;
CREATE TRIGGER trg_seed_roles_for_new_org
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_roles_for_new_org();

-- ---------------------------------------------------------------------
-- 8. GUARDS — protect the org from locking itself out
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_system_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'Role "%" is a system role and cannot be deleted. Rename it instead.', OLD.name;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_system AND NEW.is_system = FALSE THEN
    RAISE EXCEPTION 'Cannot remove system protection from role "%"', OLD.name;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_roles ON public.roles;
CREATE TRIGGER trg_protect_system_roles
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_roles();

-- An org must always retain at least one member holding '*'
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id       UUID;
  v_owner_count  INTEGER;
BEGIN
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m WHERE m.id = OLD.membership_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = OLD.role_id AND rp.permission_key = '*'
  ) THEN
    RETURN OLD;
  END IF;

  SELECT COUNT(DISTINCT mr.membership_id) INTO v_owner_count
  FROM public.membership_roles mr
  JOIN public.memberships m      ON m.id = mr.membership_id
  JOIN public.role_permissions rp ON rp.role_id = mr.role_id
  WHERE m.org_id = v_org_id AND rp.permission_key = '*';

  IF v_owner_count <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last owner of the organization';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_owner_removal ON public.membership_roles;
CREATE TRIGGER trg_prevent_last_owner_removal
  BEFORE DELETE ON public.membership_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_removal();

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;

-- The catalog is public reference data
DROP POLICY IF EXISTS "permissions_select" ON public.permissions;
CREATE POLICY "permissions_select" ON public.permissions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "roles_select" ON public.roles;
CREATE POLICY "roles_select" ON public.roles
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "roles_write" ON public.roles;
CREATE POLICY "roles_write" ON public.roles
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('roles.manage'));

DROP POLICY IF EXISTS "role_permissions_select" ON public.role_permissions;
CREATE POLICY "role_permissions_select" ON public.role_permissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.roles r
            WHERE r.id = role_id AND r.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "role_permissions_write" ON public.role_permissions;
CREATE POLICY "role_permissions_write" ON public.role_permissions
  FOR ALL USING (
    public.has_permission('roles.manage')
    AND EXISTS (SELECT 1 FROM public.roles r
                WHERE r.id = role_id AND r.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "membership_roles_select" ON public.membership_roles;
CREATE POLICY "membership_roles_select" ON public.membership_roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.memberships m
            WHERE m.id = membership_id
              AND (m.user_id = auth.uid() OR m.org_id = public.current_org_id()))
  );

DROP POLICY IF EXISTS "membership_roles_write" ON public.membership_roles;
CREATE POLICY "membership_roles_write" ON public.membership_roles
  FOR ALL USING (
    public.has_permission('roles.assign')
    AND EXISTS (SELECT 1 FROM public.memberships m
                WHERE m.id = membership_id AND m.org_id = public.current_org_id())
  );

-- ---------------------------------------------------------------------
-- 10. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_roles_updated_at ON public.roles;
CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 23_modules.sql
-- =====================================================================
-- 23. MODULE REGISTRY — Org-controlled features & navigation
-- =====================================================================
-- The sidebar is currently a hardcoded array, so every org sees Sadhana,
-- Kitchen and Cleanliness whether or not they use them.
--
--   modules              global catalog of installable features
--   organization_modules which are on for an org, in what order, named what
--
-- An org enables only what it needs, renames labels to its own vocabulary,
-- reorders navigation, and stores per-module config as JSONB. Adding a new
-- module later is one INSERT into the catalog — no core changes.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MODULE CATALOG (global)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.modules (
  key                 TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  icon                TEXT,      -- lucide icon name
  route               TEXT,      -- frontend path
  category            TEXT NOT NULL DEFAULT 'general',

  -- Permission a member needs before the nav item is shown to them
  required_permission TEXT REFERENCES public.permissions(key) ON DELETE SET NULL,

  -- Core modules cannot be disabled (an org always needs members + settings)
  is_core             BOOLEAN NOT NULL DEFAULT FALSE,

  -- Enabled automatically for brand-new organizations
  default_enabled     BOOLEAN NOT NULL DEFAULT TRUE,

  -- JSON Schema describing this module's config surface (for admin UI)
  config_schema       JSONB NOT NULL DEFAULT '{}'::jsonb,

  sort_order          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('dashboard',     'Dashboard',     'Overview and key metrics',                  'LayoutDashboard', '/',              'core',        NULL,                  TRUE,  TRUE,  0),
  ('members',       'Members',       'Member directory and profiles',             'Users',           '/members',       'core',        'members.view',        TRUE,  TRUE,  10),
  ('departments',   'Departments',   'Teams, departments and their members',      'Building2',       '/departments',   'structure',   'departments.view',    FALSE, TRUE,  20),
  ('hierarchy',     'Org Structure', 'Organization chart and reporting lines',    'GitBranch',       '/hierarchy',     'structure',   'hierarchy.view',      FALSE, TRUE,  30),
  ('events',        'Events',        'Calendar, programs and attendance',         'CalendarDays',    '/events',        'operations',  'events.view',         FALSE, TRUE,  40),
  ('trackers',      'Trackers',      'Recurring self-reported metrics & scoring', 'BookOpen',        '/trackers',      'operations',  'trackers.view_own',   FALSE, FALSE, 50),
  ('tasks',         'Tasks',         'Recurring assignments and duty rosters',    'ListChecks',      '/tasks',         'operations',  'tasks.view_own',      FALSE, FALSE, 60),
  ('resources',     'Resource Plans','Meal, inventory and resource planning',     'UtensilsCrossed', '/resources',     'operations',  'resources.view',      FALSE, FALSE, 70),
  ('mentorship',    'Mentorship',    'Mentor and mentee relationships',           'Users',           '/mentorship',    'people',      'mentorship.view_own', FALSE, FALSE, 80),
  ('announcements', 'Announcements', 'Org-wide posts and notices',                'Megaphone',       '/announcements', 'comms',       'announcements.view',  FALSE, TRUE,  90),
  ('notifications', 'Notifications', 'Personal notification inbox',               'Bell',            '/notifications', 'comms',       NULL,                  TRUE,  TRUE,  100),
  ('reports',       'Reports',       'Analytics, dashboards and exports',         'BarChart3',       '/reports',       'insights',    'reports.view',        FALSE, FALSE, 110),
  ('settings',      'Settings',      'Organization and personal settings',        'Settings',        '/settings',      'core',        NULL,                  TRUE,  TRUE,  120)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      is_core             = EXCLUDED.is_core,
      sort_order          = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 2. PER-ORGANIZATION MODULE STATE
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_modules (
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_key     TEXT NOT NULL REFERENCES public.modules(key)      ON DELETE CASCADE,

  enabled        BOOLEAN NOT NULL DEFAULT TRUE,

  -- Org's own wording, e.g. trackers -> "Sadhana", members -> "Devotees"
  label_override TEXT,
  icon_override  TEXT,

  sort_order     INTEGER NOT NULL DEFAULT 0,

  -- Module-specific configuration
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (org_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_org_modules_enabled
  ON public.organization_modules (org_id, enabled, sort_order);

-- ---------------------------------------------------------------------
-- 3. SEEDING
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_default_modules(p_org_id UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
  SELECT p_org_id, key, (default_enabled OR is_core), sort_order
  FROM public.modules
  ON CONFLICT (org_id, module_key) DO NOTHING;
$$;

-- Every existing org gets the full catalog at platform defaults
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_modules(o.id);
  END LOOP;
END $$;

-- New orgs are seeded automatically
CREATE OR REPLACE FUNCTION public.seed_modules_for_new_org()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_modules(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_modules_for_new_org ON public.organizations;
CREATE TRIGGER trg_seed_modules_for_new_org
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_modules_for_new_org();

-- ---------------------------------------------------------------------
-- 4. SURABHIKUNJ: turn on the modules they actually use, in their words
-- ---------------------------------------------------------------------
-- Their existing feature set is expressed as configuration rather than as
-- platform defaults, which is exactly the point of this migration.

DO $$
DECLARE v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Sadhana',    icon_override = 'BookOpen'        WHERE org_id = v_org_id AND module_key = 'trackers';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Services',   icon_override = 'ListChecks'      WHERE org_id = v_org_id AND module_key = 'tasks';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Kitchen',    icon_override = 'UtensilsCrossed' WHERE org_id = v_org_id AND module_key = 'resources';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Counsellor', icon_override = 'Users'           WHERE org_id = v_org_id AND module_key = 'mentorship';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Residents'                                     WHERE org_id = v_org_id AND module_key = 'members';
  UPDATE public.organization_modules SET enabled = TRUE                                                                   WHERE org_id = v_org_id AND module_key = 'reports';
END $$;

-- ---------------------------------------------------------------------
-- 5. NAVIGATION RESOLVER
-- ---------------------------------------------------------------------
-- One call returns the caller's sidebar: enabled modules they have
-- permission to see, already labelled and ordered. Replaces the hardcoded
-- navItems array in Sidebar.jsx.

CREATE OR REPLACE FUNCTION public.my_navigation()
RETURNS TABLE (
  key        TEXT,
  label      TEXT,
  icon       TEXT,
  route      TEXT,
  category   TEXT,
  sort_order INTEGER,
  config     JSONB
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    m.key,
    COALESCE(om.label_override, m.name)  AS label,
    COALESCE(om.icon_override,  m.icon)  AS icon,
    m.route,
    m.category,
    om.sort_order,
    om.config
  FROM public.organization_modules om
  JOIN public.modules m ON m.key = om.module_key
  WHERE om.org_id = public.current_org_id()
    AND om.enabled
    AND (
      m.required_permission IS NULL
      OR public.has_permission(m.required_permission)
    )
  ORDER BY om.sort_order, m.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_navigation() TO authenticated;

-- Is a module switched on for the caller's org? Used to guard routes and
-- to short-circuit queries against disabled features.
CREATE OR REPLACE FUNCTION public.module_enabled(p_module_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.organization_modules
     WHERE org_id = public.current_org_id() AND module_key = p_module_key),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.module_enabled(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. GUARD — core modules stay enabled
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_core_modules()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.enabled = FALSE
     AND EXISTS (SELECT 1 FROM public.modules WHERE key = NEW.module_key AND is_core)
  THEN
    RAISE EXCEPTION 'Module "%" is core and cannot be disabled', NEW.module_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_core_modules ON public.organization_modules;
CREATE TRIGGER trg_protect_core_modules
  BEFORE UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.protect_core_modules();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.modules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "modules_select" ON public.modules;
CREATE POLICY "modules_select" ON public.modules
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "org_modules_select" ON public.organization_modules;
CREATE POLICY "org_modules_select" ON public.organization_modules
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "org_modules_write" ON public.organization_modules;
CREATE POLICY "org_modules_write" ON public.organization_modules
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('org.modules.manage')
  );

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_org_modules_updated_at ON public.organization_modules;
CREATE TRIGGER trg_org_modules_updated_at
  BEFORE UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 24_rls_rewrite.sql
-- =====================================================================
-- 24. RLS REWRITE — Policies driven by permissions, not role names
-- =====================================================================
-- Every policy written in 01_schema.sql / 05_app_policies.sql tests role
-- names directly, e.g.  get_my_role() IN ('counsellor','admin','vmc','oc').
-- That makes custom roles meaningless at the security layer: an org could
-- create a "Kitchen Head" role but the database would never honour it.
--
-- This migration re-expresses every policy in terms of has_permission(),
-- so a permission granted to ANY role — including one the org invented
-- five minutes ago — is enforced correctly.
--
-- Also introduces active-org switching, needed now that a user can belong
-- to more than one organization.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ACTIVE ORGANIZATION
-- ---------------------------------------------------------------------
-- With multi-org membership, "which org am I looking at right now?" must
-- be explicit. Resolution order:
--   1. profiles.active_org_id, if the user is still an active member there
--   2. their legacy profiles.org_id
--   3. their single active membership, if they only have one

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.profiles SET active_org_id = org_id
WHERE active_org_id IS NULL AND org_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.active_org_id
     FROM public.profiles p
     WHERE p.id = auth.uid()
       AND EXISTS (
         SELECT 1 FROM public.memberships m
         WHERE m.user_id = p.id AND m.org_id = p.active_org_id
           AND m.status = 'active'
       )),
    (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()),
    (SELECT m.org_id FROM public.memberships m
     WHERE m.user_id = auth.uid() AND m.status = 'active'
     ORDER BY m.joined_at NULLS LAST LIMIT 1)
  );
$$;

-- Switch the caller into another organization they belong to.
CREATE OR REPLACE FUNCTION public.switch_organization(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND org_id = p_org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You are not an active member of that organization';
  END IF;

  UPDATE public.profiles
  SET active_org_id = p_org_id, updated_at = NOW()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_organization(UUID) TO authenticated;

-- Organizations the caller can switch into (for an org picker UI).
CREATE OR REPLACE FUNCTION public.my_organizations()
RETURNS TABLE (
  org_id    UUID,
  name      TEXT,
  slug      TEXT,
  logo_url  TEXT,
  status    TEXT,
  is_active BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.id, o.name, o.slug, o.logo_url, m.status,
         (o.id = public.current_org_id()) AS is_active
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.status = 'active'
  ORDER BY o.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_organizations() TO authenticated;

-- Organizations policy must allow seeing every org you belong to,
-- not only the active one (otherwise the switcher can't render).
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.memberships m
            WHERE m.org_id = organizations.id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "organizations_update" ON public.organizations;
CREATE POLICY "organizations_update" ON public.organizations
  FOR UPDATE USING (
    id = public.current_org_id() AND public.has_permission('org.settings.manage')
  );

-- ---------------------------------------------------------------------
-- 2. PROFILES  (global identity)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_select"      ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;

-- Own row always; plus anyone who shares an organization with you.
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.memberships me
      JOIN public.memberships them ON them.org_id = me.org_id
      WHERE me.user_id = auth.uid() AND them.user_id = profiles.id
    )
  );

CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.has_permission('members.manage'));

-- ---------------------------------------------------------------------
-- 3. MEMBERSHIPS  (tightened from the placeholder in migration 21)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "memberships_admin_write" ON public.memberships;

DROP POLICY IF EXISTS "memberships_update" ON public.memberships;
CREATE POLICY "memberships_update" ON public.memberships
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['members.manage', 'members.approve'])
  );

DROP POLICY IF EXISTS "memberships_insert_admin" ON public.memberships;
CREATE POLICY "memberships_insert_admin" ON public.memberships
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id() AND public.has_permission('members.invite')
  );

DROP POLICY IF EXISTS "memberships_delete" ON public.memberships;
CREATE POLICY "memberships_delete" ON public.memberships
  FOR DELETE USING (
    org_id = public.current_org_id() AND public.has_permission('members.remove')
  );

DROP POLICY IF EXISTS "member_fields_write" ON public.member_field_definitions;
CREATE POLICY "member_fields_write" ON public.member_field_definitions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('members.manage')
  );

-- ---------------------------------------------------------------------
-- 4. ORGANIZATION SETTINGS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "org_settings_write" ON public.organization_settings;
CREATE POLICY "org_settings_write" ON public.organization_settings
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('org.settings.manage')
  );

-- ---------------------------------------------------------------------
-- 5. DEPARTMENTS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "departments_select" ON public.departments;
CREATE POLICY "departments_select" ON public.departments
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('departments.view')
  );

DROP POLICY IF EXISTS "departments_write" ON public.departments;
CREATE POLICY "departments_write" ON public.departments
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('departments.manage')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='department_members') THEN

    EXECUTE 'DROP POLICY IF EXISTS "department_members_select" ON public.department_members';
    EXECUTE $p$
      CREATE POLICY "department_members_select" ON public.department_members
        FOR SELECT USING (
          EXISTS (SELECT 1 FROM public.departments d
                  WHERE d.id = department_id AND d.org_id = public.current_org_id())
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "department_members_write" ON public.department_members';
    EXECUTE $p$
      CREATE POLICY "department_members_write" ON public.department_members
        FOR ALL USING (
          public.has_any_permission(ARRAY['departments.manage','departments.assign'])
          AND EXISTS (SELECT 1 FROM public.departments d
                      WHERE d.id = department_id AND d.org_id = public.current_org_id())
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. ORG POSITIONS (hierarchy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "org_positions_select" ON public.org_positions;
CREATE POLICY "org_positions_select" ON public.org_positions
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('hierarchy.view')
  );

DROP POLICY IF EXISTS "org_positions_write" ON public.org_positions;
CREATE POLICY "org_positions_write" ON public.org_positions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('hierarchy.manage')
  );

-- ---------------------------------------------------------------------
-- 7. SADHANA REPORTS  (until the tracker primitive replaces them)
-- ---------------------------------------------------------------------
-- Previously: role IN ('counsellor','sadhana_incharge','admin','vmc','oc').
-- Now: anyone holding trackers.view_all, whatever their role is called.

DROP POLICY IF EXISTS "sadhana_select"     ON public.sadhana_reports;
DROP POLICY IF EXISTS "sadhana_insert_own" ON public.sadhana_reports;
DROP POLICY IF EXISTS "sadhana_update_own" ON public.sadhana_reports;

CREATE POLICY "sadhana_select" ON public.sadhana_reports
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.view_all'))
  );

CREATE POLICY "sadhana_insert" ON public.sadhana_reports
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (
      (profile_id = auth.uid() AND public.has_permission('trackers.submit'))
      OR public.has_permission('trackers.manage')
    )
  );

CREATE POLICY "sadhana_update" ON public.sadhana_reports
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

CREATE POLICY "sadhana_delete" ON public.sadhana_reports
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

DROP POLICY IF EXISTS "sadhana_config_select" ON public.sadhana_score_config;
CREATE POLICY "sadhana_config_select" ON public.sadhana_score_config
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "sadhana_config_write" ON public.sadhana_score_config;
CREATE POLICY "sadhana_config_write" ON public.sadhana_score_config
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('trackers.manage')
  );

-- ---------------------------------------------------------------------
-- 8. CLEANING  (until the task primitive replaces it)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "cleaning_areas_select" ON public.cleaning_areas;
CREATE POLICY "cleaning_areas_select" ON public.cleaning_areas
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "cleaning_areas_write" ON public.cleaning_areas;
CREATE POLICY "cleaning_areas_write" ON public.cleaning_areas
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('tasks.manage')
  );

DROP POLICY IF EXISTS "cleaning_logs_select" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_select" ON public.cleaning_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "cleaning_logs_insert" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_insert" ON public.cleaning_logs
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.assign'))
  );

DROP POLICY IF EXISTS "cleaning_logs_update" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_update" ON public.cleaning_logs
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.verify'))
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='cleaning_assignments') THEN
    EXECUTE 'ALTER TABLE public.cleaning_assignments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "cleaning_assignments_select" ON public.cleaning_assignments';
    EXECUTE $p$
      CREATE POLICY "cleaning_assignments_select" ON public.cleaning_assignments
        FOR SELECT USING (
          EXISTS (SELECT 1 FROM public.cleaning_areas a
                  WHERE a.id = area_id AND a.org_id = public.current_org_id())
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "cleaning_assignments_write" ON public.cleaning_assignments';
    EXECUTE $p$
      CREATE POLICY "cleaning_assignments_write" ON public.cleaning_assignments
        FOR ALL USING (
          public.has_any_permission(ARRAY['tasks.assign','tasks.manage'])
          AND EXISTS (SELECT 1 FROM public.cleaning_areas a
                      WHERE a.id = area_id AND a.org_id = public.current_org_id())
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 9. SERVICES  (until the task primitive replaces them)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "services_write" ON public.services;
CREATE POLICY "services_write" ON public.services
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('tasks.manage')
  );

DROP POLICY IF EXISTS "service_allocations_select" ON public.service_allocations;
CREATE POLICY "service_allocations_select" ON public.service_allocations
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "service_allocations_write" ON public.service_allocations;
CREATE POLICY "service_allocations_write" ON public.service_allocations
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (
      profile_id = auth.uid()
      OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage','tasks.verify'])
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='service_preferences') THEN
    EXECUTE 'ALTER TABLE public.service_preferences ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "service_preferences_all" ON public.service_preferences';
    EXECUTE $p$
      CREATE POLICY "service_preferences_all" ON public.service_preferences
        FOR ALL USING (
          profile_id = auth.uid() OR public.has_permission('tasks.assign')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 10. MEAL PLANS  (until the resource primitive replaces them)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "meal_plans_select" ON public.meal_plans;
CREATE POLICY "meal_plans_select" ON public.meal_plans
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "meal_plans_write" ON public.meal_plans;
CREATE POLICY "meal_plans_write" ON public.meal_plans
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

-- ---------------------------------------------------------------------
-- 11. EVENTS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select" ON public.events
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('events.view')
  );

DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert" ON public.events
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['events.create','events.manage'])
  );

DROP POLICY IF EXISTS "events_write" ON public.events;
DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update" ON public.events
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('events.manage'))
  );

DROP POLICY IF EXISTS "events_delete" ON public.events;
CREATE POLICY "events_delete" ON public.events
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('events.manage'))
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='event_rsvp') THEN
    EXECUTE 'DROP POLICY IF EXISTS "event_rsvp_select" ON public.event_rsvp';
    EXECUTE $p$
      CREATE POLICY "event_rsvp_select" ON public.event_rsvp
        FOR SELECT USING (
          profile_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.events e
                     WHERE e.id = event_id AND e.org_id = public.current_org_id()
                       AND public.has_permission('events.attendance'))
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "event_rsvp_write" ON public.event_rsvp';
    EXECUTE $p$
      CREATE POLICY "event_rsvp_write" ON public.event_rsvp
        FOR ALL USING (
          profile_id = auth.uid() OR public.has_permission('events.attendance')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 12. ANNOUNCEMENTS
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='announcements') THEN
    EXECUTE 'DROP POLICY IF EXISTS "announcements_select" ON public.announcements';
    EXECUTE $p$
      CREATE POLICY "announcements_select" ON public.announcements
        FOR SELECT USING (
          org_id = public.current_org_id()
          AND public.has_permission('announcements.view')
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "announcements_write" ON public.announcements';
    EXECUTE $p$
      CREATE POLICY "announcements_write" ON public.announcements
        FOR ALL USING (
          org_id = public.current_org_id()
          AND public.has_permission('announcements.manage')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 13. NOTIFICATIONS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('notifications.send'))
  );

-- ---------------------------------------------------------------------
-- 14. Retire the hardcoded role guard on profile updates
-- ---------------------------------------------------------------------
-- Role no longer lives on profiles; it lives in membership_roles, which has
-- its own policy. Approval moved to memberships.status. This trigger keeps
-- the legacy columns locked down while they still exist.

CREATE OR REPLACE FUNCTION public.protect_privileged_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_permission(ARRAY['members.manage','roles.assign']) THEN
    NEW.role        := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.org_id      := OLD.org_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 15. Signup: create a global identity only. No auto-join to any org.
-- ---------------------------------------------------------------------
-- Previously every new user was silently attached to Surabhikunj via
-- bootstrap_current_user_to_default_voice(). On a real platform, joining an
-- organization is an explicit act (invite, join code, or founding one).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, spiritual_name, email, is_approved)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
      NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
    NEW.email,
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Kept for backwards compatibility with the deployed bundle, but it is now
-- a no-op unless VITE_DEFAULT_VOICE_ID-style bootstrapping is deliberately
-- re-enabled by an operator.
CREATE OR REPLACE FUNCTION public.bootstrap_current_user_to_default_voice()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;


-- FILE: 25_trackers.sql
-- =====================================================================
-- 25. TRACKERS — Generic self-reporting primitive
-- =====================================================================
-- Replaces `sadhana_reports` / `sadhana_score_config` with a configurable
-- engine that any organization can use for any kind of tracked metric:
-- practice logs, attendance, habit tracking, volunteer hours, etc.
--
-- Sadhana is seeded as the first tracker for Surabhikunj. Its existing
-- rows are migrated into the generic tables. The old tables stay for
-- backwards compatibility until the frontend is fully cut over.
--
-- Architecture:
--   tracker_definitions  — org creates one per tracking program
--   tracker_fields       — the input fields for each tracker
--   tracker_entries      — a member's submission for one day
--   tracker_field_values — the actual values per field per entry
--   tracker_scoring_rules— how the org calculates a score from values
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TRACKER DEFINITIONS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tracker_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT DEFAULT 'BookOpen',
  color           TEXT DEFAULT '#f97316',

  -- Cadence: 'daily' | 'weekly' | 'monthly' | 'on_demand'
  cadence         TEXT NOT NULL DEFAULT 'daily',

  -- Who can submit: 'self' (each member submits own) | 'admin' (only managers)
  submission_mode TEXT NOT NULL DEFAULT 'self',

  -- Score 0-100 is computed if any scoring rules exist
  has_scoring     BOOLEAN NOT NULL DEFAULT TRUE,
  score_label     TEXT DEFAULT 'Score',

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tracker_definitions
  DROP CONSTRAINT IF EXISTS tracker_definitions_cadence_check;
ALTER TABLE public.tracker_definitions
  ADD CONSTRAINT tracker_definitions_cadence_check
  CHECK (cadence IN ('daily', 'weekly', 'monthly', 'on_demand'));

ALTER TABLE public.tracker_definitions
  DROP CONSTRAINT IF EXISTS tracker_definitions_submission_mode_check;
ALTER TABLE public.tracker_definitions
  ADD CONSTRAINT tracker_definitions_submission_mode_check
  CHECK (submission_mode IN ('self', 'admin'));

CREATE INDEX IF NOT EXISTS idx_tracker_defs_org
  ON public.tracker_definitions (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. TRACKER FIELDS
-- ---------------------------------------------------------------------
-- Each field is one piece of data collected per entry. Type drives
-- the form widget and the scoring engine.

CREATE TABLE IF NOT EXISTS public.tracker_fields (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id       UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,          -- machine key used in scoring rules
  label            TEXT NOT NULL,
  field_type       TEXT NOT NULL DEFAULT 'number',
  unit             TEXT,                   -- 'rounds', 'minutes', 'hours', etc.
  help_text        TEXT,
  placeholder      TEXT,
  default_value    TEXT,
  is_required      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order       INTEGER NOT NULL DEFAULT 0,

  -- Validation
  min_value        NUMERIC,
  max_value        NUMERIC,
  options          JSONB NOT NULL DEFAULT '[]'::jsonb, -- for select fields

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracker_id, key)
);

ALTER TABLE public.tracker_fields
  DROP CONSTRAINT IF EXISTS tracker_fields_type_check;
ALTER TABLE public.tracker_fields
  ADD CONSTRAINT tracker_fields_type_check
  CHECK (field_type IN (
    'number', 'time', 'duration_min', 'boolean',
    'select', 'text', 'textarea'
  ));

CREATE INDEX IF NOT EXISTS idx_tracker_fields_tracker
  ON public.tracker_fields (tracker_id, sort_order);

-- ---------------------------------------------------------------------
-- 3. SCORING RULES
-- ---------------------------------------------------------------------
-- Simple, declarative rules evaluated in order. Each rule contributes
-- up to `max_points` to the total. The engine sums them and normalises
-- to 100.
--
-- rule_type options:
--   'threshold' — value < threshold → points; supports tier config
--   'boolean'   — TRUE → points
--   'range'     — value in [min, max] → points (scaled linearly)
--   'penalty'   — subtract points (e.g. day rest)
--   'formula'   — arbitrary JS-safe expression (evaluated in frontend)

CREATE TABLE IF NOT EXISTS public.tracker_scoring_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id   UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  field_key    TEXT NOT NULL,
  rule_type    TEXT NOT NULL DEFAULT 'threshold',
  label        TEXT NOT NULL,
  max_points   NUMERIC(6,2) NOT NULL DEFAULT 10,

  -- Flexible config (schema depends on rule_type)
  -- threshold: { tiers: [{by: "07:00", pts: 10}, {by: "08:00", pts: 7}, ...] }
  -- range:     { min: 0, max: 45, full_score_at: 45 }
  -- boolean:   {} (true = max_points)
  -- penalty:   { per_unit: 0.5, unit: 15 }  (per 15 minutes above 0)
  -- formula:   { expr: "japa_rounds * 0.625" }
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,

  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_scoring_tracker
  ON public.tracker_scoring_rules (tracker_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. TRACKER ENTRIES
-- ---------------------------------------------------------------------
-- One row per (member, tracker, period). 'period_date' is the day being
-- reported for daily trackers; the week/month start for longer cadences.

CREATE TABLE IF NOT EXISTS public.tracker_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id     UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_date    DATE NOT NULL,

  -- Computed score (null until scoring engine runs)
  score          NUMERIC(5,2),
  score_detail   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- breakdown per rule

  notes          TEXT,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tracker_id, user_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_tracker_entries_user_date
  ON public.tracker_entries (user_id, tracker_id, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_tracker_entries_org_date
  ON public.tracker_entries (org_id, tracker_id, period_date DESC);

-- ---------------------------------------------------------------------
-- 5. FIELD VALUES
-- ---------------------------------------------------------------------
-- Stored separately so the schema adapts to any tracker without a migration.

CREATE TABLE IF NOT EXISTS public.tracker_field_values (
  entry_id   UUID NOT NULL REFERENCES public.tracker_entries(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  value_text TEXT,        -- raw string; typed value is parsed per field_type
  PRIMARY KEY (entry_id, field_key)
);

-- ---------------------------------------------------------------------
-- 6. SEED SURABHIKUNJ SADHANA AS THE FIRST TRACKER
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id     UUID;
  v_tracker_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.tracker_definitions
    (org_id, name, description, icon, color, cadence, submission_mode, has_scoring, score_label)
  VALUES
    (v_org_id, 'Sadhana', 'Daily spiritual practice report', 'BookOpen', '#f97316',
     'daily', 'self', TRUE, 'Sadhana Score')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_tracker_id;

  IF v_tracker_id IS NULL THEN
    SELECT id INTO v_tracker_id
    FROM public.tracker_definitions WHERE org_id = v_org_id AND name = 'Sadhana' LIMIT 1;
  END IF;

  -- Fields (match the legacy sadhana_reports columns)
  INSERT INTO public.tracker_fields (tracker_id, key, label, field_type, unit, sort_order)
  VALUES
    (v_tracker_id, 'wake_up_time',  'Wake-up Time',    'time',         NULL,      10),
    (v_tracker_id, 'to_bed_time',   'To Bed Time',     'time',         NULL,      20),
    (v_tracker_id, 'day_rest_min',  'Day Rest',        'duration_min', 'minutes', 30),
    (v_tracker_id, 'japa_time',     'Japa Completed',  'time',         NULL,      40),
    (v_tracker_id, 'japa_rounds',   'Japa Rounds',     'number',       'rounds',  50),
    (v_tracker_id, 'reading_min',   'Reading',         'duration_min', 'minutes', 60),
    (v_tracker_id, 'hearing_min',   'Hearing',         'duration_min', 'minutes', 70),
    (v_tracker_id, 'mangal_arti',   'Mangal Arti',     'boolean',      NULL,      80),
    (v_tracker_id, 'morning_class', 'Morning Class',   'boolean',      NULL,      90),
    (v_tracker_id, 'seva_hours',    'Seva',            'number',       'hours',   100)
  ON CONFLICT (tracker_id, key) DO NOTHING;

  -- Scoring rules (mirrors sadhana_score_config defaults)
  INSERT INTO public.tracker_scoring_rules
    (tracker_id, field_key, rule_type, label, max_points, config, sort_order)
  VALUES
    (v_tracker_id, 'japa_time', 'threshold', 'Japa Timing', 10,
     '{"tiers":[{"by":"07:00","pts":10},{"by":"08:00","pts":7},{"by":"09:00","pts":5},{"by":"23:59","pts":2}]}'::jsonb, 10),
    (v_tracker_id, 'japa_rounds', 'range', 'Japa Rounds', 10,
     '{"min":0,"max":16,"full_score_at":16}'::jsonb, 20),
    (v_tracker_id, 'wake_up_time', 'threshold', 'Wake-up', 10,
     '{"tiers":[{"by":"04:30","pts":10},{"by":"05:00","pts":7},{"by":"06:00","pts":4},{"by":"23:59","pts":0}]}'::jsonb, 30),
    (v_tracker_id, 'to_bed_time', 'threshold', 'Bed Time', 5,
     '{"tiers":[{"by":"22:00","pts":5},{"by":"23:00","pts":3},{"by":"23:59","pts":0}]}'::jsonb, 40),
    (v_tracker_id, 'day_rest_min', 'penalty', 'Day Rest Penalty', 0,
     '{"per_unit":0.5,"unit":15}'::jsonb, 50),
    (v_tracker_id, 'reading_min', 'range', 'Reading', 10,
     '{"min":0,"max":45,"full_score_at":45}'::jsonb, 60),
    (v_tracker_id, 'hearing_min', 'range', 'Hearing', 10,
     '{"min":0,"max":45,"full_score_at":45}'::jsonb, 70),
    (v_tracker_id, 'mangal_arti', 'boolean', 'Mangal Arti', 5, '{}'::jsonb, 80),
    (v_tracker_id, 'morning_class', 'boolean', 'Morning Class', 5, '{}'::jsonb, 90),
    (v_tracker_id, 'seva_hours', 'range', 'Seva', 10,
     '{"min":0,"max":4,"full_score_at":4}'::jsonb, 100)
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 7. MIGRATE existing sadhana_reports into tracker_entries
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id     UUID;
  v_tracker_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_tracker_id
  FROM public.tracker_definitions WHERE org_id = v_org_id AND name = 'Sadhana' LIMIT 1;
  IF v_tracker_id IS NULL THEN RETURN; END IF;

  -- Entries
  INSERT INTO public.tracker_entries
    (tracker_id, org_id, user_id, period_date, score, score_detail, notes, submitted_at, updated_at)
  SELECT
    v_tracker_id,
    org_id,
    profile_id,
    report_date,
    score,
    jsonb_build_object(
      'japa',       score_japa,
      'sleep',      score_sleep,
      'reading',    score_reading,
      'hearing',    score_hearing,
      'seva',       score_seva,
      'attendance', score_attendance
    ),
    notes,
    submitted_at,
    updated_at
  FROM public.sadhana_reports
  ON CONFLICT (tracker_id, user_id, period_date) DO NOTHING;

  -- Field values
  INSERT INTO public.tracker_field_values (entry_id, field_key, value_text)
  SELECT e.id, v.field_key, v.value_text
  FROM public.tracker_entries e
  JOIN public.sadhana_reports r
    ON r.profile_id = e.user_id AND r.report_date = e.period_date AND r.org_id = e.org_id
  CROSS JOIN LATERAL (VALUES
    ('wake_up_time',  r.wake_up_time::text),
    ('to_bed_time',   r.to_bed_time::text),
    ('day_rest_min',  r.day_rest_min::text),
    ('japa_time',     r.japa_time::text),
    ('japa_rounds',   r.japa_rounds::text),
    ('reading_min',   r.reading_min::text),
    ('hearing_min',   r.hearing_min::text),
    ('mangal_arti',   r.mangal_arti::text),
    ('morning_class', r.morning_class::text),
    ('seva_hours',    r.seva_hours::text)
  ) AS v(field_key, value_text)
  WHERE e.tracker_id = v_tracker_id
    AND v.value_text IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 8. HELPERS
-- ---------------------------------------------------------------------

-- Latest N entries for a user in a tracker
CREATE OR REPLACE FUNCTION public.my_tracker_entries(
  p_tracker_id UUID,
  p_limit      INTEGER DEFAULT 90
)
RETURNS TABLE (
  id          UUID,
  period_date DATE,
  score       NUMERIC,
  score_detail JSONB,
  notes       TEXT,
  submitted_at TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT te.id, te.period_date, te.score, te.score_detail, te.notes, te.submitted_at
  FROM public.tracker_entries te
  WHERE te.tracker_id = p_tracker_id
    AND te.user_id    = auth.uid()
    AND te.org_id     = public.current_org_id()
  ORDER BY te.period_date DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.my_tracker_entries(UUID, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.tracker_definitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_fields         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_scoring_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_field_values   ENABLE ROW LEVEL SECURITY;

-- Definitions: visible to any org member who can view trackers
DROP POLICY IF EXISTS "tracker_defs_select" ON public.tracker_definitions;
CREATE POLICY "tracker_defs_select" ON public.tracker_definitions
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['trackers.submit','trackers.view_own'])
  );

DROP POLICY IF EXISTS "tracker_defs_write" ON public.tracker_definitions;
CREATE POLICY "tracker_defs_write" ON public.tracker_definitions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('trackers.manage')
  );

-- Fields and scoring rules: same as definition
DROP POLICY IF EXISTS "tracker_fields_select" ON public.tracker_fields;
CREATE POLICY "tracker_fields_select" ON public.tracker_fields
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id()
              AND public.has_any_permission(ARRAY['trackers.submit','trackers.view_own']))
  );

DROP POLICY IF EXISTS "tracker_fields_write" ON public.tracker_fields;
CREATE POLICY "tracker_fields_write" ON public.tracker_fields
  FOR ALL USING (
    public.has_permission('trackers.manage')
    AND EXISTS (SELECT 1 FROM public.tracker_definitions td
                WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "tracker_scoring_select" ON public.tracker_scoring_rules;
CREATE POLICY "tracker_scoring_select" ON public.tracker_scoring_rules
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "tracker_scoring_write" ON public.tracker_scoring_rules;
CREATE POLICY "tracker_scoring_write" ON public.tracker_scoring_rules
  FOR ALL USING (
    public.has_permission('trackers.manage')
    AND EXISTS (SELECT 1 FROM public.tracker_definitions td
                WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

-- Entries: own visible to self; all visible to trackers.view_all
DROP POLICY IF EXISTS "tracker_entries_select" ON public.tracker_entries;
CREATE POLICY "tracker_entries_select" ON public.tracker_entries
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('trackers.view_all'))
  );

DROP POLICY IF EXISTS "tracker_entries_insert" ON public.tracker_entries;
CREATE POLICY "tracker_entries_insert" ON public.tracker_entries
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (
      (user_id = auth.uid() AND public.has_permission('trackers.submit'))
      OR public.has_permission('trackers.manage')
    )
  );

DROP POLICY IF EXISTS "tracker_entries_update" ON public.tracker_entries;
CREATE POLICY "tracker_entries_update" ON public.tracker_entries
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

DROP POLICY IF EXISTS "tracker_entries_delete" ON public.tracker_entries;
CREATE POLICY "tracker_entries_delete" ON public.tracker_entries
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

-- Field values: inherit from the entry's access rules
DROP POLICY IF EXISTS "tracker_fv_select" ON public.tracker_field_values;
CREATE POLICY "tracker_fv_select" ON public.tracker_field_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tracker_entries te
      WHERE te.id = entry_id
        AND te.org_id = public.current_org_id()
        AND (te.user_id = auth.uid() OR public.has_permission('trackers.view_all'))
    )
  );

DROP POLICY IF EXISTS "tracker_fv_write" ON public.tracker_field_values;
CREATE POLICY "tracker_fv_write" ON public.tracker_field_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tracker_entries te
      WHERE te.id = entry_id
        AND te.org_id = public.current_org_id()
        AND (te.user_id = auth.uid() OR public.has_permission('trackers.manage'))
    )
  );

-- ---------------------------------------------------------------------
-- 10. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_tracker_defs_updated_at ON public.tracker_definitions;
CREATE TRIGGER trg_tracker_defs_updated_at
  BEFORE UPDATE ON public.tracker_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_tracker_entries_updated_at ON public.tracker_entries;
CREATE TRIGGER trg_tracker_entries_updated_at
  BEFORE UPDATE ON public.tracker_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 26_tasks.sql
-- =====================================================================
-- 26. TASKS — Generic recurring assignment primitive
-- =====================================================================
-- Unifies `cleaning_areas`, `cleaning_assignments`, `cleaning_logs`,
-- `services`, `service_allocations`, and `service_preferences` under one
-- consistent model any organization can use for any kind of duty roster,
-- chore schedule, or service allocation.
--
-- Architecture:
--   task_categories   — org-defined groupings (e.g. "Cleaning", "Temple Service")
--   task_templates    — the reusable task itself (what, how long, recurrence)
--   task_areas        — physical or logical locations a task happens in
--   task_assignments  — who is assigned to a task/area in what window
--   task_logs         — per-day completion records
--   task_preferences  — a member's availability preferences per period
--
-- Legacy tables stay; they are migrated into this model.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TASK CATEGORIES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT DEFAULT 'ListChecks',
  color       TEXT DEFAULT '#64748b',
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_categories_org
  ON public.task_categories (org_id, sort_order);

-- ---------------------------------------------------------------------
-- 2. TASK TEMPLATES
-- ---------------------------------------------------------------------
-- Describes a recurring task type. Actual assignments are generated from
-- these templates by managers.

CREATE TABLE IF NOT EXISTS public.task_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES public.task_categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  instructions    TEXT,
  department_id   UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  default_time    TIME,
  duration_min    INTEGER,
  recurrence      TEXT NOT NULL DEFAULT 'daily',  -- daily|weekly|monthly|custom
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.task_templates
  DROP CONSTRAINT IF EXISTS task_templates_recurrence_check;
ALTER TABLE public.task_templates
  ADD CONSTRAINT task_templates_recurrence_check
  CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'custom', 'once'));

CREATE INDEX IF NOT EXISTS idx_task_templates_org
  ON public.task_templates (org_id, is_active);

-- ---------------------------------------------------------------------
-- 3. TASK AREAS
-- ---------------------------------------------------------------------
-- Optional physical/logical location for a task (cleaning area, worship
-- station, kitchen section, etc.). Tasks can exist without areas.

CREATE TABLE IF NOT EXISTS public.task_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  location    TEXT,           -- floor / building / section
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_areas_org
  ON public.task_areas (org_id, is_active);

-- ---------------------------------------------------------------------
-- 4. TASK ASSIGNMENTS
-- ---------------------------------------------------------------------
-- Assigns a member to a task (and optionally area) for a date window.

CREATE TABLE IF NOT EXISTS public.task_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id   UUID REFERENCES public.task_templates(id) ON DELETE CASCADE,
  area_id       UUID REFERENCES public.task_areas(id) ON DELETE SET NULL,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  task_date     DATE NOT NULL,
  task_time     TIME,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique: one assignment per user per task per area per day
  UNIQUE (template_id, area_id, user_id, task_date)
);

CREATE INDEX IF NOT EXISTS idx_task_assignments_org_date
  ON public.task_assignments (org_id, task_date, user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_user
  ON public.task_assignments (user_id, task_date DESC);

-- ---------------------------------------------------------------------
-- 5. TASK LOGS
-- ---------------------------------------------------------------------
-- Completion record for an assignment on a given day.

CREATE TABLE IF NOT EXISTS public.task_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id  UUID REFERENCES public.task_assignments(id) ON DELETE CASCADE,

  -- Denormalized for queries that don't need the assignment
  template_id    UUID REFERENCES public.task_templates(id) ON DELETE SET NULL,
  area_id        UUID REFERENCES public.task_areas(id) ON DELETE SET NULL,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL DEFAULT CURRENT_DATE,

  status         TEXT NOT NULL DEFAULT 'pending',
  verified_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at    TIMESTAMPTZ,
  notes          TEXT,
  marked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (assignment_id, log_date)
);

ALTER TABLE public.task_logs
  DROP CONSTRAINT IF EXISTS task_logs_status_check;
ALTER TABLE public.task_logs
  ADD CONSTRAINT task_logs_status_check
  CHECK (status IN ('pending', 'done', 'partial', 'missed', 'excused', 'verified'));

CREATE INDEX IF NOT EXISTS idx_task_logs_org_date
  ON public.task_logs (org_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_logs_user
  ON public.task_logs (user_id, log_date DESC);

-- ---------------------------------------------------------------------
-- 6. TASK PREFERENCES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_preferences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_id  UUID NOT NULL REFERENCES public.task_templates(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  preference   INTEGER NOT NULL DEFAULT 1, -- 1=preferred, 0=ok, -1=avoid
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, template_id, period_start)
);

-- ---------------------------------------------------------------------
-- 7. SEED SURABHIKUNJ: create categories for Cleaning and Services
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id          UUID;
  v_cleaning_cat_id UUID;
  v_service_cat_id  UUID;
  v_tmpl_id         UUID;
  v_area_id         UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  -- Categories
  INSERT INTO public.task_categories (org_id, name, icon, color, sort_order)
  VALUES
    (v_org_id, 'Cleanliness', 'Sparkles',   '#16a34a', 10),
    (v_org_id, 'Temple Service', 'ListChecks', '#f97316', 20)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_cleaning_cat_id
  FROM public.task_categories WHERE org_id = v_org_id AND name = 'Cleanliness' LIMIT 1;
  SELECT id INTO v_service_cat_id
  FROM public.task_categories WHERE org_id = v_org_id AND name = 'Temple Service' LIMIT 1;

  -- Migrate cleaning_areas → task_areas
  INSERT INTO public.task_areas (id, org_id, name, description, location, is_active)
  SELECT id, org_id, name, description, floor, is_active
  FROM public.cleaning_areas
  WHERE org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  -- Create one template per cleaning area (simple 1-to-1 for backwards compat)
  FOR v_area_id IN
    SELECT id FROM public.task_areas WHERE org_id = v_org_id
  LOOP
    INSERT INTO public.task_templates (org_id, category_id, name, recurrence, is_active)
    SELECT v_org_id, v_cleaning_cat_id,
           (SELECT name FROM public.task_areas WHERE id = v_area_id),
           'daily', TRUE
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_tmpl_id;
  END LOOP;

  -- Migrate services → task_templates (service category)
  INSERT INTO public.task_templates
    (id, org_id, category_id, name, description, instructions,
     department_id, default_time, duration_min, recurrence, is_active)
  SELECT
    s.id, s.org_id, v_service_cat_id,
    s.name, s.description, s.instructions,
    s.department_id, s.default_time, s.duration_min,
    CASE WHEN s.is_recurring THEN 'daily' ELSE 'once' END,
    s.is_active
  FROM public.services s
  WHERE s.org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  -- Migrate cleaning_assignments → task_assignments (date = today for open-ended)
  INSERT INTO public.task_assignments
    (org_id, template_id, area_id, user_id, task_date)
  SELECT
    a.org_id,
    (SELECT tt.id FROM public.task_templates tt
     JOIN public.task_areas ta ON ta.name = (SELECT name FROM public.task_areas WHERE id = ca.area_id)
     WHERE tt.org_id = a.org_id AND tt.name = ta.name LIMIT 1),
    ca.area_id,
    ca.profile_id,
    COALESCE(ca.assigned_from, CURRENT_DATE)
  FROM public.cleaning_assignments ca
  JOIN public.cleaning_areas a ON a.id = ca.area_id
  WHERE a.org_id = v_org_id
  ON CONFLICT DO NOTHING;

  -- Migrate cleaning_logs → task_logs
  INSERT INTO public.task_logs
    (org_id, area_id, user_id, log_date, status, notes, marked_at)
  SELECT
    cl.org_id, cl.area_id, cl.profile_id, cl.log_date,
    CASE cl.status
      WHEN 'done'     THEN 'done'
      WHEN 'partial'  THEN 'partial'
      WHEN 'not_done' THEN 'missed'
      ELSE 'pending'
    END,
    cl.notes, cl.marked_at
  FROM public.cleaning_logs cl
  WHERE cl.org_id = v_org_id
  ON CONFLICT DO NOTHING;

  -- Migrate service_allocations → task_assignments + task_logs
  INSERT INTO public.task_assignments
    (id, org_id, template_id, user_id, assigned_by, task_date, task_time, notes)
  SELECT
    sa.id, sa.org_id, sa.service_id, sa.profile_id, sa.allocated_by,
    sa.service_date, sa.service_time, sa.notes
  FROM public.service_allocations sa
  WHERE sa.org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.task_logs
    (org_id, assignment_id, template_id, user_id, log_date, status, notes, marked_at)
  SELECT
    sa.org_id, sa.id, sa.service_id, sa.profile_id, sa.service_date,
    CASE sa.status
      WHEN 'done'    THEN 'done'
      WHEN 'missed'  THEN 'missed'
      WHEN 'excused' THEN 'excused'
      ELSE 'pending'
    END,
    sa.notes, sa.updated_at
  FROM public.service_allocations sa
  WHERE sa.org_id = v_org_id AND sa.status IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Migrate service_preferences → task_preferences
  INSERT INTO public.task_preferences
    (user_id, template_id, period_start, preference)
  SELECT profile_id, service_id, week_start, preference
  FROM public.service_preferences
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.task_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_areas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_categories_select" ON public.task_categories;
CREATE POLICY "task_categories_select" ON public.task_categories
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "task_categories_write" ON public.task_categories;
CREATE POLICY "task_categories_write" ON public.task_categories
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_templates_select" ON public.task_templates;
CREATE POLICY "task_templates_select" ON public.task_templates
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "task_templates_write" ON public.task_templates;
CREATE POLICY "task_templates_write" ON public.task_templates
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_areas_select" ON public.task_areas;
CREATE POLICY "task_areas_select" ON public.task_areas
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "task_areas_write" ON public.task_areas;
CREATE POLICY "task_areas_write" ON public.task_areas
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_assignments_select" ON public.task_assignments;
CREATE POLICY "task_assignments_select" ON public.task_assignments
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "task_assignments_write" ON public.task_assignments;
CREATE POLICY "task_assignments_write" ON public.task_assignments
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_logs_select" ON public.task_logs;
CREATE POLICY "task_logs_select" ON public.task_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "task_logs_insert" ON public.task_logs;
CREATE POLICY "task_logs_insert" ON public.task_logs
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_logs_update" ON public.task_logs;
CREATE POLICY "task_logs_update" ON public.task_logs
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.verify','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_preferences_all" ON public.task_preferences;
CREATE POLICY "task_preferences_all" ON public.task_preferences
  FOR ALL USING (
    user_id = auth.uid() OR public.has_permission('tasks.assign')
  );

-- ---------------------------------------------------------------------
-- 9. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_task_templates_updated_at ON public.task_templates;
CREATE TRIGGER trg_task_templates_updated_at
  BEFORE UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_task_assignments_updated_at ON public.task_assignments;
CREATE TRIGGER trg_task_assignments_updated_at
  BEFORE UPDATE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

