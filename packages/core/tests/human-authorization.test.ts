import { describe, expect, it } from "vitest";
import {
  APPROVAL_PERMISSION,
  authorizeHumanApproval,
  type HumanIdentityVerifier,
} from "../src/security/human-authorization.js";
import {
  createApprovalGate,
  UnauthorizedApprovalError,
} from "../src/security/approval.js";

const gate = () =>
  createApprovalGate({
    id: "gate-1",
    taskId: "task-1",
    requestedBy: "agent-1",
    proposalDigest: "proposal-1",
    baseRevision: "base-1",
  });

const request = (target = gate()) => ({
  gate: target,
  credential: "opaque-session-credential",
  status: "APPROVED" as const,
  proposalDigest: "proposal-1",
  baseRevision: "base-1",
  timestamp: "2026-11-06T00:00:00.000Z",
});

describe("trusted human approval boundary", () => {
  it("derives the approver identity from the verifier, not request fields", async () => {
    const verifier: HumanIdentityVerifier = {
      verifyCredential: async () => ({
        subjectId: "human-7",
        permissions: [APPROVAL_PERMISSION],
      }),
    };
    const result = await authorizeHumanApproval(request(), verifier);
    expect(result.status).toBe("APPROVED");
    expect(result.authorizedBy).toBe("human-7");
  });

  it("fails closed when credentials are invalid", async () => {
    const verifier: HumanIdentityVerifier = {
      verifyCredential: async () => null,
    };
    await expect(authorizeHumanApproval(request(), verifier)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
  });

  it("fails closed when identity verification throws", async () => {
    const verifier: HumanIdentityVerifier = {
      verifyCredential: async () => {
        throw new Error("provider unavailable");
      },
    };
    await expect(authorizeHumanApproval(request(), verifier)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
  });

  it("requires server-resolved approval permission", async () => {
    const verifier: HumanIdentityVerifier = {
      verifyCredential: async () => ({
        subjectId: "human-7",
        permissions: ["project:read"],
      }),
    };
    await expect(authorizeHumanApproval(request(), verifier)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
  });

  it("rejects the requester attempting to approve their own proposal", async () => {
    const verifier: HumanIdentityVerifier = {
      verifyCredential: async () => ({
        subjectId: "agent-1",
        permissions: [APPROVAL_PERMISSION],
      }),
    };
    await expect(authorizeHumanApproval(request(), verifier)).rejects.toThrow(
      UnauthorizedApprovalError,
    );
  });

  it("still enforces proposal and base-revision binding", async () => {
    const verifier: HumanIdentityVerifier = {
      verifyCredential: async () => ({
        subjectId: "human-7",
        permissions: [APPROVAL_PERMISSION],
      }),
    };
    await expect(
      authorizeHumanApproval(
        { ...request(), proposalDigest: "stale-proposal" },
        verifier,
      ),
    ).rejects.toThrow();
  });
});
