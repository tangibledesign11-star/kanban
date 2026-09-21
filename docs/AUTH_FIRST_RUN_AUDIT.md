# Kan First-Run Authentication Audit

This document presents a comprehensive audit of Kan's authentication system, first-run user experience, and architecture for local/self-hosted deployment.

---

## 1. Executive Summary

Kan is designed as an open-source alternative to Trello, built with Next.js (Pages Router), tRPC, Drizzle ORM, and [Better Auth](https://better-auth.com).

### Key Findings

1. **Password Authentication Already Exists**: Username/email + password authentication is **already fully implemented** in both the backend ([`packages/auth/src/auth.ts`](packages/auth/src/auth.ts#L34-L46)) and frontend ([`apps/web/src/components/AuthForm.tsx`](apps/web/src/components/AuthForm.tsx#L208-L244)). It is not missing; it is simply disabled by default behind an unconfigured environment variable: `NEXT_PUBLIC_ALLOW_CREDENTIALS`.
2. **Why "No Authentication Methods Are Currently Available" Appears**:
   - `NEXT_PUBLIC_ALLOW_CREDENTIALS` is unset, so email/password is disabled.
   - All OAuth providers (Google, GitHub, Discord, OIDC, etc.) are unconfigured because no client IDs/secrets are set.
   - On the sign-up page (`/signup`), magic-link registration is **hardcoded to be disabled** for non-cloud instances: [`AuthForm.tsx`](apps/web/src/components/AuthForm.tsx#L311-L313) defines `isMagicLinkAvailable = isCloudEnv || (isEmailSendingEnabled && !isSignUp)`. Because `isSignUp` is `true`, `isMagicLinkAvailable` evaluates to `false`.
   - With credentials disabled, magic links disabled on sign up, and zero OAuth providers configured, the condition `!(isCredentialsEnabled || isMagicLinkAvailable) && socialProviders?.length === 0` evaluates to `true`, rendering: *"No authentication methods are currently available"*.
3. **No External SaaS Is Strictly Required for Auth**:
   - When email + password authentication is enabled, **zero external services** (no SMTP, Resend, SendGrid, OAuth, S3, Stripe, Novu, or Redis) are needed to sign up, log in, or create/manage workspaces.
   - Better Auth does not enforce email verification for credential accounts unless explicitly instructed, and Kan's backend authorization ([`packages/api/src/trpc.ts`](packages/api/src/trpc.ts#L211-L219)) only verifies that a valid user session exists, not that `emailVerified` is `true`.
4. **First-Run / Setup Wizard**:
   - Kan has **no concept of a first-run wizard, setup screen, or bootstrap admin account**.
   - There is no global system administrator role in the database. Roles (`admin`, `member`, `guest`) exist exclusively at the workspace level.
   - The first user to register simply registers as a standard user, and upon first arriving at `/boards`, the frontend automatically displays the modal to create their initial workspace, making them the `admin` of that workspace.
5. **Docker / PostgreSQL Dependency**:
   - The codebase already contains an embedded in-process database fallback via `@electric-sql/pglite` in [`packages/db/src/client.ts`](packages/db/src/client.ts#L22-L34).
   - However, running completely without Docker and without an external PostgreSQL instance is currently blocked by two specific bugs in `client.ts`: missing the `pg_trgm` extension registration and lack of a singleton database client.

---

## 2. Why "No login methods available" appears

### The Exact Code Responsible

The message displayed is defined in [`apps/web/src/components/AuthForm.tsx`](apps/web/src/components/AuthForm.tsx#L369-L378):

```tsx
// apps/web/src/components/AuthForm.tsx:369-378
{!(isCredentialsEnabled || isMagicLinkAvailable) &&
  socialProviders?.length === 0 && (
    <div className="flex w-full items-center gap-4">
      <div className="h-[1px] w-1/3 bg-light-600 dark:bg-dark-600" />
      <span className="text-center text-sm text-light-900 dark:text-dark-900">
        {t`No authentication methods are currently available`}
      </span>
      <div className="h-[1px] w-1/3 bg-light-600 dark:bg-dark-600" />
    </div>
  )}
```

### Analysis of the Condition

The banner renders when all three conditions are met:
1. `!isCredentialsEnabled`
2. `!isMagicLinkAvailable`
3. `socialProviders?.length === 0`

Here is how each variable evaluates on a fresh local instance:

#### 1. `isCredentialsEnabled`
```tsx
// apps/web/src/components/AuthForm.tsx:177-178
const credentialsAllowed =
  env("NEXT_PUBLIC_ALLOW_CREDENTIALS")?.toLowerCase() === "true";
```
In a default `.env.example` or fresh setup, `NEXT_PUBLIC_ALLOW_CREDENTIALS` is blank or unset. Thus, `isCredentialsEnabled = false`.

#### 2. `isMagicLinkAvailable`
```tsx
// apps/web/src/components/AuthForm.tsx:311-313
const isMagicLinkAvailable = useMemo(() => {
  return isCloudEnv || (isEmailSendingEnabled && !isSignUp);
}, [isCloudEnv, isEmailSendingEnabled, isSignUp]);
```
- `isCloudEnv`: Evaluates `env("NEXT_PUBLIC_KAN_ENV") === "cloud"`. In a local self-hosted instance, this is `false`.
- `isSignUp`:
  - When visiting `/signup` ([`apps/web/src/views/auth/signup/index.tsx`](apps/web/src/views/auth/signup/index.tsx#L85)), `<Auth ... isSignUp />` passes `isSignUp = true`.
  - Therefore, `!isSignUp` is `false`.
  - As a result, `isMagicLinkAvailable` evaluates to `false || (isEmailSendingEnabled && false) === false`.
  - **Magic link is explicitly prohibited from being an available sign-up method on self-hosted instances.**
- When visiting `/login`:
  - If the administrator set `NEXT_PUBLIC_DISABLE_EMAIL=true` (which is intuitive when running without SMTP), `isEmailSendingEnabled` evaluates to `false`.
  - Therefore, on `/login`, `isMagicLinkAvailable` also evaluates to `false`.

#### 3. `socialProviders?.length === 0`
```tsx
// apps/web/src/components/AuthForm.tsx:196-199
const { data: socialProviders } = useQuery({
  queryKey: ["social_providers"],
  queryFn: () => authClient.getSocialProviders(),
});
```
In [`packages/auth/src/providers.ts`](packages/auth/src/providers.ts#L20-L25), `configuredProviders` checks environment variables for 19 OAuth providers (e.g., `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, etc.). If none are set, `configuredProviders` is `{}` and `/social-providers` returns `[]`.

### Result Summary

| Route | `NEXT_PUBLIC_ALLOW_CREDENTIALS` | `NEXT_PUBLIC_DISABLE_EMAIL` | Resulting UI |
|---|---|---|---|
| `/signup` | Unset / `false` | Any | **"No authentication methods are currently available"** |
| `/login` | Unset / `false` | `true` | **"No authentication methods are currently available"** |
| `/login` | Unset / `false` | Unset / `false` | Shows "Continue with magic link" input, but submitting fails or hangs because SMTP is unconfigured. |

---

## 3. Existing Authentication Methods

All authentication logic is centralized in [`packages/auth/`](packages/auth/). Better Auth is initialized in [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts).

```
packages/auth/
├── src/
│   ├── auth.ts        # betterAuth({ ... }) configuration
│   ├── client.ts      # createAuthClient({ ... }) for frontend React
│   ├── hooks.ts       # Database hooks (user.create.before/after) & middleware
│   ├── plugins.ts     # Magic Link, API Key, Stripe, Generic OIDC plugins
│   ├── providers.ts   # Social OAuth provider registry
│   ├── server.ts      # initAuth export
│   └── utils.ts       # Avatar downloading and Novu triggers
```

### 1. Email + Password (`emailAndPassword`)
- **Status**: **Fully implemented.**
- **File**: [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts#L34-L46)
- **Configuration**:
  ```ts
  emailAndPassword: {
    enabled: env("NEXT_PUBLIC_ALLOW_CREDENTIALS")?.toLowerCase() === "true",
    disableSignUp: false,
    sendResetPassword: async (data) => {
      await sendEmail(data.user.email, "Reset Password", "RESET_PASSWORD", {
        resetPasswordUrl: data.url,
        resetPasswordToken: data.token,
      });
    },
  },
  ```
- **Password Storage**: Stored as a hashed password in the `account` table ([`packages/db/src/schema/auth.ts`](packages/db/src/schema/auth.ts#L40)) with `providerId = "credential"`. Better Auth uses `scrypt` hashing by default.
- **Email Verification**: **Not enforced.** Better Auth's `requireEmailVerification` flag is not set. A newly signed-up user can log in immediately with no email verification step.

### 2. Magic Link (`magicLink`)
- **Status**: Implemented via Better Auth plugin, but strictly dependent on email infrastructure.
- **File**: [`packages/auth/src/plugins.ts`](packages/auth/src/plugins.ts#L194-L265)
- **Token Generation**: Better Auth generates an encrypted token and stores it in the `verification` table ([`packages/db/src/schema/auth.ts`](packages/db/src/schema/auth.ts#L45-L52)).
- **Dispatch**: Delegates to [`packages/email/src/sendEmail.tsx`](packages/email/src/sendEmail.tsx) via `nodemailer`.
- **UI Availability**: Intentionally suppressed on `/signup` for non-cloud instances.

### 3. Social OAuth Providers (`socialProviders`)
- **Status**: Implemented for 18 providers.
- **File**: [`packages/auth/src/providers.ts`](packages/auth/src/providers.ts#L4-L81)
- **Supported Providers**: Google, GitHub, Discord, Apple, Microsoft, Facebook, Spotify, Twitch, Twitter, Dropbox, LinkedIn, GitLab, TikTok, Reddit, Roblox, VK, Kick, Zoom.
- **Behavior**: Auto-discovered at runtime if both `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET` exist in the environment.

### 4. Enterprise OIDC (`genericOAuth`)
- **Status**: Implemented.
- **File**: [`packages/auth/src/plugins.ts`](packages/auth/src/plugins.ts#L266-L315)
- **Controlled by**: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_DISCOVERY_URL`.

### 5. API Keys (`apiKey`)
- **Status**: Implemented for machine-to-machine authentication.
- **File**: [`packages/auth/src/plugins.ts`](packages/auth/src/plugins.ts#L179-L193)
- **Table**: `apiKey` in [`packages/db/src/schema/auth.ts`](packages/db/src/schema/auth.ts#L54-L79).

---

## 4. Signup Flow

Here is the exact end-to-end execution path when a user creates an account:

```
[Browser: /signup]
       │
       ▼
AuthForm.tsx ──(authClient.signUp.email)──► POST /api/auth/sign-up/email
                                                   │
                                                   ▼
                                      [apps/web/pages/api/auth/[...all].ts]
                                                   │
                                                   ▼
                                      Better Auth: user.create.before hook
                                        (packages/auth/src/hooks.ts)
                                                   │
                                                   ▼
                                      Database Inserts:
                                        1. user (id, email, name, emailVerified: false)
                                        2. account (userId, providerId: "credential", password: hash)
                                        3. session (userId, token, expiresAt)
                                                   │
                                                   ▼
                                      Better Auth: user.create.after hook
                                        - S3 Avatar: skipped (no image)
                                        - Novu: skipped (notificationClient is null)
                                                   │
                                                   ▼
                                      HTTP 200 + kan_session_token cookie
                                                   │
                                                   ▼
[Browser] ──(router.push("/boards"))──► Dashboard.tsx
                                                   │
                                                   ▼
                                      availableWorkspaces.length === 0
                                                   │
                                                   ▼
                                      openModal("NEW_WORKSPACE")
```

### Trace Details:

1. **Frontend Request**:
   In [`apps/web/src/components/AuthForm.tsx`](apps/web/src/components/AuthForm.tsx#L209-L226):
   ```tsx
   await authClient.signUp.email({
     name,
     email,
     password,
     callbackURL: "/boards",
   });
   ```
2. **Endpoint Execution**:
   Sent to `/api/auth/sign-up/email`. In [`apps/web/src/pages/api/auth/[...all].ts`](apps/web/src/pages/api/auth/[...all].ts), requests are handled by Better Auth's handler wrapped in `withRateLimit`.
3. **Pre-Creation Database Hook**:
   [`packages/auth/src/hooks.ts`](packages/auth/src/hooks.ts#L31-L57) executes `user.create.before`:
   - Checks `NEXT_PUBLIC_DISABLE_SIGN_UP`. If not `"true"`, passes.
   - Checks `BETTER_AUTH_ALLOWED_DOMAINS`. If unset, passes.
   - Returns `true`.
4. **Database Insertion**:
   - Better Auth generates a UUID for the user.
   - Hashes password using `scrypt`.
   - Inserts row into `user` table ([`packages/db/src/schema/users.ts`](packages/db/src/schema/users.ts#L18-L30)).
   - Inserts row into `account` table ([`packages/db/src/schema/auth.ts`](packages/db/src/schema/auth.ts#L27-L43)).
   - Creates an active session row in `session` table ([`packages/db/src/schema/auth.ts`](packages/db/src/schema/auth.ts#L14-L25)).
5. **Post-Creation Database Hook**:
   [`packages/auth/src/hooks.ts`](packages/auth/src/hooks.ts#L58-L146) executes `user.create.after`:
   - Avatar S3 upload: skipped because `user.image` is undefined.
   - Novu notification: skipped because [`notificationClient`](packages/email/src/notificationClient.tsx#L3-L6) is `null` when `NEXT_PUBLIC_KAN_ENV !== "cloud"`.
6. **No Emails Dispatched**:
   Because `requireEmailVerification` is not set and `sendResetPassword` only triggers on password reset requests, **no email is sent during sign up**.
7. **Session Cookie**:
   Better Auth returns `200 OK` with `Set-Cookie: kan_session_token=...`.
8. **Redirect**:
   Frontend detects `data?.user.id` in [`apps/web/src/views/auth/signup/index.tsx`](apps/web/src/views/auth/signup/index.tsx#L24) and redirects to `/boards`.

---

## 5. Login Flow

### 1. Credential Login Path
1. In `AuthForm.tsx`, user enters Email and Password, clicks "Continue with email".
2. Calls `authClient.signIn.email({ email, password, callbackURL })`.
3. Better Auth verifies the hash against `account.password` where `providerId = "credential"` and `userId = user.id`.
4. If valid, Better Auth creates a new session in `session` table and issues the session cookie.
5. User is redirected to `/boards`.

### 2. Magic Link Login Path (Login Only)
1. User enters Email and leaves Password empty.
2. Calls `authClient.signIn.magicLink({ email, callbackURL })`.
3. Better Auth creates a token in `verification` table.
4. Triggers `sendMagicLink` in [`packages/auth/src/plugins.ts`](packages/auth/src/plugins.ts#L196-L264).
5. Calls `sendEmail(email, "Sign in to Kan", "MAGIC_LINK", { magicLoginUrl: url })`.
6. [`packages/email/src/sendEmail.tsx`](packages/email/src/sendEmail.tsx) invokes `nodemailer.sendMail(...)`.
7. **If SMTP is not configured, this throws an error and no email is sent.**

### 3. Session Validation & Route Protection
- **Middleware**: [`apps/web/src/middleware.ts`](apps/web/src/middleware.ts#L5-L14) only intercepts the root path `"/"`. If `NEXT_PUBLIC_KAN_ENV !== "cloud"`, it redirects `"/"` to `"/login"`. It does **not** protect `/boards` or any other page.
- **Page Layout**: [`apps/web/src/components/Dashboard.tsx`](apps/web/src/components/Dashboard.tsx#L57-L63) calls `authClient.useSession()` and queries `api.user.getUser`.
- **API Guard**: [`packages/api/src/trpc.ts`](packages/api/src/trpc.ts#L211-L219) protects all sensitive procedures via `enforceUserIsAuthed`:
  ```ts
  const enforceUserIsAuthed = t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({ ctx });
  });
  ```
- **Client Auto-Redirect**: If an unauthenticated user loads a protected page, tRPC procedures return `UNAUTHORIZED`. The tRPC link in [`apps/web/src/utils/api.ts`](apps/web/src/utils/api.ts#L26-L28) catches this and redirects the browser:
  ```ts
  if (typeof window !== "undefined" && err.message === "UNAUTHORIZED") {
    window.location.href = "/login";
  }
  ```

---

## 6. Magic-Link Requirements

### What Infrastructure Magic Links Require

1. **Database Table**: Better Auth stores the verification token hash, identifier (email), and expiration timestamp in the `verification` table ([`packages/db/src/schema/auth.ts`](packages/db/src/schema/auth.ts#L45-L52)).
2. **Email Delivery Provider**: Magic-link authentication fundamentally relies on out-of-band communication:
   - Better Auth generates a single-use token embedded in a URL: `http://localhost:3000/api/auth/magic-link/verify?token=<token>&callbackURL=<url>`.
   - The user must receive this URL to prove control of the email address.
   - Kan implements this dispatch exclusively through [`packages/email/src/sendEmail.tsx`](packages/email/src/sendEmail.tsx#L21-L42), which creates a `nodemailer` transport connected to `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD`.
3. **Why It Requires an Email Provider**:
   - The codebase has **no alternative delivery mechanism** (such as logging the magic link to the terminal in development, displaying the link in a modal, or writing it to a local file).
   - If `SMTP_HOST` is unset, `nodemailer` fails to send, meaning the user can never receive the login link.
4. **Why Magic Link Is Ineffective for First-Run Sign Up**:
   - In [`AuthForm.tsx`](apps/web/src/components/AuthForm.tsx#L311), `isMagicLinkAvailable` is explicitly coded to `false` when `isSignUp` is `true` unless `NEXT_PUBLIC_KAN_ENV === "cloud"`. Even with working SMTP, magic-link signup is disabled in the self-hosted frontend.

---

## 7. OAuth Requirements

### Is OAuth Optional or Required?
**OAuth is 100% optional.**

Kan is designed to operate completely without OAuth. If no OAuth environment variables are provided:
1. [`packages/auth/src/providers.ts`](packages/auth/src/providers.ts#L4-L25) builds an empty `configuredProviders` map.
2. The `/api/auth/social-providers` endpoint returns an empty array `[]`.
3. The frontend hides all "Continue with <Provider>" buttons.
4. The generic OIDC plugin in [`packages/auth/src/plugins.ts`](packages/auth/src/plugins.ts#L266-L315) is conditionally instantiated only when `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_DISCOVERY_URL` are all present.

### Environment Variables Controlling OAuth

| Provider | Environment Variables |
|---|---|
| **Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| **GitHub** | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| **Discord** | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` |
| **Microsoft** | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| **Apple** | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_APP_BUNDLE_IDENTIFIER` |
| **GitLab** | `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, `GITLAB_ISSUER` |
| **Facebook** | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` |
| **Twitter** | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` |
| **Spotify** | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` |
| **Twitch** | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` |
| **Dropbox** | `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET` |
| **LinkedIn** | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| **Reddit** | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` |
| **Roblox** | `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET` |
| **TikTok** | `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY` |
| **VK** | `VK_CLIENT_ID`, `VK_CLIENT_SECRET` |
| **Kick** | `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` |
| **Zoom** | `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |
| **Generic OIDC** | `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISCOVERY_URL` |
| **Domain Restriction** | `BETTER_AUTH_ALLOWED_DOMAINS` (optional comma-separated domain filter) |
| **CORS / Trusted Origins** | `BETTER_AUTH_TRUSTED_ORIGINS` |

---

## 8. First-User / Bootstrap Behavior

A strict audit of the codebase reveals:

- **First user**: **Does NOT exist.** There is no check in the authentication or onboarding flow querying whether the user table is empty (`userRepo.getCount(db) === 0`). The first user is created exactly like every subsequent user.
- **First workspace**: **Does NOT exist automatically on signup.** No workspace is created by the signup handler. Instead, when the user visits `/boards`, the frontend detects that `availableWorkspaces.length === 0` ([`Dashboard.tsx`](apps/web/src/components/Dashboard.tsx#L141-L151)) and triggers `openModal("NEW_WORKSPACE")`. The user then creates their first workspace manually.
- **Admin**: **Does NOT exist globally.** Kan has no concept of a "system administrator" or "instance owner" account in the database. Roles (`admin`, `member`, `guest`) are strictly scoped to workspaces in the `workspaceMembers` table ([`packages/db/src/schema/workspaces.ts`](packages/db/src/schema/workspaces.ts#L43-L64)). When any user creates a workspace, they become the `admin` of that particular workspace ([`packages/db/src/repository/workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts#L122)). (There is a `KAN_ADMIN_API_KEY` environment variable, but it is used solely to authenticate external calls to the `/health/stats` monitoring endpoint).
- **Local installation**: **No distinct setup mode.** Kan only distinguishes between `NEXT_PUBLIC_KAN_ENV === "cloud"` and self-hosted/local. In non-cloud mode, Stripe billing is disabled and the marketing homepage redirects to `/login`.
- **Setup wizard**: **Does NOT exist.** The onboarding wizard (`/onboarding/select-plan` and `/onboarding/workspace`) exists only for Kan Cloud billing and is actively bypassed in self-hosted mode.
- **Bootstrap account**: **Does NOT exist.** There is no default admin account (e.g., `admin@kan.local`), no initial seeding script, and no CLI bootstrap command.

---

## 9. External Services Currently Required

| Service | Required for Core Local Kan? | Condition / Details |
|---|---|---|
| **PostgreSQL** | **Yes (Current Code)** | Currently required unless PGlite in `packages/db/src/client.ts` is fixed. |
| **SMTP / Email** | **NO** | Only required if using magic-link login or password resets. Credential signup/login does not use email. |
| **OAuth Providers** | **NO** | Completely optional. |
| **S3 / Object Storage** | **NO** | Optional. If unconfigured, avatar upload in `hooks.ts` is skipped, and attachment uploads simply fail or are unused. |
| **Redis** | **NO** | Optional. Rate limiter in [`packages/api/src/utils/rateLimit.ts`](packages/api/src/utils/rateLimit.ts#L50-L60) cleanly falls back to `RateLimiterMemory` when `REDIS_URL` is unset. |
| **Stripe** | **NO** | Stripped out when `NEXT_PUBLIC_KAN_ENV !== "cloud"`. |
| **Novu (Notifications)** | **NO** | Stripped out when `NEXT_PUBLIC_KAN_ENV !== "cloud"`. |
| **PostHog / Umami** | **NO** | Telemetry is disabled when environment variables are unset. |

---

## 10. Minimum Configuration for a Zero-External-Service Local Installation

To run Kan locally right now with zero external SaaS services (no SMTP, OAuth, S3, Redis, Stripe, or Novu), the **only** required environment configuration is:

```env
# Base URL for Next.js and Better Auth
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Better Auth Secret (32+ characters)
BETTER_AUTH_SECRET=local_development_secret_key_at_least_32_chars_long

# Enable Username/Email + Password Authentication
NEXT_PUBLIC_ALLOW_CREDENTIALS=true

# Database Connection (local PostgreSQL)
POSTGRES_URL=postgresql://kan:password@localhost:5432/kan
```

With just these 4 environment variables:
1. `NEXT_PUBLIC_ALLOW_CREDENTIALS=true` enables the email + password inputs in the UI and enables the Better Auth credential backend.
2. The user opens `http://localhost:3000/signup`.
3. The form renders Name, Email, and Password fields.
4. The user enters their details and clicks "Sign up with email".
5. The account, credential record, and session are created in PostgreSQL with no external calls.
6. The user is redirected to `/boards`.
7. The "New workspace" modal automatically opens.
8. The user creates their workspace and begins creating boards and cards.

---

## 11. Changes Required to Make It Zero-Configuration Local

While the 4 variables above work, a truly frictionless self-hosted application should work out-of-the-box with `pnpm dev` without requiring manual variable toggling or external infrastructure.

### Required Changes:

1. **Make Credentials Enabled by Default**:
   Instead of requiring `NEXT_PUBLIC_ALLOW_CREDENTIALS="true"`, default it to `true` whenever `NEXT_PUBLIC_KAN_ENV !== "cloud"`.
2. **Prevent "No Authentication Methods" Dead End**:
   Ensure `AuthForm.tsx` always displays the email + password form whenever no OAuth or magic link is available, rather than rendering an empty card with an error banner.
3. **Fix Embedded PGlite Database (Dockerless & Postgresless)**:
   Fix the two issues in [`packages/db/src/client.ts`](packages/db/src/client.ts):
   - Add `pg_trgm` to PGlite extensions (already present in integration tests).
   - Convert PGlite into a persistent process singleton instead of re-instantiating and re-migrating on every tRPC request.
4. **Provide Safe Fallback for Magic Links (Optional Dev Mode)**:
   If magic links are attempted in local mode without SMTP, log the magic link URL to the terminal/logger (`log.info({ magicLoginUrl: url })`) so local users can test magic links by copying the URL from the console.

---

## 12. Files That Would Need Modification

If implementing the self-hosted first-run improvements, the following files would be touched:

| File | Purpose of Modification |
|---|---|
| [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts#L35) | Default `emailAndPassword.enabled` to `true` unless explicitly set to `"false"`. |
| [`apps/web/src/components/AuthForm.tsx`](apps/web/src/components/AuthForm.tsx#L177-L185) | Default `isCredentialsEnabled` to `true` unless explicitly set to `"false"`. |
| [`packages/db/src/client.ts`](packages/db/src/client.ts#L19-L34) | Fix PGlite fallback: register `pg_trgm` extension and cache client as a singleton to prevent lock collisions. |
| [`packages/auth/src/plugins.ts`](packages/auth/src/plugins.ts#L196-L264) | In `sendMagicLink`, if `SMTP_HOST` is unset, log the magic link to console instead of failing silently. |
| [`.env.example`](.env.example#L40) | Set `NEXT_PUBLIC_ALLOW_CREDENTIALS=true` as the default in example environment. |

---

## 13. Risks / Edge Cases

1. **Email Uniqueness & Soft Deletes**:
   In [`packages/db/src/schema/users.ts`](packages/db/src/schema/users.ts#L24), `email` has a unique constraint. If an account is deleted or recreated, duplicate email handling must be respected.
2. **Password Validation**:
   [`apps/web/src/components/AuthForm.tsx`](apps/web/src/components/AuthForm.tsx#L52-L56) currently validates password as `z.string().optional()`, while Better Auth defaults to a minimum password length of 8 characters. If a user enters a 4-character password, the error returned from Better Auth must be clearly presented in the UI.
3. **PGlite File Locking across Multi-Process Next.js**:
   In Next.js development mode (`next dev`), API routes and server components can run in worker threads. Multiple processes attempting to access `./pgdata` simultaneously will crash with a lock error unless PGlite runs in a single process or uses in-memory mode / client-server proxy.
4. **Workspace Name Validation**:
   When a user signs up and the workspace modal pops up, workspace names must be between 1 and 64 characters. If a user closes the modal without creating a workspace, every dashboard visit will re-prompt until at least one workspace exists.
5. **Invitation Links Without Email**:
   When team members are invited to a self-hosted instance without SMTP, email invites will not be delivered. Self-hosted instances must rely on copying invite URLs ([`apps/web/src/views/members/index.tsx`](apps/web/src/views/members/index.tsx)) rather than sending email invitations.

---

## 14. Recommended Implementation Plan

When ready to execute, the work should be structured in three phases:

### Phase 1: Environment & Authentication Defaults (Quick Win)
- In `packages/auth/src/auth.ts` and `apps/web/src/components/AuthForm.tsx`, enable email/password by default whenever `NEXT_PUBLIC_ALLOW_CREDENTIALS !== "false"`.
- Update `.env.example` to document `NEXT_PUBLIC_ALLOW_CREDENTIALS=true` and `BETTER_AUTH_SECRET`.
- Verification: A user can start Kan against local Postgres, go to `/signup`, register with Name/Email/Password, and immediately enter the app.

### Phase 2: Magic Link Console Fallback (Developer Experience)
- In `packages/auth/src/plugins.ts`, wrap `sendEmail` in a check: if `!process.env.SMTP_HOST`, log the generated magic-link URL directly to the terminal via `@kan/logger`.
- Verification: Magic link login functions locally without any SMTP server configured.

### Phase 3: Embedded PGlite Database Stabilization (True Standalone Zero-Dependency)
- In `packages/db/src/client.ts`, import `pg_trgm` from `@electric-sql/pglite/contrib/pg_trgm` and register it in `new PGlite({ extensions: { uuid_ossp, pg_trgm } })`.
- Convert `createDrizzleClient()` into a memoized singleton so `./pgdata` is initialized and migrated exactly once upon server startup.
- Verification: Run `pnpm dev` with no `POSTGRES_URL` set; complete registration and workspace creation entirely against embedded local storage.

---

## Concluding Question

> **"Can we make a fresh Kan installation support local signup and login without Docker, PostgreSQL, SMTP, OAuth, or any other external service?"**

### Answer:

**YES, based strictly on the codebase.**

Kan has all the necessary building blocks already in place:
1. **No OAuth needed**: OAuth is completely optional; Kan runs natively without any provider configured.
2. **No SMTP needed**: Username/email + password authentication already exists in Better Auth and Kan; it creates users, stores hashed passwords, and issues sessions without dispatching any emails.
3. **No External Database / Docker needed**: Kan already has `@electric-sql/pglite` (embedded WebAssembly PostgreSQL) installed and partially integrated in [`packages/db/src/client.ts`](packages/db/src/client.ts). Kan's integration tests ([`packages/api/integration-tests/test-db.ts`](packages/api/integration-tests/test-db.ts)) already prove that Kan's entire PostgreSQL schema and all 35 migrations run successfully in PGlite without Docker or external PostgreSQL.

To achieve this out-of-the-box, Kan only requires:
- Enabling credentials by default in `packages/auth/src/auth.ts` and `AuthForm.tsx`.
- Adding the missing `pg_trgm` extension and singleton caching to `packages/db/src/client.ts` so PGlite runs reliably in Next.js.
