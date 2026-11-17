# Backend Schema — Twenty draft editing
Asset: crm:twenty-outreach · Project: twenty-outreach · Date: 2026-11-16 · Stage: Specced
## Entity overview
Existing workspace, connected account, mailbox draft, attachment, and operation/revision identity.
## Collections / tables
No database migration assumed; durable operation journal may be necessary if IMAP cannot guarantee recovery. This remains an implementation decision.
## Relations
Draft target is bound to its workspace, connected account and draft folder.
## Access rules
Existing authenticated caller must have access to the workspace and connected account; file references must belong to the same workspace.
## Storage & media
Preserve MIME parts when not explicitly replaced; bound aggregate attachment size; no secrets in logs.
## Migrations
None planned until durable recovery requirements are verified.
## API surface
Discover or inspect draft identity and revision; update explicit fields and attachment policy; return fresh identity or honest failure.
## Data lifecycle
Do not delete old message until safe recovery and replacement are demonstrable; do not global-expunge.
## Decisions
Email sending excluded.
## Assumptions & open questions
- needs-confirmation — exact recovery journal and native provider semantics require integration tests.
