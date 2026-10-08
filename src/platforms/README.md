# Platforms

This document describes source access for content tasks. See the [product specification](../../docs/product-spec.md#submission-understanding-and-connections) for target sources and [data contracts](../../docs/data-contracts.md#submitted-sources-and-reports) for results.

## Responsibilities and dependencies

`platforms` owns common browser instructions, task requirements, optional platform guidance, and compatibility source adapters. Forwarding and focus search use one browser runtime and shared session across HTTPS sites. The main process validates and saves captured materials. Xiaohongshu retains its optional enhanced note adapter.

Compatibility adapters use network and process capabilities, platform SDKs, or standalone tools. Telegram submits links to the same main-process reading queue.

## File layout

- `types.ts`: read requests, content results, and capability status interfaces.
- `registry.ts`: source capability selection by URL and temporary Xiaohongshu reader credentials.
- `browser/prompts.ts`: platform AI entry points, workflow guides, and search prompt adaptation.
- [adapters](adapters/README.md): GitHub, X, and Xiaohongshu retrieval and normalization.
