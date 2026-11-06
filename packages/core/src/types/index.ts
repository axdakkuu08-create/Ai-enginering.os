export type ProjectStatus = "ACTIVE" | "ARCHIVED" | "PENDING";
export type TaskStep = "A" | "B" | "C" | "D";
export type TaskRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED";

/** Supported dashboard navigation destinations; intentionally a closed union. */
export type NavigationRoute =
  | "/"
  | "/projects"
  | "/tasks"
  | "/evidence"
  | "/settings";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repository: string;
  readonly status: ProjectStatus;
  readonly defaultBranch: string;
}

export interface TaskRun {
  readonly id: string;
  readonly projectId: string;
  readonly step: TaskStep;
  readonly status: TaskRunStatus;
  /** Git commit or evidence object SHA; null until evidence exists. */
  readonly evidenceSha: string | null;
}

export interface ApprovalGate {
  readonly id: string;
  readonly taskId: string;
  readonly status: ApprovalStatus;
  readonly authorizedBy: string | null;
  readonly timestamp: string | null;
  /** Immutable proposal revision approved by the human. */
  readonly proposalDigest: string;
  /** Base revision against which the proposal was reviewed. */
  readonly baseRevision: string;
}

export interface AuditLog {
  readonly id: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly details: Readonly<Record<string, unknown>>;
  /** ISO-8601 timestamp. */
  readonly timestamp: string;
}

/** Provider-neutral model invocation contract; contains no credentials. */
export interface ModelRequest {
  readonly requestId: string;
  readonly model: string;
  readonly input: string;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ModelResponse {
  readonly requestId: string;
  readonly providerId: string;
  readonly model: string;
  readonly output: string;
  readonly usage?: ModelUsage;
}

export interface ModelProviderAdapter {
  readonly providerId: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/** Minimal task contract shared by planner/implementer/reviewer workers. */
export interface AgentTask {
  readonly id: string;
  readonly projectId: string;
  readonly requestedBy: string;
  readonly status: TaskRunStatus;
  readonly proposalDigest: string;
}
