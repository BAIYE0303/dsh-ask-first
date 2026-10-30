# Changelog

## 1.0.0

First public release.

- A button in the `conversation.input.left` slot of the composer. Reads the current draft without
  touching it; nothing is sent.
- The model restates what it understood in one sentence, shown in its own block so it is easy to check.
- Asks two or three questions that would change the result. Every question carries clickable options,
  and the last option of every question is always *"I don't know, you decide"*.
- The escape option is appended by the host half, not requested from the model — so it survives a model
  that ignores the instruction, returns no options at all, or returns more options than needed.
- Rewrites the draft plus the chosen answers into one request: goal, constraints, then completion
  criteria. Unknowns stay as a visible `[待补充：…]` placeholder instead of being invented.
- Writes the result back through `inputActions.setDraft()`; the user still presses send.
- Three loopback-only `POST` routes (`/health`, `/ask`, `/rewrite`). No API key, no settings page — it
  uses whatever provider and model the current session already uses.
- `node test-offline.mjs`: 39 checks, no network, no host process.
