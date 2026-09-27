# Platform adapters

`adapters` read the sources of submitted links. Each converts source text, images, identity, and retrieval scope into results defined by the parent `types.ts`. See [supported sources](../../../docs/product-spec.md#submission-understanding-and-connections).

## File layout

- `github/`: public GitHub repository links.
- `x/`: X posts.
- `xhs/`: Xiaohongshu notes.

Each platform exposes an adapter through its `index.ts`. Platform-specific clients and normalization stay in their directories; the parent module owns the shared result format.
