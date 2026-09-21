import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Key,
  Terminal,
  Wrench,
} from "lucide-react";

import { authClient } from "@kan/auth/client";
import type { McpCatalog } from "@kan/mcp";

import Button from "~/components/Button";
import FeedbackModal from "~/components/FeedbackModal";
import Input from "~/components/Input";
import Modal from "~/components/modal";
import { NewWorkspaceForm } from "~/components/NewWorkspaceForm";
import { PageHead } from "~/components/PageHead";
import { useClipboard } from "~/hooks/useClipboard";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import NewApiKeyModal from "./components/NewApiKeyModal";

interface McpSettingsProps {
  catalog: McpCatalog;
}

export default function McpSettings({ catalog }: McpSettingsProps) {
  const { modalContentType, openModal, isOpen } = useModal();
  const { showPopup } = usePopup();
  const { copy: copyEndpoint, copied: endpointCopied } = useClipboard({
    timeout: 2000,
  });
  const { copy: copySnippet, copied: snippetCopied } = useClipboard({
    timeout: 2000,
  });

  const [origin, setOrigin] = useState("http://localhost:3000");
  const [selectedClient, setSelectedClient] = useState<"cursor" | "claude">(
    "cursor",
  );
  const [toolSearch, setToolSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const endpointUrl = `${origin}/api/mcp`;

  const { data: apiKeysData } = useQuery({
    queryKey: ["apiKeys"],
    queryFn: () => authClient.apiKey.list(),
  });

  const apiKeys = apiKeysData?.data ?? [];

  const handleCopyEndpoint = () => {
    copyEndpoint(endpointUrl);
    showPopup({
      header: t`Copied to clipboard`,
      message: t`MCP endpoint copied to clipboard`,
      icon: "success",
    });
  };

  const cursorSnippet = useMemo(() => {
    return JSON.stringify(
      {
        mcpServers: {
          kan: {
            url: endpointUrl,
            headers: {
              Authorization: "Bearer <YOUR_API_KEY>",
            },
          },
        },
      },
      null,
      2,
    );
  }, [endpointUrl]);

  const claudeSnippet = useMemo(() => {
    return JSON.stringify(
      {
        mcpServers: {
          kan: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              endpointUrl,
              "--header",
              "Authorization: Bearer <YOUR_API_KEY>",
            ],
          },
        },
      },
      null,
      2,
    );
  }, [endpointUrl]);

  const activeSnippet =
    selectedClient === "cursor" ? cursorSnippet : claudeSnippet;

  const handleCopySnippet = () => {
    copySnippet(activeSnippet);
    showPopup({
      header: t`Copied to clipboard`,
      message: t`Client configuration copied to clipboard`,
      icon: "success",
    });
  };

  const toggleCategory = (categoryKey: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryKey]: !prev[categoryKey],
    }));
  };

  const normalizedSearch = toolSearch.trim().toLowerCase();

  const filteredCategories = useMemo(() => {
    if (!normalizedSearch) return catalog.categories;

    return catalog.categories
      .map((cat) => ({
        ...cat,
        tools: cat.tools.filter(
          (tool) =>
            tool.name.toLowerCase().includes(normalizedSearch) ||
            tool.description.toLowerCase().includes(normalizedSearch),
        ),
      }))
      .filter((cat) => cat.tools.length > 0);
  }, [catalog.categories, normalizedSearch]);

  const totalFilteredTools = useMemo(() => {
    return filteredCategories.reduce(
      (acc, cat) => acc + cat.tools.length,
      0,
    );
  }, [filteredCategories]);

  return (
    <>
      <PageHead title={t`Settings | MCP`} />

      {/* Section 1: Server Status & Endpoint */}
      <div className="mb-8 border-t border-light-300 dark:border-dark-300">
        <div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-[14px] font-medium text-neutral-900 dark:text-dark-1000">
              {t`Model Context Protocol (MCP)`}
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-dark-900">
              {t`Connect AI assistants and coding agents to your Kan boards via standard Streamable HTTP MCP.`}
            </p>
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t`Available · Streamable HTTP`}
            </span>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100">
          <label className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-dark-900">
            {t`Hosted MCP Server Endpoint`}
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={endpointUrl}
              className="w-full rounded-md border-0 bg-light-100 py-2 pl-3 pr-4 font-mono text-xs text-neutral-900 shadow-sm ring-1 ring-inset ring-light-300 focus:ring-2 focus:ring-inset focus:ring-light-600 dark:bg-dark-200 dark:text-dark-1000 dark:ring-dark-300 sm:text-sm"
            />
            <Button
              variant="secondary"
              className="flex shrink-0 items-center gap-1.5"
              onClick={handleCopyEndpoint}
            >
              {endpointCopied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {endpointCopied ? t`Copied` : t`Copy`}
            </Button>
          </div>
          <p className="mt-2 text-xs text-neutral-500 dark:text-dark-900">
            {t`Accepts POST requests using the MCP Streamable HTTP transport with Bearer token authentication.`}
          </p>
        </div>
      </div>

      {/* Section 2: API Keys & Authentication */}
      <div className="mb-8 border-t border-light-300 dark:border-dark-300">
        <div className="mt-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-neutral-500 dark:text-dark-900" />
            <h2 className="text-[14px] font-medium text-neutral-900 dark:text-dark-1000">
              {t`Authentication`}
            </h2>
          </div>
          <Button variant="primary" onClick={() => openModal("NEW_API_KEY")}>
            {t`Create API key`}
          </Button>
        </div>
        <p className="mt-1 text-sm text-neutral-500 dark:text-dark-900">
          {t`MCP requests require a Kan API key provided as an Authorization Bearer header.`}
        </p>

        <div className="mt-4">
          {apiKeys.length > 0 ? (
            <div className="rounded-lg border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100">
              <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-dark-900">
                <span>
                  {t`Active API keys:`}{" "}
                  <strong className="font-medium text-neutral-900 dark:text-dark-1000">
                    {apiKeys.length}
                  </strong>
                </span>
                <Link
                  href="/settings/api"
                  className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  {t`Manage API keys →`}
                </Link>
              </div>
              <ul className="mt-3 divide-y divide-light-200 border-t border-light-200 dark:divide-dark-300 dark:border-dark-300">
                {apiKeys.slice(0, 3).map((key) => (
                  <li
                    key={key.id}
                    className="flex items-center justify-between py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-neutral-900 dark:text-dark-1000">
                        {key.name}
                      </span>
                      {key.start && (
                        <span className="font-mono text-neutral-400 dark:text-dark-800">
                          ({key.start}...)
                        </span>
                      )}
                    </div>
                    <span className="text-neutral-400 dark:text-dark-800">
                      {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-light-400 p-6 text-center dark:border-dark-300">
              <p className="text-sm text-neutral-500 dark:text-dark-900">
                {t`You do not have any active API keys. Create one to authenticate your MCP client.`}
              </p>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  onClick={() => openModal("NEW_API_KEY")}
                >
                  {t`Generate key`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Client Configuration */}
      <div className="mb-8 border-t border-light-300 dark:border-dark-300">
        <div className="mt-8 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-neutral-500 dark:text-dark-900" />
          <h2 className="text-[14px] font-medium text-neutral-900 dark:text-dark-1000">
            {t`Client Configuration`}
          </h2>
        </div>
        <p className="mt-1 text-sm text-neutral-500 dark:text-dark-900">
          {t`Add Kan to your AI workspace configuration file.`}
        </p>

        <div className="mt-4 flex gap-2 border-b border-light-300 pb-2 dark:border-dark-300">
          <button
            type="button"
            onClick={() => setSelectedClient("cursor")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              selectedClient === "cursor"
                ? "bg-light-300 text-neutral-900 dark:bg-dark-300 dark:text-dark-1000"
                : "text-neutral-500 hover:text-neutral-900 dark:text-dark-900 dark:hover:text-dark-1000"
            }`}
          >
            {t`Cursor (~/.cursor/mcp.json)`}
          </button>
          <button
            type="button"
            onClick={() => setSelectedClient("claude")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              selectedClient === "claude"
                ? "bg-light-300 text-neutral-900 dark:bg-dark-300 dark:text-dark-1000"
                : "text-neutral-500 hover:text-neutral-900 dark:text-dark-900 dark:hover:text-dark-1000"
            }`}
          >
            {t`Claude Desktop (claude_desktop_config.json)`}
          </button>
        </div>

        <div className="relative mt-3">
          <pre className="overflow-x-auto rounded-lg border border-light-300 bg-neutral-900 p-4 font-mono text-xs text-neutral-100 dark:border-dark-300 dark:bg-dark-50">
            <code>{activeSnippet}</code>
          </pre>
          <div className="absolute right-3 top-3">
            <Button
              variant="secondary"
              className="flex items-center gap-1.5 py-1 text-xs"
              onClick={handleCopySnippet}
            >
              {snippetCopied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {snippetCopied ? t`Copied` : t`Copy Config`}
            </Button>
          </div>
        </div>
      </div>

      {/* Section 4: Available Tools Catalog (Derived dynamically from canonical registry) */}
      <div className="mb-8 border-t border-light-300 dark:border-dark-300">
        <div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-neutral-500 dark:text-dark-900" />
            <h2 className="text-[14px] font-medium text-neutral-900 dark:text-dark-1000">
              {t`Available Tools`}
            </h2>
            <span className="rounded-full bg-light-300 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-dark-300 dark:text-dark-900">
              {totalFilteredTools === catalog.totalTools
                ? `${catalog.totalTools} tools`
                : `${totalFilteredTools} of ${catalog.totalTools} tools`}
            </span>
          </div>

          <div className="w-full sm:w-64">
            <Input
              type="text"
              placeholder={t`Filter tools...`}
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              className="py-1.5 text-xs"
            />
          </div>
        </div>

        <p className="mt-1 text-sm text-neutral-500 dark:text-dark-900">
          {t`These canonical tools are registered and available to AI models calling your Kan MCP endpoint.`}
        </p>

        {/* Categories accordion */}
        <div className="mt-4 space-y-3">
          {filteredCategories.length > 0 ? (
            filteredCategories.map((category) => {
              const isCollapsed = Boolean(collapsedCategories[category.key]);

              return (
                <div
                  key={category.key}
                  className="overflow-hidden rounded-lg border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-100"
                >
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.key)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-light-100 dark:hover:bg-dark-200"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-neutral-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-neutral-500" />
                      )}
                      <span className="text-sm font-medium text-neutral-900 dark:text-dark-1000">
                        {category.name}
                      </span>
                      <span className="rounded-full bg-light-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-dark-300 dark:text-dark-900">
                        {category.tools.length}
                      </span>
                    </div>
                  </button>

                  {!isCollapsed && (
                    <div className="border-t border-light-300 dark:border-dark-300">
                      <div className="divide-y divide-light-200 dark:divide-dark-300">
                        {category.tools.map((tool) => (
                          <div
                            key={tool.name}
                            className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4"
                          >
                            <span className="w-48 shrink-0 font-mono text-xs font-medium text-indigo-600 dark:text-indigo-400">
                              {tool.name}
                            </span>
                            <span className="text-xs text-neutral-600 dark:text-dark-900">
                              {tool.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-light-300 p-6 text-center text-xs text-neutral-500 dark:border-dark-300 dark:text-dark-900">
              {t`No tools matching "${toolSearch}"`}
            </div>
          )}
        </div>
      </div>

      {/* API Key Modals */}
      <Modal
        modalSize="sm"
        isVisible={isOpen && modalContentType === "NEW_API_KEY"}
      >
        <NewApiKeyModal />
      </Modal>

      {/* Global Modals */}
      <Modal
        modalSize="md"
        isVisible={isOpen && modalContentType === "NEW_FEEDBACK"}
      >
        <FeedbackModal />
      </Modal>
      <Modal
        modalSize="sm"
        isVisible={isOpen && modalContentType === "NEW_WORKSPACE"}
      >
        <NewWorkspaceForm />
      </Modal>
    </>
  );
}
