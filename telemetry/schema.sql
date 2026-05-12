-- ODIN Sentinel telemetry: minimal D1 schema for opt-in session reports.
-- Only counts and class labels are stored; no transcripts, no code, no
-- repository identity. See telemetry/README.md for the full data contract.

CREATE TABLE IF NOT EXISTS session_reports (
  id TEXT PRIMARY KEY,
  protocol_version TEXT NOT NULL,
  team_count INTEGER NOT NULL,
  violation_count INTEGER NOT NULL,
  halt_count INTEGER NOT NULL,
  layout_drift_count INTEGER NOT NULL,
  peak_context_pct INTEGER NOT NULL,
  closeout_clean INTEGER NOT NULL,
  model_signals TEXT NOT NULL,
  violation_classes TEXT NOT NULL,
  blocker_classifications TEXT NOT NULL,
  role_slot_count INTEGER NOT NULL,
  drift_warning_count INTEGER NOT NULL,
  degraded_layout INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  client_redacted INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_session_reports_version ON session_reports(protocol_version);
CREATE INDEX IF NOT EXISTS idx_session_reports_received_at ON session_reports(received_at);
CREATE INDEX IF NOT EXISTS idx_session_reports_violations ON session_reports(violation_count);
