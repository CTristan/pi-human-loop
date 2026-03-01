# pi-human-loop

**Let your AI coding agent ask a human when it gets stuck.**

pi-human-loop is a [Pi](https://github.com/badlogic/pi-mono) extension that gives your AI agent an `ask_human` tool. When the agent has low confidence — repeated failures, ambiguous business logic, architectural decisions — it posts a question to [Zulip](https://zulip.com/) and waits for a human to reply. The human answers in Zulip, and the agent picks up right where it left off.

<!-- TODO: Add demo GIF showing a Zulip conversation between agent and human -->

## Features

- **`ask_human` tool** — the agent calls it when it needs guidance, with its question, context, and confidence level
- **Interactive config wizard** — `/human-loop-config` walks you through credentials and stream setup
- **Single stream model** — all agent questions land in a single Zulip stream (default: `pi-human-loop`) with `repo:branch` topics
- **Auto-provisioning** — automatically creates the stream if it doesn't exist (can be disabled for locked-down servers)
- **Zulip integration** — questions appear as topics in a Zulip stream (format: `repo:branch`); humans reply in-thread
- **Multi-turn conversations** — follow-up questions stay in the same Zulip topic
- **Efficient polling** — uses Zulip's long-poll API (~90s server-side blocks) for minimal resource usage
- **Loud failure behavior** — if Zulip is unreachable, the agent stops and reports the error
- **Works with [Fix-Die-Repeat](https://github.com/CTristan/fix-die-repeat)** — designed for Pi's print mode (`-p`), used by automated fix loops

## Quick Start

### 1. Set Up a Zulip Bot

1. Go to your Zulip server → **Settings** → **Bots** → **Add a new bot** (see [Zulip's bot documentation](https://zulip.com/help/add-a-bot-or-integration) for details)
2. Choose **Generic bot** type (e.g., name it `pi-agent-bot`)
3. Copy the bot's email and API key

### 2. Run the Configuration Wizard

In interactive Pi (not print mode), run:

```
/human-loop-config
```

The wizard validates your credentials live and stores them in `~/.pi/human-loop.json`.

### 3. Run with Pi

```bash
pi -e /path/to/pi-human-loop
```

Or with [Fix-Die-Repeat](https://github.com/CTristan/fix-die-repeat):

```bash
export FDR_HUMAN_LOOP_EXTENSION=/path/to/pi-human-loop
```

The extension auto-provisions a Zulip stream for each repo and saves it to `.pi/human-loop.json` the first time `ask_human` is called.

## Manual Configuration (Optional)

If you prefer environment variables or want to automate setup, you can configure manually:

```bash
export ZULIP_SERVER_URL="https://your-zulip-server.com"
export ZULIP_BOT_EMAIL="pi-agent-bot@your-domain.com"
export ZULIP_BOT_API_KEY="your-api-key-here"
export ZULIP_STREAM="my-project"
export ZULIP_DEBUG=true
```

| Variable | Required | Description |
|----------|----------|-------------|
| `ZULIP_SERVER_URL` | Yes | Zulip server base URL |
| `ZULIP_BOT_EMAIL` | Yes | Bot user email address |
| `ZULIP_BOT_API_KEY` | Yes | Bot user API key |
| `ZULIP_STREAM` | No | Stream name (default: `pi-human-loop`) |
| `ZULIP_POLL_INTERVAL_MS` | No | Fallback poll interval in ms (default: `5000`) |
| `ZULIP_DEBUG` | No | Enable debug logging to `.pi/human-loop-debug.log` (default: `false`) |

Config files are merged in this order: project `.pi/human-loop.json` → env vars → global `~/.pi/human-loop.json`.

## How It Works

1. The agent encounters something it's unsure about (e.g., a test that keeps failing, an ambiguous requirement)
2. It calls `ask_human` with its question, relevant context, and a confidence score
3. The extension posts a formatted message to your Zulip stream with a `repo:branch` topic (first 10 lines of context are included):

```
🤖 **Agent needs help**

**Question:** Should I change the test or the code?

**Context:**
Error: Expected DecimalError, got ValueError
File: payments/processor.py:142
... (up to 10 total context lines)

**Confidence:** 25/100

_Reply in this topic. The agent is waiting for your response._
```

4. A human replies in the Zulip topic
5. The agent receives the reply and continues working

The agent decides when to ask based on injected prompt guidance — it won't ask about routine fixes or obvious errors, only when it genuinely has low confidence.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, architecture, and detailed technical documentation.

See [AGENTS.md](./AGENTS.md) for code organization and project internals.

## License

[MIT](./LICENSE)
