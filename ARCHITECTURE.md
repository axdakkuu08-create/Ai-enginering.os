# Architecture

**Status:** Proposed architecture — not an implementation specification for currently deployed services.

## 1. System boundaries and overview

AI Engineering OS is intended to coordinate software-engineering work across isolated repositories. Its proposed logical layers are:

1. A mobile-friendly web dashboard for human visibility and control.
2. An engineering orchestrator that coordinates bounded tasks.
3. Specialized planner, implementer, independent reviewer, and tester roles.
4. Provider-independent model adapter contracts.
5. A GitHub App integration boundary for repository operations.
6. Isolated cloud execution workers for untrusted build and test workloads.
7. Audit events and explicit human approval gates.

These are planned responsibilities. No component in this list should be interpreted as implemented merely because it is documented here.

The system must keep planning, model inference, repository access, code execution, review, and release authorization as separate trust boundaries. A component should receive only the data and permissions needed for its assigned task.

## 2. Mobile-friendly dashboard boundary

The dashboard is the human-facing control and observability surface. It is expected to display projects, tasks, agent runs, pull requests, test reports, audit events, and approval requests.

The dashboard must not itself possess unrestricted repository credentials or execute arbitrary code. It should request actions through authenticated backend interfaces and display their verified outcomes. Approval controls must identify the human actor and the exact change proposal being authorized.

During the dashboard foundation phase, all displayed records and interactions are local deterministic demo data. Demo controls must not be represented as real authorization or connected operations.

## 3. Engineering orchestrator

The orchestrator is the proposed coordinator for a bounded engineering task. It should:

- Validate task scope, repository target, branch policy, and resource budget.
- Create a traceable task and run record.
- Delegate only explicitly scoped work to specialized roles.
- Enforce sequencing and policy checks.
- Collect artifacts, test reports, review findings, and audit events.
- Stop when required evidence is missing, a policy check fails, or human authorization is required.

The orchestrator must not approve its own work, bypass a denied or pending approval, or autonomously merge or deploy.

## 4. Planner agent

The planner converts an accepted task into a proposed plan containing objectives, affected areas, dependencies, risks, and verifiable acceptance criteria. Its output is advisory and must be validated before execution.

The planner has no release authorization. It should not receive broad repository write permissions or secrets merely to prepare a plan.

## 5. Implementer agent

The implementer proposes code or documentation changes within an approved task scope and designated feature branch. Changes are untrusted until independently reviewed and tested.

The implementer must not change protected branch policy, grant itself permissions, approve its own changes, merge, or deploy. Scope expansion requires a new review of the task proposal.

## 6. Independent reviewer agent

The reviewer evaluates the proposed diff against requirements, security policy, maintainability, and test evidence. Its result is a recommendation such as `APPROVE` or `REQUEST_CHANGES`.

A reviewer verdict is not human authorization. The reviewer must be independent of the implementer where practical, and its identity, input revision, findings, and verdict should be recorded.

## 7. Tester agent

The tester runs approved checks in a bounded execution environment and reports the exact commands, environment constraints, exit codes, and results. It must distinguish tests actually executed from checks that were unavailable or skipped.

Test success does not grant merge or deployment authority.

## 8. Provider-independent model adapter layer

Model adapters are intended to normalize requests and responses behind a provider-neutral contract. Provider selection must be explicit and allow-listed.

Unknown or unconfigured providers must fail closed with a structured error. The adapter layer must not silently choose an arbitrary provider, make undocumented network calls, or require real credentials during interface-only development. Provider-specific secrets, when eventually approved, belong in a dedicated secret-management boundary and must never enter logs.

## 9. GitHub App integration architecture

Repository access is planned through a GitHub App rather than a user's broad personal token. Installation scope and permissions should be limited to explicitly selected repositories and operations.

The integration boundary should validate repository identity, branch names, pull-request targets, and expected commit revisions. Read operations and proposed writes should be separately authorized. The system must not expose installation credentials to agents or workers.

Any future write capability must be separately reviewed and must not enable automatic merge or deployment. Human approval remains an independent policy requirement.

## 10. Isolated cloud execution workers

Workers are intended to execute bounded build and test jobs away from the orchestrator and dashboard. Repository content and generated code must be treated as untrusted.

The design requires isolation between jobs, short-lived workspaces, non-root execution where supported, resource quotas, and cleanup after completion. Workers must not receive production secrets or unrestricted repository credentials.

The default network-egress policy is deny. Any narrowly scoped exception requires explicit policy, destination restrictions, and auditability. Worker resource controls must include maximum execution time, memory, CPU where available, payload size, concurrency, and permitted network access.

A TypeScript interface or policy check alone is not an operating-system or container isolation boundary. Actual isolation must be demonstrated by the selected execution platform and security tests before production use.

## 11. Audit logs and event traceability

The system should record task creation, plan changes, agent runs, repository actions, worker lifecycle, test results, review decisions, approval decisions, and release attempts.

Events should include a stable event identifier, timestamp, actor identity, action, target, relevant revision or proposal digest, outcome, and risk metadata. Sensitive values must be excluded or redacted before persistence.

The intended audit store should be append-only for application actors, access-controlled, integrity-protected, and retained according to a documented policy. TypeScript `readonly` fields and in-memory freezing do not by themselves provide durable tamper-proof storage.

## 12. Approval gates

Protected operations include at minimum merging a pull request and deploying to a protected environment.

A new approval request starts in `PENDING`. Only an authenticated human actor with the required authority may transition it to `APPROVED` or `DENIED`. Both `PENDING` and `DENIED` block protected operations.

Agents cannot approve their own changes. No automated role can impersonate a human approver. A reviewer `APPROVE` verdict is a recommendation only.

Approval must be bound to the exact proposed diff or immutable proposal digest, repository, target branch, and relevant base revision. Any material change to the proposal invalidates the previous approval and requires a new decision. The policy decision must be checked again immediately before the protected operation.

Step B may define and test policy interfaces, but it must not implement real merge or deployment operations.

## 13. Error handling and exception flow

Errors should be classified into validation, authentication, authorization, provider configuration, resource-limit, execution, test, review, and external-service categories.

Failures must be explicit and fail closed. A missing provider, invalid repository target, exceeded resource budget, stale approval, unavailable audit sink, or failed required test must not be converted into success.

User-facing messages should be safe and actionable without exposing secrets, internal tokens, stack traces containing sensitive data, or untrusted payloads. Diagnostic detail should be access-controlled and redacted.

Retries must be bounded and used only for operations known to be safe to retry. Protected operations must re-check authorization and revision binding after any retry or delay.

## 14. Proposed data flow

1. A human submits a task through the dashboard.
2. The orchestrator validates identity, scope, repository target, and policy.
3. The planner proposes a bounded plan and acceptance criteria.
4. The human or authorized workflow confirms the task scope where required.
5. The implementer proposes changes in an isolated feature branch or worker workspace.
6. The tester executes bounded checks and emits evidence.
7. The independent reviewer evaluates the exact proposal and evidence.
8. The system records a human approval request bound to the exact proposal.
9. Only an authenticated human decision can authorize a protected operation.
10. A separately authorized integration may perform the approved operation and record its result.

This flow is conceptual. No autonomous loop or protected operation is implemented by this document.

## 15. Deployment boundaries and free-tier constraints

Early phases should use local deterministic fixtures, public documentation, and free-tier or open-source tooling where practical. No paid service, usage-billed service, production environment, or external provider is assumed to be available or approved.

Free-tier limits, retention, availability, and execution constraints must be verified before selecting a service. A free tier is not automatically suitable for untrusted code execution or production workloads.

Deployment design and credentials are out of scope for Step A. No deployment is authorized by this architecture document.

## Runtime verification: eve

**UNVERIFIED — DO NOT INTEGRATE YET.**

The name `eve` is not sufficient to identify a specific runtime, package, SDK, or official API. No package name, import path, version, capability, or compatibility claim is asserted. Integration remains blocked until the exact product is identified and authoritative official technical documentation is reviewed.
