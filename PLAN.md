# PLAN.md — `pi-human-loop` Extension

**Status:** Planning complete, ready for implementation
**Created:** 2026-02-25
**Last Updated:** 2026-02-25

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Architecture](#architecture)
- [Design Decisions](#design-decisions)
  - [Why an Extension (Not a Skill)](#why-an-extension-not-a-skill)
  - [Why Zulip (Not Slack)](#why-zulip-not-slack)
  - [Conversation Threading Model](#conversation-threading-model)
  - [No Timeout by Design](#no-timeout-by-design)
  - [Separate Repository](#separate-repository)
  - [Print Mode Compatibility](#print-mode-compatibility)
  - [Self-Injecting System Prompt](#self-injecting-system-prompt)
- [Extension Design](#extension-design)
  - [File Structure](#file-structure)
  - [Tool Interface](#tool-interface)
  - [System Prompt Injection](#system-prompt-injection)
  - [Zulip Mapping](#zulip-mapping)
  - [Zulip Client Design](#zulip-client-design)
  - [Configuration](#configuration)
  - [Message Format](#message-format)
  - [Error and Edge Case Handling](#error-and-edge-case-handling)
- [FDR Integration](#fdr-integration)
  - [Config Changes](#config-changes)
  - [Runner Changes](#runner-changes)
- [Testing Strategy](#testing-strategy)
- [Implementation Order](#implementation-order)
- [Pi Extension Reference](#pi-extension-reference)
- [Open Items](#open-items)

---

## Overview

`pi-human-loop` is a standalone [pi](https://github.com/mariozechner/pi) extension that enables an AI coding agent to start a conversation with a human through Zulip whenever the agent has low confidence in a task. While the primary use case is the [Fix-Die-Repeat](/Users/chris/projects/fix-die-repeat) (FDR) automated check-fix-review loop, the extension is fully generic — any pi user or orchestrator can use it.

The extension:
1. Registers a custom tool called `ask_human` that the LLM can call
2. Injects usage guidance into pi's system prompt via the `before_agent_start` event
3. Posts formatted questions to a Zulip stream (one per repo) and blocks until a human replies
4. Supports multi-turn conversations via Zulip topic threading

**Repository:** `pi-human-loop` lives in its own repository, separate from FDR.

---

## Problem Statement

When FDR runs an automated loop (check → fix → review → repeat), the agent sometimes:

- Oscillates between the same failing fixes
- Encounters domain-specific business logic it doesn't understand
- Needs to choose between multiple valid architectural approaches
- Faces test expectations that may be intentionally wrong (not a code bug)
- Is about to make a broad-impact change it's unsure about

Currently, FDR detects oscillation and aborts. There is no mechanism for the agent to ask for help. This wastes the work already done and forces a human to diagnose the problem from scratch.

**Goal:** Give the agent a way to pause, ask a human for guidance via Zulip, receive an answer, and continue — all within the same pi session and FDR iteration.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Fix-Die-Repeat (Python)          [separate repo]│
│  - Orchestrates the check → fix → review loop   │
│  - Invokes pi with `-p` (print mode)            │
│  - Passes extension via `-e /path/to/ext`       │
│  - Only change: config + `-e` flag + osc. nudge │
└──────────────┬──────────────────────────────────┘
               │ spawns pi subprocess
               ▼
┌─────────────────────────────────────────────────┐
│  Pi (agent runtime, print mode)                 │
│  - Extension loaded at startup                  │
│  - Extension injects ask_human guidance into     │
│    system prompt via before_agent_start          │
│  - LLM calls tools (read, edit, bash, etc.)     │
│  - LLM decides when to call ask_human           │
└──────────────┬──────────────────────────────────┘
               │ LLM calls ask_human tool
               ▼
┌─────────────────────────────────────────────────┐
│  pi-human-loop Extension (TS)  [this repository] │
│  - Registers ask_human tool                     │
│  - Injects system prompt guidance               │
│  - Posts formatted question to Zulip stream     │
│  - Long-polls Zulip event API for human reply   │
│  - Returns human's answer to LLM               │
│  - Supports multi-turn via topic threading      │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Zulip Server                                   │
│  - One stream per repo                          │
│  - One topic per agent question/conversation    │
│  - Humans reply in topic threads                │
│  - Long-poll API for efficient waiting          │
└─────────────────────────────────────────────────┘
```

**Key data flow:**

1. FDR spawns pi with `-p -e /path/to/pi-human-loop`
2. The extension injects `ask_human` usage guidance into pi's system prompt (via `before_agent_start`)
3. Pi's LLM attempts the task (fix, review, etc.)
4. When confidence is low, the LLM calls `ask_human(question, context, confidence)`
5. The extension posts to Zulip and blocks on long-poll
6. A human sees the message, replies in the topic
7. The extension returns the reply to the LLM
8. The LLM continues with the human's guidance
9. If more clarification is needed, the LLM calls `ask_human` again with the same `thread_id` to continue in the same Zulip topic
10. Eventually pi finishes, returns to FDR, and the loop continues

---

## Design Decisions

### Why an Extension (Not a Skill)

Per pi's own guidance: *"If you need event hooks, typed tools, UI components, or policy enforcement, use an extension."*

We need:
- A **custom tool** (`ask_human`) the LLM can call with typed parameters
- An **event hook** (`before_agent_start`) to inject system prompt guidance
- **npm dependencies** (`zulip-js` or raw `fetch` for the Zulip API)
- **Blocking execution** while waiting for a human reply (long-poll loop)
- **State management** (tracking open Zulip event queues for cleanup)

A skill (markdown instructions + bash scripts) cannot provide typed tool parameters, hook into lifecycle events, or block the LLM mid-turn waiting for external input.

### Why Zulip (Not Slack)

The **no timeout** requirement (human may take hours to respond) is the deciding factor:

- **Zulip** has a purpose-built [long-polling event API](https://zulip.com/api/real-time-events). You register an event queue and call `GET /events` which blocks server-side (~90 seconds per cycle, then re-poll). This means near-zero wasted requests during idle periods and instant response when the human replies.
- **Slack** would require polling `conversations.replies` every N seconds for potentially hours. At a 5-second interval that's 720 requests/hour — within rate limits but wasteful and inelegant. Slack's real-time alternatives (Socket Mode, Events API) require a persistent server, which doesn't fit pi's subprocess model.

Additional Zulip advantages:
- **Topic-based threading** maps perfectly to our model (each agent question = one topic)
- **Self-hostable** and open-source
- **Simpler bot setup** than Slack (no OAuth app, just a bot user with an API key)

### Conversation Threading Model

**Multi-turn via repeated tool calls, same Zulip topic (Option C):**

1. Agent calls `ask_human("Should I change the test or the code?")`
2. Extension posts to Zulip, creates topic `"Agent Q #3 — payment processing"`
3. Human replies → returned to LLM with `thread_id`
4. LLM calls `ask_human("Here's the code... does this clarify?", thread_id=<same>)`
5. Follow-up posted to same Zulip topic
6. Continues until LLM has enough confidence and stops calling the tool

**Why not multi-turn within a single tool call?** Pi's architecture doesn't support the LLM responding mid-tool-execution. `onUpdate` can stream progress to the UI but cannot solicit a new LLM response. The repeated-call pattern works naturally with pi's tool execution model: one call → one response.

**Why not single-reply with new topics each time?** Scatters the conversation across multiple Zulip topics, making it hard for the human to follow context.

### No Timeout by Design

The `ask_human` tool blocks indefinitely until a human replies. Rationale:

- A human may not be available for hours (different timezone, in meetings, etc.)
- The pi subprocess consumes minimal resources while blocked (just a long-poll HTTP connection)
- FDR's subprocess simply waits — it has no other work to do until pi returns
- If someone wants to abort, they can kill the FDR process (which kills the pi subprocess, which triggers `signal.aborted` in the tool, which cleanly deregisters the Zulip event queue)
- A future enhancement could add optional timeouts to FDR, at which point the human can manually start a new pi conversation outside FDR

### Separate Repository

The extension lives in its own repository (`pi-human-loop`), not inside FDR. Rationale:

- **Different tech stacks** — The extension is TypeScript with npm; FDR is Python with uv. Mixing them in one repo means two package managers, two CI pipelines, two linting configs, and a confusing directory structure. Neither toolchain benefits from co-location.
- **True standalone reusability** — Any pi user can install it independently, not just FDR users. It could eventually be published as a pi package (`git:github.com/user/pi-human-loop`).
- **FDR's reference is trivial** — Just a path in an env var (`FDR_HUMAN_LOOP_EXTENSION=/path/to/pi-human-loop`). No tight coupling needed.
- **Independent release cycles** — Zulip API changes or new extension features don't require an FDR release.

### Print Mode Compatibility

FDR runs pi in `-p` (print) mode. In this mode:
- ✅ Custom tools work — the LLM calls them, they execute, results return
- ✅ `before_agent_start` event fires — system prompt injection works
- ✅ `session_shutdown` event fires — cleanup works
- ✅ `pi.exec()` works for shell commands
- ❌ `ctx.ui.*` dialog methods are no-ops (`confirm`, `select`, `input`)
- ❌ `ctx.ui.notify()` is a no-op

This is fine because the extension's "UI" is Zulip, not the terminal. All interaction happens through the Zulip API. The extension should check `ctx.hasUI` before any UI calls, but it won't need any for core functionality.

### Self-Injecting System Prompt

The extension dynamically injects `ask_human` usage guidance into pi's system prompt via the `before_agent_start` event. This is superior to having FDR modify its own prompt templates because:

- **Self-contained** — The tool definition and its usage instructions live together in the extension. No coordination with the host application (FDR or otherwise).
- **Universal** — Anyone loading the extension gets the guidance automatically. No `human_loop_enabled` template flag needed in the host.
- **Less host surface area** — FDR's Jinja templates don't change at all. FDR's only responsibilities are: (1) config option for the extension path, (2) pass `-e` flag to pi, (3) optional oscillation nudge.
- **Co-located maintenance** — If the tool parameters change, the guidance updates in the same commit in the same repository.

The guidance tells the LLM when to use `ask_human`, what parameters to provide, and how to use `thread_id` for follow-ups. See [System Prompt Injection](#system-prompt-injection) for the full text.

FDR retains one small responsibility: the **oscillation nudge**. When `check_oscillation()` detects repeated identical check output, it appends a short sentence to the next prompt: *"You appear stuck in a loop. Consider using `ask_human` to get guidance."* This is FDR-specific context (oscillation state) that the extension cannot know about. It's a lightweight nudge, not full usage instructions — those come from the extension's system prompt.

---

## Extension Design

### File Structure

```
pi-human-loop/                    # Standalone repository
├── package.json                  # deps: @sinclair/typebox; devDeps: vitest, @types/node, biome
├── package-lock.json
├── tsconfig.json                 # TypeScript configuration
├── biome.json                    # Linting and formatting (Biome, per project tooling history)
├── src/
│   ├── index.ts                  # Extension entry: registers tool, injects system prompt, handles shutdown
│   ├── tool.ts                   # ask_human tool definition and execute logic
│   ├── zulip-client.ts           # Zulip API wrapper: post message, register queue, long-poll, cleanup
│   ├── config.ts                 # Read and validate environment variables, export typed config
│   └── prompt.ts                 # System prompt guidance text (ASK_HUMAN_GUIDANCE constant)
├── tests/
│   ├── config.test.ts            # Config validation: missing vars, invalid URLs, defaults
│   ├── zulip-client.test.ts      # Zulip client: mocked HTTP for post, poll, event parsing
│   ├── tool.test.ts              # Tool execute: mocked Zulip client, thread_id reuse, signal abort
│   └── prompt.test.ts            # Prompt text contains expected keywords and structure
├── AGENTS.md                     # Agent context for this repository
└── README.md                     # Usage docs, Zulip setup instructions, env var reference
```

### Tool Interface

**Parameters (what the LLM provides):**

```typescript
import { Type } from "@sinclair/typebox";

Type.Object({
  question: Type.String({
    description: "The question to ask the human"
  }),
  context: Type.String({
    description: "Relevant context: error logs, code snippets, options considered, reasoning so far"
  }),
  confidence: Type.Number({
    description: "Your current confidence level (0-100) in resolving this without help"
  }),
  thread_id: Type.Optional(Type.String({
    description: "Continue an existing conversation. Use the thread_id from a previous ask_human response."
  })),
})
```

**Return value (what the LLM receives):**

```typescript
// Success
{
  content: [{ type: "text", text: "Human replied: <reply text>" }],
  details: {
    thread_id: "agent-q-3-payment-processing",  // For follow-up calls
    responder: "chris@example.com",              // Who replied
  },
}

// Error (Zulip unreachable, misconfigured, etc.)
{
  content: [{ type: "text", text: "Failed to reach human: <error>. Proceeding without human input." }],
  isError: true,
  details: {},
}

// Aborted (pi killed the tool via signal)
{
  content: [{ type: "text", text: "Human consultation cancelled." }],
  details: {},
}
```

### System Prompt Injection

The extension uses pi's `before_agent_start` event to append guidance to the system prompt on every turn. This runs automatically whenever the extension is loaded — no host configuration needed.

**Implementation in `index.ts`:**

```typescript
import { ASK_HUMAN_GUIDANCE } from "./prompt.ts";

pi.on("before_agent_start", async (event, _ctx) => {
  return {
    systemPrompt: event.systemPrompt + "\n\n" + ASK_HUMAN_GUIDANCE,
  };
});
```

**Guidance text (in `prompt.ts`):**

```typescript
export const ASK_HUMAN_GUIDANCE = `## Human Assistance (ask_human tool)

You have access to an \`ask_human\` tool that posts questions to the team's Zulip chat and waits for a human response.

### When to use ask_human

Use it when you have LOW CONFIDENCE in your approach:
- You've attempted the same fix more than once and it keeps failing
- The error involves domain-specific business logic you don't understand
- You need to choose between multiple valid architectural approaches
- Test expectations seem intentionally wrong (not a code bug you should fix)
- You're about to make a change that could have broad impact across the codebase
- You're unsure whether a review finding is a real issue or an intentional design choice

### When NOT to use ask_human

Do NOT use it for:
- Routine fixes you're confident about (syntax errors, missing imports, typos)
- Issues where the error message clearly indicates the solution
- Simple refactoring with obvious correctness

### How to use it

1. Call \`ask_human\` with your question, relevant context, and your confidence level (0-100)
2. The tool will block until a human responds — this is expected
3. If the response includes a \`thread_id\`, use it in follow-up \`ask_human\` calls to continue the same conversation
4. Once you have enough information, proceed with your task — do not keep asking unnecessarily`;
```

### Zulip Mapping

| Concept | Zulip Equivalent | Example |
|---------|-----------------|---------|
| Repo channel | **Stream** | `fix-die-repeat` |
| Agent question + conversation | **Topic** within stream | `Agent Q #3 — payment processing` |
| Agent's question/follow-up | Bot message in topic | Posted by the Zulip bot user |
| Human's reply | Human message in same topic | Any non-bot message |
| Multi-turn | Multiple messages in topic | Tool calls reference topic via `thread_id` |

### Zulip Client Design

The client wraps three Zulip API operations. The client uses raw `fetch()` against Zulip's REST API rather than the `zulip-js` npm package, keeping dependencies minimal and giving full control over long-poll behavior.

**Authentication:** All requests use HTTP Basic Auth (`bot-email:api-key`) per Zulip's API convention.

#### 1. Post Message

```
POST /api/v1/messages
{
  type: "stream",
  to: <stream_name>,
  topic: <topic_name>,
  content: <formatted_markdown>
}
```

- For new questions: generate a topic name like `Agent Q #<N> — <short_summary>`
- For follow-ups (`thread_id` provided): post to the existing topic

#### 2. Register Event Queue

```
POST /api/v1/register
{
  event_types: ["message"],
  narrow: [
    ["stream", <stream_name>],
    ["topic", <topic_name>]
  ]
}
```

Returns `queue_id` and `last_event_id` for long-polling.

#### 3. Long-Poll for Reply

```
GET /api/v1/events?queue_id=<id>&last_event_id=<id>
```

- Blocks server-side for up to ~90 seconds
- Returns events (messages) or empty if timeout
- On empty: re-poll (loop indefinitely)
- On message: check if sender is NOT the bot (filter out own messages)
- On `signal.aborted`: deregister queue, return cancellation
- On HTTP error: retry with backoff, deregister queue on fatal errors

#### 4. Cleanup (Deregister Queue)

```
DELETE /api/v1/events
{
  queue_id: <id>
}
```

Called on:
- Successful reply received
- Signal abort (pi killed the tool)
- `session_shutdown` event (pi exiting)

### Configuration

All configuration via environment variables (no config files):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZULIP_SERVER_URL` | Yes | — | Zulip server base URL (e.g., `https://zulip.example.com`) |
| `ZULIP_BOT_EMAIL` | Yes | — | Bot user email address |
| `ZULIP_BOT_API_KEY` | Yes | — | Bot user API key |
| `ZULIP_STREAM` | Yes | — | Stream name for this repo |
| `ZULIP_POLL_INTERVAL_MS` | No | `5000` | Fallback poll interval if long-poll is unavailable (ms) |

**Validation** (in `config.ts`):
- All required variables must be present and non-empty
- `ZULIP_SERVER_URL` must be a valid URL (starts with `http://` or `https://`)
- `ZULIP_POLL_INTERVAL_MS` must be a positive integer if provided

**When validation fails:** The tool registers but returns an error result on first call, explaining which env vars are missing. This avoids crashing pi on startup when the extension is loaded but not configured.

### Message Format

**Initial question (new topic):**

```markdown
🤖 **Agent needs help**

**Question:** The test `test_payment_processing` expects a `DecimalError`
but the code raises `ValueError`. Should I change the test or the code?

**Context:**
- File: `payments/processor.py:142`
- Error: `AssertionError: Expected DecimalError, got ValueError`
- Attempted 2 fixes already

**Confidence:** 25/100

_Reply in this topic. The agent is waiting for your response._
```

**Follow-up (same topic, via `thread_id`):**

```markdown
🤖 **Follow-up:**

Here's the code at line 142:

​```python
raise ValueError("Invalid decimal format")
​```

The test expects `DecimalError` from the `decimal` stdlib. Should I wrap this
in a `DecimalError` or update the test expectation?

_Reply in this topic. The agent is waiting for your response._
```

### Error and Edge Case Handling

| Scenario | Behavior |
|----------|----------|
| Human replies | Return reply text + `thread_id` + responder to LLM |
| Multiple humans reply before poll returns | Return the first non-bot message; subsequent messages are visible in the Zulip topic for context but not returned |
| Zulip server unreachable on post | Return error result; LLM proceeds with best guess |
| Zulip server drops during long-poll | Retry with exponential backoff (max 60s between retries) |
| `signal.aborted` (pi subprocess killed) | Deregister event queue, return cancellation result |
| `session_shutdown` event | Deregister any active event queues |
| Missing/invalid env vars | Tool returns descriptive error on first call (does not crash pi) |
| Bot receives its own message in poll | Filter out messages where sender email matches `ZULIP_BOT_EMAIL` |
| Invalid `thread_id` on follow-up | Post to the topic name as-is; if topic doesn't exist, Zulip creates it (effectively a new conversation) |

---

## FDR Integration

Changes to the Fix-Die-Repeat Python project are **minimal** — no prompt template changes needed since the extension injects its own system prompt guidance.

### Config Changes

Add to `Settings` in `config.py`:

```python
human_loop_extension: str | None = Field(
    default=None,
    alias="FDR_HUMAN_LOOP_EXTENSION",
    description="Path to the pi-human-loop extension directory. Enables ask_human tool.",
)
```

### Runner Changes

**1. Pass extension to pi.** In `run_pi()` (or the arg-building code that calls it), when `settings.human_loop_extension` is set:

```python
if self.settings.human_loop_extension:
    cmd_args.extend(["-e", self.settings.human_loop_extension])
```

**2. Oscillation nudge.** In `check_oscillation()`, when oscillation is detected AND the extension is enabled, append to the prompt:

```
You appear stuck in a loop making the same changes repeatedly.
Consider using the `ask_human` tool to get guidance from the team.
```

This is the only FDR-specific prompt text. It's a short nudge referencing the tool — full usage instructions are already in the system prompt via the extension's `before_agent_start` handler.

**No prompt template changes.** The extension's `before_agent_start` handler injects all `ask_human` guidance into pi's system prompt automatically whenever the extension is loaded.

---

## Testing Strategy

### Extension Tests (TypeScript, Vitest)

**`tests/config.test.ts`:**
- Missing required env vars → returns validation error with descriptive message
- All required vars present → returns valid config object
- Invalid URL format → returns validation error
- Optional `ZULIP_POLL_INTERVAL_MS` defaults to 5000
- Non-numeric `ZULIP_POLL_INTERVAL_MS` → returns validation error

**`tests/zulip-client.test.ts`** (mocked `fetch`):
- `postMessage()` — sends correct payload, returns message ID
- `postMessage()` — handles HTTP errors gracefully
- `registerEventQueue()` — sends correct narrow filter, returns queue ID
- `pollForReply()` — returns human message, filters out bot messages
- `pollForReply()` — re-polls on empty response (long-poll timeout)
- `pollForReply()` — retries with backoff on HTTP errors
- `pollForReply()` — exits on `signal.aborted`
- `deregisterQueue()` — sends correct queue ID
- `deregisterQueue()` — handles errors gracefully (best-effort cleanup)

**`tests/tool.test.ts`** (mocked Zulip client):
- New question: posts message, polls, returns reply with `thread_id`
- Follow-up: uses provided `thread_id` as topic, posts to same topic
- Config validation failure: returns error result without calling Zulip
- Zulip post failure: returns error result
- Signal abort: returns cancellation result, calls cleanup
- Formats message correctly with question, context, confidence

**`tests/prompt.test.ts`:**
- Guidance text contains `ask_human` tool name
- Guidance text mentions confidence level
- Guidance text mentions `thread_id` for follow-ups
- Guidance text includes both "when to use" and "when NOT to use" sections

### FDR Tests (Python, pytest)

- Config: `FDR_HUMAN_LOOP_EXTENSION` parsed correctly, defaults to `None`
- Runner: `-e` flag added to pi args when extension path is set
- Runner: `-e` flag NOT added when extension path is `None`
- Oscillation: nudge text includes `ask_human` reference when extension is enabled
- Oscillation: nudge text absent when extension is not enabled

### Coverage Target

- Extension: 80%+ line coverage
- FDR changes: covered by existing test patterns (config tests)

---

## Implementation Order

### Phase 1: Extension Scaffold

1. **Create repository** — `pi-human-loop` with `package.json`, `tsconfig.json`, `biome.json`, `AGENTS.md`
2. **`src/config.ts`** — env var reading, validation, typed config export + tests

### Phase 2: Zulip Client

3. **`src/zulip-client.ts`** — post message, register queue, long-poll, deregister + tests (mocked `fetch`)

### Phase 3: Tool and Prompt

4. **`src/prompt.ts`** — `ASK_HUMAN_GUIDANCE` constant + tests
5. **`src/tool.ts`** — `ask_human` tool definition, wire config + client + tests (mocked client)

### Phase 4: Extension Entry Point

6. **`src/index.ts`** — register tool, `before_agent_start` for prompt injection, `session_shutdown` for cleanup

### Phase 5: FDR Integration

7. **FDR `config.py`** — add `human_loop_extension` setting
8. **FDR `runner.py`** — add `-e` flag to pi args, oscillation nudge text
9. **FDR tests** — config and runner tests for new setting

### Phase 6: Documentation

10. **Extension `README.md`** — usage, Zulip setup, env vars, examples
11. **FDR `README.md`** — document the human-loop feature
12. **FDR `AGENTS.md`** — update architecture section with extension integration

---

## Pi Extension Reference

Key pi APIs used by this extension (see [pi extensions docs](https://github.com/mariozechner/pi) for full reference):

### Registering the Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_human",
    label: "Ask Human",
    description: "...",
    parameters: Type.Object({ ... }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // signal.aborted — check for cancellation between poll cycles
      // onUpdate — can stream "Still waiting..." progress
      // ctx.hasUI — false in print mode, skip UI calls
      return { content: [...], details: { ... } };
    },
  });
}
```

### System Prompt Injection via before_agent_start

```typescript
pi.on("before_agent_start", async (event, _ctx) => {
  return {
    systemPrompt: event.systemPrompt + "\n\n" + ASK_HUMAN_GUIDANCE,
  };
});
```

This fires before every agent turn. The returned `systemPrompt` replaces the current system prompt for that turn (chained across extensions). The extension appends its guidance to whatever system prompt already exists.

### Session Shutdown Cleanup

```typescript
pi.on("session_shutdown", async (_event, _ctx) => {
  // Deregister any active Zulip event queues
});
```

### Extension with npm Dependencies

The extension uses `package.json` with dependencies. Pi resolves imports from the extension's own `node_modules/` via jiti. Run `npm install` in the extension directory before use.

```json
{
  "name": "pi-human-loop",
  "private": true,
  "type": "module",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {}
}
```

Note: The current plan uses raw `fetch()` for Zulip API calls, so there may be no runtime npm dependencies. `@sinclair/typebox` is provided by pi itself and does not need to be declared. Dev dependencies (vitest, biome, @types/node) are still needed.

### Print Mode Constraints

FDR runs pi with `-p` (print mode). In this mode:
- ✅ Custom tools execute normally
- ✅ `before_agent_start` event fires — system prompt injection works
- ✅ `session_shutdown` event fires — cleanup works
- ✅ `pi.exec()` works
- ❌ `ctx.ui.confirm()`, `ctx.ui.select()`, `ctx.ui.input()` → return defaults / undefined
- ❌ `ctx.ui.notify()` → no-op

The extension must not depend on any UI methods for core functionality.

---

## Open Items

These are minor implementation details to resolve during development:

1. **Topic naming convention** — Decide exact format for auto-generated topic names. Current proposal: `Agent Q #<N> — <short_summary>`. The `<N>` counter could be derived from existing topics in the stream, a simple timestamp, or a random short ID.
2. **Biome configuration** — Project tooling history says Biome for linting/formatting. Confirm exact config for a standalone TypeScript project.
3. **Vitest vs Node test runner** — Choose test framework during scaffolding. Vitest is more feature-rich; Node test runner has zero deps. Recommendation: Vitest for consistency with the TypeScript ecosystem.
4. **Zulip server setup** — Will be handled separately, not part of extension implementation. The extension just needs env vars pointing to an existing server.
5. **`@sinclair/typebox` availability** — Verify that pi provides this package at runtime so it doesn't need to be in the extension's own dependencies. The pi docs list it under "Available Imports" which suggests it's provided.
6. **`fetch` availability** — Node 18+ has global `fetch`. Verify the minimum Node version pi requires. If older, may need `node-fetch` as a dependency.
