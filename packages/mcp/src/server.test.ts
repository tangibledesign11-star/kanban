import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import type { KanClient } from "./client.js";
import { createKanMcpServer } from "./server.js";

describe("createKanMcpServer", () => {
  const request = vi.fn();
  const client: KanClient = { request };

  it("lists tools and forwards a tool call through to the injected client", async () => {
    request.mockReset();
    request.mockResolvedValueOnce([
      { publicId: "board-123456", name: "Roadmap" },
    ]);

    const mcpServer = createKanMcpServer(client);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await mcpServer.connect(serverTransport);

    const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
    await mcpClient.connect(clientTransport);

    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name)).toContain("list_boards");

    const result = await mcpClient.callTool({
      name: "list_boards",
      arguments: { workspacePublicId: "workspace-123456" },
    });

    expect(request).toHaveBeenCalledWith(
      "GET",
      "/workspaces/workspace-123456/boards",
    );
    const [content] = result.content as { type: string; text: string }[];
    expect(content?.text).toContain("Roadmap");

    await mcpClient.close();
    await mcpServer.close();
  });
});
