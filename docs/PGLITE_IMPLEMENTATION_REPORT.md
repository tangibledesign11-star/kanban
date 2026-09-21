# PGlite Embedded Database Implementation Report

## Executive Summary

Following the database architecture audit in `AUDIT_DATABASE.md`, we implemented embedded **PGlite** (`@electric-sql/pglite`) as Kan's zero-dependency local database. 

With this implementation:
- Kan runs completely locally on a user's machine **without Docker**, **without an external PostgreSQL server**, and **without SQLite migrations or schema redesign**.
- When `POSTGRES_URL` is set, Kan connects to external PostgreSQL using `pg.Pool` with zero regression.
- When `POSTGRES_URL` is absent or empty, Kan initializes embedded PGlite, stores data in `./pgdata` (or `PGLITE_DATA_DIR`), loads the required PostgreSQL extensions (`uuid-ossp` and `pg_trgm`), applies all 35 database migrations, and handles incoming requests reliably.

---

## Technical Analysis & Changes Made

### 1. Extension Support (`pg_trgm` and `uuid_ossp`)
Kan relies on two PostgreSQL extensions:
- `uuid-ossp` for `uuid_generate_v4()`
- `pg_trgm` for card and board fuzzy search (`similarity()` and `ilike`)

Both extensions are supported natively by PGlite via its contrib packages (`@electric-sql/pglite/contrib/uuid_ossp` and `@electric-sql/pglite/contrib/pg_trgm`). We added `pg_trgm` to the PGlite configuration alongside `uuid_ossp`.

### 2. Singleton Lifecycle & Migration Race Conditions
Previously, `createDrizzleClient()` in `packages/db/src/client.ts` created a new PGlite instance every time it was called and executed `migrate()` asynchronously without awaiting completion (`fire-and-forget`). This caused two critical issues:
1. PGlite instances locking the same data directory crashed subsequent calls with file lock errors.
2. API requests executing immediately upon server start failed because migrations had not finished applying tables.

**Solution**:
- Stored the database instance and migration promise on `globalThis.__kanDbState` to guarantee a single database connection per Node process.
- Exported an `ensureMigrations()` function that awaits the one-time migration promise before procedures or handlers execute.
- Made migration folder path resolution robust: dynamically resolves against `import.meta.url` (`../../packages/db/migrations` or `../migrations`) with fallback to `process.cwd()` candidates.

### 3. Server Context & Auth Integration
To ensure the embedded database is fully migrated before any query runs:
- **`packages/api/src/trpc.ts`**: Updated `createTRPCContext`, `createNextApiContext`, and `createRESTContext` to `await ensureMigrations(db)`.
- **`apps/web/src/pages/api/auth/[...all].ts`**: Added `await ensureMigrations()` before delegating requests to `authHandler`.

### 4. Next.js Bundling & External Packages
- **`apps/web/next.config.js`**:
  - Added `@electric-sql/pglite` and `pino-pretty` to `serverExternalPackages` so Next.js does not attempt to bundle WebAssembly or binary dependencies with Webpack.
- **`packages/logger/src/index.ts`**:
  - Replaced `transport: { target: "pino-pretty" }` with direct stream instantiation via `pino(..., pretty(...))` in development. This eliminates the Webpack worker thread module resolution failure (`"unable to determine transport target for 'pino-pretty'"`).

### 5. Repository Cleanliness & Configuration
- **`.gitignore`**: Added `pgdata/` and `**/pgdata/` to prevent database files from being accidentally committed.
- **`.env.example`**: Documented that omitting `POSTGRES_URL` enables embedded PGlite storing data in `./pgdata`.

---

## Detailed File Modifications

| File | Change Summary |
| :--- | :--- |
| `packages/db/src/client.ts` | Added `pg_trgm` extension, process-level singleton on `globalThis.__kanDbState`, robust migrations path resolver, and `ensureMigrations()` helper. |
| `packages/api/src/trpc.ts` | Integrated `await ensureMigrations(db)` into tRPC and REST context creation. |
| `apps/web/src/pages/api/auth/[...all].ts` | Integrated `await ensureMigrations()` before handling Better Auth requests. |
| `apps/web/next.config.js` | Added `@electric-sql/pglite` and `pino-pretty` to `serverExternalPackages`. |
| `packages/logger/src/index.ts` | Configured `pino-pretty` stream directly in dev mode to resolve Webpack worker resolution error. |
| `packages/api/integration-tests/test-db.ts` | Used robust path resolution for test database migrations. |
| `packages/api/integration-tests/pglite.persistence.integration.test.ts` | Added comprehensive integration test suite for PGlite lifecycle, persistence across restarts, and trigram search. |
| `.gitignore` | Added `pgdata/` and `**/pgdata/`. |
| `.env.example` | Updated database comments regarding embedded PGlite fallback. |

---

## Verification & Test Results

### 1. Dedicated PGlite Persistence & Search Integration Test
A new end-to-end integration test (`packages/api/integration-tests/pglite.persistence.integration.test.ts`) verifies:
- Initialization of PGlite with `uuid_ossp` and `pg_trgm`.
- Clean application of all 35 schema migrations into a temporary directory on disk.
- Writing relational data: User $\rightarrow$ Workspace $\rightarrow$ Board $\rightarrow$ List $\rightarrow$ Card.
- Trigram similarity search (`searchBoardsAndCards` using `similarity()` and `ilike`).
- Process singleton reuse within the same process.
- **Persistence across simulated restart**: Closing the database, opening a new PGlite instance pointing to the same data directory, and reading back all data.

Result: **3/3 passed (100%)**.

### 2. Full Test Suite
Ran all test suites with `vitest`:
```
Test Files  6 passed (6)
     Tests  78 passed (78)
```
- Webhook tests (15 unit tests + 14 integration tests): **Passed**
- API procedures & authorization: **Passed**
- PGlite persistence & trigram search: **Passed**

### 3. Live HTTP Endpoints (Next.js Dev Server)
Started Next.js dev server with `POSTGRES_URL` unset:
- **`GET /api/v1/health`**:
  ```json
  HTTP/1.1 200 OK
  {"status":"ok","database":"ok","storage":"not_configured"}
  ```
- **`GET /api/trpc/health.health`**:
  ```json
  HTTP/1.1 200 OK
  {"result":{"data":{"json":{"status":"ok","database":"ok","storage":"not_configured"}}}}
  ```
- **`GET /api/auth/get-session`**:
  ```
  HTTP/1.1 200 OK
  null
  ```
- Server Logs:
  ```
  [INFO] POSTGRES_URL not set, using embedded PGlite
  [INFO] Running migrations from /packages/db/migrations against PGlite...
  [INFO] PGlite migrations applied successfully
  GET /api/v1/health 200 in 1966ms
  GET /api/trpc/health.health 200 in 155ms
  GET /api/auth/get-session 200 in 99ms
  ```

---

## Limitations & Considerations

1. **Single Node / Single Process Only**:
   PGlite writes to disk and uses file locks. It is designed for single-node local development and single-tenant self-hosting. Multiple separate OS processes cannot concurrently open the same `./pgdata` directory without coordinating file locks.
2. **Production / Multi-Instance Deployments**:
   For scaled production deployments with multiple web containers or serverless functions, standard PostgreSQL (`POSTGRES_URL`) should continue to be used.
3. **Memory & Performance**:
   PGlite compiles PostgreSQL to WebAssembly. For local development, testing, and single-user instances, performance is near-instantaneous (migrations apply in ~570ms).
