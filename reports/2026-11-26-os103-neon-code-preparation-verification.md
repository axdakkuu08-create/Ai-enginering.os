# OS-10.3 Neon Code-Only Preparation — Verification Report

**Disposition: CODE PREPARATION VERIFIED; LIVE NEON VERIFICATION BLOCKED**

## Exact candidate commit

- Repository: `axdakkuu08-create/Ai-enginering.os`
- Branch: `security/os103-neon-dedicated-project-prep`
- Exact commit tested: `34e186d16d39711b832c83063732dd9c7996ec0d`
- Dedicated Neon project target: `ai-engineering-os-103`
- Neon provisioning: NOT AVAILABLE; no dedicated project exists.

## Code changes in this preparation phase

1. Added `002-os103-least-privilege-audit.sql`.
   - Creates constrained NOLOGIN roles for approval runtime, audit writer,
     audit reader, and audit function ownership.
   - Adds a SECURITY DEFINER function for atomic audit-head advancement and
     event insertion.
   - Uses a fixed search path and schema-qualified table names.
   - Gives the audit writer SELECT and EXECUTE rather than direct table UPDATE,
     DELETE, or TRUNCATE permissions.
   - Transfers function ownership to a constrained NOLOGIN role and revokes
     its temporary schema CREATE privilege.

2. Updated `PostgresAuditLedgerStore` to append through the restricted SQL
   function, retrying when a competing writer advances the head first.

3. Updated PostgreSQL adapter tests for the restricted append-function
   contract. These unit tests use a mock SQL executor and are not represented
   as live database evidence.

4. Added `scripts/os103-postgres-integration.sh` and
   `.github/workflows/os103-postgres-integration.yml`.
   The workflow starts an ephemeral PostgreSQL 16 service and verifies:
   - both migrations apply successfully;
   - database role grants match the intended least-privilege boundaries;
   - the audit append function is owned by `aios_audit_owner`;
   - the audit writer can append through the function;
   - a duplicate event failure rolls back the preceding head update;
   - two concurrent PostgreSQL sessions competing for one sequence produce
     exactly one successful append.

5. Added push-triggered verification for this preparation branch.

## CI evidence for exact commit

All three workflows completed successfully on exact commit
`34e186d16d39711b832c83063732dd9c7996ec0d`.

| Workflow | Run ID | Result |
|---|---:|---|
| OS-10.3 PostgreSQL Adapter Integration | 45688438233 | SUCCESS |
| Step B.1 Quality Checks | 45688438344 | SUCCESS |
| Permission Engine Milestone 1 | 45688438250 | SUCCESS |

Run links:

- https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/45688438233
- https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/45688438344
- https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/45688438250

The PostgreSQL integration run used a disposable PostgreSQL 16 service in
GitHub Actions. It is meaningful database-engine integration evidence, but it
is **not** a Neon project test and does not prove Neon-specific provisioning,
permissions, connection pooling, backups, compute suspension, or recovery.

## Remaining blockers

- Dedicated Neon project provisioning is still blocked by the account-level
  eligibility restriction. No existing Neon project was reused.
- No live Neon migration has been applied.
- No production server composition root or concrete trusted GitHub resolver /
  mutator has been connected to the protected-action gateway.
- No live Auth0 tenant, API audience, application allow-list, or role mapping
  has been configured or verified.
- No independently administered external audit checkpoint anchor exists.
- Independent human review, F-09 provenance disposition, and authorized human
  release decision remain open.

## Scope and safety

No database credentials were created or stored. No Neon resource was created
or modified. No production service was connected. No GitHub protected action
was performed. No merge or deployment was performed. The protected `main`
branch was not changed.

**Release remains HOLD — NOT AUTHORIZED.**
