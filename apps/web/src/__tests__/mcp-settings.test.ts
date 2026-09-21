import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/Dashboard", () => ({
  getDashboardLayout: vi.fn((page) => page),
}));
vi.mock("~/components/Popup", () => ({
  default: () => null,
}));
vi.mock("~/components/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/views/settings/McpSettings", () => ({
  default: () => null,
}));

import { getMcpToolsCatalog } from "@kan/mcp";

import { getServerSideProps } from "../pages/settings/mcp";

describe("MCP Settings Page & Catalog", () => {
  it("generates catalog dynamically from canonical tool registrars", () => {
    const catalog = getMcpToolsCatalog();

    // Verify it is not hardcoded to 45
    expect(catalog.totalTools).toBe(46);
    expect(catalog.categories).toHaveLength(7);

    const categoryKeys = catalog.categories.map((c) => c.key);
    expect(categoryKeys).toEqual([
      "workspaces",
      "boards",
      "lists",
      "cards",
      "checklists",
      "labels",
      "members",
    ]);

    // Verify every tool has valid name and description
    for (const cat of catalog.categories) {
      expect(cat.tools.length).toBeGreaterThan(0);
      for (const tool of cat.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
      }
    }

    // Verify specific critical tools exist
    const allToolNames = catalog.categories.flatMap((c) =>
      c.tools.map((t) => t.name),
    );
    expect(allToolNames).toContain("create_workspace");
    expect(allToolNames).toContain("create_board");
    expect(allToolNames).toContain("create_list");
    expect(allToolNames).toContain("create_card");
    expect(allToolNames).toContain("duplicate_card");
    expect(allToolNames).toContain("add_card_comment");
    expect(allToolNames).toContain("create_checklist");
    expect(allToolNames).toContain("create_label");
    expect(allToolNames).toContain("invite_member");
  });

  it("getServerSideProps resolves catalog prop correctly", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await getServerSideProps({} as any)) as {
      props: { catalog: ReturnType<typeof getMcpToolsCatalog> };
    };

    expect(result).toHaveProperty("props");
    expect(result.props.catalog).toBeDefined();
    expect(result.props.catalog.totalTools).toBe(46);
    expect(result.props.catalog.categories).toHaveLength(7);
  });
});
