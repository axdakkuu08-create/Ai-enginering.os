import {
  AgentPolicy,
  AuthorizationDecision,
  AuthorizationRequest,
  CanonicalCapability,
  PRIVILEGED_CAPABILITIES,
  PolicyRule
} from "./types.js";
import { PolicyStore } from "./store.js";

const DEFAULT_POLICY_VERSION = "v1.1";
const actorTypes = new Set(["user", "agent", "worker"]);
const canonicalCapabilities = new Set<string>(Object.values(CanonicalCapability));

type PolicyCheck = "allowed" | "denied" | "scope-mismatch" | "missing";

export class PermissionEngine {
  public constructor(private readonly store: PolicyStore = new PolicyStore()) {}

  public registerPolicy(policy: AgentPolicy): void {
    this.store.register(policy);
  }

  public evaluate(request: AuthorizationRequest): AuthorizationDecision {
    const initialPolicy =
      request && typeof request.actorId === "string"
        ? this.store.get(request.actorId)
        : undefined;
    const policyVersion = initialPolicy?.policyVersion ?? DEFAULT_POLICY_VERSION;

    try {
      if (!this.isValidRequest(request)) {
        return this.decision(false, "INVALID_REQUEST", policyVersion);
      }
      if (!initialPolicy) {
        return this.decision(false, "DEFAULT_DENY", policyVersion);
      }

      // Stage 1: validate the request and resolve its registered policy.
      // Stage 2: explicit deny always overrides any allow.
      if (this.hasExplicitDeny(initialPolicy, request)) {
        return this.decision(false, "EXPLICIT_DENY", policyVersion);
      }

      // Stage 3: an allow rule must match repository and branch scope.
      const directScope = this.checkPolicyScope(initialPolicy, request);
      if (directScope === "scope-mismatch") {
        return this.decision(false, "SCOPE_MISMATCH", policyVersion);
      }

      // Stage 4: every ancestor must independently allow the same request.
      if (!this.hasEffectiveAncestorPermission(initialPolicy, request)) {
        return this.decision(false, "INHERITED_RESTRICTION", policyVersion);
      }

      // Stage 5: privileged actions remain blocked until a trusted approval
      // verifier is implemented and explicitly integrated.
      if (PRIVILEGED_CAPABILITIES.has(request.capability)) {
        return this.decision(false, "PRIVILEGED_ACTION_BLOCKED", policyVersion);
      }

      // Stage 6: require an explicit allow in the actor's own policy.
      if (this.hasExplicitAllow(initialPolicy, request)) {
        return this.decision(true, "EXPLICIT_ALLOW", policyVersion);
      }

      // Stage 7: all unmatched requests fail closed.
      return this.decision(false, "DEFAULT_DENY", policyVersion);
    } catch {
      return this.decision(false, "POLICY_EVALUATION_ERROR", policyVersion);
    }
  }

  private decision(
    allowed: boolean,
    reason: AuthorizationDecision["reason"],
    policyVersion: string
  ): AuthorizationDecision {
    return { allowed, reason, policyVersion };
  }

  private isValidRequest(request: AuthorizationRequest): boolean {
    if (typeof request !== "object" || request === null || Array.isArray(request)) {
      return false;
    }
    if (
      typeof request.actorId !== "string" ||
      request.actorId.trim().length === 0 ||
      !actorTypes.has(request.actorType) ||
      typeof request.capability !== "string" ||
      !canonicalCapabilities.has(request.capability) ||
      typeof request.repository !== "string" ||
      !/^[^/\s]+\/[^/\s]+$/.test(request.repository)
    ) {
      return false;
    }
    if (
      request.branch !== undefined &&
      (typeof request.branch !== "string" || request.branch.trim().length === 0)
    ) {
      return false;
    }
    if (
      request.parentAgentId !== undefined &&
      (typeof request.parentAgentId !== "string" ||
        request.parentAgentId.trim().length === 0)
    ) {
      return false;
    }
    if (
      request.commitSha !== undefined &&
      (typeof request.commitSha !== "string" ||
        !/^[0-9a-f]{40}$/i.test(request.commitSha))
    ) {
      return false;
    }
    if (
      request.approvalReference !== undefined &&
      (typeof request.approvalReference !== "string" ||
        request.approvalReference.trim().length === 0)
    ) {
      return false;
    }
    return true;
  }

  private hasExplicitDeny(policy: AgentPolicy, request: AuthorizationRequest): boolean {
    return policy.rules.some(
      (rule) => rule.effect === "DENY" && this.ruleMatches(rule, request)
    );
  }

  private hasExplicitAllow(policy: AgentPolicy, request: AuthorizationRequest): boolean {
    return policy.rules.some(
      (rule) => rule.effect === "ALLOW" && this.ruleMatches(rule, request)
    );
  }

  private ruleMatches(rule: PolicyRule, request: AuthorizationRequest): boolean {
    const capabilityMatches =
      rule.capabilities.includes("*") || rule.capabilities.includes(request.capability);
    const repositoryMatches =
      rule.repositories.includes("*") || rule.repositories.includes(request.repository);
    return (
      capabilityMatches &&
      repositoryMatches &&
      this.branchMatches(rule.branches, request.branch)
    );
  }

  private branchMatches(allowedBranches: string[] | undefined, branch: string | undefined): boolean {
    if (allowedBranches === undefined) return true;
    if (!branch) return false;

    return allowedBranches.some((pattern) => {
      if (pattern === "*") return true;
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -1);
        return branch.startsWith(prefix);
      }
      return pattern === branch;
    });
  }

  private checkPolicyScope(
    policy: AgentPolicy,
    request: AuthorizationRequest
  ): PolicyCheck {
    const allowRules = policy.rules.filter(
      (rule) =>
        rule.effect === "ALLOW" &&
        (rule.capabilities.includes("*") || rule.capabilities.includes(request.capability))
    );

    if (allowRules.length === 0) return "missing";
    return allowRules.some((rule) => this.ruleMatches(rule, request))
      ? "allowed"
      : "scope-mismatch";
  }

  private hasEffectiveAncestorPermission(
    actorPolicy: AgentPolicy,
    request: AuthorizationRequest
  ): boolean {
    if (
      request.parentAgentId !== undefined &&
      request.parentAgentId !== actorPolicy.parentAgentId
    ) {
      return false;
    }

    const visited = new Set<string>([actorPolicy.actorId]);
    let parentId = actorPolicy.parentAgentId;

    while (parentId !== undefined) {
      if (visited.has(parentId)) return false;
      visited.add(parentId);

      const parentPolicy = this.store.get(parentId);
      if (!parentPolicy || this.hasExplicitDeny(parentPolicy, request)) {
        return false;
      }

      if (this.checkPolicyScope(parentPolicy, request) !== "allowed") {
        return false;
      }

      parentId = parentPolicy.parentAgentId;
    }

    return true;
  }
}
