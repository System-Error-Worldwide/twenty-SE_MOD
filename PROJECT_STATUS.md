# Twenty SE modifications

Updated 2026-11-17. State: candidate awaiting independent acceptance and live deployment.

The maintained default branch is `se/v2.58`, pinned to the installed upstream v2.58.0 revision. Upstream `main` is retained. Native Save draft and authenticated MCP draft editing are integrated into the source and Docker packaging. The extension supports subject/body changes, preserving or adding PDF files, and MCP attachment replacement/removal. Sender and recipient changes are outside this release. No emails may be sent during verification.

The candidate includes guarded mailbox replacement, durable operation recovery, CRM text refresh, the existing AgentChat PDF attachment compatibility fix and timeline import target filtering. Release scripts preserve container-bound originals and support interrupted-install recovery and baseline startup.

Builder evidence: focused unit tests; real isolated IMAP and PostgreSQL; authenticated isolated Twenty MCP PDF replacement/addition, stale-edit rejection and CRM text persistence; full minified frontend build and earlier real-browser Save draft using identical frontend inputs. The full monorepo typecheck exceeded its bounded memory allowance. These checks are not independent acceptance.

Continuity route and normal preflight are active. Run: `twenty-draft-edit-acceptance-20261117`. Production has not yet received this candidate. A fresh encrypted backup completed as `twenty-20261117T022502Z`; prior restic integrity checking passed. Final work: independent exact-candidate acceptance, PR merge, guarded Netcup rollout, live Save draft verification and live rollback/reinstall.
