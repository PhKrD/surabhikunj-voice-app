-- =====================================================================
-- 55. ADD UNLOCK_DEVICE COMMAND TYPE
-- =====================================================================
-- Adds 'unlock_device' to the pc_command_type enum so parents can
-- remotely unlock child devices.

ALTER TYPE pc_command_type ADD VALUE 'unlock_device' BEFORE 'sync_rules';
