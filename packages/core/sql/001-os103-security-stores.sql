-- OS-10.3 durable stores. Apply only in a dedicated AIOS database/schema.
-- The application role must not own these tables.
CREATE TABLE IF NOT EXISTS aios_approval_gates (
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

CREATE TABLE IF NOT EXISTS aios_audit_heads (
  stream_id text PRIMARY KEY,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  last_hash char(64) NOT NULL
);

INSERT INTO aios_audit_heads (stream_id, sequence, last_hash)
VALUES ('global', 0, repeat('0', 64))
ON CONFLICT (stream_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS aios_audit_events (
  stream_id text NOT NULL REFERENCES aios_audit_heads(stream_id),
  sequence bigint NOT NULL CHECK (sequence >= 1),
  event_id text NOT NULL UNIQUE,
  previous_hash char(64) NOT NULL,
  event_hash char(64) NOT NULL,
  event_json jsonb NOT NULL,
  PRIMARY KEY (stream_id, sequence)
);

-- Deployment operator: grant SELECT/INSERT on aios_audit_events to the
-- application role; do not grant UPDATE, DELETE, TRUNCATE, ownership, or DDL.
REVOKE UPDATE, DELETE, TRUNCATE ON aios_audit_events FROM PUBLIC;
