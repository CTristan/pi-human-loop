# pi-human-loop

A Pi extension that enables an AI coding agent to start a conversation with a human through Zulip whenever the agent has low confidence in a task.

## Features

- **Custom `ask_human` Tool**: The LLM can call this tool when it needs human guidance
- **Automatic System Prompt Injection**: The extension injects usage guidance into Pi's system prompt on startup
- **Zulip Integration**: Posts questions to a Zulip stream and blocks until a human replies
- **Multi-turn Conversations**: Supports topic-based threading for follow-up questions
- **Long-polling**: Efficient server-side blocking (~90 seconds) for minimal resource usage
- **Print Mode Compatible**: Works seamlessly with Pi's print mode (used by Fix-Die-Repeat)
- **Clean Shutdown**: Properly cleans up Zulip event queues on abort or session shutdown

## Installation

### From Local Directory

```bash
pi -e /path/to/pi-human-loop
```

### Using with Fix-Die-Repeat

The extension is designed to work seamlessly with [Fix-Die-Repeat](https://github.com/your-org/fix-die-repeat). Configure FDR with:

```bash
export FDR_HUMAN_LOOP_EXTENSION=/path/to/pi-human-loop
```

## Configuration

Configure via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZULIP_SERVER_URL` | Yes | — | Zulip server base URL (e.g., `https://zulip.example.com`) |
| `ZULIP_BOT_EMAIL` | Yes | — | Bot user email address |
| `ZULIP_BOT_API_KEY` | Yes | — | Bot user API key |
| `ZULIP_STREAM` | Yes | — | Stream name for this repo |
| `ZULIP_POLL_INTERVAL_MS` | No | `5000` | Fallback poll interval if long-poll is unavailable (ms) |

### Zulip Setup

1. **Create a Bot User**:
   - Go to your Zulip server's settings
   - Create a new bot user (e.g., `pi-agent-bot`)
   - Choose "Generic bot" type

2. **Get API Key**:
   - Navigate to the bot user's profile
   - Copy the API key

3. **Create a Stream**:
   - Create a stream for each repository (e.g., `fix-die-repeat`, `my-project`)
   - Ensure the bot has access to post to the stream

4. **Configure Environment**:
   ```bash
   export ZULIP_SERVER_URL="https://your-zulip-server.com"
   export ZULIP_BOT_EMAIL="pi-agent-bot@your-domain.com"
   export ZULIP_BOT_API_KEY="your-api-key-here"
   export ZULIP_STREAM="your-repo-name"
   ```

## Usage

The extension runs automatically when loaded. When the LLM encounters a situation where it has low confidence, it can call the `ask_human` tool:

```typescript
ask_human({
  question: "Should I change the test or the code?",
  context: "Error: Expected DecimalError, got ValueError\nFile: payments/processor.py:142",
  confidence: 25,
});
```

The tool posts to Zulip and blocks until a human replies. A typical flow:

1. Agent calls `ask_human` with its question
2. Extension posts formatted message to Zulip stream (creates new topic)
3. Human sees message and replies in the topic
4. Extension returns human's reply to the agent
5. Agent uses the guidance to continue

### Multi-turn Conversations

For follow-up questions, the agent uses the `thread_id` returned from the first call:

```typescript
// First call - creates new topic
const result1 = await ask_human({
  question: "Should I use approach A or B?",
  context: "Context about both approaches...",
  confidence: 30,
});
// Returns result.details.thread_id = "Agent Q #42 — payment processing"

// Follow-up - continues in same topic
const result2 = await ask_human({
  question: "Here's the code for approach A. Does this look right?",
  context: "```python\ndef process():\n  ...\n```",
  confidence: 50,
  thread_id: result1.details.thread_id,
});
```

### Message Format

**Initial question (new topic):**
```markdown
🤖 **Agent needs help**

**Question:** Should I change the test or the code?

**Context:**
Error: Expected DecimalError, got ValueError
File: payments/processor.py:142

**Confidence:** 25/100

_Reply in this topic. The agent is waiting for your response._
```

**Follow-up (same topic):**
```markdown
🤖 **Follow-up:**

Here's the code for approach A:

```python
def process():
  return Decimal(value)
```

_Reply in this topic. The agent is waiting for your response._
```

## When to Use `ask_human`

Use the tool when you have **LOW CONFIDENCE** in your approach:

- You've attempted the same fix more than once and it keeps failing
- The error involves domain-specific business logic you don't understand
- You need to choose between multiple valid architectural approaches
- Test expectations seem intentionally wrong (not a code bug you should fix)
- You're about to make a change that could have broad impact across the codebase
- You're unsure whether a review finding is a real issue or an intentional design choice

## When NOT to Use `ask_human`

Do NOT use it for:

- Routine fixes you're confident about (syntax errors, missing imports, typos)
- Issues where the error message clearly indicates the solution
- Simple refactoring with obvious correctness

## Error Handling

The extension gracefully handles various error scenarios:

| Scenario | Behavior |
|----------|----------|
| Missing/invalid env vars | Extension loads but tool returns descriptive error on first call |
| Zulip server unreachable | Tool returns error; agent proceeds with best guess |
| Human never replies | Tool blocks indefinitely (by design) until pi process is killed |
| Multiple humans reply | Returns first non-bot message; subsequent replies visible in Zulip topic |
| Cancellation or graceful shutdown during poll | Attempts to clean up Zulip event queue and return a cancellation result (behavior on hard kills such as `SIGKILL` is not guaranteed) |

## Development

See [AGENTS.md](./AGENTS.md) for development details, architecture, and testing information.

### Running Tests

```bash
npm test
```

### Linting and Formatting

```bash
npm run check    # Lint with Biome
npm run fix      # Auto-fix linting and formatting issues
```

### Type Checking

```bash
npm run type-check
```

### TypeScript/Biome Compatibility

`tsconfig.json` intentionally keeps `noPropertyAccessFromIndexSignature` disabled (`false`) because enabling it conflicts with Biome's `useLiteralKeys` rule.

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

## License

[Specify your license here]
