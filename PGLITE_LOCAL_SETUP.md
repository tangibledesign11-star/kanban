# Running Kan Locally with Embedded PGlite

Kan supports running completely locally without Docker, PostgreSQL containers, or an external database service. When `POSTGRES_URL` is omitted, Kan automatically falls back to an embedded PostgreSQL engine powered by **PGlite** (`@electric-sql/pglite`).

---

## Quick Start

### 1. Prerequisites
- **Node.js**: v20 or later
- **pnpm**: v9 or later

### 2. Install Dependencies
```bash
pnpm install
```

### 3. Environment Configuration
Create a `.env` file in the root:
```bash
# Minimum required configuration for zero-service local mode
BETTER_AUTH_SECRET="any-random-secret-key-at-least-32-chars-long"
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
NEXT_PUBLIC_ALLOW_CREDENTIALS="true"

# LEAVE POSTGRES_URL UNSET OR EMPTY FOR EMBEDDED PGLITE:
# POSTGRES_URL=
```

> **Note**:
> - `NEXT_PUBLIC_ALLOW_CREDENTIALS="true"` enables username/email + password sign-up and login without requiring SMTP, OAuth, or external auth providers.
> - Do not provide a `POSTGRES_URL`. Leaving it absent or empty tells Kan to initialize embedded PGlite.
> - `NEXT_PUBLIC_BASE_URL` must match the URL you open in your browser (default: `http://localhost:3000`).

### 4. Start the Application
```bash
pnpm dev
```
1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Sign up at `/signup` with your name, email, and password.
3. You will immediately be authenticated and prompted to create your first workspace.
4. No SMTP, Redis, S3, or Docker required!

---

## How It Works

### Automatic Database Initialization & Migrations
- On the first incoming request (API route, tRPC query, or auth endpoint), Kan boots an in-process PostgreSQL instance using PGlite.
- Database migrations located in `packages/db/migrations` are detected and executed automatically.
- PostgreSQL extensions required by Kan (`uuid-ossp` and `pg_trgm`) are loaded directly inside the embedded engine.

### Data Persistence
- By default, all data and tables are persisted to disk in the `./pgdata` directory.
- Your workspaces, boards, cards, and user sessions persist across server restarts.
- To configure a custom directory, set `PGLITE_DATA_DIR`:
  ```bash
  PGLITE_DATA_DIR="/path/to/my/kan-data"
  ```
- To reset the local database and start fresh, simply stop the server and delete the data directory:
  ```bash
  rm -rf pgdata apps/web/pgdata
  ```

---

## Switching Between Embedded PGlite and PostgreSQL

| Mode | Environment Variable | Database Engine | Data Storage |
| :--- | :--- | :--- | :--- |
| **Embedded Local** | `POSTGRES_URL` omitted or `""` | PGlite (Wasm/in-process Postgres) | Filesystem (`./pgdata`) |
| **External Database** | `POSTGRES_URL="postgresql://user:pass@host:5432/db"` | PostgreSQL server (Docker / RDS / Supabase) | PostgreSQL server |

No code changes or schema adjustments are needed to switch. When `POSTGRES_URL` is provided, Kan connects directly via `pg.Pool` as usual.

---

## Verification & Health Check

You can verify the running database status at any time via the health endpoints:
```bash
# REST API
curl http://localhost:3000/api/v1/health

# Response:
# {"status":"ok","database":"ok","storage":"not_configured"}
```
