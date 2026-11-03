import { describe, expect, it } from "vitest";
import {
  assertNotSelfApproval,
  canProceed,
  createApprovalGate,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";
import {
  WorkerConcurrencyGuard,
  WorkerConcurrencyLimitError,
} from "../src/security/worker-bounds.js";

describe("approval gate", () => {
  it("defaults new gates to PENDING and blocks execution", () => {
    const gate = createApprovalGate({ id: "gate-1", taskId: "task-1" });
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
});
