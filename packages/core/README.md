# Core policy primitives

This package contains provider-neutral contracts and small, deterministic policy helpers for the AI Engineering OS foundation.

## Implemented

- Shared project, task, approval, model request/response, and provider adapter types.
- Approval gates bound to a proposal digest and base revision. Only a pending gate can receive a decision; only the `HUMAN` actor type is accepted by the policy primitive. Stale proposal/base revisions reject or invalidate the decision.
- Repository target validation requiring an explicit repository allow-list and a non-protected feature target branch.
- Audit-event sanitization that drops fields with sensitive names, bounds nested values, and redacts common credential patterns before returning a safe event.
- In-process worker concurrency guard with a default limit of one, configurable positive safe-integer limits, and idempotent release.

## Verification

The current Step B candidate was verified by GitHub Actions run [42202936458](https://github.com/axdakkuu08-create/Ai-enginering.os/actions/runs/42202936458): 22 Vitest tests passed and TypeScript completed with exit code 0.

## Security boundaries and limitations

These modules are policy primitives, not a complete production security system:

- A caller must authenticate the human and enforce the authorization to act. The `actorType` field alone is not proof of identity.
- The repository allow-list must come from trusted configuration; callers must not let an untrusted task choose its own allow-list.
- Audit sanitization is not an exhaustive secret detector, durable append-only storage, access control, or tamper-proof integrity mechanism.
- The worker guard limits in-process concurrency only. It does not enforce CPU, memory, wall-clock, filesystem, network-egress, process, container, or VM isolation.
- No live model provider, credentials, merge operation, or deployment operation is implemented.

No ESLint or formatter is currently configured. The exact-revision TypeScript and Vitest checks are recorded; lint/formatter evidence remains deferred rather than being claimed as passing.
