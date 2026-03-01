/**
 * System prompt guidance for the ask_human tool.
 *
 * Injected into Pi's system prompt via the before_agent_start event.
 */

export const ASK_HUMAN_GUIDANCE = `## Human Assistance (ask_human tool)

You have access to an \`ask_human\` tool that posts messages to the team's Zulip chat and waits for a human response. Compose your messages naturally, like asking a colleague for help — include context, code snippets, options you've considered, and your reasoning. End each message with your confidence score (out of 100) and a brief explanation of why.

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

1. Compose a natural message with your question, relevant context, code snippets, options considered, and reasoning
2. End your message with your confidence score (out of 100) and a brief explanation of *why* you have that confidence level
3. Call \`ask_human(message, confidence, thread_id?)\` with your message and confidence
4. The tool will block until a human responds — this is expected
5. If the response includes a \`thread_id\`, use it in follow-up \`ask_human\` calls to continue the same conversation
6. Once you have enough information, proceed with your task — do not keep asking unnecessarily

**Example message:**

\`\`\`
I'm hitting an issue with the payment processor and need guidance. The test \`test_refund_exceeds_original_amount\` expects a \`DecimalError\` but the code is throwing a \`ValueError\` instead.

Looking at payments/processor.py:142, the validation checks \`refund_amount > original_amount\` first, then calls \`validate_decimal_precision()\`. The error is thrown in \`validate_decimal_precision()\` before the amount comparison completes.

Options I've considered:
1. Swap the order of validations — but this would allow invalid decimals through
2. Catch \`ValueError\` and re-raise as \`DecimalError\` — but this feels wrong semantically

Which approach should I take? Or is there something I'm missing?

Confidence: 25/100 — I understand the error, but I'm uncertain about the architectural trade-offs between the two approaches.
\`\`\`

### Critical failures

If \`ask_human\` returns an error, you MUST stop working immediately.
Do NOT attempt to continue with a best guess.
Report the error clearly and halt.`;
