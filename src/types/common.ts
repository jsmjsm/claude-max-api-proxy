/**
 * Common types shared across all CLI backends
 *
 * Standardized event interfaces that all subprocess managers emit,
 * allowing routes.ts to handle any backend uniformly.
 */

/**
 * Which CLI backend to use
 */
export type BackendType = "claude" | "cursor" | "gemini";

/**
 * Standardized streaming text delta event
 */
export interface ContentDeltaEvent {
  text: string;
}

/**
 * Standardized final result event
 */
export interface ResultEvent {
  text: string;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Options for starting a subprocess (backend-agnostic)
 */
export interface SubprocessStartOptions {
  model: string;
  sessionId?: string;
  cwd?: string;
  timeout?: number;
}

/**
 * Common interface for all CLI subprocess managers
 */
export interface CliSubprocess {
  start(prompt: string, options: SubprocessStartOptions): Promise<void>;
  kill(signal?: NodeJS.Signals): void;
  isRunning(): boolean;

  on(event: "content_delta", listener: (delta: ContentDeltaEvent) => void): this;
  on(event: "result", listener: (result: ResultEvent) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number | null) => void): this;
  on(event: "raw", listener: (line: string) => void): this;
}
