---
name: thimble-settings
description: "Read or change thimble's settings (cards, citations, verifier model and effort, explainers, heads-ups, labels, claims, coverage, minimal mode). Use when the person types /thimble-settings, optionally with a key and a value."
---

The person's words: $ARGUMENTS

- No words: call `thimble_settings` with no key and show each setting in a short table: title, key, value, choices. Then say they can change one with /thimble-settings <key> <value>, or in the Settings tab of thimble's workbench.
- A key and a value: call `thimble_settings` with them (match the key and value to the list's spelling, e.g. `citations` and `auto + verify`). Show the new value in one line. If the call fails, show its message.

Settings are saved for every session, and the guidance changes from the next prompt.
