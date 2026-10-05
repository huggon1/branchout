# Platform adapters

`adapters` read the sources of submitted links. Each converts source text, images, identity, and retrieval scope into results defined by the parent `types.ts`. See [supported sources](../../../docs/product-spec.md#submission-understanding-and-connections).

## File layout

- `github/`: public GitHub repository links.
- `xhs/`: Xiaohongshu notes.

GitHub and Xiaohongshu expose adapters through their `index.ts`. X uses the shared browser reading path. Platform-specific clients and normalization stay in their directories; the parent module owns the shared result format.
