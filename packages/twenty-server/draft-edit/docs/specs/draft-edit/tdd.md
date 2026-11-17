# Technical Design — Twenty draft editing
Asset: crm:twenty-outreach · Project: twenty-outreach · Date: 2026-11-16 · Stage: Specced
## Architecture
Extend the v2.58.0 server tool registry and outbound mailbox layer; expose through MCP and Twenty. Preserve existing paths. IMAP lacks an in-place message update; provider-specific replacement requires safe identity and recovery.
## Stack
Reuse Twenty's TypeScript, NestJS, imapflow and existing MIME/file services; no new hosting or provider.
## Key technical decisions
Target by workspace/account, folder, UIDVALIDITY, UID and content revision. Inspect actual server capabilities before choosing replace operation; do not use global EXPUNGE. Explicitly separate omitted attachments from replacement. Reject any unprovable atomicity or conflicting revision.
## Non-functional requirements
Bound attachment sizes and timeouts, prevent duplicate retries, and avoid logging message bodies or credentials.
## Security & compliance
Enforce existing authenticated user and workspace/account ownership at the server, validate file ownership and allowed paths, preserve user-controlled data.
## State, API, and journey linkage
J1/A1 calls edit tool with target, revision and changes; success returns new identity and revision, conflict returns no success. J2/A2 handles incomplete operations. J3/A3 edits via existing UI.
## Integrations
Real isolated IMAP provider and normal Twenty tool routing. Never invoke SMTP.
## Observability & ops
Record non-sensitive result states, no body or credentials. Disable custom feature and retain original image for rollback.
## Decisions
User authorized private implementation and no sending.
## Assumptions & open questions
- needs-confirmation — provider capabilities and whether atomic replacement can be guaranteed remain unverified.
