import type { NextApiRequest, NextApiResponse } from "next";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "next-runtime-env";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { getApiToken } from "@kan/api/utils/apiToken";
import { createKanMcpServer } from "@kan/mcp";
import { createKanClient } from "@kan/mcp/client";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiToken = getApiToken(req);
  if (!apiToken) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="kan"');
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const rawBaseUrl = env("NEXT_PUBLIC_BASE_URL");
  if (!rawBaseUrl) {
    res.status(500).json({ error: "NEXT_PUBLIC_BASE_URL is not configured" });
    return;
  }
  const baseUrl = rawBaseUrl.replace(/\/$/, "");

  const client = createKanClient({ baseUrl, apiToken });

  const server = createKanMcpServer(client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export default withApiLogging(handler, { transport: "mcp" });
