# Project Registry

This file is the portfolio-level index for projects managed or explored through AI Engineering OS.

## Working rules

- Keep every project in its own repository unless an explicit integration is approved.
- Do not push directly to `main`; use feature branches and pull requests.
- Never merge a pull request or deploy to production without explicit human approval.
- Record verified status separately from planned work.
- Prefer free tiers and open-source tools; request approval before introducing paid or usage-billed services.
- Do not expose credentials, tokens, private keys, or personal data in issues, commits, logs, or documentation.

## Projects

| Project | Repository | Purpose | Current status |
|---|---|---|---|
| AI Engineering OS | [Ai-enginering.os](https://github.com/axdakkuu08-create/Ai-enginering.os) | Independent engineering workspace for planning, implementation, review, testing, and approval-gated delivery with AI agents. | Step B audit workflow succeeded on `fef0116d`; final acceptance HOLD pending artifact review. Step C not started; explicit authorization required. |
| Gemini GitHub MCP Bridge | [gemini-github-mcp-bridge](https://github.com/axdakkuu08-create/gemini-github-mcp-bridge) | GitHub-connected MCP bridge and foundation for agent-assisted engineering workflows. | Existing project; keep changes isolated from this repository unless explicitly approved. |
| NEXUS-AI | [NEXUS-AI-PUBLIC](https://github.com/axdakkuu08-create/NEXUS-AI-PUBLIC) | AI application / frontend project. | Existing project; maintain its own branches and release process. |
| Pulse | [convex-backend-.001](https://github.com/axdakkuu08-create/convex-backend-.001) | Music discovery and playback application with cloud-backed library features. | Existing project; maintain its own branches and provider constraints. |
| Arcane Protocol | [Arcane](https://github.com/axdakkuu08-create/Arcane) | Godot-based sci-fi first-person game prototype. | Existing project; keep separate from other game concepts and repositories. |
| RepoPilot AI | Separate repository not yet confirmed | Standalone AI-assisted repository engineering product; potential later integration with AI Engineering OS only after independent verification. | Requirements and architecture collection only; implementation and repository changes are not authorized yet. |

## AI Engineering OS milestones

1. **Repository foundation** — project registry, architecture, security principles, and roadmap.
2. **Dashboard** — mobile-friendly project and run visibility.
3. **Orchestration** — planner and provider-independent model adapter.
4. **GitHub App integration** — least-privilege repository access and branch/PR workflows.
5. **Cloud execution** — isolated, resource-limited workers with auditable logs.
6. **Quality gates** — automated tests, independent review, and CI evidence.
7. **Human approval** — mandatory approval before merge or production deployment.

## Current implementation boundary

The first delivery is documentation and an isolated scaffold on a feature branch. No existing project repository is modified by this work. Runtime and hosting choices must be verified against current official documentation before implementation; no paid service is assumed.
