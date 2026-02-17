#!/usr/bin/env node
/**
 * Standalone server for testing without Clawdbot
 *
 * Supports multiple CLI backends: Claude Code CLI, Cursor CLI (agent), Gemini CLI
 *
 * Usage:
 *   npm run start
 *   # or
 *   node dist/server/standalone.js [port]
 */

import { startServer, stopServer } from "./index.js";
import { verifyClaude, verifyAuth } from "../subprocess/manager.js";
import { verifyCursor } from "../subprocess/cursor.js";
import { verifyGemini } from "../subprocess/gemini.js";

const DEFAULT_PORT = 3456;

async function main(): Promise<void> {
  console.log("Multi-CLI API Proxy - Standalone Server");
  console.log("=======================================\n");

  // Parse port from command line
  const port = parseInt(process.argv[2] || String(DEFAULT_PORT), 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${process.argv[2]}`);
    process.exit(1);
  }

  // Track available backends
  const backends: string[] = [];

  // ─── Verify Claude CLI ─────────────────────────────────────────────
  console.log("Checking Claude CLI (claude)...");
  const claudeCheck = await verifyClaude();
  if (claudeCheck.ok) {
    console.log(`  ✓ Claude CLI: ${claudeCheck.version || "OK"}`);
    const authCheck = await verifyAuth();
    if (authCheck.ok) {
      console.log("  ✓ Claude Auth: OK");
      backends.push("claude");
    } else {
      console.log(`  ✗ Claude Auth: ${authCheck.error}`);
    }
  } else {
    console.log(`  ✗ ${claudeCheck.error}`);
  }

  // ─── Verify Cursor CLI ────────────────────────────────────────────
  console.log("Checking Cursor CLI (agent)...");
  const cursorCheck = await verifyCursor();
  if (cursorCheck.ok) {
    console.log(`  ✓ Cursor CLI: ${cursorCheck.version || "OK"}`);
    backends.push("cursor");
  } else {
    console.log(`  ✗ ${cursorCheck.error}`);
  }

  // ─── Verify Gemini CLI ────────────────────────────────────────────
  console.log("Checking Gemini CLI (gemini)...");
  const geminiCheck = await verifyGemini();
  if (geminiCheck.ok) {
    console.log(`  ✓ Gemini CLI: ${geminiCheck.version || "OK"}`);
    backends.push("gemini");
  } else {
    console.log(`  ✗ ${geminiCheck.error}`);
  }

  console.log("");

  if (backends.length === 0) {
    console.error("Error: No CLI backends available.");
    console.error("Install at least one of:");
    console.error("  Claude: npm install -g @anthropic-ai/claude-code");
    console.error("  Cursor: https://docs.cursor.com/agent");
    console.error("  Gemini: npm install -g @anthropic-ai/gemini-cli");
    process.exit(1);
  }

  console.log(`Available backends: ${backends.join(", ")}\n`);

  // Start server
  try {
    await startServer({ port });
    console.log("\nServer ready. Examples:\n");

    if (backends.includes("claude")) {
      console.log("  # Claude CLI:");
      console.log(`  curl -X POST http://localhost:${port}/v1/chat/completions \\`);
      console.log(`    -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"model": "claude-sonnet-4", "messages": [{"role": "user", "content": "Hello!"}]}'`);
      console.log("");
    }

    if (backends.includes("cursor")) {
      console.log("  # Cursor CLI:");
      console.log(`  curl -X POST http://localhost:${port}/v1/chat/completions \\`);
      console.log(`    -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"model": "cursor/auto", "messages": [{"role": "user", "content": "Hello!"}]}'`);
      console.log("");
    }

    if (backends.includes("gemini")) {
      console.log("  # Gemini CLI:");
      console.log(`  curl -X POST http://localhost:${port}/v1/chat/completions \\`);
      console.log(`    -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"model": "gemini-cli/gemini-2.5-pro", "messages": [{"role": "user", "content": "Hello!"}]}'`);
      console.log("");
    }

    console.log("Press Ctrl+C to stop.\n");
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await stopServer();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
