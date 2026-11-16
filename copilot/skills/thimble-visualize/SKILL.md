---
name: thimble-visualize
description: "Draw the last answer as an interactive card (chart or table of the data behind it) in thimble's workbench. The v key of thimble. Use when the person types /thimble-visualize or asks thimble to visualize the last answer."
---

The person asks for a card of your last answer (thimble's v key). Their words, if any: $ARGUMENTS

1. Call `thimble_visualize` and follow the instructions it returns: they say how to pick the one question the card answers, write its rows to a JSON file with code, and design the view.
2. Draw the card with `thimble_card`. Read the text copy it returns and fix what the person would misread, with `id` and `edits`.
3. End with one short line that names the card's title and says it is in thimble's workbench (the `thimble` canvas, or `thimble_open` for its address). Place it with a line that holds only `[title](card:<id>)`.

If cards are off in thimble's settings, say so in one line and draw nothing.
