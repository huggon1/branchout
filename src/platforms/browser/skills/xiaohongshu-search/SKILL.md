---
name: xiaohongshu-search
description: Search Xiaohongshu through 点点 AI, then inspect its source cards for usable original note links.
---

# Search Xiaohongshu through 点点 AI

## Answer

1. Open `https://www.xiaohongshu.com/ai_chat` and start a fresh conversation.
2. The welcome page can contain overlapping textareas. Click the textarea with `receivesPointerEvents=true`. Fill its focused editable reference, confirm the value, and press Enter on it. After a rerender or failed click, inspect a fresh snapshot for the active textarea.
3. Confirm generation has stopped, or capture the assistant body twice at least 2 seconds apart and repeat while the body changes within the task budget. Capture the complete assistant-only container and return the question and final reply capture ID. The application saves this answer before asking for citations.

## Citations

1. Inspect the current answer page. Read its saved inline citations through `capture_search_sources` with the saved reply capture ID. Open the observed disclosure labelled `ai总结N篇笔记生成`. Wait for the source cards; `参考来源` alone indicates loading. Capture the source panel or relevant cards with `capture_search_sources`, retaining titles, authors, dates, links, and source capture IDs.
2. Prefer full original addresses captured from source cards, retaining their access parameters. Treat an inline note address as a citation hint. Resolve its observed source control, or open the same note and wait for `sourceAccess.state=readable`, which confirms its own content container and document identity. After an in-page SPA opening, navigate the observed same-note URL once, then wait and inspect within the task budget. A readable tokenless note is valid. A temporary tab returns `openedLinks`; a same-tab opening returns `url`. Restore the saved answer page before inspecting further source cards.
3. A `/404` address or `sourceError` records a source rejection. Preserve its actual reason and previously verified notes. Return `failed` when cited note addresses remain unresolved. Return `completed` with usable observed addresses and successful source capture IDs. An inspected answer with no source disclosure or inline note citations returns `empty`.

Observed sign-in, verification, and access limits return their matching access error.
