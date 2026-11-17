# Capability Ledger — Twenty draft editing
Asset: crm:twenty-outreach · Project: twenty-outreach · Date: 2026-11-16 · Stage: Specced

## How this was built
Applied API/MCP and internal-tool rosters, universal questions and multi-tenant isolation. Existing account and billing functionality is outside this feature.

## Ledger
| # | Capability (actor + verb) | Class | Disposition | Reason / trigger | Owner | Depends on |
|---|---|---|---|---|---|---|
| C1 | Operator identifies exact existing draft and revision | API | in-slice-1 | Prevent wrong-message update | Builder | D1 |
| C2 | Server enforces workspace and account access | API | in-slice-1 | Protect private mailbox | Builder | C1 |
| C3 | User changes subject and body | API | in-slice-1 | Core job | Builder | C2 |
| C4 | User preserves or explicitly replaces PDF attachments | API | in-slice-1 | Preserve draft contents | Builder | C2 |
| C5 | Server rejects conflicts and unsafe retries | API | in-slice-1 | Avoid duplicate or lost edits | Builder | C1 |
| C6 | Operator resolves interrupted update safely | Internal tool | in-slice-1 | Recovery and diagnostics | Builder | C5 |
| C7 | User invokes edit via MCP | API | in-slice-1 | Codex workflow | Builder | C3, C4, C5 |
| C8 | User edits in Twenty UI | Web app | in-slice-2 | Native user journey | Builder | C7 |
| C9 | Operator disables and rolls back customization | Internal tool | in-slice-1 | Bounded blast radius | Builder | D1 |
| C10 | Operator tests using isolated provider | API | in-slice-1 | Real provider boundary | Builder | D2 |
| C11 | Operator upgrades pinned version safely | Internal tool | later | Trigger next Twenty upgrade | Operator | C9 |
| C12 | User edits drafts in Gmail or Microsoft | API | later | Current request uses IMAP mailbox | Operator | C7 |
| C13 | User sends emails | API | out | Explicitly prohibited | User | C7 |
| C14 | User manages account, billing, deletion or export | Universal | out | Existing Twenty feature, unchanged | Twenty | D1 |
| C15 | Operator handles cost, rate limits, abuse and provider outage | API | in-slice-1 | Bounded failures and no new paid provider | Builder | C2 |
| C16 | Operator documents version, authentication and example | API | in-slice-1 | Usable and maintainable API | Builder | C7 |
| C17 | Operator considers legal terms and data residency | Universal | out | Existing service policies unchanged; no legal decision | User | D1 |

## Coverage
12 in · 3 out · 2 later · 0 blocked · 17 total. These are scope counts, not implementation evidence.

## Journey / action index
| Capability | Journeys | Actions | Disposition | Implementation evidence | Verification evidence |
|---|---|---|---|---|---|
| C1–C7, C10, C15–C16 | J1 | A1 | in-slice-1 | pending | pending |
| C6, C9 | J2 | A2 | in-slice-1 | pending | pending |
| C8 | J3 | A3 | in-slice-2 | pending | pending |

## Decisions
The user authorized implementation, independent acceptance, merge into System-Error-Worldwide/twenty-SE_MOD and Netcup deployment with rollback verification. Sending email is prohibited.

## Assumptions & open questions
- safe-default — implement IMAP first and fail closed on unsupported provider capabilities.
- safe-default — verification uses self-addressed synthetic drafts; no outreach email is sent. Sender and recipient edits are outside this release.
