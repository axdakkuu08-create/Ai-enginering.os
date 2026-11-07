export {
  CanonicalCapability,
  PRIVILEGED_CAPABILITIES
} from "./types.js";
export type {
  ActorType,
  AgentPolicy,
  AuthorizationDecision,
  AuthorizationRequest,
  DecisionReason,
  PolicyRule
} from "./types.js";
export { PermissionEngine } from "./engine.js";
export { PolicyStore, validateAgentPolicy } from "./store.js";
