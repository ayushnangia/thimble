---
name: thimble-cite
description: "Cite words of the last answer and have thimble's verifier (a second model) check them against the lines of the files. The c key of thimble. Use when the person types /thimble-cite <words>, or asks thimble to check or verify citations."
---

The person asks thimble to check these words of your last answer: $ARGUMENTS

- If they gave words: call `thimble_cite` with `words` set to those exact words (and `sentence` set to the sentence that holds them, the words in [brackets]). It starts the verifier in the background.
- If they gave no words: call `thimble_verify` to check every unchecked citation of the last answer.

Then tell the person in one line that the verifier is checking, and that its verdicts (verified, corrected, narrowed, wrong or unconfirmed, with the evidence lines) show in the Citations tab of thimble's workbench and in the timeline. Do not check the words yourself, and do not wait for the verdict unless the person asks; then pass `wait: true`.
