import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-runtime-env", () => ({
  env: vi.fn(),
}));

vi.mock("@kan/api/trpc", () => ({
  createNextApiContext: vi
    .fn()
    .mockRejectedValue(new Error("no auth in tests")),
}));

vi.mock("@kan/logger", () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

const request = vi.fn();
vi.mock("@kan/mcp/client", () => ({
  createKanClient: vi.fn(() => ({ request })),
  KanApiError: class KanApiError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      public body: unknown,
    ) {
      super("Kan API error");
    }
  },
}));

const connect = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);
vi.mock("@kan/mcp", () => ({
  createKanMcpServer: vi.fn(() => ({ connect, close })),
}));

const handleRequest = vi.fn().mockResolvedValue(undefined);
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    handleRequest,
  })),
}));

const { env } = await import("next-runtime-env");
const mockedEnv = vi.mocked(env);
const { createKanClient } = await import("@kan/mcp/client");
const mockedCreateKanClient = vi.mocked(createKanClient);
const handler = (await import("../pages/api/mcp.js")).default;

function makeReqRes(
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
) {
  const req = {
    method: options.method ?? "POST",
    headers: {
      authorization: "Bearer kan_test_token",
      ...options.headers,
    },
    body: options.body ?? {},
  } as unknown as NextApiRequest;
  const statusSpy = vi.fn().mockReturnThis();
  const jsonSpy = vi.fn().mockReturnThis();
  const setHeaderSpy = vi.fn().mockReturnThis();
  const onSpy = vi.fn();
  const res = {
    setHeader: setHeaderSpy,
    status: statusSpy,
    json: jsonSpy,
    on: onSpy,
  } as unknown as NextApiResponse;
  return { req, res, statusSpy, jsonSpy, setHeaderSpy, onSpy };
}

describe("POST /api/mcp", () => {
  beforeEach(() => {
    request.mockReset();
    connect.mockClear();
    handleRequest.mockClear();
    mockedCreateKanClient.mockClear();
    mockedEnv.mockReset();
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "http://localhost:3000";
      return undefined;
    });
  });

  it("rejects non-POST methods with 405 Method Not Allowed", async () => {
    const { req, res, statusSpy, jsonSpy, setHeaderSpy } = makeReqRes({
      method: "GET",
    });
    await handler(req, res);

    expect(setHeaderSpy).toHaveBeenCalledWith("Allow", "POST");
    expect(statusSpy).toHaveBeenCalledWith(405);
    expect(jsonSpy).toHaveBeenCalledWith({ error: "Method not allowed" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects requests without API key with 401 Unauthorized", async () => {
    const { req, res, statusSpy, jsonSpy, setHeaderSpy } = makeReqRes({
      headers: { authorization: "" },
    });
    await handler(req, res);

    expect(setHeaderSpy).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Bearer realm="kan"',
    );
    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith({ error: "Missing API key" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("accepts a lowercase 'bearer' authorization header", async () => {
    const { req, res, statusSpy } = makeReqRes({
      headers: { authorization: "bearer kan_test_token_lowercase" },
    });
    await handler(req, res);

    expect(statusSpy).not.toHaveBeenCalledWith(401);
    expect(mockedCreateKanClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "kan_test_token_lowercase" }),
    );
    expect(connect).toHaveBeenCalled();
    expect(handleRequest).toHaveBeenCalled();
  });

  it("accepts an x-api-key header", async () => {
    const { req, res, statusSpy } = makeReqRes({
      headers: {
        authorization: "",
        "x-api-key": "kan_api_key_header_value",
      },
    });
    await handler(req, res);

    expect(statusSpy).not.toHaveBeenCalledWith(401);
    expect(mockedCreateKanClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "kan_api_key_header_value" }),
    );
    expect(connect).toHaveBeenCalled();
  });

  it("strips trailing slash from NEXT_PUBLIC_BASE_URL", async () => {
    mockedEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "http://localhost:3000/";
      return undefined;
    });

    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(mockedCreateKanClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:3000" }),
    );
  });

  it("initializes transport and handles request on valid authentication", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const { req, res, onSpy } = makeReqRes({ body });
    await handler(req, res);

    expect(connect).toHaveBeenCalled();
    expect(handleRequest).toHaveBeenCalledWith(req, res, body);
    expect(onSpy).toHaveBeenCalledWith("close", expect.any(Function));
  });
});
