# Platforms

This document describes source access for content tasks. See the [product specification](../../docs/product-spec.md#submission-understanding-and-connections) for target sources and [data contracts](../../docs/data-contracts.md#submitted-sources-and-reports) for results.

## Responsibilities and dependencies

`platforms` reads submitted GitHub, X, and Xiaohongshu links and returns normalized source snapshots, retrieval status, and configuration guidance. The main process runs Chrome reading through a shared browser service. Xiaohongshu retains its enhanced note adapter; browser reading supplies the fallback. Platform AI search uses the same browser profiles with platform-specific guides.

Adapters may use Node.js network and process capabilities, platform SDKs, or standalone tools. The Telegram bot receives links for main-process queuing; these adapters still read their source content.

## File layout

- `types.ts`: read requests, content results, and capability status interfaces.
- `registry.ts`: source capability selection by URL and temporary Xiaohongshu reader credentials.
- `browser/prompts.ts`: platform AI entry points, workflow guides, and search prompt adaptation.
- [adapters](adapters/README.md): GitHub, X, and Xiaohongshu retrieval and normalization.
