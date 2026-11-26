-- Staging migration: server-managed permissions for Clerk subjects.
-- Apply only to the isolated os103-security-migration-test branch.
BEGIN;
CREATE TABLE IF NOT EXISTS app.aios_user_permissions (
  subject_id text NOT NULL,
  permission text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text NOT NULL,
  PRIMARY KEY (subject_id, permission),
  CONSTRAINT aios_user_permissions_subject_nonempty CHECK (length(trim(subject_id)) > 0),
  CONSTRAINT aios_user_permissions_permission_nonempty CHECK (length(trim(permission)) > 0),
  CONSTRAINT aios_user_permissions_granted_by_nonempty CHECK (length(trim(granted_by)) > 0)
);
REVOKE ALL ON TABLE app.aios_user_permissions FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE app.aios_user_permissions FROM ai_engineering_os_app;
GRANT SELECT ON TABLE app.aios_user_permissions TO ai_engineering_os_app;
COMMIT;
