# AGENTS.md

> **Note**: This is a living document and should be updated whenever appropriate to reflect changes in the project structure, configuration, or logic.

## Project Overview

`pi-human-loop` is a Pi extension that enables an AI coding agent to start a conversation with a human through Zulip whenever the agent has low confidence in a task. The extension registers a custom tool called `ask_human` that the LLM can call, injects usage guidance into Pi's system prompt, posts formatted questions to a Zulip stream, and blocks until a human replies. It supports multi-turn conversations via Zulip topic threading.

## Key Files

### Entry Point

- **`index.ts`**: Main extension entry point. Wires together all modules, registers the `ask_human` tool, registers the `/human-loop-config` wizard command, handles `before_agent_start` for system prompt injection, and handles `session_shutdown` for cleanup.

### Source Modules (`src/`)

- **`src/config.ts`**: Configuration loading, validation, and persistence. Merges global JSON config, env vars, and project JSON config. Exposes save helpers for the wizard.
- **`src/logger.ts`**: Debug logging module with zero-overhead when disabled. Writes JSON-formatted logs to `.pi/human-loop-debug.log` for troubleshooting.
- **`src/zulip-client.ts`**: Zulip API wrapper. Handles posting messages, registering event queues, long-polling for replies, stream creation, ensuring subscriptions, and deregistering queues. Uses raw `fetch()` for minimal dependencies.
- **`src/tool.ts`**: `ask_human` tool definition and execute logic. Loads config per call, auto-provisions streams when needed, formats messages, handles `thread_id` for follow-ups, and supports `signal.aborted` for cancellation.
- **`src/auto-provision.ts`**: Auto-provisions a stream for new repos and persists it to project config.
- **`src/repo.ts`**: Detects repo name from git remote or working directory.
- **`src/wizard.ts`**: Interactive `/human-loop-config` wizard (UI-only) for configuring credentials, streams, poll interval, auto-provisioning, and debug logging.
- **`src/ui-helpers.ts`**: TUI helpers for the wizard (custom select list wrapper).
- **`src/prompt.ts`**: System prompt guidance text. Exports `ASK_HUMAN_GUIDANCE` with instructions on when to use `ask_human` and how to handle failures.
- **`src/queue-registry.ts`**: Queue registry for cleanup on session shutdown. Manages active Zulip event queues that need cleanup when the session ends. Shared between `index.ts` and `src/tool.ts` to avoid circular dependencies.

### Documentation

- **`README.md`**: User-facing project overview — elevator pitch, quick start, and how it works. Optimized for cold readers.
- **`CONTRIBUTING.md`**: Development setup, architecture diagram, error handling reference, multi-turn conversation details, and message format documentation.
- **`LICENSE`**: MIT license.

### Testing

- **`tests/*.test.ts`**: Unit tests using Vitest. Run with `npm run test`.
- **Naming Convention**: Test filenames must clearly indicate what they are testing (e.g., `config.test.ts`, `zulip-client.test.ts`, `tool.test.ts`, `prompt.test.ts`).

### CI/CD

- **`scripts/ci.sh`**: CI gate script for local and automated checks (type checking, linting, formatting, unit tests). Requires a bash-compatible environment.
- **`scripts/setup-hooks.sh`**: Shell script to install and configure the Git pre-commit hook.
- **`.github/workflows/ci.yml`**: GitHub Actions workflow for running the CI gate on push/PR.
- **`.git/hooks/pre-commit`**: Local Git hook that runs `ci.sh` before every commit.

## Data Flow

1. **Extension Load**: Pi loads the extension, `index.ts` registers the `ask_human` tool, registers the `/human-loop-config` command, and hooks into `before_agent_start` and `session_shutdown`.
2. **System Prompt Injection**: Before each agent turn, `before_agent_start` appends `ASK_HUMAN_GUIDANCE` to the system prompt.
3. **Tool Call**: The LLM calls `ask_human(question, context, confidence, thread_id?)` when it needs human guidance.
4. **Auto-Provision (if needed)**: If no stream is configured and auto-provisioning is enabled, the tool creates a stream named after the repo and writes `.pi/human-loop.json`.
5. **Zulip Post**: The tool posts a formatted message to the configured Zulip stream.
6. **Long-poll**: The tool registers an event queue and long-polls Zulip for a reply.
7. **Reply Received**: When a human replies, the tool returns the reply text + `thread_id` + responder to the LLM.
8. **Cleanup**: On successful reply, signal abort, or session shutdown, the tool deregisters the event queue.

## Zulip Mapping

| Concept | Zulip Equivalent | Example |
|---------|-----------------|---------|
| Repo channel | **Stream** | `fix-die-repeat` |
| Agent question + conversation | **Topic** within stream | `Agent Q #3 — payment processing` |
| Agent's question/follow-up | Bot message in topic | Posted by the Zulip bot user |
| Human's reply | Human message in same topic | Any non-bot message |
| Multi-turn | Multiple messages in topic | Tool calls reference topic via `thread_id` |

## Configuration Schema

Configuration is loaded from three sources, merged in this order:

1. Project config: `.pi/human-loop.json`
2. Environment variables
3. Global config: `~/.pi/human-loop.json`

### Global Config (`~/.pi/human-loop.json`)

```jsonc
{
  "serverUrl": "https://zulip.example.com",
  "botEmail": "bot@example.com",
  "botApiKey": "your-api-key-here",
  "autoProvision": true,
  "pollIntervalMs": 5000,
  "debug": false
}
```

### Project Config (`.pi/human-loop.json`)

```jsonc
{
  "stream": "my-project",
  "streamDescription": "optional description",
  "pollIntervalMs": 3000
}
```

### Environment Variables (optional)

```bash
ZULIP_SERVER_URL=https://zulip.example.com
ZULIP_BOT_EMAIL=bot@example.com
ZULIP_BOT_API_KEY=your-api-key-here
ZULIP_STREAM=fix-die-repeat
ZULIP_POLL_INTERVAL_MS=5000  # optional
ZULIP_DEBUG=true             # optional, enables debug logging
```

### Validation Rules

- Required fields: server URL, bot email, bot API key (can come from any source).
- `serverUrl` must be a valid URL (starts with `http://` or `https://`).
- `pollIntervalMs` must be a positive integer if provided.
- `debug` is a boolean (default: `false`). When enabled, logs are written to `.pi/human-loop-debug.log`.

When validation fails, the tool returns an error result on first call, explaining the configuration errors.

### Subscription Requirement

The bot must be subscribed to a stream to receive event queue events from that stream. Event queue narrows filter messages based on the user's channel subscriptions. If the bot is not subscribed to a stream, the narrow produces no message events — only heartbeats.

The extension automatically ensures the bot is subscribed to the stream by calling `ensureSubscribed()` before registering an event queue. This is done for all streams (both auto-provisioned and manually configured).

### BAD_EVENT_QUEUE_ID Re-registration

Zulip garbage-collects event queues after approximately 10 minutes of inactivity. When an event queue is garbage-collected, the `/api/v1/events` endpoint returns a `BAD_EVENT_QUEUE_ID` error.

The extension handles this error by:
1. Detecting the `BAD_EVENT_QUEUE_ID` error in the poll response
2. Re-registering the event queue with the same stream and topic
3. Continuing to poll with the new queue ID
4. Logging the re-registration event for debugging
5. Limiting re-registration attempts to 3 to avoid infinite loops

This ensures that long-running conversations can continue even if the initial event queue is garbage-collected while waiting for a human reply.

## Development Guidelines

### File Size Limit

**Any file reaching 2000 lines or more must be refactored.** Split large files into focused modules with clear responsibilities. Aim to keep most files under roughly 500 lines where practical, and periodically refactor growing files.

### Code Organization

- Keep config reading and validation in `src/config.ts`.
- Keep Zulip API operations in `src/zulip-client.ts`.
- Keep tool definition and execute logic in `src/tool.ts`.
- Keep auto-provisioning in `src/auto-provision.ts`.
- Keep repo detection in `src/repo.ts`.
- Keep the configuration wizard in `src/wizard.ts` and UI helpers in `src/ui-helpers.ts`.
- Keep system prompt guidance in `src/prompt.ts`.
- Keep queue registry and cleanup logic in `src/queue-registry.ts`.
- Keep extension entry point and event handlers in `index.ts`.

### Testing Best Practices

- **Descriptive Names**: Ensure test files are named after the module or feature they test.
- **Mock External Dependencies**: Mock `fetch` for Zulip client tests, mock Zulip client for tool tests.
- **Coverage Target**: 80%+ line coverage for extension code.

### Language & Environment

- **Language**: TypeScript
- **Environment**: Node.js (executed within Pi extension host)
- **Tooling**: Shell scripts (`.sh`) are used for CI/CD and Git hooks. On Windows, a bash-compatible environment such as Git Bash or WSL is required.
- **TypeScript/Biome Compatibility**: `tsconfig.json` intentionally sets `noPropertyAccessFromIndexSignature` to `false` because enabling it conflicts with Biome's `useLiteralKeys` rule.
- **Dependencies**: `@mariozechner/pi-coding-agent` for extension API types. `@sinclair/typebox` is provided by Pi and does not need to be in dependencies.

### Print Mode Compatibility

The extension works in Pi's print mode (`-p` flag):
- ✅ Custom tools execute normally
- ✅ `before_agent_start` event fires — system prompt injection works
- ✅ `session_shutdown` event fires — cleanup works
- ❌ `ctx.ui.*` dialog methods are no-ops

The extension must not depend on any UI methods for core functionality. The only UI exception is the interactive `/human-loop-config` wizard, which guards on `ctx.hasUI`.
