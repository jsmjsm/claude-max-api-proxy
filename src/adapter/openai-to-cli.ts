/**
 * Converts OpenAI chat request messages to a single prompt string
 * suitable for any CLI backend (Claude, Cursor, Gemini).
 *
 * All three CLIs accept a single prompt string in their non-interactive modes.
 */

import type { OpenAIChatRequest, OpenAIChatContent } from "../types/openai.js";

/**
 * Extract plain text from OpenAI message content.
 *
 * Content can be:
 *   - A plain string: "Hello"
 *   - An array of parts: [{ type: "text", text: "Hello" }, { type: "image_url", ... }]
 *
 * We extract only the text parts and ignore images (CLIs don't support them).
 */
function contentToString(content: OpenAIChatContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!)
      .join("");
  }

  // Fallback for unexpected types
  return String(content);
}

/**
 * Convert OpenAI messages array to a single prompt string for CLI backends.
 *
 * CLI tools in --print mode expect a single prompt, not a conversation.
 * We format the messages into a readable format that preserves context.
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const text = contentToString(msg.content);

    switch (msg.role) {
      case "system":
        // System messages become context instructions
        parts.push(`<system>\n${text}\n</system>\n`);
        break;

      case "user":
        // User messages are the main prompt
        parts.push(text);
        break;

      case "assistant":
        // Previous assistant responses for context
        parts.push(`<previous_response>\n${text}\n</previous_response>\n`);
        break;
    }
  }

  return parts.join("\n").trim();
}
