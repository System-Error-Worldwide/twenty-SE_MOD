# Engineering Plan — Twenty draft editing
Asset: crm:twenty-outreach · Project: twenty-outreach · Date: 2026-11-16 · Stage: Specced
## Build slices
1. Prove IMAP identity, revision, replacement and recovery in isolated provider; integrate server and MCP; C1–C7, C9–C10, C15–C16.
2. Wire and exercise normal Twenty UI editing; C8.
## Sequencing
Slice 1 validates the riskiest provider behavior before UI. Slice 2 depends on slice 1.
## External dependencies
| ID | Dependency | Owner | Gate | Lead time |
|---|---|---|---|---|
| D1 | Twenty v2.58.0 exact source and existing account access controls | Builder | inspected and tested | available |
| D2 | Isolated real IMAP service with no external email delivery | Builder | reproducible integration test | setup required |
## Economics
Reuse self-hosted infrastructure; no new paid dependency.
## Risks
Concurrent modification, partial append/delete, UID reuse, MIME loss, cross-workspace access and unintended sends. Reject uncertain states and require recoverability.
## Verification strategy
Unit: input, identity, attachment semantics, conflict and retry. Integration: real IMAP plus actual provider adapter, failures, permissions and restart. E2E: normal MCP route and Twenty UI with persistence and attachments. Static: type, lint, build. Independent acceptance required for S2. No SMTP or production prospect tests.
## Deployment
The user explicitly authorized merge into the Twenty fork, Netcup deployment and rollback verification on 2026-11-17. Sending emails remains prohibited.
## Manual vs. automated
Repeatable behavior and regression tests belong in versioned code; user reviews actual prospect content.
## Decisions
One-time exception permits private branch implementation without continuity lease. No email sending.
## Assumptions & open questions
- safe-default — if safe provider replacement cannot be proven, keep feature unavailable and report failure.
