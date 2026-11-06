import { describe, expect, it } from "vitest";
import {
  assertNotSelfApproval,
  canProceed,
  canProceedForProposal,
  createApprovalGate,
  recordApprovalDecision,
  refreshApprovalForProposal,
  StaleApprovalError,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";
import {
  createSafeAuditEvent,
} from "../src/security/audit-event.js";
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

const initialGate = () => createApprovalGate({
  id: "gate-1",
  taskId: "task-1",
  proposalDigest: "proposal-a",
  baseRevision: "base-a",
});

describe("approval gate", () => {
  it("defaults new gates to PENDING and blocks execution", () => {
    const gate = initialGate();
    expect(gate.status).toBe("PENDING");
    expect(gate.authorizedBy).toBeNull();
    expect(canProceed(gate.status)).toBe(false);
  });

  it("blocks DENIED gates", () => {
    expect(canProceed("DENIED")).toBe(false);
  });

  it("allows only APPROVED gates", () => {
    expect(canProceed("APPROVED")).toBe(true);
  });

  it("rejects agent self-approval", () => {
    expect(() => assertNotSelfApproval("agent-1", "agent-1")).toThrow(
      UnauthorizedApprovalError,
    );
  });

  it("allows a different approver identity through the self-approval guard", () => {
    expect(() => assertNotSelfApproval("human-1", "agent-1")).not.toThrow();
  });

  it("rejects non-human approval actors", () => {
    expect(() => recordApprovalDecision(initialGate(), {
      status: "APPROVED",
      actorId: "agent-2",
      actorType: "AGENT",
      proposalDigest: "proposal-a",
      baseRevision: "base-a",
      timestamp: "2026-11-06T10:00:00.000Z",
    })).toThrow(UnauthorizedApprovalError);
  });

  it("binds a human approval to the exact proposal and base revision", () => {
    const approved = recordApprovalDecision(initialGate(), {
      status: "APPROVED",
      actorId: "human-1",
      actorType: "HUMAN",
      proposalDigest: "proposal-a",
      baseRevision: "base-a",
      timestamp: "2026-11-06T10:00:00.000Z",
    });
    expect(canProceedForProposal(approved, "proposal-a", "base-a")).toBe(true);
    expect(canProceedForProposal(approved, "proposal-b", "base-a")).toBe(false);
    expect(canProceedForProposal(approved, "proposal-a", "base-b")).toBe(false);
  });

  it("rejects approval decisions for a stale proposal", () => {
    expect(() => recordApprovalDecision(initialGate(), {
      status: "APPROVED",
      actorId: "human-1",
      actorType: "HUMAN",
      proposalDigest: "proposal-old",
      baseRevision: "base-a",
      timestamp: "2026-11-06T10:00:00.000Z",
    })).toThrow(StaleApprovalError);
  });

  it("invalidates an approval when proposal or base revision changes", () => {
    const approved = recordApprovalDecision(initialGate(), {
      status: "APPROVED",
      actorId: "human-1",
      actorType: "HUMAN",
      proposalDigest: "proposal-a",
      baseRevision: "base-a",
      timestamp: "2026-11-06T10:00:00.000Z",
    });
    const refreshed = refreshApprovalForProposal(approved, "proposal-b", "base-a");
    expect(refreshed.status).toBe("PENDING");
    expect(refreshed.authorizedBy).toBeNull();
    expect(refreshed.timestamp).toBeNull();
    expect(canProceedForProposal(refreshed, "proposal-b", "base-a")).toBe(false);
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
    expect(validateRepositoryTarget(validTarget).fullName).toBe("example-org/sample-repo");
  });

  it("rejects repositories outside the allow-list", () => {
    expect(() => validateRepositoryTarget({
      ...validTarget,
      repository: "other-repo",
    })).toThrow(InvalidRepositoryTargetError);
  });

  it("rejects protected or malformed target branches", () => {
    for (const targetBranch of ["main", "master", "bad branch", "../escape", "feature//x"]) {
      expect(() => validateRepositoryTarget({
        ...validTarget,
        targetBranch,
      })).toThrow(InvalidRepositoryTargetError);
    }
  });

  it("rejects identical base and target branches", () => {
    expect(() => validateRepositoryTarget({
      ...validTarget,
      targetBranch: "main",
    })).toThrow(InvalidRepositoryTargetError);
  });
});

describe("audit event privacy", () => {
  it("removes sensitive keys and redacts credential-like values", () => {
    const event = createSafeAuditEvent({
      id: "event-1",
      timestamp: "2026-11-06T10:00:00.000Z",
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
        },
      },
    });
    expect(event.details).toEqual({
      branch: "feat/safe-change",
      nested: { message: "Authorization: [REDACTED]" },
    });
    expect(JSON.stringify(event)).not.toContain("do-not-store-this");
    expect(JSON.stringify(event)).not.toContain("abc.def.ghi");
  });

  it("rejects incomplete audit event identity", () => {
    expect(() => createSafeAuditEvent({
      id: "",
      timestamp: "2026-11-06T10:00:00.000Z",
      actorId: "human-1",
      action: "test",
      target: "repo",
      outcome: "FAILED",
    })).toThrow(TypeError);
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
