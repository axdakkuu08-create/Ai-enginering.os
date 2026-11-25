-- OS-10.3 least-privilege database roles and atomic audit append.
-- Apply only after 001-os103-security-stores.sql on the dedicated OS-10.3
-- Neon project. Execute with a controlled database owner/migration principal.
--
-- These are NOLOGIN group/owner roles. After provisioning, create separate
-- LOGIN roles and grant them membership in the appropriate group role.
DO $roles$
BEGIN
  CREATE ROLE aios_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;

DO $roles$
BEGIN
  CREATE ROLE aios_audit_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;

DO $roles$
BEGIN
  CREATE ROLE aios_audit_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;

DO $roles$
BEGIN
  CREATE ROLE aios_audit_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;

-- Refuse unexpected pre-existing role configurations instead of silently
-- accepting a login-capable, superuser, or bypass-RLS role.
DO $verify_roles$
DECLARE
  role_name text;
  role_row record;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'aios_runtime',
    'aios_audit_writer',
    'aios_audit_reader',
    'aios_audit_owner'
  ]
  LOOP
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolreplication, rolbypassrls
      INTO role_row
      FROM pg_catalog.pg_roles
     WHERE rolname = role_name;

    IF NOT FOUND OR role_row.rolcanlogin OR role_row.rolsuper
       OR role_row.rolcreatedb OR role_row.rolcreaterole
       OR role_row.rolreplication OR role_row.rolbypassrls THEN
      RAISE EXCEPTION 'OS-10.3 role % has unsafe attributes', role_name;
    END IF;
  END LOOP;
END
$verify_roles$;

REVOKE ALL ON TABLE public.aios_approval_gates FROM PUBLIC;
REVOKE ALL ON TABLE public.aios_audit_heads FROM PUBLIC;
REVOKE ALL ON TABLE public.aios_audit_events FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.aios_approval_gates TO aios_runtime;

GRANT SELECT
  ON TABLE public.aios_audit_heads, public.aios_audit_events
  TO aios_audit_writer, aios_audit_reader;

-- The function owner can only read/advance the audit head and insert events.
GRANT SELECT, UPDATE
  ON TABLE public.aios_audit_heads TO aios_audit_owner;
GRANT SELECT, INSERT
  ON TABLE public.aios_audit_events TO aios_audit_owner;

CREATE OR REPLACE FUNCTION public.aios_append_audit_event(
  p_stream_id text,
  p_sequence bigint,
  p_previous_hash char(64),
  p_event_id text,
  p_event_hash char(64),
  p_event_json jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  advanced_sequence bigint;
BEGIN
  IF p_stream_id IS NULL OR length(p_stream_id) = 0
     OR p_sequence < 1
     OR p_previous_hash !~ '^[0-9a-f]{64}$'
     OR p_event_hash !~ '^[0-9a-f]{64}$'
     OR p_event_id IS NULL OR length(p_event_id) = 0
     OR jsonb_typeof(p_event_json) <> 'object'
     OR p_event_json ->> 'id' IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Invalid OS-10.3 audit append input';
  END IF;

  UPDATE public.aios_audit_heads
     SET sequence = p_sequence,
         last_hash = p_event_hash
   WHERE stream_id = p_stream_id
     AND sequence = p_sequence - 1
     AND last_hash = p_previous_hash
  RETURNING sequence INTO advanced_sequence;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.aios_audit_events
    (stream_id, sequence, event_id, previous_hash, event_hash, event_json)
  VALUES
    (p_stream_id, advanced_sequence, p_event_id, p_previous_hash,
     p_event_hash, p_event_json);

  RETURN true;
END
$function$;

-- Transfer the SECURITY DEFINER function to a constrained NOLOGIN role.
GRANT aios_audit_owner TO CURRENT_USER;
ALTER FUNCTION public.aios_append_audit_event(text, bigint, char, text, char, jsonb)
  OWNER TO aios_audit_owner;
REVOKE aios_audit_owner FROM CURRENT_USER;

REVOKE ALL ON FUNCTION public.aios_append_audit_event(text, bigint, char, text, char, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aios_append_audit_event(text, bigint, char, text, char, jsonb)
  TO aios_audit_writer;

-- Do not grant aios_audit_writer UPDATE/DELETE/TRUNCATE on either audit table.
