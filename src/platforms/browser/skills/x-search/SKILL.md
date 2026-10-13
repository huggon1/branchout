---
name: x-search
description: Search X posts through Grok, then inspect its citation disclosures for original post links.
---

# Search X through Grok

## Answer

1. Open `https://x.com/i/grok` and start a fresh conversation.
2. For an optional account-linking modal, use its observed `Not now` control. Wait briefly, inspect a fresh snapshot, and confirm the question input is available. If dismissal stalls, repeat with fresh controls up to twice. Account linking or terms confirmation that blocks the input returns `action_required` for the user to handle in Settings.
3. Submit the adapted English question once. Ask Grok to use X posts as sources. After an interrupted action, inspect the existing conversation for an answer or active generation before submitting.
4. Confirm generation has stopped, or compare assistant body captures at least 2 seconds apart until they stabilize within the task budget. Capture the complete assistant-only container and return the question and final reply capture ID. The application saves this answer before asking for citations.

## Citations

1. Read inline post citations from the saved answer through `capture_search_sources` using the saved reply capture ID. Inspect a fresh snapshot on the current answer page. Open citation disclosures and capture their loaded panel or cards with the same tool using their observed reference.
2. Return original post URLs already captured from the saved reply or source cards. Open an observed source control when its final original URL is missing. A failed click keeps every captured post in the result. Read `openedLinks` for a temporary tab or the current `url` for a same-tab navigation. Restore the saved answer page to inspect further sources.
3. Return original X post URLs with their source capture IDs, observed titles, and displayed dates. An inspected answer with no post citations returns `empty`; citations whose original links remain unavailable return `failed` with the saved answer retained.

Observed sign-in, verification, and access limits return their matching access error.
