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
