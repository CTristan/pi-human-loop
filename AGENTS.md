# AGENTS.md

> **Note**: This is a living document and should be updated whenever appropriate to reflect changes in the project structure, configuration, or logic.

## Project Overview

`pi-human-loop` is a Pi extension that enables an AI coding agent to start a conversation with a human through Zulip whenever the agent has low confidence in a task. The extension registers a custom tool called `ask_human` that the LLM can call, injects usage guidance into Pi's system prompt, posts formatted questions to a Zulip stream, and blocks until a human replies. It supports multi-turn conversations via Zulip topic threading.

## Key Files

### Entry Point

- **`index.ts`**: Main extension entry point. Wires together all modules, registers the `ask_human` tool, handles `before_agent_start` for system prompt injection, and handles `session_shutdown` for cleanup.

### Source Modules (`src/`)

- **`src/config.ts`**: Configuration loading, validation, and export. Reads environment variables (`ZULIP_SERVER_URL`, `ZULIP_BOT_EMAIL`, `ZULIP_BOT_API_KEY`, `ZULIP_STREAM`, `ZULIP_POLL_INTERVAL_MS`) and validates them.
- **`src/zulip-client.ts`**: Zulip API wrapper. Handles posting messages, registering event queues, long-polling for replies, and deregistering queues. Uses raw `fetch()` for minimal dependencies.
- **`src/tool.ts`**: `ask_human` tool definition and execute logic. Wires config and Zulip client, formats messages, handles `thread_id` for follow-ups, and supports `signal.aborted` for cancellation.
- **`src/prompt.ts`**: System prompt guidance text. Exports `ASK_HUMAN_GUIDANCE` constant with instructions on when to use `ask_human`, how to use it, and when NOT to use it.
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

1. **Extension Load**: Pi loads the extension, `index.ts` registers the `ask_human` tool and hooks into `before_agent_start` and `session_shutdown`.
2. **System Prompt Injection**: Before each agent turn, `before_agent_start` appends `ASK_HUMAN_GUIDANCE` to the system prompt.
3. **Tool Call**: The LLM calls `ask_human(question, context, confidence, thread_id?)` when it needs human guidance.
4. **Zulip Post**: The tool posts a formatted message to the configured Zulip stream.
5. **Long-poll**: The tool registers an event queue and long-polls Zulip for a reply.
6. **Reply Received**: When a human replies, the tool returns the reply text + `thread_id` + responder to the LLM.
7. **Cleanup**: On successful reply, signal abort, or session shutdown, the tool deregisters the event queue.

## Zulip Mapping

| Concept | Zulip Equivalent | Example |
|---------|-----------------|---------|
| Repo channel | **Stream** | `fix-die-repeat` |
| Agent question + conversation | **Topic** within stream | `Agent Q #3 — payment processing` |
| Agent's question/follow-up | Bot message in topic | Posted by the Zulip bot user |
| Human's reply | Human message in same topic | Any non-bot message |
| Multi-turn | Multiple messages in topic | Tool calls reference topic via `thread_id` |

## Configuration Schema

All configuration via environment variables:

```bash
ZULIP_SERVER_URL=https://zulip.example.com
ZULIP_BOT_EMAIL=bot@example.com
ZULIP_BOT_API_KEY=your-api-key-here
ZULIP_STREAM=fix-die-repeat
ZULIP_POLL_INTERVAL_MS=5000  # optional
```

### Validation Rules

- All required variables must be present and non-empty.
- `ZULIP_SERVER_URL` must be a valid URL (starts with `http://` or `https://`).
- `ZULIP_POLL_INTERVAL_MS` must be a positive integer if provided.

When validation fails, the tool returns an error result on first call, explaining which env vars are missing. This avoids crashing Pi on startup.

## Development Guidelines

### File Size Limit

**Any file reaching 2000 lines or more must be refactored.** Split large files into focused modules with clear responsibilities. Aim to keep most files under roughly 500 lines where practical, and periodically refactor growing files.

### Code Organization

- Keep config reading and validation in `src/config.ts`.
- Keep Zulip API operations in `src/zulip-client.ts`.
- Keep tool definition and execute logic in `src/tool.ts`.
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

The extension must not depend on any UI methods for core functionality. All interaction happens through the Zulip API.
