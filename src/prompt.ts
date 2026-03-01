/**
 * System prompt guidance for the ask_human tool.
 *
 * Injected into Pi's system prompt via the before_agent_start event.
 */

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
4. Once you have enough information, proceed with your task — do not keep asking unnecessarily

### Critical failures

If \`ask_human\` returns an error, you MUST stop working immediately.
Do NOT attempt to continue with a best guess.
Report the error clearly and halt.`;
