---
name: thimble-explain
description: "A short explainer of a term or of words in the last answer, for a reader new to the field. The e key of thimble. Use when the person types /thimble-explain <words>."
---

The person asks what these words mean: $ARGUMENTS

Call `thimble_explain` with `term` set to those exact words and no `body`: a second model writes the explainer from the conversation and the files, in the background. Tell the person in one line that it will show in the Notes tab of thimble's workbench and in the timeline.

If the person gave no words, ask them in one short line which words to explain.
