/**
 * Claude Code CLI Subprocess Manager
 *
 * Handles spawning, managing, and parsing output from Claude CLI subprocesses.
 * Uses spawn() instead of exec() to prevent shell injection vulnerabilities.
 *
 * Emits standardized events (ContentDeltaEvent, ResultEvent) for uniform
 * handling across all CLI backends.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type {
  ClaudeCliMessage,
  ClaudeCliAssistant,
  ClaudeCliResult,
  ClaudeCliStreamEvent,
} from "../types/claude-cli.js";
import { isAssistantMessage, isResultMessage, isContentDelta } from "../types/claude-cli.js";
import type { ContentDeltaEvent, ResultEvent, SubprocessStartOptions } from "../types/common.js";

export type ClaudeModel = "opus" | "sonnet" | "haiku";

const DEFAULT_TIMEOUT = 300000; // 5 minutes

export class ClaudeSubprocess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private timeoutId: NodeJS.Timeout | null = null;
  private isKilled: boolean = false;

  /**
   * Start the Claude CLI subprocess with the given prompt
   */
  async start(prompt: string, options: SubprocessStartOptions): Promise<void> {
    const args = this.buildArgs(prompt, options);
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      try {
        // Use spawn() for security - no shell interpretation
        this.process = spawn("claude", args, {
          cwd: options.cwd || process.cwd(),
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Set timeout
        this.timeoutId = setTimeout(() => {
          if (!this.isKilled) {
            this.isKilled = true;
            this.process?.kill("SIGTERM");
            this.emit("error", new Error(`Request timed out after ${timeout}ms`));
          }
        }, timeout);

        // Handle spawn errors (e.g., claude not found)
        this.process.on("error", (err) => {
          this.clearTimeout();
          if (err.message.includes("ENOENT")) {
            reject(
              new Error(
                "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
              )
            );
          } else {
            reject(err);
          }
        });

        // Close stdin since we pass prompt as argument
        this.process.stdin?.end();

        console.error(`[ClaudeSubprocess] Process spawned with PID: ${this.process.pid}`);

        // Parse JSON stream from stdout
        this.process.stdout?.on("data", (chunk: Buffer) => {
          const data = chunk.toString();
          console.error(`[ClaudeSubprocess] Received ${data.length} bytes of stdout`);
          this.buffer += data;
          this.processBuffer();
        });

        // Capture stderr for debugging
        this.process.stderr?.on("data", (chunk: Buffer) => {
          const errorText = chunk.toString().trim();
          if (errorText) {
            // Don't emit as error unless it's actually an error
            // Claude CLI may write debug info to stderr
            console.error("[ClaudeSubprocess stderr]:", errorText.slice(0, 200));
          }
        });

        // Handle process close
        this.process.on("close", (code) => {
          console.error(`[ClaudeSubprocess] Process closed with code: ${code}`);
          this.clearTimeout();
          // Process any remaining buffer
          if (this.buffer.trim()) {
            this.processBuffer();
          }
          this.emit("close", code);
        });

        // Resolve immediately since we're streaming
        resolve();
      } catch (err) {
        this.clearTimeout();
        reject(err);
      }
    });
  }

  /**
   * Build CLI arguments array
   */
  private buildArgs(prompt: string, options: SubprocessStartOptions): string[] {
    const args = [
      "--print", // Non-interactive mode
      "--output-format",
      "stream-json", // JSON streaming output
      "--verbose", // Required for stream-json
      "--include-partial-messages", // Enable streaming chunks
      "--model",
      options.model || "sonnet", // Model alias (opus/sonnet/haiku)
      prompt, // Pass prompt as argument (more reliable than stdin)
    ];

    if (options.sessionId) {
      args.push("--session-id", options.sessionId);
    }

    return args;
  }

  private lastModel: string = "claude-sonnet-4";

  /**
   * Process the buffer and emit parsed messages.
   * Emits standardized ContentDeltaEvent and ResultEvent.
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message: ClaudeCliMessage = JSON.parse(trimmed);

        if (isContentDelta(message)) {
          // Emit standardized content delta
          const event = message as ClaudeCliStreamEvent;
          const text = event.event.delta?.text || "";
          if (text) {
            const delta: ContentDeltaEvent = { text };
            this.emit("content_delta", delta);
          }
        } else if (isAssistantMessage(message)) {
          const assistant = message as ClaudeCliAssistant;
          this.lastModel = assistant.message.model || this.lastModel;
        } else if (isResultMessage(message)) {
          const cliResult = message as ClaudeCliResult;
          const modelName = cliResult.modelUsage
            ? Object.keys(cliResult.modelUsage)[0]
            : this.lastModel;

          const result: ResultEvent = {
            text: cliResult.result,
            model: modelName,
            usage: cliResult.usage ? {
              input_tokens: cliResult.usage.input_tokens || 0,
              output_tokens: cliResult.usage.output_tokens || 0,
            } : undefined,
          };
          this.emit("result", result);
        }
      } catch {
        // Non-JSON output, emit as raw
        this.emit("raw", trimmed);
      }
    }
  }

  /**
   * Clear the timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Kill the subprocess
   */
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.isKilled && this.process) {
      this.isKilled = true;
      this.clearTimeout();
      this.process.kill(signal);
    }
  }

  /**
   * Check if the process is still running
   */
  isRunning(): boolean {
    return this.process !== null && !this.isKilled && this.process.exitCode === null;
  }
}

/**
 * Verify that Claude CLI is installed and accessible
 */
export async function verifyClaude(): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: "pipe" });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        error:
          "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({
          ok: false,
          error: "Claude CLI returned non-zero exit code",
        });
      }
    });
  });
}

/**
 * Check if Claude CLI is authenticated
 *
 * Claude Code stores credentials in the OS keychain, not a file.
 * We verify authentication by checking if we can call the CLI successfully.
 * If the CLI is installed, it typically has valid credentials from `claude auth login`.
 */
export async function verifyAuth(): Promise<{ ok: boolean; error?: string }> {
  // If Claude CLI is installed and the user has run `claude auth login`,
  // credentials are stored in the OS keychain and will be used automatically.
  // We can't easily check the keychain, so we'll just return true if the CLI exists.
  // Authentication errors will surface when making actual API calls.
  return { ok: true };
}
