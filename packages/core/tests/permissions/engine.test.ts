import { beforeEach, describe, expect, test } from "vitest";
import { PermissionEngine } from "../../src/permissions/engine.js";
import { PolicyStore } from "../../src/permissions/store.js";
import {
  AgentPolicy,
  AuthorizationRequest,
  CanonicalCapability
} from "../../src/permissions/types.js";

const readRequest = (overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest => ({
  actorId: "agent-1",
  actorType: "agent",
  capability: CanonicalCapability.REPO_READ,
  repository: "org/repo",
  ...overrides
});

const allowPolicy = (
  actorId = "agent-1",
  overrides: Partial<AgentPolicy> = {}
): AgentPolicy => ({
  actorId,
  policyVersion: "test-v1",
  rules: [
    {
      id: "allow-read",
      effect: "ALLOW",
      capabilities: [CanonicalCapability.REPO_READ],
      repositories: ["org/repo"]
    }
  ],
  ...overrides
});

describe("PermissionEngine - Milestone 1 verification", () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine();
  });

  test("explicitly allowed repository read returns ALLOW", () => {
    engine.registerPolicy(allowPolicy());
    expect(engine.evaluate(readRequest())).toEqual({
      allowed: true,
      reason: "EXPLICIT_ALLOW",
      policyVersion: "test-v1"
    });
  });

  test("missing policy defaults to DENY", () => {
    const decision = engine.evaluate(readRequest({ actorId: "unknown-agent" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("DEFAULT_DENY");
  });

  test("explicit deny overrides an otherwise matching allow", () => {
    engine.registerPolicy(
      allowPolicy("agent-1", {
        rules: [
          {
            id: "allow",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"]
          },
          {
            id: "deny",
            effect: "DENY",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"]
          }
        ]
      })
    );
    expect(engine.evaluate(readRequest()).reason).toBe("EXPLICIT_DENY");
  });

  test("wrong repository is a scope mismatch", () => {
    engine.registerPolicy(allowPolicy());
    const decision = engine.evaluate(readRequest({ repository: "org/other" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("SCOPE_MISMATCH");
  });

  test("trailing branch wildcard matches a branch below its prefix", () => {
    engine.registerPolicy(
      allowPolicy("agent-1", {
        rules: [
          {
            id: "branch-read",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"],
            branches: ["feature/*"]
          }
        ]
      })
    );
    expect(engine.evaluate(readRequest({ branch: "feature/permission-engine" })).allowed).toBe(true);
  });

  test("branch wildcard does not match a different branch", () => {
    engine.registerPolicy(
      allowPolicy("agent-1", {
        rules: [
          {
            id: "branch-read",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"],
            branches: ["feature/*"]
          }
        ]
      })
    );
    const decision = engine.evaluate(readRequest({ branch: "main" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("SCOPE_MISMATCH");
  });

  test("branch-constrained rule denies a request with no branch", () => {
    engine.registerPolicy(
      allowPolicy("agent-1", {
        rules: [
          {
            id: "branch-read",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"],
            branches: ["feature/*"]
          }
        ]
      })
    );
    expect(engine.evaluate(readRequest()).allowed).toBe(false);
  });

  test("empty policy allowlist defaults to DENY", () => {
    engine.registerPolicy(allowPolicy("agent-1", { rules: [] }));
    const decision = engine.evaluate(readRequest());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("DEFAULT_DENY");
  });

  test("child cannot exceed the direct parent's capability set", () => {
    engine.registerPolicy(
      allowPolicy("parent", {
        rules: [
          {
            id: "parent-read",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"]
          }
        ]
      })
    );
    engine.registerPolicy(
      allowPolicy("child", {
        parentAgentId: "parent",
        rules: [
          {
            id: "child-write",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.BRANCH_WRITE],
            repositories: ["org/repo"]
          }
        ]
      })
    );

    const decision = engine.evaluate(
      readRequest({
        actorId: "child",
        capability: CanonicalCapability.BRANCH_WRITE,
        parentAgentId: "parent"
      })
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INHERITED_RESTRICTION");
  });

  test("grandparent restrictions are inherited recursively", () => {
    engine.registerPolicy(
      allowPolicy("grandparent", {
        rules: [
          {
            id: "grandparent-read",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"]
          }
        ]
      })
    );
    engine.registerPolicy(
      allowPolicy("parent", {
        parentAgentId: "grandparent",
        rules: [
          {
            id: "parent-read",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"]
          }
        ]
      })
    );
    engine.registerPolicy(
      allowPolicy("child", {
        parentAgentId: "parent",
        rules: [
          {
            id: "child-read",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"]
          }
        ]
      })
    );

    expect(
      engine.evaluate(readRequest({ actorId: "child", parentAgentId: "parent" })).allowed
    ).toBe(true);

    const restrictedEngine = new PermissionEngine();
    restrictedEngine.registerPolicy(
      allowPolicy("grandparent", {
        rules: [
          {
            id: "grandparent-no-branch-write",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.REPO_READ],
            repositories: ["org/repo"]
          }
        ]
      })
    );
    restrictedEngine.registerPolicy(
      allowPolicy("parent", {
        parentAgentId: "grandparent",
        rules: [
          {
            id: "parent-branch-write",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.BRANCH_WRITE],
            repositories: ["org/repo"]
          }
        ]
      })
    );
    restrictedEngine.registerPolicy(
      allowPolicy("child", {
        parentAgentId: "parent",
        rules: [
          {
            id: "child-branch-write",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.BRANCH_WRITE],
            repositories: ["org/repo"]
          }
        ]
      })
    );

    const decision = restrictedEngine.evaluate(
      readRequest({
        actorId: "child",
        parentAgentId: "parent",
        capability: CanonicalCapability.BRANCH_WRITE
      })
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INHERITED_RESTRICTION");
  });

  test("missing ancestor policy denies inherited permission", () => {
    engine.registerPolicy(allowPolicy("child", { parentAgentId: "missing-parent" }));
    const decision = engine.evaluate(readRequest({ actorId: "child" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INHERITED_RESTRICTION");
  });

  test("circular parent relationships fail closed", () => {
    engine.registerPolicy(allowPolicy("agent-a", { parentAgentId: "agent-b" }));
    engine.registerPolicy(allowPolicy("agent-b", { parentAgentId: "agent-a" }));
    const decision = engine.evaluate(readRequest({ actorId: "agent-a" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INHERITED_RESTRICTION");
  });

  test("request cannot substitute a different parent identity", () => {
    engine.registerPolicy(allowPolicy("agent-1", { parentAgentId: "real-parent" }));
    engine.registerPolicy(allowPolicy("real-parent"));
    engine.registerPolicy(allowPolicy("fake-parent"));
    const decision = engine.evaluate(readRequest({ parentAgentId: "fake-parent" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INHERITED_RESTRICTION");
  });

  test("invalid capability is rejected", () => {
    const decision = engine.evaluate(
      readRequest({ capability: "invalid.capability" })
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INVALID_REQUEST");
  });

  test("malformed request is rejected", () => {
    const decision = engine.evaluate(
      { ...readRequest(), actorId: "" } as AuthorizationRequest
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INVALID_REQUEST");
  });

  test("privileged action remains blocked even with a policy allow and approval reference", () => {
    engine.registerPolicy(
      allowPolicy("agent-1", {
        rules: [
          {
            id: "allow-merge",
            effect: "ALLOW",
            capabilities: [CanonicalCapability.MERGE_EXECUTE],
            repositories: ["org/repo"]
          }
        ]
      })
    );
    const decision = engine.evaluate(
      readRequest({
        capability: CanonicalCapability.MERGE_EXECUTE,
        approvalReference: "reference-is-not-proof"
      })
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("PRIVILEGED_ACTION_BLOCKED");
  });

  test("invalid policy registration is rejected", () => {
    expect(() =>
      engine.registerPolicy(
        allowPolicy("agent-1", {
          rules: [
            {
              id: "bad-rule",
              effect: "ALLOW",
              capabilities: [],
              repositories: ["org/repo"]
            }
          ]
        })
      )
    ).toThrow(TypeError);
  });

  test("policy store rejects replacement of an existing actor snapshot", () => {
    engine.registerPolicy(allowPolicy());
    expect(() => engine.registerPolicy(allowPolicy())).toThrow(
      "A policy is already registered for this actor"
    );
  });

  test("registered policy snapshots cannot be mutated by the caller", () => {
    const policy = allowPolicy();
    engine.registerPolicy(policy);
    policy.rules[0].repositories[0] = "org/other";
    expect(engine.evaluate(readRequest()).allowed).toBe(true);
  });

  test("identical inputs produce identical decisions", () => {
    engine.registerPolicy(allowPolicy());
    expect(engine.evaluate(readRequest())).toEqual(engine.evaluate(readRequest()));
  });

  test("policy store exceptions return a denial decision", () => {
    class BrokenStore extends PolicyStore {
      override get(_actorId: string): AgentPolicy | undefined {
        throw new Error("store unavailable");
      }
    }
    const brokenEngine = new PermissionEngine(new BrokenStore());
    const decision = brokenEngine.evaluate(readRequest());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("POLICY_EVALUATION_ERROR");
  });
});
