# HireRelay

AI-powered walk-in hiring coordinator. Candidates register (built-in shareable form, or a Google Form synced by **viaSocket**), HR watches a live dashboard, runs the queue, records feedback, and an AI agent — also running on viaSocket — answers questions from live data and prepares reminders that HR approves before **viaSocket** sends them through Gmail.

```
Candidate submits form ─► viaSocket handler ─► POST /api/ingest/google-forms ─► de-dupe + insert (SQLite)
                                                                               │
Dashboard (polls DB) ◄─────────────────────────────────────────────────────────┘
AI agent: live snapshot ─► viaSocket AI (JSON) ─► proposals validated vs real rows ─► Approvals queue
HR approves ─► viaSocket runs Gmail "Send Email" on the user's script_id ─► result logged in workflow_runs
```

**Stack:** React + Tailwind (Vite) · Node + Express · SQLite (node-sqlite3-wasm, one file under `DATA_DIR`) with built-in email/password login · viaSocket (Google Forms trigger, Gmail action, AI, prebuilt integrations UI).

## Run it

```bash
npm install
cp .env.example .env     # optional locally; add VIASOCKET_EMBED_SECRET etc.
npm run dev              # API :8787, web :5173
```

Data lives in `./data/hirerelay.db` (or `DATA_DIR`). Sign up on the login screen; each HR user only sees their own drives and candidates. There is no database to provision.

The app has a **Setup** screen (`/setup`) listing exactly which viaSocket values are set. A feature that needs a missing value stays off and says why — nothing pretends to work.

### viaSocket values
`VIASOCKET_ORG_ID` and `VIASOCKET_PROJECT_ID` are in `.env.example`. `VIASOCKET_EMBED_SECRET` comes from **viaSocket → Integrations → the embed → Install Code**. It is read only by the server and used to sign per-user embed tokens.

`HIRERELAY_PUBLIC_URL` must be reachable from viaSocket's servers (a tunnel in development) because the Google Forms handler calls `POST /api/ingest/google-forms` there. `INGEST_SECRET` is any long random string; per-drive ingest keys are derived from it.

## Design decisions
| Value | Who supplies it |
|---|---|
| Which Google Form feeds a drive | HR, picked once from their own Google account (`list-options`) |
| Gmail "From" address | HR, picked once from their own Gmail addresses |
| Email subject/body | Code templates; the AI agent chooses *whether/who*, never free-writes sends |
| Which action runs | Developer in code (Gmail Send Email for approved emails; Forms New Response trigger for intake); AI only proposes from a closed set (`interview_reminder`, `feedback_reminder`) |

- **No duplicates:** unique indexes on `(drive, email)`, `(drive, phone)`, `(drive, source, response id)`; concurrent submissions resolve to one row.
- **HR state is protected:** a duplicate submission may only fill *empty* profile fields. Stage, queue, interviewer and interview timestamps are written only by HR actions.
- **Approvals:** emails are queued as `pending`; approve is atomic (once), executed through viaSocket, and every attempt is a `workflow_runs` row with the real response or error. Registration confirmations can be switched to auto-send (reminders always need approval).
- **Secrets:** embed secret, `script_id`s and ingest keys never reach the browser. The browser receives an embed token only to open the Connect popup / prebuilt UI.

## Deployed on Embarko
Live at https://hirerelay.embarko.app (one Node process: `npm run build` builds the client, `npm start` serves API + UI). The SQLite file lives in Embarko's `DATA_DIR`, so it survives redeploys; **it is not backed up**. Only `VIASOCKET_EMBED_SECRET` still needs adding in the Embarko environment settings for connecting apps, the AI agent and sending email.

## Tests
`npm test` runs against the real SQLite layer (in memory) and the real signup/login routes, with no mocks. `npm run check:viasocket` validates every viaSocket id/URL in the code against the live catalog.
