/**
 * API Route Handlers
 *
 * Implements OpenAI-compatible endpoints that route to Claude CLI,
 * Cursor CLI (agent), or Gemini CLI based on the requested model.
 */

import type { Request, Response } from "express";
import type { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { createAndStartSubprocess, resolveBackend } from "../subprocess/factory.js";
import { messagesToPrompt } from "../adapter/openai-to-cli.js";
import type { OpenAIChatRequest } from "../types/openai.js";
import type { ContentDeltaEvent, ResultEvent } from "../types/common.js";

/**
 * Handle POST /v1/chat/completions
 *
 * Main endpoint for chat requests, supports both streaming and non-streaming.
 * Routes to the appropriate CLI backend based on model name.
 */
export async function handleChatCompletions(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
  const body = req.body as OpenAIChatRequest;
  const stream = body.stream === true;

  try {
    // Validate request
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
          code: "invalid_messages",
        },
      });
      return;
    }

    const model = body.model || "claude-sonnet-4";
    const resolved = resolveBackend(model);
    const prompt = messagesToPrompt(body.messages);

    console.error(
      `[handleChatCompletions] model="${model}" → backend=${resolved.backend}, cliModel="${resolved.cliModel}"`
    );

    const { subprocess, start } = createAndStartSubprocess(model, prompt, {
      sessionId: body.user,
    });

    if (stream) {
      await handleStreamingResponse(req, res, subprocess, start, requestId, model);
    } else {
      await handleNonStreamingResponse(res, subprocess, start, requestId, model);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[handleChatCompletions] Error:", message);

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message,
          type: "server_error",
          code: null,
        },
      });
    }
  }
}

/**
 * Handle streaming response (SSE)
 *
 * Uses standardized events (content_delta, result) that all backends emit.
 */
async function handleStreamingResponse(
  req: Request,
  res: Response,
  subprocess: EventEmitter,
  startSubprocess: () => Promise<void>,
  requestId: string,
  requestedModel: string
): Promise<void> {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", requestId);

  // Flush headers immediately to establish SSE connection
  res.flushHeaders();

  // Send initial comment to confirm connection is alive
  res.write(":ok\n\n");

  return new Promise<void>((resolve, reject) => {
    let isFirst = true;
    let lastModel = requestedModel;
    let isComplete = false;

    // Helper to kill subprocess on disconnect
    const killSubprocess = () => {
      if ("kill" in subprocess && typeof (subprocess as any).kill === "function") {
        (subprocess as any).kill();
      }
    };

    // Handle actual client disconnect
    res.on("close", () => {
      if (!isComplete) {
        killSubprocess();
      }
      resolve();
    });

    // Handle streaming content deltas (standardized across all backends)
    subprocess.on("content_delta", (delta: ContentDeltaEvent) => {
      if (delta.text && !res.writableEnded) {
        const chunk = {
          id: `chatcmpl-${requestId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: lastModel,
          choices: [{
            index: 0,
            delta: {
              role: isFirst ? "assistant" : undefined,
              content: delta.text,
            },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        isFirst = false;
      }
    });

    // Handle final result (standardized across all backends)
    subprocess.on("result", (result: ResultEvent) => {
      isComplete = true;
      if (result.model) {
        lastModel = result.model;
      }
      if (!res.writableEnded) {
        // Send final done chunk with finish_reason
        const doneChunk = {
          id: `chatcmpl-${requestId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: lastModel,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop",
          }],
        };
        res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
      resolve();
    });

    subprocess.on("error", (error: Error) => {
      console.error("[Streaming] Error:", error.message);
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            error: { message: error.message, type: "server_error", code: null },
          })}\n\n`
        );
        res.end();
      }
      resolve();
    });

    subprocess.on("close", (code: number | null) => {
      if (!res.writableEnded) {
        if (code !== 0 && !isComplete) {
          res.write(`data: ${JSON.stringify({
            error: { message: `Process exited with code ${code}`, type: "server_error", code: null },
          })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      }
      resolve();
    });

    // Start the subprocess
    startSubprocess().catch((err) => {
      console.error("[Streaming] Subprocess start error:", err);
      reject(err);
    });
  });
}

/**
 * Handle non-streaming response
 */
async function handleNonStreamingResponse(
  res: Response,
  subprocess: EventEmitter,
  startSubprocess: () => Promise<void>,
  requestId: string,
  requestedModel: string
): Promise<void> {
  return new Promise((resolve) => {
    let finalResult: ResultEvent | null = null;

    subprocess.on("result", (result: ResultEvent) => {
      finalResult = result;
    });

    subprocess.on("error", (error: Error) => {
      console.error("[NonStreaming] Error:", error.message);
      res.status(500).json({
        error: {
          message: error.message,
          type: "server_error",
          code: null,
        },
      });
      resolve();
    });

    subprocess.on("close", (code: number | null) => {
      if (finalResult) {
        const response = {
          id: `chatcmpl-${requestId}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: finalResult.model || requestedModel,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: finalResult.text,
            },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: finalResult.usage?.input_tokens || 0,
            completion_tokens: finalResult.usage?.output_tokens || 0,
            total_tokens:
              (finalResult.usage?.input_tokens || 0) +
              (finalResult.usage?.output_tokens || 0),
          },
        };
        res.json(response);
      } else if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: `CLI exited with code ${code} without response`,
            type: "server_error",
            code: null,
          },
        });
      }
      resolve();
    });

    // Start the subprocess
    startSubprocess().catch((error) => {
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: "server_error",
          code: null,
        },
      });
      resolve();
    });
  });
}

/**
 * Handle GET /v1/models
 *
 * Returns available models from all backends
 */
export function handleModels(_req: Request, res: Response): void {
  const now = Math.floor(Date.now() / 1000);

  res.json({
    object: "list",
    data: [
      // ─── Claude CLI models ─────────────────────────────────────────
      {
        id: "claude-opus-4",
        object: "model",
        owned_by: "anthropic",
        created: now,
      },
      {
        id: "claude-sonnet-4",
        object: "model",
        owned_by: "anthropic",
        created: now,
      },
      {
        id: "claude-haiku-4",
        object: "model",
        owned_by: "anthropic",
        created: now,
      },
      // ─── Cursor CLI models (popular subset) ────────────────────────
      {
        id: "cursor/opus-4.6-thinking",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      {
        id: "cursor/opus-4.6",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      {
        id: "cursor/sonnet-4.5-thinking",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      {
        id: "cursor/sonnet-4.5",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      {
        id: "cursor/gpt-5.3-codex",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      {
        id: "cursor/gpt-5.2",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      {
        id: "cursor/gemini-3-pro",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      {
        id: "cursor/auto",
        object: "model",
        owned_by: "cursor",
        created: now,
      },
      // ─── Gemini CLI models ─────────────────────────────────────────
      {
        id: "gemini-cli/gemini-2.5-pro",
        object: "model",
        owned_by: "google",
        created: now,
      },
      {
        id: "gemini-cli/gemini-2.5-flash",
        object: "model",
        owned_by: "google",
        created: now,
      },
    ],
  });
}

/**
 * Handle GET /health
 *
 * Health check endpoint
 */
export function handleHealth(_req: Request, res: Response): void {
  res.json({
    status: "ok",
    provider: "multi-cli-proxy",
    backends: ["claude", "cursor", "gemini"],
    timestamp: new Date().toISOString(),
  });
}
