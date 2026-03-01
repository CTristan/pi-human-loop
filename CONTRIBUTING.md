# Contributing to pi-human-loop

Thank you for your interest in contributing! This guide covers architecture, development setup, and operational details.

For project internals and code organization, see [AGENTS.md](./AGENTS.md).

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Fix-Die-Repeat (Python)          [separate repo]│
│  - Orchestrates the check → fix → review loop   │
│  - Invokes pi with `-p` (print mode)            │
│  - Passes extension via `-e /path/to/ext`       │
└──────────────┬──────────────────────────────────┘
               │ spawns pi subprocess
               ▼
┌─────────────────────────────────────────────────┐
│  Pi (agent runtime, print mode)                 │
│  - Extension loaded at startup                  │
│  - Extension injects ask_human guidance         │
│  - LLM calls tools (read, edit, bash, ask_human)│
└──────────────┬──────────────────────────────────┘
               │ LLM calls ask_human tool
               ▼
┌─────────────────────────────────────────────────┐
│  pi-human-loop Extension (TypeScript)            │
│  - Registers ask_human tool                     │
│  - Injects system prompt guidance               │
│  - Ensures Zulip stream exists (auto-provision) │
│  - Posts agent's message to repo:branch topic    │
│  - Long-polls Zulip event API for human reply   │
│  - Returns human's answer to LLM               │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Zulip Server                                   │
│  - One stream for all repos (default: pi-human-loop)│
│  - One topic per repo:branch                   │
│  - Long-poll API for efficient waiting          │
└─────────────────────────────────────────────────┘
```

## Development Setup

### Prerequisites

- Node.js
- npm
- A bash-compatible environment (macOS/Linux, or Git Bash/WSL on Windows)

### Install Dependencies

```bash
npm install
```

### Set Up Git Hooks

```bash
npm run setup-hooks
```

This installs a pre-commit hook that runs the full CI gate before every commit.

### Running Tests

```bash
npm test              # Run tests with coverage
npm run test:watch    # Run tests in watch mode
```

### Linting and Formatting

This project uses [Biome](https://biomejs.dev/) (not ESLint) for linting and formatting:

```bash
npm run check    # Check for lint and format issues
npm run fix      # Auto-fix lint and format issues
```

### Type Checking

```bash
npm run type-check
```

### Full CI Gate

Run the same checks that CI runs:

```bash
npm run ci
```

This runs type checking, linting, formatting, and tests in sequence.

### TypeScript/Biome Compatibility Note

`tsconfig.json` intentionally keeps `noPropertyAccessFromIndexSignature` disabled (`false`) because enabling it conflicts with Biome's `useLiteralKeys` rule.

## Configuration

Configuration is loaded from three sources, in order of priority:

1. Project config: `.pi/human-loop.json`
2. Environment variables
3. Global config: `~/.pi/human-loop.json`

Global config stores credentials and global defaults; project config stores the stream name and repo-specific overrides. The `/human-loop-config` wizard writes these files for you.

## Auto-Provisioning

When auto-provisioning is enabled (default: `true`), the tool ensures the configured stream exists and the bot is subscribed before posting messages:

1. Checks if the stream exists (via Zulip API `createStream`, which is idempotent).
2. Ensures the bot is subscribed to the stream (required to receive event queue events).

This happens once per tool invocation, making the extension resilient to stream deletion or subscription changes.

If auto-provisioning is disabled, the tool assumes the stream exists and skips creation. If the stream doesn't exist or the bot isn't subscribed, the tool will fail when posting or registering the event queue. This mode is useful for locked-down Zulip servers where stream creation requires admin approval.

## Error Handling

The extension surfaces errors loudly to avoid silent failures:

| Scenario | Behavior |
|----------|----------|
| Missing/invalid configuration | Tool returns a critical error; agent must stop and report it |
| Zulip server unreachable | Tool returns a critical error; agent must stop and report it |
| Human never replies | Tool blocks indefinitely (by design) until the Pi process is killed |
| Multiple humans reply | Returns first non-bot message; subsequent replies are visible in the Zulip topic |
| Cancellation or graceful shutdown during poll | Attempts to clean up Zulip event queue and return a cancellation result (behavior on hard kills such as `SIGKILL` is not guaranteed) |

## Multi-turn Conversations

The `ask_human` tool supports follow-up questions within the same Zulip topic. The first call constructs a `repo:branch` topic and returns that value as `thread_id`. Subsequent calls can pass that `thread_id` to continue the conversation:

```typescript
// First call — constructs repo:branch topic
const result1 = await ask_human({
  message: "Should I use approach A or B?\n\nContext about both approaches...\n\nConfidence: 30/100 — I'm unsure which approach is better.",
  confidence: 30,
});
// result1.details.thread_id = "my-repo:feature/add-payments"

// Follow-up — continues in the same topic
const result2 = await ask_human({
  message: "Here's the code for approach A. Does this look right?\n\ndef process(): ...\n\nConfidence: 50/100 — more confident now with the code.",
  confidence: 50,
  thread_id: result1.details.thread_id,
});
```

## Message Format

The agent composes natural messages — like asking a colleague for help — and posts them directly to Zulip with no formatting or wrapping. The LLM decides what context to include and how to present it.

### Initial Question (repo:branch topic)

```
I'm hitting an issue with the payment processor and need guidance. The test `test_refund_exceeds_original_amount` expects a `DecimalError` but the code is throwing a `ValueError` instead.

Looking at payments/processor.py:142, the validation checks `refund_amount > original_amount` first, then calls `validate_decimal_precision()`. The error is thrown in `validate_decimal_precision()` before the amount comparison completes.

Options I've considered:
1. Swap the order of validations — but this would allow invalid decimals through
2. Catch `ValueError` and re-raise as `DecimalError` — but this feels wrong semantically

Which approach should I take? Or is there something I'm missing?

Confidence: 25/100 — I understand the error, but I'm uncertain about the architectural trade-offs.
```

### Follow-up (same topic)

```
Thanks for the suggestion! I've implemented the try-catch approach, but now I'm seeing a different issue.

The decimal validation is working, but the error messages are less informative than I'd like. The original `DecimalError` included the field name, but now I'm getting a generic "Invalid decimal precision" message.

Should I:
1. Pass the field name to `validate_decimal_precision()` and include it in the error
2. Catch and re-raise with a custom error message

Confidence: 60/100 — the code works, just need to decide on error message quality.
```

## Debug Logging

The extension supports optional debug logging to help troubleshoot issues with Zulip integration.

### Enabling Debug Logging

Debug logging can be enabled via any of these methods:

1. **Global config**: Set `"debug": true` in `~/.pi/human-loop.json`
2. **Project config**: Set `"debug": true` in `.pi/human-loop.json`
3. **Environment variable**: Set `ZULIP_DEBUG=true` (also accepts `1` or `yes`)

Priority order: project config > environment variable > global config.

### Log File Location

Logs are written to `.pi/human-loop-debug.log` in the project root (same directory as `.pi/human-loop.json`).

### Log Format

Each log entry is a JSON object on its own line:

```json
{"timestamp":"2024-02-28T20:00:00.000Z","message":"Config loaded","data":{"serverUrl":"https://zulip.example.com","botEmail":"bot@example.com","stream":"test-stream","debug":true}}
```

### What Gets Logged

When debug logging is enabled:
- Configuration loading and merging
- Zulip API calls (postMessage, registerEventQueue, pollForReply, etc.)
- Event queue registration and re-registration
- Polling lifecycle (start, events received, reply received, etc.)
- Auto-provisioning steps
- Tool execution lifecycle

When debug logging is disabled (default), logging is zero-overhead — no file I/O occurs.

### Log File Truncation

The log file is truncated at the start of each session, so only the current session's logs are retained. If you need to compare logs across sessions, copy the log file before starting a new session.

### Debugging Event Queue Issues

If the extension appears to hang waiting for a reply, enable debug logging and check for:
- "ZulipClient.registerEventQueue" events
- "ZulipClient.pollForReply events received" entries
- Whether messages are being received or just heartbeats

The event queue should receive both heartbeat events (type="heartbeat") and message events (type="message"). If only heartbeats are received, this indicates a subscription or narrow issue.

## Error Handling

The extension surfaces errors loudly to avoid silent failures:

| Scenario | Behavior |
|----------|----------|
| Missing/invalid configuration | Tool returns a critical error; agent must stop and report it |
| Zulip server unreachable | Tool returns a critical error; agent must stop and report it |
| Human never replies | Tool blocks indefinitely (by design) until Pi process is killed |
| Multiple humans reply | Returns first non-bot message; subsequent replies are visible in Zulip topic |
| Cancellation or graceful shutdown during poll | Attempts to clean up Zulip event queue and return a cancellation result (behavior on hard kills such as `SIGKILL` is not guaranteed) |
| BAD_EVENT_QUEUE_ID error | Automatically re-registers the event queue (up to 3 attempts) and continues polling |
| Stale messages in event queue | Filters out messages with ID <= questionMessageId to prevent old messages from being returned as replies |
