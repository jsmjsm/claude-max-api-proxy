# OpenClaw Integration Guide

This guide explains how to use the Multi-CLI API Proxy as a model provider in OpenClaw.

## Prerequisites

1. The proxy server running on `http://localhost:3456`
2. At least one CLI backend installed (Cursor Agent CLI, Gemini CLI, or Claude Code CLI)

## Two Provider Approaches

OpenClaw uses `provider/model` format for model references. The first `/` splits the
provider name from the model ID. You have two options for setting up the proxy:

### Option A: Register as `openai` provider (simpler)

If you register the proxy under the built-in `openai` provider, model IDs **can**
contain slashes (OpenClaw treats the full string after the first `/` as the model ID):

| OpenClaw model ref              | Proxy receives          | Routes to             |
|---------------------------------|-------------------------|-----------------------|
| `openai/cursor/opus-4.6`       | `cursor/opus-4.6`       | Cursor CLI: opus-4.6  |
| `openai/gemini-cli/gemini-2.5-pro` | `gemini-cli/gemini-2.5-pro` | Gemini CLI: gemini-2.5-pro |
| `openai/claude-sonnet-4`       | `claude-sonnet-4`       | Claude CLI: sonnet    |

### Option B: Register as a custom provider (e.g. `cli-proxy`)

When registered as a custom provider, model IDs **cannot contain `/`**, so use
dash-separated IDs instead:

| OpenClaw model ref                      | Proxy receives                | Routes to                     |
|-----------------------------------------|-------------------------------|-------------------------------|
| `cli-proxy/cursor-auto`                 | `cursor-auto`                 | Cursor CLI: auto              |
| `cli-proxy/cursor-opus-4.6-thinking`    | `cursor-opus-4.6-thinking`    | Cursor CLI: opus-4.6-thinking |
| `cli-proxy/gemini-cli-gemini-2.5-flash` | `gemini-cli-gemini-2.5-flash` | Gemini CLI: gemini-2.5-flash  |
| `cli-proxy/claude-opus-4`               | `claude-opus-4`               | Claude CLI: opus              |

Both slash-format (`cursor/opus-4.6`) and dash-format (`cursor-opus-4.6`) are supported
by the proxy's backend resolver.

## Option A: OpenAI Provider Configuration

The quickest way — reuse the built-in `openai` provider slot:

```bash
openclaw config set models.providers.openai.baseUrl "http://127.0.0.1:3456/v1"
openclaw config set models.providers.openai.apiKey "not-needed"
openclaw config set agents.defaults.model.primary "openai/cursor/opus-4.6"
```

Or edit `openclaw.json` directly:

```json5
{
  agents: {
    defaults: {
      model: { primary: "openai/cursor/opus-4.6" },
      models: {
        "openai/cursor/auto": {},
        "openai/cursor/opus-4.6-thinking": {},
        "openai/cursor/opus-4.6": {},
        "openai/cursor/sonnet-4.5-thinking": {},
        "openai/cursor/sonnet-4.5": {},
        "openai/cursor/gpt-5.3-codex": {},
        "openai/gemini-cli/gemini-2.5-pro": {},
        "openai/claude-sonnet-4": {},
      },
    },
  },
  models: {
    providers: {
      openai: {
        baseUrl: "http://127.0.0.1:3456/v1",
        apiKey: "not-needed",
        api: "openai-completions",
        models: [
          { id: "cursor/auto", name: "Cursor Auto", contextWindow: 200000, maxTokens: 64000 },
          { id: "cursor/opus-4.6-thinking", name: "Claude 4.6 Opus (Thinking)", reasoning: true, contextWindow: 200000, maxTokens: 64000 },
          { id: "cursor/opus-4.6", name: "Claude 4.6 Opus", contextWindow: 200000, maxTokens: 64000 },
          { id: "cursor/sonnet-4.5-thinking", name: "Claude 4.5 Sonnet (Thinking)", reasoning: true, contextWindow: 200000, maxTokens: 64000 },
          { id: "cursor/sonnet-4.5", name: "Claude 4.5 Sonnet", contextWindow: 200000, maxTokens: 64000 },
          { id: "cursor/gpt-5.3-codex", name: "GPT-5.3 Codex", contextWindow: 128000, maxTokens: 16384 },
          { id: "cursor/gpt-5.2", name: "GPT-5.2", contextWindow: 128000, maxTokens: 16384 },
          { id: "cursor/gemini-3-pro", name: "Gemini 3 Pro (via Cursor)", contextWindow: 1048576, maxTokens: 65536 },
          { id: "gemini-cli/gemini-2.5-pro", name: "Gemini 2.5 Pro (CLI)", contextWindow: 1048576, maxTokens: 65536 },
          { id: "gemini-cli/gemini-2.5-flash", name: "Gemini 2.5 Flash (CLI)", contextWindow: 1048576, maxTokens: 65536 },
          { id: "claude-opus-4", name: "Claude Opus 4", contextWindow: 200000, maxTokens: 64000 },
          { id: "claude-sonnet-4", name: "Claude Sonnet 4", contextWindow: 200000, maxTokens: 64000 },
          { id: "claude-haiku-4", name: "Claude Haiku 4", contextWindow: 200000, maxTokens: 64000 },
        ],
      },
    },
  },
}
```

## Option B: Custom Provider Configuration

If you prefer a dedicated provider name (or the `openai` slot is taken):

```json5
{
  agents: {
    defaults: {
      model: { primary: "cli-proxy/cursor-auto" },
      models: {
        "cli-proxy/cursor-auto": { alias: "Cursor Auto" },
        "cli-proxy/cursor-opus-4.6-thinking": { alias: "Opus 4.6 Thinking" },
        "cli-proxy/cursor-opus-4.6": { alias: "Opus 4.6" },
        "cli-proxy/cursor-sonnet-4.5-thinking": { alias: "Sonnet 4.5 Thinking" },
        "cli-proxy/cursor-sonnet-4.5": { alias: "Sonnet 4.5" },
        "cli-proxy/cursor-gpt-5.3-codex": { alias: "GPT 5.3 Codex" },
        "cli-proxy/cursor-gpt-5.2": { alias: "GPT 5.2" },
        "cli-proxy/cursor-gemini-3-pro": { alias: "Gemini 3 Pro (via Cursor)" },
        "cli-proxy/gemini-cli-gemini-2.5-pro": { alias: "Gemini 2.5 Pro (CLI)" },
        "cli-proxy/gemini-cli-gemini-2.5-flash": { alias: "Gemini 2.5 Flash (CLI)" },
        "cli-proxy/claude-opus-4": { alias: "Claude Opus 4" },
        "cli-proxy/claude-sonnet-4": { alias: "Claude Sonnet 4" },
        "cli-proxy/claude-haiku-4": { alias: "Claude Haiku 4" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      "cli-proxy": {
        baseUrl: "http://localhost:3456/v1",
        apiKey: "not-needed",
        api: "openai-completions",
        models: [
          { id: "cursor-auto", name: "Cursor Auto" },
          { id: "cursor-opus-4.6-thinking", name: "Opus 4.6 Thinking" },
          { id: "cursor-opus-4.6", name: "Opus 4.6" },
          { id: "cursor-sonnet-4.5-thinking", name: "Sonnet 4.5 Thinking" },
          { id: "cursor-sonnet-4.5", name: "Sonnet 4.5" },
          { id: "cursor-gpt-5.3-codex", name: "GPT 5.3 Codex" },
          { id: "cursor-gpt-5.2", name: "GPT 5.2" },
          { id: "cursor-gemini-3-pro", name: "Gemini 3 Pro (via Cursor)" },
          { id: "gemini-cli-gemini-2.5-pro", name: "Gemini 2.5 Pro (CLI)" },
          { id: "gemini-cli-gemini-2.5-flash", name: "Gemini 2.5 Flash (CLI)" },
          { id: "claude-opus-4", name: "Claude Opus 4" },
          { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
          { id: "claude-haiku-4", name: "Claude Haiku 4" },
        ],
      },
    },
  },
}
```

## Per-Agent Configuration

To assign a specific model to one agent only:

```json5
{
  agents: {
    list: [
      {
        id: "builder",
        model: { primary: "openai/cursor/opus-4.6" },
      },
      {
        id: "researcher",
        model: { primary: "openai/gemini-cli/gemini-2.5-pro" },
      },
    ],
  },
}
```

## Switching Models in Chat

Once configured, switch models in any OpenClaw session:

```
/model openai/cursor/opus-4.6-thinking
/model openai/gemini-cli/gemini-2.5-flash
/model openai/claude-opus-4
```

Or with the custom provider:

```
/model cli-proxy/cursor-opus-4.6-thinking
/model cli-proxy/gemini-cli-gemini-2.5-flash
/model cli-proxy/claude-opus-4
```

## Verifying the Setup

```bash
# 1. Check proxy is running
curl http://localhost:3456/health

# 2. List available models
curl http://localhost:3456/v1/models

# 3. Run a quick test via OpenClaw
openclaw agent --local -m "Hello!" --session-id test --json

# 4. Check which provider/model was used (look for "provider" and "model" in output)
```

## Running the Proxy as a Service

### Option A: PM2 (recommended for development)

```bash
npm install -g pm2
pm2 start /path/to/claude-max-api-proxy/dist/server/standalone.js --name cli-proxy
pm2 save
pm2 startup  # Follow instructions to enable auto-start on boot
```

### Option B: macOS LaunchAgent

See [macos-setup.md](./macos-setup.md) for LaunchAgent configuration.

## Troubleshooting

### "Unknown model" errors

The model is not in the `agents.defaults.models` allowlist. Add it:

```bash
# For openai provider approach:
openclaw config set agents.defaults.models.openai/cursor/opus-4.6 '{}'
```

### "Connection refused" errors

The proxy is not running. Start it:

```bash
cd /path/to/claude-max-api-proxy
npm start
# or
pm2 start cli-proxy
```

### Empty responses or `[object Object]`

Make sure you are running the latest version of the proxy (v1.1+). Older versions
did not handle multimodal (array-format) message content that OpenClaw sends.

### Rate limit fallback

OpenClaw has built-in failover. If the primary model hits a rate limit, it will
try fallback models. Configure fallbacks:

```bash
openclaw config set agents.defaults.model.fallbacks '["openai/cursor/auto", "openai/gemini-cli/gemini-2.5-flash"]'
```
