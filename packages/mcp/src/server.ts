import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { KanClient } from "./client.js";
import { registerBoardTools } from "./tools/board.js";
import { registerCardTools } from "./tools/card.js";
import { registerChecklistTools } from "./tools/checklist.js";
import { registerLabelTools } from "./tools/label.js";
import { registerListTools } from "./tools/list.js";
import { registerMemberTools } from "./tools/member.js";
import { registerWorkspaceTools } from "./tools/workspace.js";

export function createKanMcpServer(client: KanClient): McpServer {
  const server = new McpServer({
    name: "kan",
    version: "0.1.0",
  });

  registerWorkspaceTools(server, client);
  registerBoardTools(server, client);
  registerListTools(server, client);
  registerCardTools(server, client);
  registerChecklistTools(server, client);
  registerLabelTools(server, client);
  registerMemberTools(server, client);

  return server;
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpToolCategory {
  key: string;
  name: string;
  tools: McpToolInfo[];
}

export interface McpCatalog {
  categories: McpToolCategory[];
  totalTools: number;
}

export function getMcpToolsCatalog(): McpCatalog {
  function extract(
    registrar: (server: McpServer, client: KanClient) => void,
  ): McpToolInfo[] {
    const tools: McpToolInfo[] = [];
    const fakeServer = {
      tool: (name: string, description: string) => {
        tools.push({ name, description });
      },
    } as unknown as McpServer;
    registrar(fakeServer, {} as KanClient);
    return tools;
  }

  const categories: McpToolCategory[] = [
    {
      key: "workspaces",
      name: "Workspaces",
      tools: extract(registerWorkspaceTools),
    },
    { key: "boards", name: "Boards", tools: extract(registerBoardTools) },
    { key: "lists", name: "Lists", tools: extract(registerListTools) },
    { key: "cards", name: "Cards", tools: extract(registerCardTools) },
    {
      key: "checklists",
      name: "Checklists",
      tools: extract(registerChecklistTools),
    },
    { key: "labels", name: "Labels", tools: extract(registerLabelTools) },
    { key: "members", name: "Members", tools: extract(registerMemberTools) },
  ];

  const totalTools = categories.reduce(
    (sum, cat) => sum + cat.tools.length,
    0,
  );

  return { categories, totalTools };
}
