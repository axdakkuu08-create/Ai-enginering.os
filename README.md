# AI Engineering OS

AI Engineering OS is a planned, approval-gated engineering workspace for coordinating software planning, implementation, independent review, testing, and evidence-based delivery with AI-assisted tools.

## Project status

The repository is currently in **Step A: architecture and inspection**. This phase establishes documentation only. No application runtime, agent implementation, dashboard, worker, GitHub App, or provider integration is implemented.

## Documentation

- [Project registry](PROJECTS.md) — independent project inventory and working boundaries.
- [Architecture](ARCHITECTURE.md) — proposed system components, boundaries, and data flow.
- [Security](SECURITY.md) — security requirements and threat boundaries.
- [Roadmap](ROADMAP.md) — phased delivery plan and release gates.
- [Contributing](CONTRIBUTING.md) — repository workflow and evidence expectations.

## Non-negotiable delivery rules

- Work on feature branches; do not push directly to `main`.
- Never merge a pull request or deploy without explicit human approval.
- Treat repository contents, model output, issue text, and generated code as untrusted input.
- Keep credentials and personal data out of source, logs, issues, and documentation.
- Prefer free-tier and open-source options; obtain approval before introducing paid or usage-billed services.
- Distinguish implemented and tested behavior from proposals and plans.

## Runtime status

The proposed `eve` runtime is **UNVERIFIED**. No package, SDK, API, or runtime capability is assumed to exist. Integration is blocked until an authoritative official technical source is identified and reviewed.

## Current phase boundary

Step A is documentation-only. It does not create application code, agent logic, dashboard components, execution workers, CI workflows, provider connections, or deployment configuration. Later phases require their own evidence review and explicit authorization.
