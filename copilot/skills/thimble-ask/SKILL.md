---
name: thimble-ask
description: "Ask a side question in a thread of its own, answered by a second model with the files, without changing this conversation. The a key of thimble. Use when the person types /thimble-ask <question>."
---

The person's side question: $ARGUMENTS

Call `thimble_ask` with `question` set to their words as typed (and `about` set to what it is about, if they named words of an answer, a card or a tab). Pass `wait: true`, then show the answer it returns exactly, under the heading "Side thread". Do not answer the question yourself, and do not carry the side thread into the main conversation.
