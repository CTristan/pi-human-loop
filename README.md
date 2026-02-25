# pi-human-loop

A Pi extension that enables an AI coding agent to start a conversation with a human through Zulip whenever the agent has low confidence in a task.

## Features

- **Custom `ask_human` Tool**: The LLM can call this tool when it needs human guidance
- **Automatic System Prompt Injection**: The extension injects usage guidance into Pi's system prompt on startup
- **Zulip Integration**: Posts questions to a Zulip stream and blocks until a human replies
- **Multi-turn Conversations**: Supports topic-based threading for follow-up questions
- **Print Mode Compatible**: Works seamlessly with Pi's print mode (used by Fix-Die-Repeat)

## Installation

To install this extension, use the `pi` CLI:

```bash
pi package install .
```

Or configure in your project:

```bash
pi -e /path/to/pi-human-loop
```

## Configuration

Configure via environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ZULIP_SERVER_URL` | Yes | Zulip server base URL (e.g., `https://zulip.example.com`) |
| `ZULIP_BOT_EMAIL` | Yes | Bot user email address |
| `ZULIP_BOT_API_KEY` | Yes | Bot user API key |
| `ZULIP_STREAM` | Yes | Stream name for this repo |
| `ZULIP_POLL_INTERVAL_MS` | No | Fallback poll interval if long-poll is unavailable (default: 5000) |

## Usage

The extension runs automatically when loaded. When the LLM encounters a situation where it has low confidence, it can call the `ask_human` tool:

```typescript
ask_human({
  question: "Should I change the test or the code?",
  context: "Error: Expected DecimalError, got ValueError",
  confidence: 25,
});
```

The tool posts to Zulip and blocks until a human replies.

### When to Use `ask_human`

- You've attempted the same fix more than once and it keeps failing
- The error involves domain-specific business logic you don't understand
- You need to choose between multiple valid architectural approaches
- Test expectations seem intentionally wrong (not a code bug you should fix)
- You're about to make a change that could have broad impact

### When NOT to Use `ask_human`

- Routine fixes you're confident about (syntax errors, missing imports, typos)
- Issues where the error message clearly indicates the solution
- Simple refactoring with obvious correctness

## Development

See [AGENTS.md](./AGENTS.md) for development details.

## License

[Specify your license here]
