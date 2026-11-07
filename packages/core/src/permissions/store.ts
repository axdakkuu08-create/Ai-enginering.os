import {
  AgentPolicy,
  CanonicalCapability,
  PolicyRule
} from "./types.js";

const canonicalCapabilities = new Set<string>(Object.values(CanonicalCapability));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function freezePolicy(policy: AgentPolicy): AgentPolicy {
  const rules = policy.rules.map((rule) =>
    Object.freeze({
      ...rule,
      capabilities: Object.freeze([...rule.capabilities]) as unknown as string[],
      repositories: Object.freeze([...rule.repositories]) as unknown as string[],
      ...(rule.branches === undefined
        ? {}
        : { branches: Object.freeze([...rule.branches]) as unknown as string[] })
    })
  );
  return Object.freeze({
    ...policy,
    rules: Object.freeze(rules) as unknown as PolicyRule[]
  });
}

export function validateAgentPolicy(value: unknown): asserts value is AgentPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Policy must be an object");
  }

  const policy = value as Partial<AgentPolicy>;
  if (!isNonEmptyString(policy.actorId) || !isNonEmptyString(policy.policyVersion)) {
    throw new TypeError("Policy actorId and policyVersion are required");
  }
  if (
    policy.parentAgentId !== undefined &&
    (!isNonEmptyString(policy.parentAgentId) || policy.parentAgentId === policy.actorId)
  ) {
    throw new TypeError("Policy parentAgentId must be a different non-empty actor ID");
  }
  if (!Array.isArray(policy.rules)) {
    throw new TypeError("Policy rules must be an array");
  }

  const ruleIds = new Set<string>();
  for (const candidate of policy.rules as unknown[]) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new TypeError("Every policy rule must be an object");
    }
    const rule = candidate as Partial<PolicyRule>;
    if (!isNonEmptyString(rule.id) || ruleIds.has(rule.id)) {
      throw new TypeError("Policy rule IDs must be non-empty and unique");
    }
    ruleIds.add(rule.id);

    if (rule.effect !== "ALLOW" && rule.effect !== "DENY") {
      throw new TypeError("Policy rule effect must be ALLOW or DENY");
    }
    if (
      !Array.isArray(rule.capabilities) ||
      rule.capabilities.length === 0 ||
      !rule.capabilities.every(
        (capability) => capability === "*" || canonicalCapabilities.has(capability)
      )
    ) {
      throw new TypeError("Policy rule capabilities must be a non-empty canonical allowlist");
    }
    if (
      !Array.isArray(rule.repositories) ||
      rule.repositories.length === 0 ||
      !rule.repositories.every(isNonEmptyString)
    ) {
      throw new TypeError("Policy rule repositories must be a non-empty allowlist");
    }
    if (
      rule.branches !== undefined &&
      (!Array.isArray(rule.branches) ||
        rule.branches.length === 0 ||
        !rule.branches.every(
          (branch) =>
            isNonEmptyString(branch) &&
            (branch === "*" ||
              (!branch.includes("*") && !branch.includes("?")) ||
              (branch.endsWith("/*") && branch.indexOf("*") === branch.length - 1))
        ))
    ) {
      throw new TypeError("Branch allowlists must contain exact names, '*', or trailing '/*' patterns");
    }
  }
}

/**
 * In-memory policy registry. Registered policies are copied and deeply frozen;
 * evaluation receives immutable snapshots and cannot mutate stored policy state.
 */
export class PolicyStore {
  private readonly policies = new Map<string, AgentPolicy>();

  public register(policy: AgentPolicy): void {
    validateAgentPolicy(policy);
    this.policies.set(policy.actorId, freezePolicy(policy));
  }

  public get(actorId: string): AgentPolicy | undefined {
    return this.policies.get(actorId);
  }

  public has(actorId: string): boolean {
    return this.policies.has(actorId);
  }

  public get size(): number {
    return this.policies.size;
  }
}
