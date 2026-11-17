import { describe, expect, it } from "vitest";
import { PermissionEngine } from "../src/permissions/engine.js";
import {
  authorizeHumanApproval,
  type HumanApprovalDependencies,
} from "../src/security/human-authorization.js";
import { createApprovalGate } from "../src/security/approval.js";
import { InMemoryApprovalStore } from "../src/security/approval-store.js";
import {
  digestProtectedActionProposal,
  ProtectedActionChangedError,
  ProtectedActionDeniedError,
  ProtectedActionGateway,
  type ProtectedActionProposal,
} from "../src/security/protected-action.js";

const now = new Date("2026-11-18T10:00:00.000Z");
const proposal: ProtectedActionProposal = {
  action: "branch.write",
  repository: "example-org/sample-repo",
  targetBranch: "feat/safe",
  baseRevision: "a".repeat(40),
  headRevision: "b".repeat(40),
  diffDigest: "c".repeat(64),
};

function permissionEngine(allow = true): PermissionEngine {
  const engine = new PermissionEngine();
  engine.registerPolicy({
    actorId: "agent-1",
    policyVersion: "test-v1",
    rules: allow
      ? [{
          id: "branch-write",
          effect: "ALLOW",
          capabilities: ["branch.write"],
          repositories: ["example-org/sample-repo"],
          branches: ["feat/safe"],
        }]
      : [],
  });
  return engine;
}

async function approvedStore(
  currentProposal: ProtectedActionProposal = proposal,
) {
  const digest = await digestProtectedActionProposal(currentProposal);
  const store = new InMemoryApprovalStore();
  await store.create(
    createApprovalGate({
      id: "gate-1",
      taskId: "task-1",
      requestedBy: "agent-1",
      proposalDigest: digest,
      baseRevision: currentProposal.baseRevision,
    }),
  );
  const dependencies: HumanApprovalDependencies = {
    verifier: {
      verifyCredential: async () => ({
        subjectId: "human-1",
        permissions: ["approval:write"],
      }),
    },
    store,
    clock: { now: () => now },
  };
  await authorizeHumanApproval(
    {
      gateId: "gate-1",
      credential: "verified-in-test",
      status: "APPROVED",
      proposalDigest: digest,
      baseRevision: currentProposal.baseRevision,
    },
    dependencies,
  );
  return store;
}

describe("protected action gateway", () => {
  it("runs the provider callback only after fresh policy, state, and approval checks", async () => {
    const store = await approvedStore();
    let calls = 0;
    const gateway = new ProtectedActionGateway({
      approvalStore: store,
      permissionEngine: permissionEngine(),
      proposalResolver: {
        resolveCurrent: async () => proposal,
      },
      clock: { now: () => now },
    });

    const result = await gateway.execute(
      "gate-1",
      { actorId: "agent-1", actorType: "agent" },
      async (current) => {
        calls += 1;
        return current.repository;
      },
    );

    expect(result).toBe("example-org/sample-repo");
    expect(calls).toBe(1);
    expect((await store.load("gate-1"))?.gate.status).toBe("CONSUMED");
  });

  it("does not invoke the callback when policy denies", async () => {
    const store = await approvedStore();
    let calls = 0;
    const gateway = new ProtectedActionGateway({
      approvalStore: store,
      permissionEngine: permissionEngine(false),
      proposalResolver: {
        resolveCurrent: async () => proposal,
      },
      clock: { now: () => now },
    });

    await expect(
      gateway.execute(
        "gate-1",
        { actorId: "agent-1", actorType: "agent" },
        async () => {
          calls += 1;
        },
      ),
    ).rejects.toThrow(ProtectedActionDeniedError);
    expect(calls).toBe(0);
    expect((await store.load("gate-1"))?.gate.status).toBe("APPROVED");
  });

  it("does not invoke the callback when provider state changes after review", async () => {
    const store = await approvedStore();
    let reads = 0;
    let calls = 0;
    const changed = { ...proposal, headRevision: "d".repeat(40) };
    const gateway = new ProtectedActionGateway({
      approvalStore: store,
      permissionEngine: permissionEngine(),
      proposalResolver: {
        resolveCurrent: async () => (++reads === 1 ? proposal : changed),
      },
      clock: { now: () => now },
    });

    await expect(
      gateway.execute(
        "gate-1",
        { actorId: "agent-1", actorType: "agent" },
        async () => {
          calls += 1;
        },
      ),
    ).rejects.toThrow(ProtectedActionChangedError);
    expect(calls).toBe(0);
    expect((await store.load("gate-1"))?.gate.status).toBe("APPROVED");
  });

  it("consumes approval before invoking the provider callback and never replays it", async () => {
    const store = await approvedStore();
    const gateway = new ProtectedActionGateway({
      approvalStore: store,
      permissionEngine: permissionEngine(),
      proposalResolver: {
        resolveCurrent: async () => proposal,
      },
      clock: { now: () => now },
    });

    await gateway.execute(
      "gate-1",
      { actorId: "agent-1", actorType: "agent" },
      async () => "done",
    );
    await expect(
      gateway.execute(
        "gate-1",
        { actorId: "agent-1", actorType: "agent" },
        async () => "replayed",
      ),
    ).rejects.toThrow();
  });
});
