import { describe, expect, it } from "vitest";
import {
  ApprovalAlreadyDecidedError,
  assertNotSelfApproval,
  canProceedForProposal,
  createApprovalGate,
  recordApprovalDecision,
  refreshApprovalForProposal,
  StaleApprovalError,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";
import { createSafeAuditEvent } from "../src/security/audit-event.js";
import {
  WorkerConcurrencyGuard,
  WorkerConcurrencyLimitError,
} from "../src/security/worker-bounds.js";
import {
  InvalidRepositoryTargetError,
  validateRepositoryTarget,
} from "../src/security/repository-target.js";
import type {
  ModelProviderAdapter,
  ModelRequest,
  ModelResponse,
} from "../src/types/index.js";

const decisionTime = new Date("2026-11-06T10:00:00.000Z");
const initialGate = () =>
  createApprovalGate({
    id: "gate-1",
    taskId: "task-1",
    requestedBy: "agent-requester",
    proposalDigest: "proposal-a",
    baseRevision: "base-a",
  });
const decision = (overrides: Record<string, unknown> = {}) => ({
  status: "APPROVED" as const,
  actorId: "human-1",
  actorType: "HUMAN" as const,
  proposalDigest: "proposal-a",
  baseRevision: "base-a",
  ...overrides,
});

describe("approval gate", () => {
  it("creates a pending gate with no decision or expiry", () => {
    const gate = initialGate();
    expect(gate.status).toBe("PENDING");
    expect(gate.authorizedBy).toBeNull();
    expect(gate.timestamp).toBeNull();
    expect(gate.expiresAt).toBeNull();
    expect(gate.consumedAt).toBeNull();
  });

  it("rejects direct and delegated self-approval", () => {
    expect(() => assertNotSelfApproval("agent-1", "agent-1")).toThrow(
      UnauthorizedApprovalError,
    );
    expect(() =>
      assertNotSelfApproval("human-1", "agent-1", ["service-9", "agent-1"]),
    ).toThrow(UnauthorizedApprovalError);
  });

  it("allows a distinct verified human subject", () => {
    expect(() => assertNotSelfApproval("human-1", "agent-1")).not.toThrow();
  });

  it("denies case-only requester identity aliases conservatively", () => {
    expect(() => assertNotSelfApproval("Agent-1", "agent-1")).toThrow(
      UnauthorizedApprovalError,
    );
  });

  it("rejects empty or malformed delegation identities", () => {
    expect(() => assertNotSelfApproval("human-1", "agent-1", [" "])).toThrow(
      UnauthorizedApprovalError,
    );
  });

  it("rejects non-human approval actors", () => {
    expect(() =>
      recordApprovalDecision(
        initialGate(),
        decision({ actorId: "agent-2", actorType: "AGENT" }),
        decisionTime,
      ),
    ).toThrow(UnauthorizedApprovalError);
  });

  it("binds approval to the exact proposal and base and generates server expiry", () => {
    const approved = recordApprovalDecision(
      initialGate(),
      decision(),
      decisionTime,
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.timestamp).toBe(decisionTime.toISOString());
    expect(approved.expiresAt).toBe("2026-11-06T10:05:00.000Z");
    expect(
      canProceedForProposal(
        approved,
        "proposal-a",
        "base-a",
        new Date("2026-11-06T10:04:59.999Z"),
      ),
    ).toBe(true);
    expect(
      canProceedForProposal(
        approved,
        "proposal-b",
        "base-a",
        new Date("2026-11-06T10:01:00.000Z"),
      ),
    ).toBe(false);
    expect(
      canProceedForProposal(
        approved,
        "proposal-a",
        "base-b",
        new Date("2026-11-06T10:01:00.000Z"),
      ),
    ).toBe(false);
    expect(
      canProceedForProposal(
        approved,
        "proposal-a",
        "base-a",
        new Date("2026-11-06T10:05:00.000Z"),
      ),
    ).toBe(false);
  });

  it("prevents a second decision on an already decided gate", () => {
    const approved = recordApprovalDecision(
      initialGate(),
      decision(),
      decisionTime,
    );
    expect(() =>
      recordApprovalDecision(
        approved,
        decision({ status: "DENIED", actorId: "human-2" }),
        new Date("2026-11-06T10:01:00.000Z"),
      ),
    ).toThrow(ApprovalAlreadyDecidedError);
  });

  it("rejects stale proposal decisions with the specific error class", () => {
    expect(() =>
      recordApprovalDecision(
        initialGate(),
        decision({ proposalDigest: "proposal-old" }),
        decisionTime,
      ),
    ).toThrow(StaleApprovalError);
  });

  it("invalidates approval when the proposal or base changes", () => {
    const approved = recordApprovalDecision(
      initialGate(),
      decision(),
      decisionTime,
    );
    const refreshed = refreshApprovalForProposal(
      approved,
      "proposal-b",
      "base-a",
    );
    expect(refreshed.status).toBe("PENDING");
    expect(refreshed.authorizedBy).toBeNull();
    expect(refreshed.timestamp).toBeNull();
    expect(refreshed.expiresAt).toBeNull();
    expect(refreshed.consumedAt).toBeNull();
  });

  it("requires a trusted valid server clock", () => {
    expect(() =>
      recordApprovalDecision(initialGate(), decision(), new Date("invalid")),
    ).toThrow(TypeError);
  });
});

describe("repository target validation", () => {
  const validTarget = {
    owner: "example-org",
    repository: "sample-repo",
    baseBranch: "main",
    targetBranch: "feat/safe-change",
    allowedRepositories: ["example-org/sample-repo"],
  };

  it("accepts an explicitly allow-listed repository and feature branch", () => {
    expect(validateRepositoryTarget(validTarget).fullName).toBe(
      "example-org/sample-repo",
    );
  });

  it("rejects repositories outside the allow-list", () => {
    expect(() =>
      validateRepositoryTarget({
        ...validTarget,
        repository: "other-repo",
      }),
    ).toThrow(InvalidRepositoryTargetError);
  });

  it("rejects protected or malformed target branches", () => {
    for (const targetBranch of [
      "main",
      "master",
      "bad branch",
      "../escape",
      "feature//x",
    ]) {
      expect(() =>
        validateRepositoryTarget({
          ...validTarget,
          targetBranch,
        }),
      ).toThrow(InvalidRepositoryTargetError);
    }
  });

  it("rejects identical base and target branches", () => {
    expect(() =>
      validateRepositoryTarget({
        ...validTarget,
        targetBranch: "main",
      }),
    ).toThrow(InvalidRepositoryTargetError);
  });
});

describe("audit event privacy", () => {
  it("redacts sensitive keys and common credential formats", () => {
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      "fake-private-material",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const event = createSafeAuditEvent(
      {
        id: "event-1",
        actorId: "human-1",
        action: "repository.inspect",
        target: "example-org/sample-repo",
        outcome: "SUCCESS",
        details: {
          branch: "feat/safe-change",
          accessToken: "do-not-store-this",
          nested: {
            password: "hidden",
            message: "Authorization: Bearer abc.def.ghi",
            aws: "AKIAIOSFODNN7EXAMPLE",
            jwt: "eyJabcdefghijk.abcdefghijk.abcdefghijk",
            pem,
          },
        },
      },
      decisionTime,
    );
    const serialized = JSON.stringify(event);
    expect(event.timestamp).toBe(decisionTime.toISOString());
    expect(event.details).toEqual({
      branch: "feat/safe-change",
      nested: {
        message: "Authorization: [REDACTED]",
        aws: "[REDACTED]",
        jwt: "[REDACTED]",
        pem: "[REDACTED]",
      },
    });
    for (const secret of [
      "do-not-store-this",
      "abc.def.ghi",
      "AKIAIOSFODNN7EXAMPLE",
      "eyJabcdefghijk",
      "fake-private-material",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("rejects incomplete audit event identity", () => {
    expect(() =>
      createSafeAuditEvent(
        {
          id: "",
          actorId: "human-1",
          action: "test",
          target: "repo",
          outcome: "FAILED",
        },
        decisionTime,
      ),
    ).toThrow(TypeError);
  });
});

describe("provider-independent model contracts", () => {
  it("allows a provider implementation to satisfy the common adapter contract", async () => {
    const adapter: ModelProviderAdapter = {
      providerId: "fixture-provider",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        return {
          requestId: request.requestId,
          providerId: "fixture-provider",
          model: request.model,
          output: "fixture response",
        };
      },
    };
    const response = await adapter.generate({
      requestId: "request-1",
      model: "fixture-model",
      input: "hello",
    });
    expect(response.providerId).toBe(adapter.providerId);
    expect(response.requestId).toBe("request-1");
    expect(response.output).toBe("fixture response");
  });
});

describe("free-tier worker concurrency bounds", () => {
  it("allows at most one concurrent agent task by default", () => {
    const guard = new WorkerConcurrencyGuard();
    const release = guard.acquire();

    expect(guard.activeCount).toBe(1);
    expect(() => guard.acquire()).toThrow(WorkerConcurrencyLimitError);

    release();
    expect(guard.activeCount).toBe(0);
    expect(() => guard.acquire()).not.toThrow();
  });

  it("makes release idempotent", () => {
    const guard = new WorkerConcurrencyGuard();
    const release = guard.acquire();

    release();
    release();

    expect(guard.activeCount).toBe(0);
  });

  it("rejects invalid concurrency limits", () => {
    expect(() => new WorkerConcurrencyGuard(0)).toThrow(RangeError);
    expect(() => new WorkerConcurrencyGuard(-1)).toThrow(RangeError);
    expect(() => new WorkerConcurrencyGuard(1.5)).toThrow(RangeError);
  });

  it("enforces configured concurrency and returns to zero after release", () => {
    const guard = new WorkerConcurrencyGuard(2);
    const releaseOne = guard.acquire();
    const releaseTwo = guard.acquire();
    expect(guard.activeCount).toBe(2);
    expect(() => guard.acquire()).toThrow(WorkerConcurrencyLimitError);
    releaseOne();
    releaseTwo();
    expect(guard.activeCount).toBe(0);
  });
});
