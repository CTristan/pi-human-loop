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
│  - Posts formatted question to Zulip stream     │
│  - Long-polls Zulip event API for human reply   │
│  - Returns human's answer to LLM               │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Zulip Server                                   │
│  - One stream per repo                          │
│  - One topic per agent question/conversation    │
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

## Error Handling

The extension gracefully handles various error scenarios without crashing Pi:

| Scenario | Behavior |
|----------|----------|
| Missing/invalid env vars | Extension loads but tool returns descriptive error on first call |
| Zulip server unreachable | Tool returns error; agent proceeds with best guess |
| Human never replies | Tool blocks indefinitely (by design) until the Pi process is killed |
| Multiple humans reply | Returns first non-bot message; subsequent replies are visible in the Zulip topic |
| Cancellation or graceful shutdown during poll | Attempts to clean up Zulip event queue and return a cancellation result (behavior on hard kills such as `SIGKILL` is not guaranteed) |

## Multi-turn Conversations

The `ask_human` tool supports follow-up questions within the same Zulip topic. The first call creates a new topic and returns a `thread_id`. Subsequent calls can pass that `thread_id` to continue the conversation:

```typescript
// First call — creates new topic
const result1 = await ask_human({
  question: "Should I use approach A or B?",
  context: "Context about both approaches...",
  confidence: 30,
});
// result1.details.thread_id = "Agent Q #42 — payment processing"

// Follow-up — continues in same topic
const result2 = await ask_human({
  question: "Here's the code for approach A. Does this look right?",
  context: "def process(): ...",
  confidence: 50,
  thread_id: result1.details.thread_id,
});
```

## Message Format

### Initial Question (new topic)

```
🤖 **Agent needs help**

**Question:** Should I change the test or the code?

**Context:**
Error: Expected DecimalError, got ValueError
File: payments/processor.py:142

**Confidence:** 25/100

_Reply in this topic. The agent is waiting for your response._
```

### Follow-up (same topic)

```
🤖 **Follow-up:**

Here's the code for approach A:
...

_Reply in this topic. The agent is waiting for your response._
```
