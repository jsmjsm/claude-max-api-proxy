/**
 * Cursor CLI (agent) Subprocess Manager
 *
 * Handles spawning and parsing output from the Cursor CLI `agent` command.
 * The Cursor CLI uses a similar stream-json format to Claude CLI but with
 * some key differences:
 *   - Prompt is piped via stdin (not passed as argument)
 *   - Streaming deltas are `type: "assistant"` messages with `timestamp_ms`
 *   - The final complete message has no `timestamp_ms`
 *   - Result messages have no usage/token stats
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type { ContentDeltaEvent, ResultEvent, SubprocessStartOptions } from "../types/common.js";

const DEFAULT_TIMEOUT = 300000; // 5 minutes

export class CursorSubprocess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private timeoutId: NodeJS.Timeout | null = null;
  private isKilled: boolean = false;

  /**
   * Start the Cursor CLI subprocess with the given prompt.
   * Prompt is written to stdin because agent -p reads from stdin.
   */
  async start(prompt: string, options: SubprocessStartOptions): Promise<void> {
    const args = this.buildArgs(options);
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn("agent", args, {
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
                "Cursor CLI (agent) not found. Install from: https://docs.cursor.com/agent"
              )
            );
          } else {
            reject(err);
          }
        });

        console.error(`[CursorSubprocess] Process spawned with PID: ${this.process.pid}`);

        // Write prompt to stdin, then close it
        this.process.stdin?.write(prompt);
        this.process.stdin?.end();

        // Parse JSON stream from stdout
        this.process.stdout?.on("data", (chunk: Buffer) => {
          const data = chunk.toString();
          console.error(`[CursorSubprocess] Received ${data.length} bytes of stdout`);
          this.buffer += data;
          this.processBuffer();
        });

        // Capture stderr for debugging
        this.process.stderr?.on("data", (chunk: Buffer) => {
          const errorText = chunk.toString().trim();
          if (errorText) {
            console.error("[CursorSubprocess stderr]:", errorText.slice(0, 200));
          }
        });

        this.process.on("close", (code) => {
          console.error(`[CursorSubprocess] Process closed with code: ${code}`);
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
   * Build CLI arguments for Cursor agent
   */
  private buildArgs(options: SubprocessStartOptions): string[] {
    const args = [
      "-p",                        // Print mode (non-interactive, reads from stdin)
      "--output-format", "stream-json",
      "--stream-partial-output",   // Enable streaming deltas
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    return args;
  }

  /**
   * Process the buffer and emit parsed messages.
   *
   * Cursor CLI stream-json messages:
   * - { type: "system", subtype: "init", ... }
   * - { type: "user", message: { role: "user", content: [...] } }
   * - { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "delta" }] }, timestamp_ms: ... }
   * - { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "full" }] } }  (final, no timestamp_ms)
   * - { type: "result", subtype: "success", result: "full text", ... }
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

  private lastModel: string = "cursor-auto";

  private handleMessage(msg: any): void {
    if (msg.type === "system" && msg.subtype === "init") {
      if (msg.model) {
        this.lastModel = msg.model;
      }
      return;
    }

    if (msg.type === "assistant") {
      // Extract text from content array
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        const text = content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("");

        if (msg.timestamp_ms) {
          // Streaming delta (has timestamp_ms)
          const delta: ContentDeltaEvent = { text };
          this.emit("content_delta", delta);
        }
        // Final complete message (no timestamp_ms) — we don't need to emit,
        // the result message will follow with the full text.
      }
      return;
    }

    if (msg.type === "result") {
      const result: ResultEvent = {
        text: msg.result || "",
        model: this.lastModel,
        // Cursor CLI result has no usage stats
        usage: undefined,
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
 * Verify that Cursor CLI (agent) is installed and accessible
 */
export async function verifyCursor(): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("agent", ["--version"], { stdio: "pipe" });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        error: "Cursor CLI (agent) not found. Install from: https://docs.cursor.com/agent",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({
          ok: false,
          error: "Cursor CLI (agent) returned non-zero exit code",
        });
      }
    });
  });
}
