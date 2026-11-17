# Application Flow — Twenty draft editing
Asset: crm:twenty-outreach · Project: twenty-outreach · Date: 2026-11-16 · Stage: Specced
## Surfaces
Existing MCP tool discovery and Twenty drafts surface; operator runbook.
## Action contract
| ID | Journey | Actor | Entry and prerequisites | Handler and effect | Success | Failure / continuation | Evidence |
|---|---|---|---|---|---|---|---|
| A1 | J1 | authenticated user | discover and select exact draft with revision | edit tool updates one mailbox draft | new identity and revision | conflict or recovery status; no blind retry | isolated MCP integration pending |
| A2 | J2 | operator | inspect status | recovery / disable | safe original or replacement | explicit manual recovery | failure injection pending |
| A3 | J3 | authenticated user | Twenty draft navigation | edit and save | persisted reopened draft | visible error, no silent overwrite | browser E2E pending |
## Route / screen map
Twenty draft list → existing draft → edit → save → reopened draft. MCP list tools → inspect draft → update → read back.
## User journeys
J1 and J3 modify one chosen draft; J2 resolves a reported partial operation without sending.
## Branch conditions & states
Missing authorization, changed revision, unsupported IMAP capability, malformed file and unavailable provider all stop the update.
## Failure & recovery paths
Explicit recovery instructions must distinguish confirmed original, confirmed new draft and indeterminate status.
## Handoffs
No handoff to SMTP or external recipients.
## Decisions
User forbids sending.
## Assumptions & open questions
- safe-default — no live mailbox test until isolated acceptance and explicit authorization.
