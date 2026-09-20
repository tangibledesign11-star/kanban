# Kan Local Mode Implementation Report: Zero-Service Authentication

## 1. Executive Summary

This report documents the implementation and verification of Kan's standalone local mode with **embedded PGlite** and **zero-external-service authentication**.

With this configuration:
- A developer or self-hoster starts Kan with only `pnpm dev`.
- Kan connects to an in-process, embedded PostgreSQL instance (`@electric-sql/pglite`) without Docker, external PostgreSQL, SMTP, Redis, S3, or OAuth.
- Users can visit `/signup`, register an account with **Name + Email + Password**, immediately receive an authenticated session, create their first workspace, create boards, lists, and cards, and log back in after restarting the server.
- The external PostgreSQL connection path (`POSTGRES_URL`), OAuth providers, and cloud functionality remain 100% functional and intact.

---

## 2. Root Cause Analysis of Previous Observations

During manual testing, several friction points were observed:

### Observation 1: "No authentication methods are currently available" on `/signup`
- **Cause**: In `apps/web/src/components/AuthForm.tsx`, `NEXT_PUBLIC_ALLOW_CREDENTIALS` was unset, disabling email/password authentication. For non-cloud environments, magic link signup is explicitly disallowed (`isMagicLinkAvailable = isCloudEnv || (isEmailSendingEnabled && !isSignUp)`), and no OAuth providers were configured. As a result, zero authentication methods were available to the user.
- **Fix**: Set `NEXT_PUBLIC_ALLOW_CREDENTIALS=true`, which activates the existing Better Auth `emailAndPassword` handler and renders the name, email, and password registration form.

### Observation 2: "Invalid origin" on authentication requests
- **Cause**: In the local environment, the dev server naturally listened on `http://localhost:3000` (Next.js default), but the untracked `.env` file had `NEXT_PUBLIC_BASE_URL=http://localhost:3002`. Better Auth compares the incoming HTTP `Origin` header (`http://localhost:3000`) against `baseURL` and `trustedOrigins`. Because of the port discrepancy (3000 vs 3002), Better Auth threw `APIError: FORBIDDEN: Invalid origin`.
- **Fix**: 
  1. Aligned the source of truth in `.env`: `NEXT_PUBLIC_BASE_URL=http://localhost:3000` (matching the actual server port and documented standard).
  2. Updated `packages/auth/src/auth.ts` so that in development mode (`NODE_ENV !== "production"`), `trustedOrigins` includes `http://localhost:*` and `http://127.0.0.1:*`, and `baseURL` falls back safely to `http://localhost:${process.env.PORT || "3000"}` if unset. This prevents origin rejection across local ports while maintaining strict origin enforcement in production.

### Observation 3: Magic Link Attempt Without SMTP
- **Cause**: Magic links inherently require an external email transport to deliver login tokens to the user's inbox. Without SMTP configured, `nodemailer` fails to send.
- **Resolution**: Under zero-service local mode, email/password credential authentication is the intended, functional authentication mechanism. Magic Link remains untouched for environments that provide SMTP credentials.

---

## 3. Files Changed

| File | Changes Made |
| :--- | :--- |
| `packages/auth/src/auth.ts` | Added development mode origin fallback for `baseURL` (`http://localhost:${PORT \|\| 3000}`) and added `["http://localhost:*", "http://127.0.0.1:*"]` to `trustedOrigins` in development. Preserved strict configuration for production. |
| `.env` | Aligned `NEXT_PUBLIC_BASE_URL` to `http://localhost:3000`; set `NEXT_PUBLIC_ALLOW_CREDENTIALS=true`; commented out `POSTGRES_URL` so embedded PGlite is used; cleaned up unneeded external service variables. |
| `.env.example` | Clarified database and credential settings (`NEXT_PUBLIC_ALLOW_CREDENTIALS=true`) for standalone zero-service local setup. |
| `PGLITE_LOCAL_SETUP.md` | Updated setup guide to document the 3 minimum required environment variables for local operation. |
| `packages/api/integration-tests/local-auth.integration.test.ts` | Added automated integration test suite covering credential signup, password hashing, credential login, session verification via cookies, workspace creation, board creation, list creation, and card creation. |

---

## 4. Minimum Required Local Configuration

To run Kan completely locally with zero external services, only **3 variables** are required in `.env`:

```env
# 1. Base URL of the application
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# 2. Secret key for Better Auth session signing (32+ chars)
BETTER_AUTH_SECRET=gUNCOYFeIWzlSOGmKdvfrDObmeUWpiFM

# 3. Enable email/password authentication without SMTP/OAuth
NEXT_PUBLIC_ALLOW_CREDENTIALS=true

# LEAVE POSTGRES_URL UNSET FOR EMBEDDED PGLITE:
# POSTGRES_URL=
```

No other services or credentials are required:
- **No `POSTGRES_URL`**: Kan boots embedded PGlite in `./pgdata`.
- **No SMTP (`SMTP_HOST`, `SMTP_PORT`, etc.)**: Account creation and login do not require email verification.
- **No OAuth credentials**: Social logins remain disabled with zero errors.
- **No Redis (`REDIS_URL`)**: Rate limiting automatically falls back to in-memory storage.
- **No S3 (`S3_ENDPOINT`, `S3_ACCESS_KEY_ID`)**: Local mode works without external object storage.

---

## 5. End-to-End Verification Results

### A. Automated Integration Tests
1. **`local-auth.integration.test.ts`**:
   - Initialized in-memory PGlite with all 35 schema migrations.
   - User sign-up via `auth.api.signUpEmail`: verified user creation and `scrypt` password hashing in `account` table.
   - User login via `auth.api.signInEmail`: verified session issuance and session cookies.
   - Session validation via `auth.api.getSession`: confirmed session retrieval.
   - Workspace creation via `workspaceRepo.create`: verified workspace admin membership.
   - Board, List, and Card creation: verified full relational integrity.
   - **Result**: **Passed (1/1)**.
2. **Full Repository Test Suite**:
   - Total Vitest tests: **87 passed** (79 `@kan/api` + 8 `@kan/auth`).

### B. Clean 12-Step Live Verification Against Running Server
Executed against a fresh Next.js dev server with deleted `./pgdata`:

| Step | Action | Endpoint / Operation | Result |
| :---: | :--- | :--- | :---: |
| **1** | Open local URL | `GET /login`, `GET /signup` | **200 OK** |
| **2** | Sign up with credentials | `POST /api/auth/sign-up/email` | **200 OK** (User created, session cookie set) |
| **3** | Confirm authenticated session | `GET /api/auth/get-session` | **200 OK** (Active session for user) |
| **4** | Create initial workspace | `POST /api/trpc/workspace.create` | **200 OK** (Created "My Local Studio", publicId: `gzirph4vub7l`) |
| **5** | Create board in workspace | `POST /api/trpc/board.create` | **200 OK** (Created "Product Roadmap", publicId: `w22l3v7vrbau`) |
| **6** | Create list in board | `POST /api/trpc/list.create` | **200 OK** (Created "In Progress", publicId: `y7betzo0yqdu`) |
| **7** | Create card in list | `POST /api/trpc/card.create` | **200 OK** (Created "Implement Local Auth", publicId: `vs6ayizv64c5`) |
| **8/9** | Stop Kan | Terminated server process | Server shut down cleanly |
| **10** | Restart Kan | Started fresh Next.js dev server | Reopened `./pgdata` on disk |
| **11** | Log in again | `POST /api/auth/sign-in/email` | **200 OK** (Logged in as `e2e.user@kan.local`) |
| **12** | Verify persisted entities | `GET /api/trpc/workspace.all`, `board.all` | **200 OK** (Workspace "My Local Studio", Board "Product Roadmap", lists, and cards verified) |

---

## 6. Limitations & Considerations

1. **Password Resets**:
   In local zero-service mode without SMTP, password resets via email cannot be dispatched to an external inbox. Users must know their password or reset the local database by removing `./pgdata`.
2. **File Attachments / S3**:
   Card attachments require S3 or S3-compatible storage (MinIO). In local mode without S3 configured, card descriptions, checklists, comments, and labels function fully, but uploading file attachments will fail.
3. **Single Process Architecture**:
   Embedded PGlite is file-backed and single-process. Running multiple concurrent Next.js dev server processes against the same `./pgdata` folder will result in file lock conflicts.
