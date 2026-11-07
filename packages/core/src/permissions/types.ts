export enum CanonicalCapability {
  REPO_READ = "repo.read",
  REPO_INSPECT = "repo.inspect",
  VERIFICATION_RUN = "verification.run",
  BRANCH_WRITE = "branch.write",
  PR_WRITE = "pr.write",
  MERGE_EXECUTE = "merge.execute",
  DEPLOY_EXECUTE = "deploy.execute"
}

export const PRIVILEGED_CAPABILITIES: ReadonlySet<string> = new Set([
  CanonicalCapability.MERGE_EXECUTE,
  CanonicalCapability.DEPLOY_EXECUTE
]);

export type ActorType = "user" | "agent" | "worker";

export interface AuthorizationRequest {
  actorId: string;
  actorType: ActorType;
  capability: string;
  repository: string;
  branch?: string;
  commitSha?: string;
  parentAgentId?: string;
  approvalReference?: string;
}

export type DecisionReason =
  | "EXPLICIT_ALLOW"
  | "DEFAULT_DENY"
  | "EXPLICIT_DENY"
  | "SCOPE_MISMATCH"
  | "INVALID_REQUEST"
  | "INHERITED_RESTRICTION"
  | "PRIVILEGED_ACTION_BLOCKED"
  | "POLICY_EVALUATION_ERROR";

export interface AuthorizationDecision {
  allowed: boolean;
  reason: DecisionReason;
  policyVersion: string;
}

export interface PolicyRule {
  id: string;
  effect: "ALLOW" | "DENY";
  capabilities: string[];
  repositories: string[];
  branches?: string[];
}

export interface AgentPolicy {
  actorId: string;
  parentAgentId?: string;
  rules: PolicyRule[];
  policyVersion: string;
}
