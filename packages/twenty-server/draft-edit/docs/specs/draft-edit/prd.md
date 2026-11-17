# Product Requirements — Twenty draft editing
Asset: crm:twenty-outreach · Project: twenty-outreach · Date: 2026-11-16 · Stage: Specced

## Problem
Existing outreach drafts need updates to personalized copy and PDFs. Twenty's existing MCP draft tool creates another mailbox draft rather than editing the original.
## Users & jobs
Moses uses Twenty and Codex to revise an existing outreach draft and review it before any sending.
## Scope
### IN — the MVP slice
C1–C10, C15–C16: identify, authorize, edit, recover, test, expose in MCP and Twenty.
### OUT — explicit non-goals
C13–C14, C17: sending, account administration and legal decisions.
### LATER
C11–C12: upgrades and non-IMAP providers.
## Requirements
R1: An authorized user selects one exact draft and expected revision. R2: Omitted fields and attachments remain intact; explicit replacements are reflected. R3: Conflict or ambiguous state fails without deleting an unrelated message. R4: no code path sends mail. R5: expose a documented MCP action and a Twenty editing journey. R6: report recoverable partial failure honestly.
## Journey inventory
| J-ID | Actor | Outcome | Entry / discovery | Capabilities | Completion criteria | Readiness gate |
|---|---|---|---|---|---|---|
| J1 | User | Revise exact draft | MCP tool discovery | C1–C7, C10, C15–C16 | One correct revised draft with attachment | slice |
| J2 | Operator | Recover or disable | Operational runbook | C6, C9 | Original recoverable, honest outcome | slice |
| J3 | User | Edit in Twenty | Normal draft navigation | C8 | Saved and reopened edit | internal-test |
## Journey outcomes & readiness
Slice requires J1 and J2 with independent checks. Internal test requires J1–J3. Beta and public release are out of scope.
## Success metrics
One correct draft after editing and zero sends in isolated tests.
## Constraints
Twenty v2.58.0; existing IMAP account; no paid service and no SMTP sends.
## Decisions
User explicitly forbids sending.
## Assumptions & open questions
- safe-default — existing provider functionality must be established before live use.
