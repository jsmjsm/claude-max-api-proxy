/**
 * Converts OpenAI chat request messages to a single prompt string
 * suitable for any CLI backend (Claude, Cursor, Gemini).
 *
 * All three CLIs accept a single prompt string in their non-interactive modes.
 */

import type { OpenAIChatRequest } from "../types/openai.js";

/**
 * Convert OpenAI messages array to a single prompt string for CLI backends.
 *
 * CLI tools in --print mode expect a single prompt, not a conversation.
 * We format the messages into a readable format that preserves context.
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        // System messages become context instructions
        parts.push(`<system>\n${msg.content}\n</system>\n`);
        break;

      case "user":
        // User messages are the main prompt
        parts.push(msg.content);
        break;

      case "assistant":
        // Previous assistant responses for context
        parts.push(`<previous_response>\n${msg.content}\n</previous_response>\n`);
        break;
    }
  }

  return parts.join("\n").trim();
}
