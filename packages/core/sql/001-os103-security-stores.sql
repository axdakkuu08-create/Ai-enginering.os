-- OS-10.3 durable stores for the dedicated AI Engineering OS database.
-- Apply as the database owner during a controlled migration.
-- The runtime role must be a NOLOGIN group role and must not own these objects.
-- This migration intentionally fails if the restricted role is not provisioned.

CREATE SCHEMA IF NOT EXISTS app;
REVOKE CREATE ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO ai_engineering_os_app;

CREATE TABLE IF NOT EXISTS app.aios_approval_gates (
  gate_id text PRIMARY KEY,
  task_id text NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED')),
  proposal_digest text NOT NULL,
  base_revision text NOT NULL,
  authorized_by text,
  decided_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (
    (status = 'PENDING' AND authorized_by IS NULL AND decided_at IS NULL
      AND expires_at IS NULL AND consumed_at IS NULL)
    OR
    (status IN ('APPROVED', 'DENIED') AND authorized_by IS NOT NULL
      AND decided_at IS NOT NULL AND expires_at IS NOT NULL AND consumed_at IS NULL)
    OR
    (status = 'CONSUMED' AND authorized_by IS NOT NULL
      AND decided_at IS NOT NULL AND expires_at IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS app.aios_audit_heads (
  stream_id text PRIMARY KEY,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  last_hash char(64) NOT NULL
);

INSERT INTO app.aios_audit_heads (stream_id, sequence, last_hash)
VALUES ('global', 0, repeat('0', 64))
ON CONFLICT (stream_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS app.aios_audit_events (
  stream_id text NOT NULL REFERENCES app.aios_audit_heads(stream_id),
  sequence bigint NOT NULL CHECK (sequence >= 1),
  event_id text NOT NULL UNIQUE,
  previous_hash char(64) NOT NULL,
  event_hash char(64) NOT NULL,
  event_json jsonb NOT NULL,
  PRIMARY KEY (stream_id, sequence)
);

REVOKE ALL ON app.aios_approval_gates, app.aios_audit_heads, app.aios_audit_events FROM PUBLIC;

-- The runtime role can create/read/update approval gates with compare-and-set,
-- advance the audit head, and append/read audit events. It cannot rewrite or
-- delete audit events and receives no schema ownership or DDL privilege.
GRANT SELECT, INSERT, UPDATE ON app.aios_approval_gates TO ai_engineering_os_app;
GRANT SELECT, UPDATE ON app.aios_audit_heads TO ai_engineering_os_app;
GRANT SELECT, INSERT ON app.aios_audit_events TO ai_engineering_os_app;
REVOKE UPDATE, DELETE, TRUNCATE ON app.aios_audit_events FROM ai_engineering_os_app;
