/**
 * Multi-CLI API Proxy Plugin for Clawdbot
 *
 * Enables using Claude Max, Cursor Pro, and Gemini subscriptions
 * through their respective CLI tools, exposed as an OpenAI-compatible API.
 *
 * Supported backends:
 *   - Claude Code CLI (`claude`) — Claude Max subscription
 *   - Cursor CLI (`agent`) — Cursor Pro subscription
 *   - Gemini CLI (`gemini`) — Google Gemini subscription
 */

import { startServer, stopServer, getServer } from "./server/index.js";
import { verifyClaude, verifyAuth } from "./subprocess/manager.js";
import { verifyCursor } from "./subprocess/cursor.js";
import { verifyGemini } from "./subprocess/gemini.js";

// Provider constants
const PROVIDER_ID = "multi-cli-proxy";
const PROVIDER_LABEL = "Multi-CLI Proxy";
const DEFAULT_PORT = 3456;
const DEFAULT_MODEL = "claude-sonnet-4";

// Available models across all backends
const CLAUDE_MODELS = [
  {
    id: "claude-opus-4",
    name: "Claude Opus 4.5",
    reasoning: true,
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    reasoning: false,
  },
  {
    id: "claude-haiku-4",
    name: "Claude Haiku 4",
    reasoning: false,
  },
];

const CURSOR_MODELS = [
  {
    id: "cursor/opus-4.6-thinking",
    name: "Cursor: Claude 4.6 Opus (Thinking)",
    reasoning: true,
  },
  {
    id: "cursor/opus-4.6",
    name: "Cursor: Claude 4.6 Opus",
    reasoning: false,
  },
  {
    id: "cursor/sonnet-4.5-thinking",
    name: "Cursor: Claude 4.5 Sonnet (Thinking)",
    reasoning: true,
  },
  {
    id: "cursor/sonnet-4.5",
    name: "Cursor: Claude 4.5 Sonnet",
    reasoning: false,
  },
  {
    id: "cursor/gpt-5.3-codex",
    name: "Cursor: GPT-5.3 Codex",
    reasoning: false,
  },
  {
    id: "cursor/gpt-5.2",
    name: "Cursor: GPT-5.2",
    reasoning: false,
  },
  {
    id: "cursor/auto",
    name: "Cursor: Auto",
    reasoning: false,
  },
];

const GEMINI_MODELS = [
  {
    id: "gemini-cli/gemini-2.5-pro",
    name: "Gemini 2.5 Pro (CLI)",
    reasoning: false,
  },
  {
    id: "gemini-cli/gemini-2.5-flash",
    name: "Gemini 2.5 Flash (CLI)",
    reasoning: false,
  },
];

const ALL_MODELS = [...CLAUDE_MODELS, ...CURSOR_MODELS, ...GEMINI_MODELS];

/**
 * Build model definitions for Clawdbot config
 */
function buildModelDefinition(model: (typeof ALL_MODELS)[number]) {
  return {
    id: model.id,
    name: model.name,
    api: "openai-completions",
    reasoning: model.reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };
}

/**
 * Empty plugin config schema (no user configuration needed)
 */
function emptyPluginConfigSchema() {
  return {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  };
}

/**
 * Plugin definition
 */
const multiCliProxyPlugin = {
  id: "multi-cli-proxy-provider",
  name: "Multi-CLI API Proxy",
  description:
    "Use Claude Max, Cursor Pro, and Gemini subscriptions via their CLI tools (OpenAI-compatible API)",
  configSchema: emptyPluginConfigSchema(),

  register(api: any) {
    let serverPort = DEFAULT_PORT;

    // Register the provider
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/multi-cli-proxy",
      aliases: ["claude-cli", "cursor-cli", "gemini-cli", "claude-max"],
      envVars: [], // No env vars needed - CLIs handle their own auth

      auth: [
        {
          id: "local",
          label: "Local CLI Proxy",
          hint: "Uses your existing CLI authentication (Claude Max, Cursor Pro, Gemini)",
          kind: "custom",

          run: async (ctx: any) => {
            const spin = ctx.prompter.progress("Checking CLI backends...");

            try {
              const availableBackends: string[] = [];

              // Check Claude CLI
              const claudeCheck = await verifyClaude();
              if (claudeCheck.ok) {
                const authCheck = await verifyAuth();
                if (authCheck.ok) {
                  availableBackends.push("claude");
                }
              }

              // Check Cursor CLI
              const cursorCheck = await verifyCursor();
              if (cursorCheck.ok) {
                availableBackends.push("cursor");
              }

              // Check Gemini CLI
              const geminiCheck = await verifyGemini();
              if (geminiCheck.ok) {
                availableBackends.push("gemini");
              }

              if (availableBackends.length === 0) {
                spin.stop("No CLI backends found");
                await ctx.prompter.note(
                  "Install at least one CLI: claude, agent, or gemini",
                  "Installation"
                );
                throw new Error("No CLI backends available");
              }

              spin.message(`Found backends: ${availableBackends.join(", ")}. Starting server...`);

              // Ask for port
              const portInput = await ctx.prompter.text({
                message: "Local server port",
                initialValue: String(DEFAULT_PORT),
                validate: (v: string) => {
                  const p = parseInt(v, 10);
                  if (isNaN(p) || p < 1 || p > 65535) {
                    return "Enter a valid port (1-65535)";
                  }
                  return undefined;
                },
              });
              serverPort = parseInt(portInput, 10);

              // Start the local server
              await startServer({ port: serverPort });
              spin.stop("Multi-CLI proxy ready");

              const baseUrl = `http://127.0.0.1:${serverPort}/v1`;

              // Filter models to only include available backends
              const availableModels = ALL_MODELS.filter((m) => {
                if (m.id.startsWith("cursor/")) return availableBackends.includes("cursor");
                if (m.id.startsWith("gemini-cli/")) return availableBackends.includes("gemini");
                return availableBackends.includes("claude");
              });

              return {
                profiles: [
                  {
                    profileId: `${PROVIDER_ID}:local`,
                    credential: {
                      type: "token",
                      provider: PROVIDER_ID,
                      token: "local",
                    },
                  },
                ],
                configPatch: {
                  models: {
                    providers: {
                      [PROVIDER_ID]: {
                        baseUrl,
                        apiKey: "local",
                        api: "openai-completions",
                        authHeader: false,
                        models: availableModels.map(buildModelDefinition),
                      },
                    },
                  },
                  agents: {
                    defaults: {
                      models: Object.fromEntries(
                        availableModels.map((m) => [
                          `${PROVIDER_ID}/${m.id}`,
                          {},
                        ])
                      ),
                    },
                  },
                },
                defaultModel: DEFAULT_MODEL,
                notes: [
                  `Available backends: ${availableBackends.join(", ")}`,
                  "Uses your existing CLI subscriptions — no additional API costs.",
                  `Local server running at http://127.0.0.1:${serverPort}`,
                  "Model prefixes: claude-* (Claude CLI), cursor/* (Cursor CLI), gemini-cli/* (Gemini CLI)",
                ],
              };
            } catch (err) {
              spin.stop("Setup failed");
              throw err;
            }
          },
        },
      ],
    });

    // Handle plugin unload
    api.on("plugin:unload", async () => {
      const server = getServer();
      if (server) {
        console.log("[MultiCliProxy] Stopping server on plugin unload");
        await stopServer();
      }
    });

    // Register CLI commands for manual server control
    api.registerCli?.((cli: any) => {
      cli
        .command("proxy:start [port]")
        .description("Start the multi-CLI proxy server")
        .action(async (port: string) => {
          const p = parseInt(port || String(DEFAULT_PORT), 10);
          await startServer({ port: p });
          console.log(`Server started on port ${p}`);
        });

      cli
        .command("proxy:stop")
        .description("Stop the multi-CLI proxy server")
        .action(async () => {
          await stopServer();
          console.log("Server stopped");
        });

      cli
        .command("proxy:status")
        .description("Check multi-CLI proxy server status")
        .action(() => {
          const server = getServer();
          if (server) {
            console.log(`Server is running on port ${serverPort}`);
          } else {
            console.log("Server is not running");
          }
        });
    });

    console.log("[MultiCliProxy] Plugin registered");
  },
};

export default multiCliProxyPlugin;

// Also export server utilities for standalone use
export { startServer, stopServer, getServer } from "./server/index.js";
export { ClaudeSubprocess, verifyClaude, verifyAuth } from "./subprocess/manager.js";
export { CursorSubprocess, verifyCursor } from "./subprocess/cursor.js";
export { GeminiSubprocess, verifyGemini } from "./subprocess/gemini.js";
export { sessionManager } from "./session/manager.js";
