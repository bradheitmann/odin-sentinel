-- Upgrade existing telemetry D1 databases from the legacy payload schema to the
-- allowlisted counts/class-label schema used by the current Worker.
--
-- Apply once to databases that were created before violation_classes,
-- blocker_classifications, role_slot_count, drift_warning_count, and
-- degraded_layout were added to schema.sql.

ALTER TABLE session_reports ADD COLUMN violation_classes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE session_reports ADD COLUMN blocker_classifications TEXT NOT NULL DEFAULT '[]';
ALTER TABLE session_reports ADD COLUMN role_slot_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_reports ADD COLUMN drift_warning_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_reports ADD COLUMN degraded_layout INTEGER NOT NULL DEFAULT 0;
