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
 * Model routing rules (checked in order):
 *
 *   --- Slash-prefix format (direct API usage) ---
 *   1. "cursor/<model>"                    → Cursor CLI with <model>
 *   2. "gemini-cli/<model>" or "gemini/<model>" → Gemini CLI with <model>
 *   3. "claude/<model>" or "claude-code-cli/<model>" → Claude CLI
 *
 *   --- Dash-prefix format (OpenClaw custom provider sends model IDs like this) ---
 *   4. "cursor-<model>"  → Cursor CLI with <model> (e.g. "cursor-auto" → "auto")
 *   5. "gemini-cli-<model>" → Gemini CLI with <model>
 *   6. "claude-<alias>"  → Claude CLI (e.g. "claude-opus-4" → "opus")
 *
 *   --- Bare model IDs ---
 *   7. Known Cursor model IDs (from CURSOR_MODELS set) → Cursor CLI
 *   8. Known Gemini CLI model IDs → Gemini CLI
 *   9. Known Claude aliases (opus/sonnet/haiku) → Claude CLI
 *  10. GPT/Grok pattern match → Cursor CLI
 *  11. Default → Claude CLI with "sonnet"
 */
export function resolveBackend(model: string): ResolvedBackend {
  // ─── 1-3. Slash-prefix routing (direct API callers) ─────────────────
  if (model.startsWith("cursor/")) {
    const cliModel = model.slice("cursor/".length);
    return { backend: "cursor", cliModel: cliModel || "auto" };
  }

  if (model.startsWith("gemini-cli/")) {
    const cliModel = model.slice("gemini-cli/".length);
    return { backend: "gemini", cliModel: cliModel || "" };
  }

  if (model.startsWith("gemini/")) {
    const cliModel = model.slice("gemini/".length);
    return { backend: "gemini", cliModel: cliModel || "" };
  }

  if (model.startsWith("claude/") || model.startsWith("claude-code-cli/")) {
    const prefix = model.startsWith("claude/") ? "claude/" : "claude-code-cli/";
    const remainder = model.slice(prefix.length);
    const cliModel = CLAUDE_MODEL_MAP[remainder] || "sonnet";
    return { backend: "claude", cliModel };
  }

  // ─── 4-6. Dash-prefix routing (OpenClaw custom provider format) ─────
  // When registered as `models.providers.cli-proxy`, OpenClaw strips the
  // "cli-proxy/" prefix and sends only the model ID. Since model IDs can't
  // contain "/" in OpenClaw, we use dashes: "cursor-auto", "cursor-opus-4.6", etc.
  const cursorDashMatch = matchDashPrefix(model, "cursor-", CURSOR_MODELS);
  if (cursorDashMatch) {
    return { backend: "cursor", cliModel: cursorDashMatch };
  }

  if (model.startsWith("gemini-cli-")) {
    const cliModel = model.slice("gemini-cli-".length);
    return { backend: "gemini", cliModel };
  }

  // Claude dash-prefix: "claude-opus-4" → "opus", "claude-sonnet-4" → "sonnet"
  const claudeDashMatch = matchClaudeDashPrefix(model);
  if (claudeDashMatch) {
    return { backend: "claude", cliModel: claudeDashMatch };
  }

  // ─── 7-9. Bare model IDs ───────────────────────────────────────────
  if (CURSOR_MODELS.has(model)) {
    return { backend: "cursor", cliModel: model };
  }

  if (GEMINI_CLI_MODELS.has(model)) {
    return { backend: "gemini", cliModel: model };
  }

  if (CLAUDE_MODEL_MAP[model]) {
    return { backend: "claude", cliModel: CLAUDE_MODEL_MAP[model] };
  }

  // ─── 10. Pattern matching ──────────────────────────────────────────
  if (model.startsWith("gpt-") || model.startsWith("grok")) {
    return { backend: "cursor", cliModel: model };
  }

  // ─── 11. Default → Claude CLI ──────────────────────────────────────
  return { backend: "claude", cliModel: "sonnet" };
}

/**
 * Match a dash-prefixed model ID against known Cursor models.
 *
 * OpenClaw sends "cursor-auto", "cursor-opus-4.6-thinking", etc.
 * We try progressively longer suffixes to find the best match in CURSOR_MODELS.
 *
 * Example: "cursor-opus-4.6-thinking"
 *   → try "opus-4.6-thinking" (found in CURSOR_MODELS) → return "opus-4.6-thinking"
 *
 * Example: "cursor-auto"
 *   → try "auto" (found in CURSOR_MODELS) → return "auto"
 */
function matchDashPrefix(model: string, prefix: string, knownModels: Set<string>): string | null {
  if (!model.startsWith(prefix)) return null;

  const remainder = model.slice(prefix.length);
  if (!remainder) return null;

  // Direct match: the remainder is a known model
  if (knownModels.has(remainder)) {
    return remainder;
  }

  // If not a direct match, it's still likely a Cursor model we just
  // don't have in our hardcoded set — pass it through anyway.
  // The Cursor CLI will validate it.
  return remainder;
}

/**
 * Match Claude dash-prefixed model IDs.
 *
 * Handles: "claude-opus-4" → "opus", "claude-sonnet-4" → "sonnet", "claude-haiku-4" → "haiku"
 */
function matchClaudeDashPrefix(model: string): string | null {
  // Only match if it starts with "claude-" but NOT "claude-code-cli-" (handled elsewhere)
  if (!model.startsWith("claude-") || model.startsWith("claude-code-cli-")) return null;

  const remainder = model.slice("claude-".length);

  // Check against known Claude model aliases
  if (CLAUDE_MODEL_MAP[remainder]) {
    return CLAUDE_MODEL_MAP[remainder];
  }

  // Also check the full model name (e.g. "claude-opus-4" → look up "opus-4")
  // Map common OpenClaw-style names to CLI aliases
  if (remainder.startsWith("opus")) return "opus";
  if (remainder.startsWith("sonnet")) return "sonnet";
  if (remainder.startsWith("haiku")) return "haiku";

  return null;
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
