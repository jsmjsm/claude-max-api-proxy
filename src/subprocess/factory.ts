/**
 * Subprocess Factory
 *
 * Determines which CLI backend to use based on the model name,
 * and creates the appropriate subprocess instance.
 */

import { EventEmitter } from "events";
import { ClaudeSubprocess } from "./manager.js";
import { CursorSubprocess } from "./cursor.js";
import { GeminiSubprocess } from "./gemini.js";
import type { BackendType, SubprocessStartOptions } from "../types/common.js";

/**
 * Resolved backend info: which CLI to use and what model alias to pass
 */
export interface ResolvedBackend {
  backend: BackendType;
  cliModel: string;  // Model name/alias to pass to the CLI
}

// ─── Cursor CLI model IDs ───────────────────────────────────────────────────
// From `agent --list-models`
const CURSOR_MODELS = new Set([
  "auto",
  "composer-1.5",
  "composer-1",
  "gpt-5.3-codex",
  "gpt-5.3-codex-low",
  "gpt-5.3-codex-high",
  "gpt-5.3-codex-xhigh",
  "gpt-5.3-codex-fast",
  "gpt-5.3-codex-low-fast",
  "gpt-5.3-codex-high-fast",
  "gpt-5.3-codex-xhigh-fast",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.2-codex-high",
  "gpt-5.2-codex-low",
  "gpt-5.2-codex-xhigh",
  "gpt-5.2-codex-fast",
  "gpt-5.2-codex-high-fast",
  "gpt-5.2-codex-low-fast",
  "gpt-5.2-codex-xhigh-fast",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-max-high",
  "opus-4.6-thinking",
  "sonnet-4.5-thinking",
  "gpt-5.2-high",
  "opus-4.6",
  "opus-4.5",
  "opus-4.5-thinking",
  "sonnet-4.5",
  "gpt-5.1-high",
  "gemini-3-pro",
  "gemini-3-flash",
  "grok",
]);

// ─── Gemini CLI model patterns ──────────────────────────────────────────────
// Gemini CLI uses Google's model names
const GEMINI_CLI_MODELS = new Set([
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
]);

// ─── Claude CLI model aliases ───────────────────────────────────────────────
const CLAUDE_MODEL_MAP: Record<string, string> = {
  "claude-opus-4": "opus",
  "claude-sonnet-4": "sonnet",
  "claude-haiku-4": "haiku",
  "opus": "opus",
  "sonnet": "sonnet",
  "haiku": "haiku",
};

/**
 * Resolve which backend to use and what CLI model name to pass.
 *
 * Model routing rules:
 *   1. "cursor/<model>" prefix → Cursor CLI with <model>
 *   2. "gemini-cli/<model>" prefix → Gemini CLI with <model>
 *   3. "claude/<model>" or "claude-code-cli/<model>" prefix → Claude CLI
 *   4. Known Cursor model IDs → Cursor CLI
 *   5. Known Gemini CLI model IDs → Gemini CLI
 *   6. Known Claude aliases (opus/sonnet/haiku) → Claude CLI
 *   7. Default → Claude CLI with "sonnet"
 */
export function resolveBackend(model: string): ResolvedBackend {
  // 1. Explicit prefix routing
  if (model.startsWith("cursor/")) {
    const cliModel = model.slice("cursor/".length);
    return { backend: "cursor", cliModel: cliModel || "auto" };
  }

  if (model.startsWith("gemini-cli/")) {
    const cliModel = model.slice("gemini-cli/".length);
    return { backend: "gemini", cliModel: cliModel || "" };
  }

  if (model.startsWith("claude/") || model.startsWith("claude-code-cli/")) {
    const prefix = model.startsWith("claude/") ? "claude/" : "claude-code-cli/";
    const remainder = model.slice(prefix.length);
    const cliModel = CLAUDE_MODEL_MAP[remainder] || "sonnet";
    return { backend: "claude", cliModel };
  }

  // 2. Known model IDs
  if (CURSOR_MODELS.has(model)) {
    return { backend: "cursor", cliModel: model };
  }

  if (GEMINI_CLI_MODELS.has(model)) {
    return { backend: "gemini", cliModel: model };
  }

  if (CLAUDE_MODEL_MAP[model]) {
    return { backend: "claude", cliModel: CLAUDE_MODEL_MAP[model] };
  }

  // 3. Pattern matching
  if (model.startsWith("gpt-") || model.startsWith("grok")) {
    return { backend: "cursor", cliModel: model };
  }

  // Default to Claude CLI
  return { backend: "claude", cliModel: "sonnet" };
}

/**
 * Create the appropriate subprocess for the given backend
 */
export function createSubprocess(backend: BackendType): EventEmitter {
  switch (backend) {
    case "cursor":
      return new CursorSubprocess();
    case "gemini":
      return new GeminiSubprocess();
    case "claude":
    default:
      return new ClaudeSubprocess();
  }
}

/**
 * Create a subprocess and start it with the resolved backend
 */
export function createAndStartSubprocess(
  model: string,
  prompt: string,
  options: Omit<SubprocessStartOptions, "model">
): { subprocess: EventEmitter; backend: BackendType; start: () => Promise<void> } {
  const resolved = resolveBackend(model);
  const subprocess = createSubprocess(resolved.backend);

  const startFn = async () => {
    const startOptions: SubprocessStartOptions = {
      ...options,
      model: resolved.cliModel,
    };

    if (subprocess instanceof ClaudeSubprocess) {
      await subprocess.start(prompt, startOptions);
    } else if (subprocess instanceof CursorSubprocess) {
      await subprocess.start(prompt, startOptions);
    } else if (subprocess instanceof GeminiSubprocess) {
      await subprocess.start(prompt, startOptions);
    }
  };

  return { subprocess, backend: resolved.backend, start: startFn };
}
