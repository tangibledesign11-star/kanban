# Kan Database Architecture Audit: PostgreSQL vs. SQLite

This audit evaluates whether Kan can be run completely without PostgreSQL or Docker by replacing PostgreSQL with SQLite, allowing Kan to run as a self-contained local application.

---

## 1. Executive Summary

### Is SQLite technically feasible?
**Yes, SQLite is technically feasible in theory**, because Kan is primarily a relational CRUD application structured around boards, lists, cards, and workspace memberships without reliance on proprietary PostgreSQL procedural languages (PL/pgSQL), native JSONB operators, or Postgres arrays.

### Is it likely a small, medium, or large architectural change?
**It is a LARGE architectural change.** Replacing PostgreSQL with SQLite is not a simple driver swap. It requires:
1. Rewriting all **17 schema files** comprising **31 database tables** from `drizzle-orm/pg-core` to `drizzle-orm/sqlite-core`.
2. Eliminating **11 PostgreSQL custom `ENUM` types** and replacing them with SQLite text columns and application-level validation.
3. Re-engineering the primary search engine in `workspace.repo.ts`, which relies on PostgreSQL's `pg_trgm` extension (`similarity()` function, GIN trigram indexing, and `ILIKE` operators) that do not exist in SQLite.
4. Scrapping all **35 existing Drizzle SQL migrations** and creating an entirely new migration history, as the current migrations use PostgreSQL-exclusive DDL (`CREATE EXTENSION`, `CREATE TYPE ... AS ENUM`, `ALTER TYPE ... ADD VALUE`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, and `ALTER COLUMN DROP NOT NULL`).
5. Completely overhauling connection management in `packages/db/src/client.ts` and `packages/api/src/trpc.ts`, which currently instantiates a new database client per HTTP request—an approach that causes immediate file-locking conflicts in SQLite.
6. Reconfiguring Better Auth's Drizzle adapter from `provider: "pg"` to `provider: "sqlite"` and adjusting auth table schemas to match SQLite types.

### What are the biggest blockers?
1. **Fuzzy Search Dependency (`pg_trgm` & `similarity()`)**: Kan's search implementation in [`packages/db/src/repository/workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts) directly issues `sql`similarity(${boards.name}, ${query}) > 0.2`` and `sql`similarity(${cards.title}, ${query}) DESC``. SQLite has no trigram similarity function built-in; without a rewrite to SQLite FTS5 or an in-memory JS search algorithm, board/card search will throw SQL syntax errors.
2. **Incompatible DDL in Migration System**: SQLite's limited `ALTER TABLE` support cannot execute operations present in Kan's migration history (such as `ALTER COLUMN ... DROP NOT NULL` or enum modifications).
3. **Per-Request Client Instantiation Pattern**: `createDrizzleClient()` is executed on every incoming request in `packages/api/src/trpc.ts`. SQLite file access requires a long-lived singleton with Write-Ahead Logging (WAL) mode and explicit connection sharing to prevent `SQLITE_BUSY` database lock errors.

### What functionality could potentially break?
- **Global Workspace Search**: Search for cards and boards will fail completely due to missing `similarity()` and `ILIKE` operators.
- **Data Integrity & Cascades**: SQLite does not enforce foreign keys by default unless `PRAGMA foreign_keys = ON;` is explicitly executed on every connection. Cascading deletions (e.g., deleting a list deleting all its cards) would silently fail to cascade, leaving orphaned rows.
- **High-Concurrency Operations**: Simultaneous card moves, reordering, and counter increments across multiple users could lock the database or fail with concurrency errors without careful WAL configuration and busy timeout handling.
- **Production Upgrades**: Any existing deployment running on PostgreSQL cannot migrate to SQLite using Drizzle's migration tooling without manual ETL scripts.

---

## 2. Current Database Architecture

Kan is organized as a pnpm monorepo managed with Turborepo. Database access is strictly abstracted into a dedicated workspace package: `@kan/db`.

```
apps/web (Next.js 15 Pages Router)
  ├── pages/api/trpc/[trpc].ts ──────► packages/api (tRPC Router)
  ├── pages/api/auth/[...all].ts ────► packages/auth (Better Auth)
  └── pages/api/upload/* ────────────► packages/db/repository/*
                                              │
                                              ▼
                                     packages/db
                                       ├── src/client.ts (Drizzle + pg.Pool / PGlite)
                                       ├── src/schema/* (Drizzle pg-core definitions)
                                       └── src/repository/* (Data access queries)
                                              │
                                              ▼
                                     PostgreSQL 15 (Docker)
```

### Components & File References

- **ORM**: Drizzle ORM (`drizzle-orm` `^0.42.0`, `drizzle-kit` `^0.28.1`).
  - Configuration: [`packages/db/drizzle.config.ts`](packages/db/drizzle.config.ts) configured with `dialect: "postgresql"`, schema at `./src/schema`, and migrations at `./migrations`.
- **Connection Layer**: [`packages/db/src/client.ts`](packages/db/src/client.ts).
  - Uses `pg.Pool` from `pg` (`^8.11.3`) when `POSTGRES_URL` is set.
  - Notably, [`packages/db/src/client.ts`](packages/db/src/client.ts#L22-L34) already contains an experimental fallback to `@electric-sql/pglite` (embedded WebAssembly Postgres) writing to `./pgdata` when `POSTGRES_URL` is undefined.
  - Client export type: `export type dbClient = NodePgDatabase<typeof schema> & { $client: Pool };`.
- **Schema Layer**: 17 schema files in [`packages/db/src/schema/`](packages/db/src/schema/), re-exported through [`packages/db/src/schema/index.ts`](packages/db/src/schema/index.ts). All tables use PostgreSQL-specific primitives from `drizzle-orm/pg-core`.
- **Migration Layer**: 35 raw SQL migration files in [`packages/db/migrations/`](packages/db/migrations/) managed by `drizzle-kit migrate`.
- **Repository Layer**: 20 repositories in [`packages/db/src/repository/`](packages/db/src/repository/) containing domain queries. All database operations accept `db: dbClient`.
- **Authentication Layer**: [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts) initializes Better Auth using `drizzleAdapter(db, { provider: "pg", schema: { ...schema, user: schema.users } })`.
- **Context Injection**: [`packages/api/src/trpc.ts`](packages/api/src/trpc.ts#L94-L140) instantiates `createDrizzleClient()` dynamically on every tRPC, NextApi, and REST request context creation.
- **Docker Compose**: [`docker-compose.yml`](docker-compose.yml) provisions:
  - `postgres`: PostgreSQL 15 container (`kan-db`) with persistent volume `kan_postgres_data`.
  - `migrate`: Standalone migration runner running `drizzle-kit migrate`.
  - `web`: Next.js web application depending on `migrate`.

---

## 3. PostgreSQL Dependencies

| Dependency | File / Location | PostgreSQL-specific? | SQLite equivalent? | Migration difficulty |
|---|---|---|---|---|
| `drizzle-orm/pg-core` (`pgTable`, `bigserial`, etc.) | All 17 files in [`packages/db/src/schema/`](packages/db/src/schema/) | **Yes** | `drizzle-orm/sqlite-core` (`sqliteTable`, `integer`, `text`) | **High** (31 tables must be rewritten) |
| Custom `pgEnum` definitions (11 enums) | [`boards.ts`](packages/db/src/schema/boards.ts), [`cards.ts`](packages/db/src/schema/cards.ts), [`workspaces.ts`](packages/db/src/schema/workspaces.ts), [`imports.ts`](packages/db/src/schema/imports.ts), [`notifications.ts`](packages/db/src/schema/notifications.ts), [`workspaceInviteLinks.ts`](packages/db/src/schema/workspaceInviteLinks.ts) | **Yes** | `text({ enum: [...] })` with CHECK constraints or app-level TypeScript enums | **Medium** |
| `pg_trgm` extension & `similarity()` function | [`workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts#L429-L484), [`20251001220136_AddFuzzySearchSupport.sql`](packages/db/migrations/20251001220136_AddFuzzySearchSupport.sql) | **Yes** | None built-in; requires SQLite FTS5 extension or JS in-memory fuzzy search (e.g. Fuse.js) | **High** (Architectural search rewrite) |
| `ILIKE` operator | [`workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts#L428-L483) | **Yes** | `LIKE` (case-insensitive for ASCII only in SQLite) or `lower(col) LIKE lower(?)` | **Low** |
| `uuid-ossp` extension & `uuid_generate_v4()` | [`users.ts`](packages/db/src/schema/users.ts#L22), [`20250508083758_SetupTables.sql`](packages/db/migrations/20250508083758_SetupTables.sql) | **Yes** | Client-side `crypto.randomUUID()` in JS / `$defaultFn()` | **Low** |
| `.enableRLS()` table directive | All 17 files in [`packages/db/src/schema/`](packages/db/src/schema/) | **Yes** (PG Row Level Security) | None (ignored/unsupported in SQLite) | **Low** (simply remove call) |
| GIN Trigram Indexes (`USING gin (name gin_trgm_ops)`) | [`20251001220136_AddFuzzySearchSupport.sql`](packages/db/migrations/20251001220136_AddFuzzySearchSupport.sql) | **Yes** | FTS5 virtual tables (`CREATE VIRTUAL TABLE ... USING fts5`) | **High** |
| Partial Unique Indexes (`where(sql`${deletedAt} IS NULL`)`) | [`boards.ts`](packages/db/src/schema/boards.ts#L66-L69) | No | SQLite 3.8.0+ supports `CREATE UNIQUE INDEX ... WHERE` | **Low** |
| CTE `WITH ... UPDATE ... FROM ...` | [`card.repo.ts`](packages/db/src/repository/card.repo.ts#L140-L150), [`list.repo.ts`](packages/db/src/repository/list.repo.ts#L72-L82) | No | Supported in SQLite 3.33.0+ | **Low** |
| `RETURNING` clauses (`.returning()`) | [`card.repo.ts`](packages/db/src/repository/card.repo.ts#L91), [`board.repo.ts`](packages/db/src/repository/board.repo.ts#L800), etc. | No | Supported in SQLite 3.35.0+ | **Low** |
| `ON CONFLICT DO UPDATE` (UPSERT) | [`permission.repo.ts`](packages/db/src/repository/permission.repo.ts#L206), [`integration.repo.ts`](packages/db/src/repository/integration.repo.ts#L68) | No | Supported in SQLite 3.24.0+ | **Low** |
| Better Auth `drizzleAdapter` provider | [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts#L23) | **Yes** (configured as `"pg"`) | `provider: "sqlite"` | **Medium** |
| Native `timestamp` and `boolean` types | All schema files in [`packages/db/src/schema/`](packages/db/src/schema/) | **Yes** (PG native types) | `integer({ mode: "timestamp" })` and `integer({ mode: "boolean" })` | **Medium** |
| Database driver (`pg`, `pg.Pool`) | [`packages/db/package.json`](packages/db/package.json#L52), [`client.ts`](packages/db/src/client.ts) | **Yes** | `better-sqlite3` or `@libsql/client` | **Medium** |
| Migration Runner Container (`kan-migrate`) | [`apps/web/Dockerfile`](apps/web/Dockerfile#L74-L100), [`docker-compose.yml`](docker-compose.yml#L2-L17) | **Yes** (runs `pg` against `POSTGRES_URL`) | Embedded local migration on startup | **Low** |

---

## 4. Schema Compatibility Audit

Kan defines **31 tables** across 17 schema files. Below is the full audit of compatibility for every table:

### 1. `auth.ts` (`session`, `account`, `verification`, `apiKey`)
- **`session`**:
  - `id`: `bigserial` -> Needs `integer({ mode: "number" }).primaryKey({ autoIncrement: true })`.
  - `expiresAt`, `createdAt`, `updatedAt`: `timestamp` -> Needs `integer({ mode: "timestamp" })`.
  - `userId`: `uuid` -> Needs `text`.
  - Foreign key: `references(() => users.id, { onDelete: "cascade" })` -> Supported.
- **`account`**:
  - `id`: `bigserial` -> `integer`.
  - `userId`: `uuid` -> `text`.
  - `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `createdAt`, `updatedAt`: `timestamp` -> `integer({ mode: "timestamp" })`.
- **`verification`**:
  - `id`: `bigserial` -> `integer`.
  - `expiresAt`, `createdAt`, `updatedAt`: `timestamp` -> `integer`.
- **`apiKey`**:
  - `id`: `bigserial` -> `integer`.
  - `userId`: `uuid` -> `text`.
  - `enabled`, `rateLimitEnabled`: `boolean` -> `integer({ mode: "boolean" })`.
  - `lastRefillAt`, `lastRequest`, `expiresAt`, `createdAt`, `updatedAt`: `timestamp` -> `integer`.

### 2. `users.ts` (`user`)
- **`user`**:
  - `id`: `uuid("id").primaryKey().default(sql`uuid_generate_v4()`)` -> **Incompatible default**. SQLite has no `uuid_generate_v4()`. Must use `$defaultFn(() => crypto.randomUUID())` and `text("id")`.
  - `name`, `email`, `image`, `stripeCustomerId`: `varchar(255)` -> `text`.
  - `emailVerified`: `boolean` -> `integer({ mode: "boolean" })`.
  - `createdAt`, `updatedAt`: `timestamp` -> `integer({ mode: "timestamp" })`.

### 3. `boards.ts` (`board`, `user_board_favorites`)
- **Enums**: `board_visibility` (`private`, `public`), `board_type` (`regular`, `template`).
  - In SQLite: Must use `text({ enum: ["private", "public"] })`.
- **`board`**:
  - `id`: `bigserial` -> `integer`.
  - `publicId`: `varchar(12)` -> `text`.
  - `createdBy`, `deletedBy`: `uuid` -> `text`.
  - `importId`, `workspaceId`, `sourceBoardId`: `bigint({ mode: "number" })` -> `integer`.
  - `isArchived`: `boolean` -> `integer({ mode: "boolean" })`.
  - `unique_slug_per_workspace`: Partial unique index with `where(sql`${table.deletedAt} IS NULL`)` -> Supported in SQLite 3.8.0+.
- **`user_board_favorites`**:
  - `userId`: `uuid`, `boardId`: `bigint`.
  - Composite primary key: `primaryKey({ columns: [table.userId, table.boardId] })` -> Supported in SQLite.

### 4. `cards.ts` (`card`, `card_activity`, `_card_labels`, `_card_workspace_members`, `card_comments`, `card_attachment`)
- **Enum**: `card_activity_type` with 26 values.
  - In SQLite: Must be defined as `text({ enum: activityTypes })`.
- **`card`**:
  - `id`: `bigserial` -> `integer`.
  - `title`, `description`: `text` -> Supported directly.
  - `index`, `cardNumber`: `integer` -> Supported directly.
  - `listId`, `importId`: `bigint` -> `integer`.
  - `dueDate`, `createdAt`, `updatedAt`, `deletedAt`: `timestamp` -> `integer({ mode: "timestamp" })`.
- **`card_activity`**:
  - `fromIndex`, `toIndex`: `integer`.
  - `fromListId`, `toListId`, `labelId`, `workspaceMemberId`, `commentId`, `sourceBoardId`, `attachmentId`: `bigint` -> `integer`.
  - `fromDueDate`, `toDueDate`: `timestamp` -> `integer({ mode: "timestamp" })`.
- **`_card_labels` & `_card_workspace_members`**:
  - Many-to-many join tables with composite primary keys -> Fully compatible with SQLite composite primary keys.
- **`card_comments` & `card_attachment`**:
  - `size`: `bigint` -> `integer`.
  - Foreign keys with `onDelete: "set null"` and `"cascade"` -> Supported by SQLite (requires `PRAGMA foreign_keys = ON;`).

### 5. `checklists.ts` (`card_checklist`, `card_checklist_item`)
- Standard integer IDs, text names, booleans (`completed`), timestamps, and foreign keys -> Fully compatible when converted to SQLite types.

### 6. `feedback.ts` (`feedback`)
- `feedback`: `text`, `url`: `text`, `reviewed`: `boolean` -> Fully compatible.

### 7. `imports.ts` (`import`)
- **Enums**: `importSourceEnum` (`trello`, `github`), `importStatusEnum` (`started`, `success`, `failed`).
  - Must be converted to `text({ enum: ... })`.

### 8. `integrations.ts` (`integration`)
- Composite primary key: `[userId, provider]` -> Fully compatible.
- `expiresAt`, `createdAt`, `updatedAt`: `timestamp` -> `integer({ mode: "timestamp" })`.

### 9. `labels.ts` (`label`) & `lists.ts` (`list`)
- Standard table structures -> Fully compatible when converted to SQLite types.

### 10. `notifications.ts` (`notification`)
- **Enum**: `notification_type` (`mention`, `workspace.member.added`, `workspace.member.removed`, `workspace.role.changed`).
- Multiple composite indexes (`[userId, deletedAt]`, `[userId, readAt, deletedAt]`, etc.) -> Fully supported in SQLite.

### 11. `permissions.ts` (`workspace_roles`, `workspace_role_permissions`, `workspace_member_permissions`)
- Unique indexes on `[workspaceId, name]`, `[workspaceRoleId, permission]`, `[workspaceMemberId, permission]` -> Fully supported in SQLite.

### 12. `subscriptions.ts` (`subscription`)
- `seats`, `partnerTier`: `integer`.
  - `unlimitedSeats`, `cancelAtPeriodEnd`: `boolean` -> `integer({ mode: "boolean" })`.
  - `periodStart`, `periodEnd`, `trialStart`, `trialEnd`: `timestamp` -> `integer({ mode: "timestamp" })`.

### 13. `webhooks.ts` (`workspace_webhooks`)
- `events`: `text("events")`. Note: Kan stores webhook events as a JSON-stringified array in a plain `text` column, parsed in JS. This already avoids PostgreSQL JSONB and works seamlessly in SQLite.

### 14. `workspaceInviteLinks.ts` (`workspace_invite_links`)
- **Enum**: `invite_link_status` (`active`, `inactive`) -> `text({ enum: ... })`.

### 15. `workspaces.ts` (`workspace`, `workspace_members`, `workspace_slugs`, `workspace_slug_checks`)
- **Enums**: `role` (`admin`, `member`, `guest`), `member_status` (`invited`, `active`, `removed`, `paused`), `slug_type` (`reserved`, `premium`), `workspace_plan` (`free`, `team`, `pro`, `enterprise`).
- `cardPrefix`: `varchar(10)`, `cardCounter`: `integer` -> Fully compatible.

---

## 5. Query Compatibility

### 1. JSON / JSONB
- **Findings**: There are **zero** `json` or `jsonb` columns in Kan's PostgreSQL database schema.
- In [`packages/db/src/schema/webhooks.ts`](packages/db/src/schema/webhooks.ts#L34), `events` is explicitly typed as `text("events")` and comments note `// JSON array of webhook events`.
- In [`packages/db/src/repository/webhook.repo.ts`](packages/db/src/repository/webhook.repo.ts#L9-L33), serialization and deserialization are handled strictly via standard `JSON.stringify()` and `JSON.parse()`.
- **Verdict**: Fully compatible. No PostgreSQL JSON operators (`->`, `->>`, `@>`) are used.

### 2. Arrays
- **Findings**: There are **zero** PostgreSQL native array columns (`text[]`, `integer[]`, etc.).
- Array relationships (such as card labels or card members) use standard normalized join tables (`_card_labels`, `_card_workspace_members`).
- **Verdict**: Fully compatible.

### 3. Full-Text Search and Fuzzy Matching (CRITICAL BLOCKER)
- In [`packages/db/src/repository/workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts#L427-L486), search across boards and cards uses PostgreSQL trigram matching:
  ```typescript
  // Board search:
  or(
    ilike(boards.name, `%${query}%`),
    sql`similarity(${boards.name}, ${query}) > 0.2`,
  )
  .orderBy(
    sql`CASE WHEN ${boards.name} ILIKE ${`%${query}%`} THEN 1 ELSE 0 END DESC`,
    sql`similarity(${boards.name}, ${query}) DESC`,
    desc(boards.updatedAt),
  )

  // Card search:
  or(
    ilike(cards.title, searchQuery),
    sql`similarity(${cards.title}, ${query}) > 0.2`,
  )
  .orderBy(
    sql`CASE WHEN ${cards.title} ILIKE ${searchQuery} THEN 1 ELSE 0 END DESC`,
    sql`similarity(${cards.title}, ${query}) DESC`,
    desc(cards.updatedAt),
  )
  ```
- **Incompatibility**: `similarity()` is provided solely by the PostgreSQL `pg_trgm` extension. SQLite has no equivalent function. Executing this query against SQLite will result in an immediate runtime exception: `no such function: similarity`.
- **Verdict**: Blocker. Replacing PostgreSQL with SQLite requires replacing this query with either:
  - SQLite FTS5 virtual tables with bm25 ranking, or
  - An exact `LIKE` fallback combined with application-layer fuzzy filtering.

### 4. Case-Insensitive Matching
- In [`packages/db/src/repository/workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts#L428), `ilike(boards.name, ...)` and raw SQL `ILIKE` are used.
- **Incompatibility**: `ILIKE` is a PostgreSQL keyword. In SQLite, `LIKE` is case-insensitive for ASCII characters by default, but SQLite does not recognize the keyword `ILIKE`.
- **Verdict**: Incompatible raw SQL. Queries must be rewritten to use `like()` or `lower(column) LIKE lower(?)`.

### 5. Date / Time Operations
- In schema definitions, timestamps use `.defaultNow()`. In Drizzle SQLite, this maps to `default(sql`(unixepoch())`)` or `$defaultFn(() => new Date())`.
- In repositories, all timestamp modifications (e.g., in [`card.repo.ts`](packages/db/src/repository/card.repo.ts#L218) and [`board.repo.ts`](packages/db/src/repository/board.repo.ts#L649)) use JavaScript `new Date()` objects:
  ```typescript
  updatedAt: new Date()
  ```
- Expiration checks in [`packages/db/src/repository/integration.repo.ts`](packages/db/src/repository/integration.repo.ts#L15) use Drizzle's `gte(integrations.expiresAt, new Date())`.
- **Verdict**: Compatible when Drizzle's SQLite `integer({ mode: "timestamp" })` or `text({ mode: "timestamp" })` is used, as Drizzle converts JS `Date` instances automatically.

### 6. Conflict / Upsert Behavior
- Kan uses `onConflictDoUpdate` and `onConflictDoNothing` in:
  - [`board.repo.ts`](packages/db/src/repository/board.repo.ts#L983): `userBoardFavorites`
  - [`integration.repo.ts`](packages/db/src/repository/integration.repo.ts#L68): `integrations` on `[userId, provider]`
  - [`permission.repo.ts`](packages/db/src/repository/permission.repo.ts#L206, #L236, #L431, #L460): `workspaceRolePermissions` and `workspaceMemberPermissions`
  - [`apps/web/src/pages/api/trello/authenticate.ts`](apps/web/src/pages/api/trello/authenticate.ts#L43)
- SQLite added native `UPSERT` (`ON CONFLICT(...) DO UPDATE / NOTHING`) in version 3.24.0 (2018). Drizzle's SQLite dialect supports `.onConflictDoUpdate({ target: [...], set: ... })`.
- **Verdict**: Compatible.

### 7. Transactions and Sequential Index Reordering
- Kan enforces strict sequential index ordering (`0..n-1`) on cards and lists. When cards or lists are moved or deleted, transactions are used extensively.
- For example, in [`packages/db/src/repository/list.repo.ts`](packages/db/src/repository/list.repo.ts#L72-L82):
  ```sql
  WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
    FROM "list"
    WHERE "boardId" = ${result.boardId} AND "deletedAt" IS NULL
  )
  UPDATE "list" l
  SET "index" = o.new_index
  FROM ordered o
  WHERE l.id = o.id;
  ```
- And in [`packages/db/src/repository/card.repo.ts`](packages/db/src/repository/card.repo.ts#L845-L855):
  ```sql
  WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY "listId" ORDER BY "index", id) - 1 AS new_index
    FROM "card"
    WHERE "listId" IN (${sql.join(affectedListIds, sql`,`)}) AND "deletedAt" IS NULL
  )
  UPDATE "card" c
  SET "index" = o.new_index
  FROM ordered o
  WHERE c.id = o.id;
  ```
- **Compatibility**:
  - `ROW_NUMBER() OVER (PARTITION BY ...)` was added in SQLite 3.25.0.
  - `UPDATE ... FROM ...` was added in SQLite 3.33.0.
  - Modern `better-sqlite3` bundles SQLite > 3.40.
- **Concurrency Caveat**: In PostgreSQL, these transactions lock rows or tables using MVCC. In SQLite, a write transaction locks the entire database. If multiple concurrent requests trigger index compaction simultaneously, SQLite transactions will fail with `SQLITE_BUSY` unless WAL mode and a busy timeout (e.g. 5000ms) are configured.

### 8. Aggregations, Ordering, and Filtering
- Index compaction verification queries in [`card.repo.ts`](packages/db/src/repository/card.repo.ts#L126-L136) use `COUNT(*)` with `having(gt(countExpr, 1))`.
- Status ordering in [`workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts#L222) uses `desc(sql`CASE WHEN ${member.role} = 'admin' THEN 1 ELSE 0 END`)`.
- Soft delete filtering uniformly applies `isNull(table.deletedAt)`.
- **Verdict**: Fully compatible.

---

## 6. Authentication and Sessions

Kan uses **Better Auth** (`better-auth` `^1.2.9`) for authentication and session management.

### Implementation Details:
1. In [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts#L22-L28):
   ```typescript
   database: drizzleAdapter(db, {
     provider: "pg",
     schema: {
       ...schema,
       user: schema.users,
     },
   }),
   ```
2. In [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts#L66-L68):
   ```typescript
   advanced: {
     cookiePrefix: "kan",
     database: {
       generateId: false,
     },
   }
   ```
3. Better Auth officially supports SQLite via `provider: "sqlite"`.
4. **Differences for SQLite in Better Auth**:
   - In PostgreSQL mode, Better Auth expects native `timestamp` and `uuid` columns.
   - In SQLite mode, Better Auth expects `integer` timestamps (`mode: "timestamp"`) and text IDs.
   - Because `generateId: false` is set, Better Auth expects the database default or schema `$defaultFn` to generate IDs. In PostgreSQL, this relies on `sql`uuid_generate_v4()`` on `users.id`. In SQLite, `users.id` must provide `$defaultFn(() => crypto.randomUUID())`.

---

## 7. Migration System

Kan uses Drizzle Kit to manage migrations:
- **Migration Directory**: [`packages/db/migrations/`](packages/db/migrations/)
- **Total Migrations**: 35 SQL migration files (`20250508083758_SetupTables.sql` through `20260529123231_DropPartnerLicenseKeyUniqueConstraint.sql`).
- **Snapshot Metadata**: 35 snapshot files in [`packages/db/migrations/meta/`](packages/db/migrations/meta/).

### Why Existing Migrations Cannot Run on SQLite:
1. **PostgreSQL Extensions**:
   - `20250508083758_SetupTables.sql`: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`
   - `20251001220136_AddFuzzySearchSupport.sql`: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
2. **PostgreSQL Custom Enums**:
   - `20250508083758_SetupTables.sql`: 8 statements of `CREATE TYPE "public"."..." AS ENUM(...)`
   - `20250813141748_AddChecklistActivityTypes.sql`: `ALTER TYPE "public"."card_activity_type" ADD VALUE '...' BEFORE '...';`
   - `20250918201751_AddPausedMemberStatus.sql`: `ALTER TYPE "public"."member_status" ADD VALUE 'paused';`
   - `20260402225628_AddTeamWorkspacePlan.sql`: `ALTER TYPE "public"."workspace_plan" ADD VALUE 'team';`
   SQLite has no `CREATE TYPE` or `ALTER TYPE`.
3. **Row Level Security**:
   - Every table migration contains `ALTER TABLE "..." ENABLE ROW LEVEL SECURITY;`. SQLite has no RLS.
4. **GIN Trigram Indexes**:
   - `20251001220136_AddFuzzySearchSupport.sql`:
     ```sql
     CREATE INDEX IF NOT EXISTS boards_name_trgm_idx ON board USING gin (name gin_trgm_ops);
     CREATE INDEX IF NOT EXISTS cards_title_trgm_idx ON card USING gin (title gin_trgm_ops);
     ```
5. **Column Constraint Drops**:
   - `20250910195058_RemoveNotNullConstraintFromReferenceIdOnSubsriptions.sql`:
     ```sql
     ALTER TABLE "subscription" ALTER COLUMN "referenceId" DROP NOT NULL;
     ```
   SQLite does not support altering column nullability in-place.

### Adaptation Strategy:
The existing migration history **cannot be reused**. A switch to SQLite would require generating a clean baseline schema migration (`0000_initial_sqlite.sql`) from the updated SQLite Drizzle schema.

---

## 8. Application Changes Required

If SQLite were adopted, the following files and modules would require modification:

### 1. Configuration Changes
- [`packages/db/package.json`](packages/db/package.json): Remove `pg`, `@types/pg`. Add `better-sqlite3` (or `@libsql/client`) and `@types/better-sqlite3`.
- [`packages/db/drizzle.config.ts`](packages/db/drizzle.config.ts): Change `dialect: "postgresql"` to `dialect: "sqlite"`. Update `dbCredentials` to point to a local file path (e.g. `url: "./kan.db"`).
- [`.env.example`](.env.example): Replace `POSTGRES_URL` and `POSTGRES_PASSWORD` with `SQLITE_DB_PATH=./kan.db`.
- [`docker-compose.yml`](docker-compose.yml): Remove `postgres` service and `migrate` service if running standalone.

### 2. Schema Changes (All 17 files in `packages/db/src/schema/`)
- Replace imports from `drizzle-orm/pg-core` with `drizzle-orm/sqlite-core`.
- Replace `pgTable` with `sqliteTable`.
- Replace `bigserial("id", { mode: "number" }).primaryKey()` with `integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })`.
- Replace `uuid("id").default(sql`uuid_generate_v4()`)` with `text("id").$defaultFn(() => crypto.randomUUID())`.
- Replace `timestamp("col")` with `integer("col", { mode: "timestamp" })`.
- Replace `boolean("col")` with `integer("col", { mode: "boolean" })`.
- Replace `varchar("col", { length: N })` with `text("col")`.
- Remove `pgEnum(...)` calls; replace with TypeScript string unions and `text("col", { enum: [...] })`.
- Remove all `.enableRLS()` calls.

### 3. Query Changes
- [`packages/db/src/repository/workspace.repo.ts`](packages/db/src/repository/workspace.repo.ts#L412-L489): Rewrite `searchWorkspace()` to remove `similarity()` and `ILIKE`. Implement SQLite `LIKE` matching or integrate FTS5 virtual tables.
- [`packages/db/src/repository/board.repo.ts`](packages/db/src/repository/board.repo.ts), [`integration.repo.ts`](packages/db/src/repository/integration.repo.ts), [`permission.repo.ts`](packages/db/src/repository/permission.repo.ts): Verify `onConflictDoUpdate` target syntax matches SQLite table constraints.

### 4. Database Client & Concurrency Changes
- [`packages/db/src/client.ts`](packages/db/src/client.ts):
  - Replace `Pool` and `NodePgDatabase` with `BetterSQLite3Database`.
  - Implement a **thread-safe singleton client** with connection pooling / reuse.
  - Enable Write-Ahead Logging: `sqlite.pragma("journal_mode = WAL");`.
  - Enable foreign key constraint enforcement: `sqlite.pragma("foreign_keys = ON");`.
  - Set busy timeout to avoid immediate lock errors: `sqlite.pragma("busy_timeout = 5000");`.
- [`packages/api/src/trpc.ts`](packages/api/src/trpc.ts#L94-L140):
  - Stop calling `createDrizzleClient()` on every request. Reuse the singleton instance from `@kan/db/client`.

### 5. Authentication Changes
- [`packages/auth/src/auth.ts`](packages/auth/src/auth.ts#L22-L28):
  - Change Better Auth provider: `provider: "sqlite"`.
  - Update user schema mapping to match the SQLite `users` definition.

### 6. Migration Changes
- Delete existing migrations in [`packages/db/migrations/`](packages/db/migrations/).
- Run `pnpm drizzle-kit generate` to generate a unified SQLite migration baseline.

### 7. Test Changes
- [`packages/api/integration-tests/test-db.ts`](packages/api/integration-tests/test-db.ts): Update test harness from PGlite in-memory to better-sqlite3 in-memory (`:memory:`).

---

## 9. What Would Stay Unchanged

Substantial portions of the Kan codebase are decoupled from the underlying database dialect and would require **zero changes**:

1. **Frontend Application (`apps/web/src/components/`, `views/`, `hooks/`)**:
   - The entire React UI, drag-and-drop kanban boards, TipTap rich text editors, modals, Lingui translations, and Tailwind CSS styling communicate purely via tRPC and REST APIs.
2. **tRPC API Routers (`packages/api/src/routers/`)**:
   - Routers (`card.ts`, `board.ts`, `list.ts`, `member.ts`, `webhook.ts`, etc.) call repository methods without writing raw SQL. Their inputs, outputs, and Zod schemas remain unchanged.
3. **Repository Signatures (`packages/db/src/repository/`)**:
   - Method signatures (`createCard`, `updateCard`, `moveCard`, `getBoardByPublicId`) remain identical, preserving API layer stability.
4. **External Services & Storage**:
   - S3 attachments (`packages/shared/src/utils/s3.ts`), email sending (`packages/email`), Stripe webhooks (`packages/stripe`), and rate limiting fallback (`packages/api/src/utils/rateLimit.ts`) operate independently of the database.
5. **Rate Limiting**:
   - As verified in [`packages/api/src/utils/rateLimit.ts`](packages/api/src/utils/rateLimit.ts#L59), rate limiting already falls back gracefully to `RateLimiterMemory` when Redis is absent.

---

## 10. Proposed SQLite Architecture

If PostgreSQL were replaced with SQLite, the local architecture would be completely self-contained:

```
┌─────────────────────────────────────────────────────────┐
│                    Web Browser                          │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP / WebSocket
                             ▼
┌─────────────────────────────────────────────────────────┐
│              Kan Next.js Server (Node.js)               │
│                                                         │
│  ┌────────────────────┐      ┌───────────────────────┐  │
│  │   tRPC / REST API  │      │  Better Auth (SQLite) │  │
│  └─────────┬──────────┘      └───────────┬───────────┘  │
│            │                             │              │
│            ▼                             ▼              │
│  ┌───────────────────────────────────────────────────┐  │
│  │     @kan/db (Singleton BetterSQLite3 / Drizzle)   │  │
│  │     - PRAGMA journal_mode = WAL;                  │  │
│  │     - PRAGMA foreign_keys = ON;                   │  │
│  │     - PRAGMA busy_timeout = 5000;                 │  │
│  └─────────────────────────┬─────────────────────────┘  │
└────────────────────────────┼────────────────────────────┘
                             │ Local File I/O
                             ▼
┌─────────────────────────────────────────────────────────┐
│                  kan.db (Single File)                   │
│         - Data directory: ./data/kan.db                 │
│         - WAL file:       ./data/kan.db-wal             │
│         - SHM file:       ./data/kan.db-shm             │
└─────────────────────────────────────────────────────────┘
```

### File Location and Environments:
- **Development**: Stored at `<project_root>/data/kan.db` (gitignored).
- **Production (Self-Hosted / Single Binary / Desktop)**:
  - Dockerless host: Stored in a standard persistent path such as `~/.kan/kan.db` or `/var/lib/kan/kan.db` configurable via `SQLITE_DB_PATH`.
  - Docker container (optional): Mounted via a single volume `./data:/app/data`.
- **Database Migrations**: Executed automatically on server startup via `migrate(db, { migrationsFolder: "./migrations" })` before the HTTP server binds to its port, eliminating the need for a separate migration container.

---

## 11. Risk Assessment

| Issue / Challenge | Risk Level | Rationale |
|---|---|---|
| **Loss of Trigram Fuzzy Search** | **BLOCKER** | Kan's board and card search relies heavily on PostgreSQL's `pg_trgm` extension and `similarity()` function. SQLite has no built-in equivalent. Without replacing the search engine with SQLite FTS5 or an external search library, search will fail. |
| **Complete Schema & Migration Incompatibility** | **HIGH** | All 31 tables and 35 migrations use PostgreSQL-specific DDL (`pgEnum`, `bigserial`, `uuid`, `ALTER TYPE`, RLS). A full rewrite of the database layer is required. Existing PostgreSQL databases cannot be upgraded automatically. |
| **Concurrency & Database Locking (`SQLITE_BUSY`)** | **MEDIUM** | Card movements, index recalculations, and bulk imports involve multi-statement write transactions. In SQLite, write transactions lock the entire database file. Heavy concurrent usage without WAL mode and busy timeouts will degrade performance or fail. |
| **Foreign Key Constraint Enforcement** | **MEDIUM** | SQLite ignores foreign key constraints by default unless `PRAGMA foreign_keys = ON;` is explicitly executed on every connection. A missed PRAGMA could lead to silent data corruption or orphaned records during card/list deletions. |
| **Client Per-Request Instantiation Bug** | **MEDIUM** | The current codebase instantiates `createDrizzleClient()` on every request in `trpc.ts`. In SQLite, opening a new file handle per HTTP request causes file contention and performance collapse. Must be refactored to a singleton. |
| **Better Auth SQLite Migration** | **LOW** | Better Auth natively supports SQLite; adjusting the schema and adapter configuration is straightforward once table column types match SQLite conventions. |
| **Redis Dependency** | **LOW** | Rate limiting in `packages/api/src/utils/rateLimit.ts` already has a built-in memory fallback when `REDIS_URL` is omitted. |

---

## 12. Recommended Next Step

### Evaluation of Options

#### Option A: Keep PostgreSQL
- **Pros**: Zero code changes. Maintains trigram fuzzy search (`pg_trgm`), full concurrency, and backwards compatibility with all existing migrations and production deployments.
- **Cons**: Requires users to run Docker or an external PostgreSQL database server, preventing Kan from running as a lightweight, zero-dependency self-contained desktop or local app.

#### Option B: Replace PostgreSQL with SQLite
- **Pros**: Allows running Kan completely locally without Docker or external servers using a single `.db` file.
- **Cons**: Requires a massive, breaking refactor across 31 tables, 17 schema files, all 35 migrations, Better Auth adapter, and a rewrite of the search engine. Breaks backward compatibility with existing PostgreSQL deployments.

#### Option C: Finalize the Existing Embedded PGlite Approach (RECOMMENDED)
During this audit, a critical discovery was made in the codebase: **Kan has ALREADY started implementing embedded, Dockerless database support via `@electric-sql/pglite`!**

Inspect [`packages/db/src/client.ts`](packages/db/src/client.ts#L20-L34):
```typescript
export const createDrizzleClient = (): dbClient => {
  const connectionString = process.env.POSTGRES_URL;

  if (!connectionString) {
    log.warn("POSTGRES_URL not set, falling back to PGLite");

    const client = new PGlite({
      dataDir: "./pgdata",
      extensions: { uuid_ossp },
    });
    const db = drizzlePgLite(client, { schema });

    migrate(db, { migrationsFolder: "../../packages/db/migrations" });

    return db as unknown as dbClient;
  }
  // ...
};
```
Furthermore, inspect [`packages/api/integration-tests/test-db.ts`](packages/api/integration-tests/test-db.ts#L19-L30):
```typescript
export async function createTestDb(): Promise<TestDbClient> {
  const client = new PGlite({
    extensions: { uuid_ossp, pg_trgm },
  });

  const db = drizzle(client, { schema });

  // Run migrations
  await migrate(db, { migrationsFolder: "../../packages/db/migrations" });

  return db as unknown as TestDbClient;
}
```
**Kan's integration tests already run against embedded PGlite with `uuid_ossp` and `pg_trgm` extensions, successfully executing all 35 PostgreSQL migrations in-memory without Docker or PostgreSQL installed.**

PGlite is PostgreSQL packaged as an embedded WebAssembly / C library that runs directly inside Node.js and writes to a local filesystem folder (e.g., `./pgdata`), exactly like SQLite.

Comparing SQLite vs. PGlite for Kan:
- **With SQLite (Option B)**: You must rewrite 31 tables, rewrite 35 migrations, rewrite the search engine, reconfigure Better Auth, and maintain two divergent database architectures.
- **With PGlite (Option C)**: You keep **100% of the current schema**, **100% of existing migrations**, **100% of the search queries (`pg_trgm`)**, and **100% of Better Auth configuration**. Kan runs completely standalone without Docker, without an external database, storing all data in a local `./pgdata` directory.

To make PGlite production-ready in Kan, only two small fixes are required:
1. Add `pg_trgm` to the extensions in `packages/db/src/client.ts` (matching `test-db.ts`):
   ```typescript
   import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
   // ...
   extensions: { uuid_ossp, pg_trgm }
   ```
2. Turn `createDrizzleClient()` into a singleton so that PGlite is instantiated once and migrations run once on startup, rather than on every HTTP request.

### Concrete Recommendation:
**Proceed with Option C (Investigate and finalize the embedded PGlite approach).**
Replacing PostgreSQL with SQLite would require an enormous amount of refactoring and introduce substantial architectural risk for the exact same end-user benefit that PGlite already offers with virtually zero code changes.

---

## Audit Conclusion

### "Can we realistically turn Kan into a completely self-contained application that requires neither Docker nor PostgreSQL by replacing PostgreSQL with SQLite?"

**Yes, it is technically possible, but doing so via SQLite is an unnecessarily costly and risky architectural decision because Kan can achieve the exact same self-contained, Docker-free outcome much more reliably by finalizing its embedded PGlite implementation.**

**Reasoning:**
1. **SQLite requires an intrusive rewrite**: Replacing PostgreSQL with SQLite requires rewriting 31 schema tables, 11 enums, 35 migrations, connection handling, and re-implementing the core search engine (due to the lack of `pg_trgm` and `similarity()`).
2. **PGlite achieves the goal natively**: Kan's dependencies and integration test suite ([`packages/api/integration-tests/test-db.ts`](packages/api/integration-tests/test-db.ts)) already demonstrate that `@electric-sql/pglite` runs Kan's full PostgreSQL schema, extensions (`uuid_ossp`, `pg_trgm`), and migrations directly inside Node.js without Docker or an external database service.
3. **Preservation of dual-mode flexibility**: By using embedded PGlite for local/offline usage and standard PostgreSQL (`pg.Pool`) when `POSTGRES_URL` is provided, Kan can run as a zero-dependency standalone application on a user's machine while remaining 100% compatible with scalable cloud PostgreSQL deployments.
