import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePgLite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";

import { createLogger } from "@kan/logger";

import * as schema from "./schema";

const log = createLogger("db");

export type dbClient = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

function getMigrationsFolder(): string {
  try {
    const fromModule = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../migrations",
    );
    if (fs.existsSync(fromModule)) {
      return fromModule;
    }
  } catch {
    // Ignore error and fall through to candidates below
  }

  const cwdCandidates = [
    path.resolve(process.cwd(), "../../packages/db/migrations"),
    path.resolve(process.cwd(), "packages/db/migrations"),
    path.resolve(process.cwd(), "./migrations"),
  ];
  for (const candidate of cwdCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "../../packages/db/migrations";
}

interface GlobalDbState {
  client?: dbClient;
  migrationPromise?: Promise<void>;
}

const globalForDb = globalThis as unknown as {
  __kanDbState?: GlobalDbState;
};

const dbState: GlobalDbState =
  globalForDb.__kanDbState ?? (globalForDb.__kanDbState = {});

export const ensureMigrations = async (_db?: dbClient): Promise<void> => {
  if (dbState.migrationPromise) {
    await dbState.migrationPromise;
  }
};

export const createDrizzleClient = (): dbClient => {
  if (dbState.client) {
    return dbState.client;
  }

  const connectionString = process.env.POSTGRES_URL;

  if (!connectionString) {
    log.info("POSTGRES_URL not set, using embedded PGlite");

    const dataDir = process.env.PGLITE_DATA_DIR || "./pgdata";

    const client = new PGlite({
      dataDir,
      extensions: { uuid_ossp, pg_trgm },
    });
    const db = drizzlePgLite(client, { schema });

    const migrationsFolder = getMigrationsFolder();
    log.info(`Running migrations from ${migrationsFolder} against PGlite...`);

    dbState.migrationPromise = migrate(db, { migrationsFolder })
      .then(() => {
        log.info("PGlite migrations applied successfully");
      })
      .catch((err) => {
        log.error({ err }, "Failed to apply PGlite migrations");
        throw err;
      });

    dbState.client = db as unknown as dbClient;
    return dbState.client;
  }

  const pool = new Pool({
    connectionString,
  });

  dbState.client = drizzlePg(pool, { schema }) as dbClient;
  return dbState.client;
};
