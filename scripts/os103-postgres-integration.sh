#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export PGPASSWORD

psql -X -v ON_ERROR_STOP=1 -f "$root/packages/core/sql/001-os103-security-stores.sql"
psql -X -v ON_ERROR_STOP=1 -f "$root/packages/core/sql/002-os103-least-privilege-audit.sql"

# Assert role grants and the constrained SECURITY DEFINER owner from PostgreSQL.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $assertions$
DECLARE
  function_owner text;
BEGIN
  IF has_table_privilege('aios_audit_writer', 'public.aios_audit_heads', 'UPDATE')
     OR has_table_privilege('aios_audit_writer', 'public.aios_audit_events', 'INSERT')
     OR has_table_privilege('aios_audit_writer', 'public.aios_audit_events', 'UPDATE')
     OR has_table_privilege('aios_audit_writer', 'public.aios_audit_events', 'DELETE')
     OR has_table_privilege('aios_audit_writer', 'public.aios_audit_events', 'TRUNCATE') THEN
    RAISE EXCEPTION 'audit writer has direct table mutation privileges';
  END IF;

  IF NOT has_table_privilege('aios_audit_writer', 'public.aios_audit_heads', 'SELECT')
     OR NOT has_table_privilege('aios_audit_writer', 'public.aios_audit_events', 'SELECT')
     OR NOT has_table_privilege('aios_audit_reader', 'public.aios_audit_events', 'SELECT')
     OR has_table_privilege('aios_audit_reader', 'public.aios_audit_events', 'INSERT')
     OR has_table_privilege('aios_runtime', 'public.aios_audit_events', 'SELECT')
     OR NOT has_table_privilege('aios_runtime', 'public.aios_approval_gates', 'UPDATE') THEN
    RAISE EXCEPTION 'OS-10.3 database role grants do not match least-privilege policy';
  END IF;

  SELECT r.rolname INTO function_owner
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
   WHERE p.oid = 'public.aios_append_audit_event(text,bigint,character,text,character,jsonb)'::regprocedure;

  IF function_owner IS DISTINCT FROM 'aios_audit_owner' THEN
    RAISE EXCEPTION 'unexpected audit append function owner: %', function_owner;
  END IF;
END
$assertions$;
SQL

zero_hash="$(printf '%064d' 0 | tr '0' '0')"
hash_a="$(printf '%064d' 0 | tr '0' 'a')"
hash_b="$(printf '%064d' 0 | tr '0' 'b')"
hash_c="$(printf '%064d' 0 | tr '0' 'c')"
hash_d="$(printf '%064d' 0 | tr '0' 'd')"

# The writer can append only through the SECURITY DEFINER function.
first_result="$(psql -X -A -t -v ON_ERROR_STOP=1 -c "
  SET ROLE aios_audit_writer;
  SELECT public.aios_append_audit_event(
    'global', 1, '$zero_hash', 'event-1', '$hash_a',
    '{\"id\":\"event-1\",\"outcome\":\"SUCCESS\"}'::jsonb
  );
")"
if [[ "$first_result" != "t" ]]; then
  echo "Expected first audit append to succeed, got: $first_result" >&2
  exit 1
fi

# A duplicate event ID causes the whole function statement to roll back,
# including its preceding head update.
psql -X -v ON_ERROR_STOP=1 <<SQL
SET ROLE aios_audit_writer;
DO \$rollback_test\$
BEGIN
  BEGIN
    PERFORM public.aios_append_audit_event(
      'global', 2, '$hash_a', 'event-1', '$hash_b',
      '{"id":"event-1","outcome":"SUCCESS"}'::jsonb
    );
    RAISE EXCEPTION 'expected duplicate event ID to fail';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  IF (SELECT sequence FROM public.aios_audit_heads WHERE stream_id = 'global') <> 1
     OR (SELECT last_hash FROM public.aios_audit_heads WHERE stream_id = 'global') <> '$hash_a' THEN
    RAISE EXCEPTION 'failed audit append did not roll back the head update';
  END IF;
END
\$rollback_test\$;
SQL

# Race two independent PostgreSQL sessions for the same next sequence/head.
# Exactly one append may win; the loser must observe the advanced head and return false.
(
  psql -X -A -t -v ON_ERROR_STOP=1 -c "
    SET ROLE aios_audit_writer;
    SELECT public.aios_append_audit_event(
      'global', 2, '$hash_a', 'event-2a', '$hash_c',
      '{\"id\":\"event-2a\",\"outcome\":\"SUCCESS\"}'::jsonb
    );
  " > "$tmp/a"
) &
pid_a=$!
(
  psql -X -A -t -v ON_ERROR_STOP=1 -c "
    SET ROLE aios_audit_writer;
    SELECT public.aios_append_audit_event(
      'global', 2, '$hash_a', 'event-2b', '$hash_d',
      '{\"id\":\"event-2b\",\"outcome\":\"SUCCESS\"}'::jsonb
    );
  " > "$tmp/b"
) &
pid_b=$!

wait "$pid_a"
wait "$pid_b"

result_a="$(tr -d '[:space:]' < "$tmp/a")"
result_b="$(tr -d '[:space:]' < "$tmp/b")"
wins=0
[[ "$result_a" == "t" ]] && wins=$((wins + 1))
[[ "$result_b" == "t" ]] && wins=$((wins + 1))
if [[ "$wins" -ne 1 ]] || { [[ "$result_a" != "t" ]] && [[ "$result_a" != "f" ]]; } || { [[ "$result_b" != "t" ]] && [[ "$result_b" != "f" ]]; }; then
  echo "Expected exactly one concurrent append winner; got a='$result_a' b='$result_b'" >&2
  exit 1
fi

expected_hash="$hash_d"
[[ "$result_a" == "t" ]] && expected_hash="$hash_c"
actual_head="$(psql -X -A -t -v ON_ERROR_STOP=1 -c "SELECT sequence::text || ':' || rtrim(last_hash) FROM public.aios_audit_heads WHERE stream_id = 'global';")"
if [[ "$actual_head" != "2:$expected_hash" ]]; then
  echo "Unexpected audit head after concurrent append: $actual_head" >&2
  exit 1
fi

echo "OS-10.3 PostgreSQL migration, role, rollback, and concurrent append checks passed."
