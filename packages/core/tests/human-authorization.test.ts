import { describe, expect, it } from "vitest";
import {
  APPROVAL_PERMISSION,
  authorizeHumanApproval,
  type HumanApprovalDependencies,
  type HumanApprovalRequest,
  type HumanIdentityVerifier,
} from "../src/security/human-authorization.js";
import {
  ApprovalAlreadyDecidedError,
  createApprovalGate,
  StaleApprovalError,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";
import {
  ApprovalNotFoundError,
  InMemoryApprovalStore,
  requireApprovedForProposal,
  type ApprovalClock,
} from "../src/security/approval-store.js";

const SERVER_TIME = "2026-11-06T00:00:00.000Z";

const fixedClock = (iso: string): ApprovalClock => ({
  now: () => new Date(iso),
});

const gateInput = {
  id: "gate-1",
  taskId: "task-1",
  requestedBy: "agent-1",
  proposalDigest: "proposal-1",
  baseRevision: "base-1",
};

async function setup(
  subjectId: string | null,
  permissions: readonly string[] = [APPROVAL_PERMISSION],
): Promise<{ store: InMemoryApprovalStore; deps: HumanApprovalDependencies }> {
  const store = new InMemoryApprovalStore();
  await store.create(createApprovalGate(gateInput));
  const verifier: HumanIdentityVerifier = {
    verifyCredential: async () =>
      subjectId === null ? null : { subjectId, permissions },
  };
  return {
    store,
    deps: { verifier, store, clock: fixedClock(SERVER_TIME) },
  };
}

const request = (
  overrides: Partial<HumanApprovalRequest> = {},
): HumanApprovalRequest => ({
  gateId: "gate-1",
  credential: "opaque-session-credential",
  status: "APPROVED",
  proposalDigest: "proposal-1",
  baseRevision: "base-1",
  ...overrides,
});

describe("trusted human approval boundary", () => {
  it("records the verified subject as the approver and the server time", async () => {
    const { store, deps } = await setup("human-7");
    const result = await authorizeHumanApproval(request(), deps);

    expect(result.status).toBe("APPROVED");
    expect(result.authorizedBy).toBe("human-7");
    expect(result.timestamp).toBe(SERVER_TIME);

    const stored = await store.load("gate-1");
    expect(stored?.gate.authorizedBy).toBe("human-7");
    expect(stored?.version).toBe(2);
  });

  it("ignores caller-supplied actor, actor type, timestamp and gate fields", async () => {
    const { store, deps } = await setup("human-7");
    const forged = {
      ...request(),
      actorId: "admin-forged",
      actorType: "SERVICE",
      timestamp: "2000-01-01T00:00:00.000Z",
      gate: { status: "APPROVED", authorizedBy: "admin-forged" },
    } as unknown as HumanApprovalRequest;

    const result = await authorizeHumanApproval(forged, deps);

    expect(result.authorizedBy).toBe("human-7");
    expect(result.timestamp).toBe(SERVER_TIME);
    expect((await store.load("gate-1"))?.gate.authorizedBy).toBe("human-7");
  });

  it("fails closed on invalid credentials and leaves state unchanged", async () => {
    const { store, deps } = await setup(null);
    await expect(authorizeHumanApproval(request(), deps)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
    const stored = await store.load("gate-1");
    expect(stored?.gate.status).toBe("PENDING");
    expect(stored?.version).toBe(1);
  });

  it("fails closed when identity verification throws", async () => {
    const { deps } = await setup("human-7");
    const throwing: HumanIdentityVerifier = {
      verifyCredential: async () => {
        throw new Error("provider unavailable");
      },
    };
    await expect(
      authorizeHumanApproval(request(), { ...deps, verifier: throwing }),
    ).rejects.toThrow(UnauthorizedApprovalError);
  });

  it("requires server-resolved approval permission", async () => {
    const { store, deps } = await setup("human-7", ["project:read"]);
    await expect(authorizeHumanApproval(request(), deps)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
    expect((await store.load("gate-1"))?.gate.status).toBe("PENDING");
  });

  it("blocks the requester approving their own proposal, using the trusted subject", async () => {
    const { store, deps } = await setup("agent-1");
    await expect(authorizeHumanApproval(request(), deps)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
    expect((await store.load("gate-1"))?.gate.status).toBe("PENDING");
  });

  it("rejects a stale proposal without changing stored state", async () => {
    const { store, deps } = await setup("human-7");
    await expect(
      authorizeHumanApproval(request({ proposalDigest: "stale" }), deps),
    ).rejects.toThrow(StaleApprovalError);
    const stored = await store.load("gate-1");
    expect(stored?.gate.status).toBe("PENDING");
    expect(stored?.version).toBe(1);
  });

  it("rejects an unknown gate identifier", async () => {
    const { deps } = await setup("human-7");
    await expect(
      authorizeHumanApproval(request({ gateId: "missing" }), deps),
    ).rejects.toThrow(ApprovalNotFoundError);
  });

  it("rejects an invalid decision status at runtime", async () => {
    const { deps } = await setup("human-7");
    await expect(
      authorizeHumanApproval(
        request({ status: "PENDING" as unknown as "APPROVED" }),
        deps,
      ),
    ).rejects.toThrow(TypeError);
  });

  it("rejects a replayed decision on an already decided gate", async () => {
    const { store, deps } = await setup("human-7");
    await authorizeHumanApproval(request(), deps);

    const secondDeps = {
      ...deps,
      verifier: {
        verifyCredential: async () => ({
          subjectId: "human-8",
          permissions: [APPROVAL_PERMISSION],
        }),
      },
    };
    await expect(
      authorizeHumanApproval(request({ status: "DENIED" }), secondDeps),
    ).rejects.toThrow(ApprovalAlreadyDecidedError);

    expect((await store.load("gate-1"))?.gate.authorizedBy).toBe("human-7");
  });

  it("lets exactly one of two concurrent decisions commit", async () => {
    const { store, deps } = await setup("human-7");
    const other: HumanApprovalDependencies = {
      ...deps,
      verifier: {
        verifyCredential: async () => ({
          subjectId: "human-8",
          permissions: [APPROVAL_PERMISSION],
        }),
      },
    };

    const results = await Promise.allSettled([
      authorizeHumanApproval(request(), deps),
      authorizeHumanApproval(request({ status: "DENIED" }), other),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(ApprovalAlreadyDecidedError);

    const stored = await store.load("gate-1");
    expect(stored?.version).toBe(2);
    expect(["human-7", "human-8"]).toContain(stored?.gate.authorizedBy);
  });

  it("re-checks the stored gate before protected work", async () => {
    const { store, deps } = await setup("human-7");
    await authorizeHumanApproval(request(), deps);

    await expect(
      requireApprovedForProposal(store, "gate-1", "proposal-1", "base-1"),
    ).resolves.toMatchObject({ status: "APPROVED" });

    await expect(
      requireApprovedForProposal(store, "gate-1", "proposal-2", "base-1"),
    ).rejects.toThrow(StaleApprovalError);
  });
});
