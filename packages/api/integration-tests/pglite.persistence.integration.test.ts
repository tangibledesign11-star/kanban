import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { createDrizzleClient, ensureMigrations, type dbClient } from "@kan/db/client";
import * as schema from "@kan/db/schema";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { generateUID } from "@kan/shared/utils";

const TEST_DATA_DIR = path.resolve(process.cwd(), "./packages/api/pgdata-test");

describe("PGlite Embedded Database Full Persistence & Feature Tests", () => {
  afterAll(async () => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  it("initializes PGlite, runs migrations, writes data, and verifies search", async () => {
    delete process.env.POSTGRES_URL;
    process.env.PGLITE_DATA_DIR = TEST_DATA_DIR;

    // 1. Create client and ensure migrations
    const db = createDrizzleClient();
    await ensureMigrations(db);

    // 2. Create test user
    const userId = crypto.randomUUID();
    const [user] = await db
      .insert(schema.users)
      .values({
        id: userId,
        name: "PGlite Test User",
        email: "pglite-test@example.com",
        emailVerified: true,
      })
      .returning();
    expect(user).toBeDefined();
    expect(user!.id).toBe(userId);

    // 3. Create test workspace
    const workspacePublicId = generateUID();
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        publicId: workspacePublicId,
        name: "Embedded PGlite Workspace",
        slug: `pglite-ws-${workspacePublicId}`,
        createdBy: user!.id,
      })
      .returning();
    expect(workspace).toBeDefined();

    // 4. Create board
    const board = await boardRepo.create(db, {
      name: "Roadmap 2026",
      workspaceId: workspace!.id,
      createdBy: user!.id,
      slug: "roadmap-2026",
    });
    expect(board).toBeDefined();
    expect(board.name).toBe("Roadmap 2026");

    // 5. Create list
    const list = await listRepo.create(db, {
      name: "In Progress",
      boardId: board.id,
      createdBy: user!.id,
    });
    expect(list).toBeDefined();
    expect(list.name).toBe("In Progress");

    // 6. Create card
    const card = await cardRepo.create(db, {
      title: "Implement PGlite Embedded Database",
      description: "Run Kan without Docker or external PostgreSQL",
      listId: list.id,
      workspaceId: workspace!.id,
      createdBy: user!.id,
    });
    expect(card).toBeDefined();
    expect(card.cardNumber).toBe(1);
    expect(card.publicId).toBeDefined();

    const fullCard = await cardRepo.getByPublicId(db, card.publicId);
    expect(fullCard).toBeDefined();
    expect(fullCard?.title).toBe("Implement PGlite Embedded Database");

    // 7. Verify search using pg_trgm similarity and ILIKE
    const searchResults = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace!.id,
      "PGlite",
    );
    expect(searchResults.length).toBeGreaterThan(0);
    const foundCard = searchResults.find((r) => r.type === "card");
    expect(foundCard).toBeDefined();
    expect(foundCard?.title).toBe("Implement PGlite Embedded Database");

    // Also fuzzy search test with slight misspelling: "PGlit"
    const fuzzyResults = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace!.id,
      "PGlit",
    );
    expect(fuzzyResults.length).toBeGreaterThan(0);
  });

  it("reuses singleton client within process", () => {
    const client1 = createDrizzleClient();
    const client2 = createDrizzleClient();
    expect(client1).toBe(client2);
  });

  it("persists data across restart and verifies data on disk", async () => {
    // 1. Simulate process restart by clearing cached client
    const globalState = globalThis as unknown as { __kanDbState?: Record<string, unknown> };
    delete globalState.__kanDbState;

    process.env.PGLITE_DATA_DIR = TEST_DATA_DIR;

    // 2. Re-create client from disk
    const db = createDrizzleClient();
    await ensureMigrations(db);

    // 3. Query all workspaces
    const allWorkspaces = await db.select().from(schema.workspaces);
    expect(allWorkspaces.length).toBeGreaterThan(0);
    const persistedWs = allWorkspaces.find((w) => w.name === "Embedded PGlite Workspace");
    expect(persistedWs).toBeDefined();

    // 4. Query boards in persisted workspace
    const boards = await boardRepo.getAllByWorkspaceId(db, persistedWs!.id);
    expect(boards.length).toBeGreaterThan(0);
    expect(boards[0]?.name).toBe("Roadmap 2026");

    // 5. Query cards
    const cards = await db.select().from(schema.cards);
    expect(cards.length).toBeGreaterThan(0);
    const persistedCard = cards.find((c) => c.title === "Implement PGlite Embedded Database");
    expect(persistedCard).toBeDefined();
    expect(persistedCard?.cardNumber).toBe(1);
  });
});
