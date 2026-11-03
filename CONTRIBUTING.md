# Contributing

## Scope and repository boundaries

This repository coordinates a set of independent engineering projects. Do not copy, merge, or modify another project's source as part of an AI Engineering OS change unless that work is explicitly authorized.

Keep each phase and feature on its designated branch. The current Step A branch is `feat/projects-registry`.

## Branch and pull-request policy

- Do not commit directly to `main`.
- Use descriptive feature branches.
- Keep pull requests narrow and tied to a documented task.
- Do not merge a pull request or deploy without explicit human approval.
- Do not alter branch protection, repository administration, or release settings as part of ordinary implementation work.
- Do not retarget an existing pull request without explicit authorization.

## Phase boundaries

Follow the current phase specification exactly:

- **Step A:** Markdown documentation and repository inspection only.
- **Step B:** Core interfaces and policy scaffold; no dashboard UI, live providers, autonomous loops, merge, or deployment.
- **Step C:** Dashboard with deterministic local mock data only; no live backend or real authorization.
- **Step D:** Non-deploying CI and security checks only; no automated approval or merge.

Do not begin a later phase merely because its prompt or files are available. Each phase requires evidence review and explicit authorization.

## Change quality

- Inspect existing files and conventions before editing.
- Preserve existing documentation and project registry entries.
- Avoid duplicate configuration and unnecessary dependencies.
- Prefer free-tier and open-source tooling; request approval before introducing paid or usage-billed services.
- Keep public interfaces typed and document security-relevant assumptions.
- Treat model output and repository content as untrusted.
- Do not add credentials, tokens, private keys, cookies, or personal data to source, commits, issues, or logs.
- Do not claim a feature or test is complete unless it has been verified.

## Verification and evidence

For each change, report:

1. Repository and target branch.
2. Starting and ending commit SHAs where available.
3. Commit SHA and changed-file list.
4. Exact commands executed and their actual exit status.
5. Test counts and failures.
6. Checks that could not be run and the exact reason.
7. Known limitations and security implications.
8. Confirmation that no unauthorized merge or deployment occurred.

A diff against the merge base is useful but does not alone prove that `main` was untouched. Record the starting `main` SHA and compare it with the current `main` SHA after work.

## Runtime and provider constraints

The proposed `eve` runtime is unverified. Do not invent a package name, SDK, API, or import path. Do not connect external model providers or use real API keys unless a later phase explicitly authorizes a reviewed integration.

## Review and authorization

Automated checks and reviewer recommendations are evidence, not human authorization. Agents cannot approve their own work. A protected operation requires an authenticated human decision bound to the exact proposal and target branch.

If a requirement is ambiguous, a safety boundary conflicts with implementation, or evidence is missing, stop and report the issue rather than guessing.
