> Historical implementation brief: this predates the Supabase/Dropbox dashboard and the Pipecat backend selector. It is retained as project history, not current setup instructions. Use [README.md](README.md), [ADMIN_SETUP.md](ADMIN_SETUP.md) and [PIPECAT_MIGRATION.md](PIPECAT_MIGRATION.md) for the implemented behavior.

# Codex prompt: Voice agent admin dashboard

Work in the existing `voice-agent` Next.js repository. Implement a single-business, admin-only dashboard with two capabilities: (1) edit the voice assistant's business configuration, and (2) upload and list documents in one configured Google Drive folder. Preserve the working voice page and search integration. Implement, verify and document the work, rather than only proposing a plan.

## Project context

The current app uses Next.js App Router, TypeScript, OpenAI Realtime and a server-side rag-wrapper integration. It is hosted on Vercel. The code and project instructions are authoritative; inspect them first and comply with `AGENTS.md`, including its Next.js documentation requirement. The documentation identifies these current integration points, subject to verification against the actual code:

- `app/page.tsx` renders the public voice page.
- `app/api/session/route.ts` creates Realtime client credentials.
- `lib/server.ts` contains session configuration and origin checks.
- `lib/assistant-instructions.ts` combines business settings and the application baseline.
- `app/api/search/route.ts` calls rag-wrapper through server-held credentials.

Existing environment settings include `BUSINESS_NAME`, `AGENT_GREETING`, `AGENT_INSTRUCTIONS`, `OPENAI_API_KEY`, `RAG_WRAPPER_URL`, and `RAG_WRAPPER_API_KEY`. The Realtime instructions and tool results can be inspected or altered by the browser client, so instructions are behavioral guidance, not enforceable authorization.

## Scope and admin experience

Add a simple, responsive dashboard with:

1. **Assistant settings:** edit and save business name, greeting, tone, business-specific instructions and human-support contact details. Provide explicit save feedback, validation, loading and error states. Do not place private credentials in instructions. Existing baseline protections and server tool permissions remain application-controlled.
2. **Documents:** select a supported file, upload it to a preconfigured Google Drive folder, and list files in that folder with name and upload/modified date where available. Clearly say `Uploaded to Drive` and that search availability is not yet tracked. A failed upload should show an understandable retryable error. Prevent accidental duplicate submissions in the interface.
3. **Authentication:** sign-in and sign-out for one administrator; protect the dashboard and every read/write endpoint independently on the server. Use an established, maintained authentication/session solution appropriate for Next.js and Vercel. Provision the admin securely through an explicit documented process; no public sign-up, hard-coded credentials, plaintext passwords, or unauthenticated first-user creation. Include session expiry, secure HTTP-only same-site cookies, CSRF/origin protection for mutations, and rate limiting appropriate to the deployment (or document and enforce hosting-level protection if a distributed limiter is not available). Do not treat the existing origin check as authentication. Fail closed when authentication configuration is missing.

Use a restrained, professional interface with clear labels, keyboard access, mobile responsiveness and accessible error/status messages. Do not add analytics, a multi-tenant dashboard, conversation recording, billing, or an ingestion-status feature.

## Configuration and voice integration

- Persist the business settings in PostgreSQL, using a small explicit migration and a scoped database role. A separate schema/table in the existing PostgreSQL instance is acceptable if it is reachable from the Vercel server and the operator chooses to configure it. Do not assume a private Render database address is reachable from Vercel. Explain the connection options, costs/constraints and how to configure a secure reachable database without exposing credentials. Do not alter existing vector tables or ingestion data.
- Read saved configuration on the server when a new voice session is created; changes take effect for new sessions without a code change or redeploy. Existing sessions keep their settings. Where appropriate, make the public page's displayed business name match the saved configuration.
- Preserve `ASSISTANT_BASELINE` and existing privacy, truthful action reporting, and `search_knowledge` behavior. Clearly document precedence and the limitation that browser-side Realtime instructions are not a security boundary.
- Provide a deliberate initialization strategy: before the first saved configuration, use existing environment settings as defaults or seed them explicitly, without overwriting existing data. If a configured database is unavailable, surface a clear error rather than silently serving stale/default settings; define and document the initial no-database behavior. Validate lengths, supported tone values and contact fields, and allow safe multiline prompts. Use parameterized queries.

## Google Drive upload

- Implement server-side Google Drive integration for one server-configured folder ID. Select a suitable authentication method for a server deployment, use least-privilege access, and document exact setup and limitations: enable Drive API, credentials, folder access/sharing, OAuth/service-account choice and storage ownership/quota constraints. Do not assume a service account can upload to an arbitrary My Drive folder: verify the selected arrangement; if a shared drive or OAuth user account is required, give workable setup instructions. Never expose credentials to the browser or commit secret files. Do not use the user's personal connected ChatGPT Drive session.
- Use server-side folder selection, never a browser-supplied folder ID. Keep a stable returned Drive file ID for each uploaded file so the existing workflow can use it as `source_id`. Do not overwrite files silently; for now create new files and document duplicates and later replacement behavior.
- Accept only file formats supported by the current ingestion service (PDF, DOCX, TXT, MD, TEXT, CSV and JSON), with configurable safe server-side size limits and content/type checks. Use an authenticated API with bounded bodies and safe errors. Account for Vercel function request-size limits: choose an upload approach that actually works on the selected hosting plan, enforce/document the supported maximum, and explain an alternative if larger files are needed. Do not claim arbitrary-sized uploads work.
- List only files in the configured folder, with pagination or a clearly stated bounded list. Never put Google credentials, API keys or file contents in logs. Use a storage integration module so Drive can be replaced later.
- The existing n8n workflow is responsible for detecting uploads and ingestion. Do not edit it, call the ingestion API, implement status callbacks, or delete files/vectors. Verify from existing workflow configuration whether this folder is actually monitored; if unavailable, state the check is still required. A Drive upload must never be presented as successful ingestion.

## Security and operational requirements

Use server-side access control on every dashboard operation. Use proper escaping/validation, protect against CSRF and unsafe redirects, avoid exposing secrets in error messages, and keep data out of logs. Credentials belong in server-only environment variables. Add `.env.example` entries with placeholders and update `.gitignore` as needed. Do not request real secrets in chat or tests. Note that public voice routes also need authentication/quotas before commercial use; do not claim the dashboard login alone protects those routes.

Use the project's existing package manager and conventions. Keep dependencies modest and compatible with the installed Next.js version. Do not deploy, change live databases or Drive contents, or commit secrets. Supply migrations for review, not automatic destructive changes. Include clear Windows PowerShell local setup and Vercel configuration instructions, including database connectivity, admin provisioning, Google Drive access, and the folder used by n8n.

## Verification and delivery

Add focused tests using mocks for authorization, sign-out/session expiry as applicable, settings validation and persistence, baseline prompt assembly, a new session receiving saved settings, unauthorized API calls, file validation, server-selected Drive folder, successful/failed uploads and clear uploaded-only status. Preserve existing tests. Run `npm run test`, `npm run typecheck`, `npm run lint` and `npm run build` when available; fix failures. Where credentials or external services are unavailable, run mocked tests and explicitly label PostgreSQL, Drive, Vercel and microphone integration as unverified.

Provide a manual end-to-end checklist: sign in; update settings; start a new voice session and verify behavior; upload a small supported file; confirm it appears in the intended Drive folder; verify n8n detects it separately; verify unauthorized access is denied. Explain how to apply and roll back the database migration without touching vector data. Report changed files, actual test results, configuration steps, limitations, and any blocked checks.
