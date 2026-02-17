/**
 * Gemini CLI Subprocess Manager
 *
 * Handles spawning and parsing output from the Gemini CLI `gemini` command.
 * The Gemini CLI stream-json format differs from Claude CLI:
 *   - Init: { type: "init", session_id, model }
 *   - User: { type: "message", role: "user", content: "..." }
 *   - Delta: { type: "message", role: "assistant", content: "delta text", delta: true }
 *   - Result: { type: "result", status: "success", stats: { input_tokens, output_tokens, ... } }
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type { ContentDeltaEvent, ResultEvent, SubprocessStartOptions } from "../types/common.js";

const DEFAULT_TIMEOUT = 300000; // 5 minutes

export class GeminiSubprocess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private timeoutId: NodeJS.Timeout | null = null;
  private isKilled: boolean = false;

  /**
   * Start the Gemini CLI subprocess with the given prompt
   */
  async start(prompt: string, options: SubprocessStartOptions): Promise<void> {
    const args = this.buildArgs(prompt, options);
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn("gemini", args, {
          cwd: options.cwd || process.cwd(),
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.timeoutId = setTimeout(() => {
          if (!this.isKilled) {
            this.isKilled = true;
            this.process?.kill("SIGTERM");
            this.emit("error", new Error(`Request timed out after ${timeout}ms`));
          }
        }, timeout);

        this.process.on("error", (err) => {
          this.clearTimeout();
          if (err.message.includes("ENOENT")) {
            reject(
              new Error(
                "Gemini CLI not found. Install with: npm install -g @anthropic-ai/gemini-cli or see https://github.com/google-gemini/gemini-cli"
              )
            );
          } else {
            reject(err);
          }
        });

        // Close stdin since we pass prompt as argument
        this.process.stdin?.end();

        console.error(`[GeminiSubprocess] Process spawned with PID: ${this.process.pid}`);

        // Parse JSON stream from stdout
        this.process.stdout?.on("data", (chunk: Buffer) => {
          const data = chunk.toString();
          console.error(`[GeminiSubprocess] Received ${data.length} bytes of stdout`);
          this.buffer += data;
          this.processBuffer();
        });

        // Capture stderr for debugging (gemini writes status messages to stderr)
        this.process.stderr?.on("data", (chunk: Buffer) => {
          const errorText = chunk.toString().trim();
          if (errorText) {
            console.error("[GeminiSubprocess stderr]:", errorText.slice(0, 200));
          }
        });

        this.process.on("close", (code) => {
          console.error(`[GeminiSubprocess] Process closed with code: ${code}`);
          this.clearTimeout();
          if (this.buffer.trim()) {
            this.processBuffer();
          }
          this.emit("close", code);
        });

        resolve();
      } catch (err) {
        this.clearTimeout();
        reject(err);
      }
    });
  }

  /**
   * Build CLI arguments for Gemini.
   * Gemini uses -p "prompt" (prompt is the value of -p flag).
   */
  private buildArgs(prompt: string, options: SubprocessStartOptions): string[] {
    const args = [
      "-p", prompt,           // Non-interactive mode with prompt
      "-o", "stream-json",    // JSON streaming output
    ];

    if (options.model) {
      args.push("-m", options.model);
    }

    // Auto-approve tool use for headless operation
    args.push("-y");

    return args;
  }

  /**
   * Process the buffer and emit parsed messages.
   *
   * Gemini CLI stream-json messages:
   * - { type: "init", session_id, model, timestamp }
   * - { type: "message", role: "user", content: "...", timestamp }
   * - { type: "message", role: "assistant", content: "delta text", delta: true, timestamp }
   * - { type: "result", status: "success", stats: { input_tokens, output_tokens, duration_ms, ... }, timestamp }
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch {
        this.emit("raw", trimmed);
      }
    }
  }

  private lastModel: string = "gemini";
  private fullText: string = "";

  private handleMessage(msg: any): void {
    if (msg.type === "init") {
      if (msg.model) {
        this.lastModel = msg.model;
      }
      return;
    }

    if (msg.type === "message" && msg.role === "assistant") {
      if (msg.delta) {
        // Streaming delta
        const delta: ContentDeltaEvent = { text: msg.content || "" };
        this.fullText += msg.content || "";
        this.emit("content_delta", delta);
      }
      return;
    }

    if (msg.type === "result") {
      const result: ResultEvent = {
        text: this.fullText || "",
        model: this.lastModel,
        usage: msg.stats ? {
          input_tokens: msg.stats.input_tokens || msg.stats.input || 0,
          output_tokens: msg.stats.output_tokens || 0,
        } : undefined,
      };
      this.emit("result", result);
      return;
    }
  }

  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.isKilled && this.process) {
      this.isKilled = true;
      this.clearTimeout();
      this.process.kill(signal);
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.isKilled && this.process.exitCode === null;
  }
}

/**
 * Verify that Gemini CLI is installed and accessible
 */
export async function verifyGemini(): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("gemini", ["--version"], { stdio: "pipe" });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        error: "Gemini CLI not found. See: https://github.com/google-gemini/gemini-cli",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({
          ok: false,
          error: "Gemini CLI returned non-zero exit code",
        });
      }
    });
  });
}
