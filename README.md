# Multi-CLI API Proxy

**Use your Claude Max, Cursor Pro, and Gemini subscriptions with any OpenAI-compatible client — no separate API costs!**

This proxy wraps multiple AI CLI tools (Claude Code CLI, Cursor CLI, Gemini CLI) as subprocesses and exposes a unified OpenAI-compatible HTTP API, allowing tools like OpenClaw, Continue.dev, or any OpenAI-compatible client to use your existing subscriptions instead of paying per-API-call.

## Supported Backends

| Backend | CLI Command | Subscription | Models |
|---------|------------|--------------|--------|
| **Claude Code CLI** | `claude` | Claude Max ($200/month) | Opus, Sonnet, Haiku |
| **Cursor CLI** | `agent` | Cursor Pro | Opus 4.6, Sonnet 4.5, GPT-5.x, Gemini 3, Grok |
| **Gemini CLI** | `gemini` | Google Gemini | Gemini 2.5 Pro/Flash, 2.0 Flash |

## Why This Exists

| Approach | Cost | Limitation |
|----------|------|------------|
| Claude API | ~$15/M input, ~$75/M output tokens | Pay per use |
| Claude Max | $200/month flat | OAuth blocked for third-party API use |
| Cursor Pro | $20/month | No public API |
| Google Gemini | Free tier / paid | CLI-only access |
| **This Proxy** | $0 extra (uses existing subscriptions) | Routes through CLIs |

## How It Works

```
Your App (OpenClaw, Continue.dev, Python client, etc.)
         ↓
    HTTP Request (OpenAI format)
         ↓
   Multi-CLI API Proxy (this project)
         ↓  resolves model → backend
    ┌────┼────────────┐
    ↓    ↓            ↓
  claude  agent     gemini
  (CLI)  (CLI)      (CLI)
    ↓    ↓            ↓
  Anthropic  Cursor   Google
    API    servers     API
    ↓    ↓            ↓
   Response → OpenAI format → Your App
```

## Features

- **Three CLI backends** — Claude, Cursor, and Gemini behind one API
- **OpenAI-compatible API** — Works with any client that supports OpenAI's API format
- **Streaming support** — Real-time token streaming via Server-Sent Events
- **Automatic routing** — Model name determines which backend handles the request
- **Multimodal content** — Handles both plain string and array-format message content
- **Session management** — Maintains conversation context
- **Auto-start service** — Optional LaunchAgent for macOS
- **Zero configuration** — Uses existing CLI authentication
- **Secure by design** — Uses `spawn()` to prevent shell injection

## Prerequisites

Install at least **one** CLI backend:

### Claude Code CLI (optional)
```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

### Cursor CLI (optional)
Install from [docs.cursor.com/agent](https://docs.cursor.com/agent), then:
```bash
agent login
```

### Gemini CLI (optional)
```bash
npm install -g @anthropic-ai/gemini-cli
# or see https://github.com/google-gemini/gemini-cli
gemini  # Follow auth prompts on first run
```

## Installation

```bash
# Clone the repository
git clone https://github.com/atalovesyou/claude-max-api-proxy.git
cd claude-max-api-proxy

# Install dependencies
npm install

# Build
npm run build
```

## Usage

### Start the server

```bash
npm start
# or
node dist/server/standalone.js [port]
```

The server starts at `http://localhost:3456` by default and auto-detects which CLIs are available:

```
Multi-CLI API Proxy - Standalone Server
=======================================

Checking Claude CLI (claude)...
  ✓ Claude CLI: 2.0.22 (Claude Code)
  ✓ Claude Auth: OK
Checking Cursor CLI (agent)...
  ✓ Cursor CLI: 2026.02.13
Checking Gemini CLI (gemini)...
  ✓ Gemini CLI: 0.28.2

Available backends: claude, cursor, gemini
```

### Test it

```bash
# Health check
curl http://localhost:3456/health

# List all available models
curl http://localhost:3456/v1/models

# Claude CLI — chat completion
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Cursor CLI — chat completion
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cursor/opus-4.6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Gemini CLI — chat completion
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-cli/gemini-2.5-pro",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Streaming (any backend)
curl -N -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cursor/auto",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (lists available backends) |
| `/v1/models` | GET | List available models from all backends |
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |

## Available Models

### Claude CLI (`claude`)

| Model ID | Description |
|----------|-------------|
| `claude-opus-4` | Claude Opus 4.5 |
| `claude-sonnet-4` | Claude Sonnet 4 |
| `claude-haiku-4` | Claude Haiku 4 |

### Cursor CLI (`agent`)

Use the `cursor/` prefix:

| Model ID | Description |
|----------|-------------|
| `cursor/auto` | Auto-select best model |
| `cursor/opus-4.6-thinking` | Claude 4.6 Opus (Thinking) |
| `cursor/opus-4.6` | Claude 4.6 Opus |
| `cursor/sonnet-4.5-thinking` | Claude 4.5 Sonnet (Thinking) |
| `cursor/sonnet-4.5` | Claude 4.5 Sonnet |
| `cursor/gpt-5.3-codex` | GPT-5.3 Codex |
| `cursor/gpt-5.2` | GPT-5.2 |
| `cursor/gemini-3-pro` | Gemini 3 Pro |
| `cursor/grok` | Grok |

Run `agent --list-models` to see all available Cursor models.

### Gemini CLI (`gemini`)

Use the `gemini-cli/` or `gemini/` prefix:

| Model ID | Description |
|----------|-------------|
| `gemini-cli/gemini-2.5-pro` | Gemini 2.5 Pro |
| `gemini-cli/gemini-2.5-flash` | Gemini 2.5 Flash |
| `gemini/gemini-2.5-pro` | Gemini 2.5 Pro (alias) |

## Model Routing

The proxy determines which CLI backend to use based on the model name:

| Model Pattern | Backend | Example |
|--------------|---------|---------|
| `cursor/*` | Cursor CLI | `cursor/opus-4.6` |
| `gemini-cli/*` or `gemini/*` | Gemini CLI | `gemini-cli/gemini-2.5-pro` |
| `claude-*`, `opus`, `sonnet`, `haiku` | Claude CLI | `claude-sonnet-4` |
| `gpt-*`, `grok` | Cursor CLI | `gpt-5.3-codex` |
| Everything else | Claude CLI (default) | — |

## Configuration with Popular Tools

### OpenClaw

Set the provider in your OpenClaw config:

```bash
openclaw config set models.providers.openai.baseUrl "http://127.0.0.1:3456/v1"
openclaw config set models.providers.openai.apiKey "not-needed"
openclaw config set agents.defaults.model.primary "openai/cursor/opus-4.6"
```

Then test:
```bash
openclaw agent --local -m "Hello!" --session-id test --json
```

### Continue.dev

Add to your Continue config:

```json
{
  "models": [{
    "title": "Cursor Opus 4.6",
    "provider": "openai",
    "model": "cursor/opus-4.6",
    "apiBase": "http://localhost:3456/v1",
    "apiKey": "not-needed"
  }]
}
```

### Generic OpenAI Client (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="not-needed"  # Any value works
)

# Use Cursor backend
response = client.chat.completions.create(
    model="cursor/opus-4.6",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Use Gemini backend
response = client.chat.completions.create(
    model="gemini-cli/gemini-2.5-pro",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Use Claude backend
response = client.chat.completions.create(
    model="claude-sonnet-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Auto-Start on macOS

Create a LaunchAgent to start the proxy automatically on login. See `docs/macos-setup.md` for detailed instructions.

## Architecture

```
src/
├── types/
│   ├── common.ts             # Shared event types (ContentDeltaEvent, ResultEvent)
│   ├── claude-cli.ts         # Claude CLI JSON output types
│   └── openai.ts             # OpenAI API types (multimodal content support)
├── adapter/
│   └── openai-to-cli.ts      # Convert OpenAI messages → CLI prompt string
├── subprocess/
│   ├── manager.ts            # Claude CLI subprocess (spawn "claude")
│   ├── cursor.ts             # Cursor CLI subprocess (spawn "agent")
│   ├── gemini.ts             # Gemini CLI subprocess (spawn "gemini")
│   └── factory.ts            # Backend resolver & subprocess factory
├── session/
│   └── manager.ts            # Session ID mapping
├── server/
│   ├── index.ts              # Express server setup
│   ├── routes.ts             # API route handlers (backend-agnostic)
│   └── standalone.ts         # CLI entry point
└── index.ts                  # Package exports & plugin definition
```

## Security

- Uses Node.js `spawn()` instead of shell execution to prevent injection attacks
- No API keys stored or transmitted by this proxy
- All authentication handled by each CLI's own secure credential storage
- Prompts passed as CLI arguments or stdin, not through shell interpretation
- Server binds to `127.0.0.1` only (not exposed externally)

## Cost Savings Example

| Usage | API Cost | With This Proxy |
|-------|----------|----------------|
| 1M input tokens/month (Claude) | ~$15 | $0 (included in Max) |
| 500K output tokens/month (Claude) | ~$37.50 | $0 (included in Max) |
| Cursor Pro models | Not available via API | $0 (included in Pro) |
| Gemini CLI | Free tier | $0 |
| **Monthly Total** | **~$52.50+** | **$0 extra** |

If you're already paying for Claude Max, Cursor Pro, or using Gemini's free tier, this proxy lets you use those subscriptions for API-style access at no additional cost.

## Troubleshooting

### "Claude CLI not found"

Install and authenticate the CLI:
```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

### "Cursor CLI (agent) not found"

Install from [docs.cursor.com/agent](https://docs.cursor.com/agent):
```bash
agent login
agent status  # Verify authentication
```

### "Gemini CLI not found"

```bash
npm install -g @anthropic-ai/gemini-cli
gemini --version  # Verify installation
```

### Streaming returns immediately with no content

Ensure you're using `-N` flag with curl (disables buffering):
```bash
curl -N -X POST http://localhost:3456/v1/chat/completions ...
```

### Server won't start (port in use)

```bash
lsof -i :3456  # Find what's using the port
kill <PID>     # Kill the process
npm start      # Restart
```

### OpenClaw shows `[object Object]` in responses

Update to the latest version of this proxy — multimodal message content (array format) is now handled correctly.

## Contributing

Contributions welcome! Please submit PRs with tests.

## License

MIT

## Acknowledgments

- Built for use with [OpenClaw](https://openclaw.ai) and [Clawdbot](https://clawd.bot)
- Powered by [Claude Code CLI](https://github.com/anthropics/claude-code), [Cursor CLI](https://docs.cursor.com/agent), and [Gemini CLI](https://github.com/google-gemini/gemini-cli)
