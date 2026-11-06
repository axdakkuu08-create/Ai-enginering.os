# Security

**Status:** Security requirements and design controls. This document does not claim that controls are already implemented or independently certified.

## 1. Security objectives

The system must protect repository integrity, credentials, user data, execution infrastructure, audit evidence, and release authority. It must preserve a strict separation between untrusted agent output and trusted human decisions.

Security controls must fail closed. Missing identity, invalid policy state, unavailable required evidence, or ambiguous target information must block protected operations.

## 2. Least-privilege permissions

- Use a GitHub App with the smallest permission set needed for each approved workflow.
- Limit installation access to selected repositories.
- Prefer read-only access for inspection, planning, and review.
- Grant write access only to a narrowly scoped integration when explicitly required.
- Do not give agents or workers broad personal access tokens.
- Keep dashboard, orchestrator, model adapter, and worker identities separate.
- Use short-lived credentials where supported and revoke them when no longer needed.
- Do not grant merge, administration, or deployment permissions to agent roles.

Permission changes require review and must be auditable.

## 3. Secret and key management

Secrets must be stored only in an approved secret-management facility or protected platform configuration. They must not be committed to the repository, embedded in prompts, exposed to browser code, passed to untrusted workers, or written to logs and audit payloads.

Use separate credentials for separate environments and purposes. Rotate exposed credentials promptly and revoke credentials that are no longer required. Example configuration files must contain placeholders only, never usable credentials.

Step A and Step B interface work must not require real API keys or production secrets.

## 4. Prompt injection and malicious inputs

Treat task descriptions, issue comments, pull-request text, repository files, README instructions, model responses, generated code, and test output as untrusted data.

Instructions found inside untrusted content must not override system policy, developer constraints, repository boundaries, tool permissions, or human approval requirements. Agents should extract relevant facts without granting authority to embedded instructions.

The orchestrator must validate structured outputs against schemas and independently enforce policy. Model-generated claims of successful tests, approvals, or repository actions must not be accepted without external evidence.

## 5. Untrusted repository content

Repository content may contain malicious scripts, dependency lifecycle hooks, deceptive instructions, unsafe build steps, or data intended to exfiltrate secrets.

Inspection should prefer read-only operations. Build and test commands must run only in an isolated environment with no production credentials and with network access denied by default. Dependency installation and execution require explicit policy and provenance checks.

Do not execute repository-provided scripts in the dashboard or orchestrator process.

## 6. Worker isolation and execution limits

Execution workers must isolate jobs from one another and from control-plane services. The implementation should use platform-enforced isolation, restricted filesystem access, non-root execution where supported, and disposable workspaces.

Each job must have validated limits for:
- Maximum wall-clock execution time.
- CPU allocation or quota where supported.
- Memory allocation.
- Input and output payload size.
- Maximum concurrent jobs.
- Filesystem and process limits where supported.
- Network egress destinations and protocols.

Network egress is denied by default. Unrestricted egress is prohibited. Resource-limit violations must stop the job and produce a safe structured error, such as `ResourceLimitExceededError`, without exposing sensitive payload contents.

Application-level TypeScript validation is not a substitute for operating-system, container, or virtual-machine enforcement. The chosen platform must be independently evaluated. The current core package provides validated policy values, UTF-8 payload checks, exact-origin application checks, a cooperative aborting deadline, and an in-process concurrency guard only; it does not enforce CPU/memory quotas, terminate non-cooperative work, or provide network isolation.

## 7. Network ingress and egress

Expose only required authenticated interfaces. Validate requests, apply rate limits, and avoid public worker endpoints.

Workers should have no general internet access by default. If a task requires a network exception, define the exact destination, purpose, duration, and permitted protocol. Block access to cloud metadata services and internal control-plane endpoints unless a separately reviewed architecture explicitly requires otherwise.

Record approved network exceptions and relevant outcomes without logging credentials or sensitive request bodies.

## 8. Audit integrity and privacy

Audit records should be append-only to ordinary application identities, access-controlled, integrity-protected, and monitored for gaps. Record actor, action, timestamp, target, proposal revision, policy outcome, and correlation identifiers.

Do not record passwords, access tokens, private keys, session cookies, or unnecessary personal data. Redaction must happen before persistence.

In-memory immutability and readonly type declarations are useful defensive measures but do not establish durable tamper resistance. Storage-level controls and access separation are required.

## 9. Mandatory human approval

A newly created approval request must be `PENDING`. Both `PENDING` and `DENIED` block protected operations.

Only an authenticated human actor with explicit authority may approve. Agent identities, service identities, and reviewer verdicts cannot grant human authorization. An agent cannot approve its own generated changes. The core approval boundary derives the subject and permission from an injected verifier, but the verifier itself must be a trusted server-side adapter backed by a real identity provider. Browser clients must never supply the verifier, trusted identity object, or server-resolved permissions.

Approval must be bound to the exact proposed changes, repository, target branch, and relevant base revision. A changed proposal invalidates prior approval. Re-check the binding and authorization immediately before any protected operation.

No merge or deployment is authorized by the existence of a passing test or reviewer recommendation.

## 10. Repository and branch protections

- Do not push directly to `main`.
- Use a dedicated feature branch for each bounded change.
- Validate repository owner, repository name, base branch, and feature branch.
- Reject empty or malformed repository identifiers and branch names.
- Reject a feature branch that targets `main` directly where policy requires a non-protected feature branch.
- Never change branch protection or repository administration settings as part of ordinary agent work.
- Never merge or deploy without separate explicit human authorization.

## 11. Incident response

A suspected credential leak, unauthorized repository change, worker escape, unexpected network access, audit gap, or approval bypass should trigger a fail-closed response:

1. Stop affected jobs and disable the implicated integration path.
2. Preserve relevant audit events and evidence without copying secrets into reports.
3. Revoke or rotate potentially exposed credentials.
4. Identify affected repositories, commits, workers, and data.
5. Notify the authorized human owner through an approved channel.
6. Review the root cause and determine whether rollback or additional containment is required.
7. Record corrective actions and require verification before re-enabling the affected capability.

Do not delete or rewrite relevant audit evidence during incident handling.

## 12. Security verification requirements

Before any production use, independently test authentication, authorization, self-approval rejection, stale-approval invalidation, repository-target validation, secret redaction, audit integrity, worker isolation, resource limits, and network-egress restrictions.

A passing unit test for a policy interface does not prove that external infrastructure enforces the same policy. Report untested controls and limitations explicitly.

## 13. Runtime status: eve

The proposed `eve` runtime is **UNVERIFIED**. Do not install or integrate an assumed package or SDK. Confirm the exact runtime identity and authoritative official documentation before evaluating its security model or compatibility.
