import { describe, expect, it } from "vitest";
import { initAuth } from "@kan/auth/server";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import { generateUID } from "@kan/shared/utils";
import { createTestDb } from "./test-db";

describe("Local Authentication & Workspace Integration Tests", () => {
  it("supports zero-service credential signup, login, session, and workspace creation", async () => {
    // 1. Configure environment for local credentials
    process.env.NEXT_PUBLIC_ALLOW_CREDENTIALS = "true";
    process.env.BETTER_AUTH_SECRET = "test-secret-123456789012345678901234567890";
    process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";

    // 2. Initialize in-memory PGlite test database with all 35 migrations
    const db = await createTestDb();
    const auth = initAuth(db as any);

    // 3. User Sign-up with name, email, password
    const signupResult = await auth.api.signUpEmail({
      body: {
        name: "Local Dev User",
        email: "developer@kan.local",
        password: "StrongLocalPassword123!",
      },
    });

    expect(signupResult).toBeDefined();
    expect(signupResult.user).toBeDefined();
    expect(signupResult.user.email).toBe("developer@kan.local");
    expect(signupResult.user.name).toBe("Local Dev User");
    expect(signupResult.token).toBeDefined();

    const userId = signupResult.user.id;

    // Verify account record in DB
    const accounts = await db.query.account.findMany({
      where: (account, { eq }) => eq(account.userId, userId),
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].providerId).toBe("credential");
    expect(accounts[0].password).toBeDefined();
    expect(accounts[0].password).not.toBe("StrongLocalPassword123!"); // Hashed

    // 4. User Login with email and password (asResponse: true returns Set-Cookie header)
    const signinResponse = await auth.api.signInEmail({
      body: {
        email: "developer@kan.local",
        password: "StrongLocalPassword123!",
      },
      asResponse: true,
    });

    expect(signinResponse.status).toBe(200);
    const setCookie = signinResponse.headers.get("set-cookie");
    expect(setCookie).toBeDefined();

    // 5. Session validation using the issued session cookie
    const session = await auth.api.getSession({
      headers: new Headers({
        cookie: setCookie!,
      }),
    });

    expect(session).toBeDefined();
    expect(session?.user?.id).toBe(userId);

    // 6. First workspace creation
    const workspace = await workspaceRepo.create(db, {
      name: "My Local Workspace",
      slug: "my-local-workspace",
      description: "A test workspace created after local signup",
      publicId: generateUID(),
      createdBy: userId,
      createdByEmail: "developer@kan.local",
    });

    expect(workspace).toBeDefined();
    expect(workspace.name).toBe("My Local Workspace");

    const fullWorkspace = await workspaceRepo.getByPublicId(db, workspace.publicId);
    expect(fullWorkspace).toBeDefined();

    // Verify workspace membership (admin role)
    const userWorkspaces = await workspaceRepo.getAllByUserId(db, userId);
    expect(userWorkspaces).toHaveLength(1);
    expect(userWorkspaces[0].workspace.name).toBe("My Local Workspace");

    // 7. Create board in workspace
    const board = await boardRepo.create(db, {
      name: "Project Kanban",
      slug: "project-kanban",
      publicId: generateUID(),
      workspaceId: fullWorkspace!.id,
      createdBy: userId,
    });

    expect(board).toBeDefined();
    expect(board.name).toBe("Project Kanban");

    // 8. Create list in board
    const list = await listRepo.create(db, {
      name: "To Do",
      boardId: board.id,
      createdBy: userId,
    });

    expect(list).toBeDefined();
    expect(list.name).toBe("To Do");

    // 9. Create card in list
    const card = await cardRepo.create(db, {
      title: "First Local Card",
      description: "Testing card creation",
      listId: list.id,
      workspaceId: fullWorkspace!.id,
      position: "end",
      createdBy: userId,
    });

    expect(card).toBeDefined();
    expect(card.publicId).toBeDefined();

    // Verify full relational retrieval
    const fetchedCard = await cardRepo.getByPublicId(db, card.publicId);
    expect(fetchedCard).toBeDefined();
    expect(fetchedCard?.title).toBe("First Local Card");
    expect(fetchedCard?.list?.name).toBe("To Do");
  });
});
