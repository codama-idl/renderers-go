---
"@codama/renderers-go": minor
---

Dependency refresh and generated go.mod:

- New `goModule` option: the render visitor emits a `go.mod` for the generated package, with the Go dependency versions pinned in one place (`goMod.njk`); the e2e projects' go.mod files are now rendered from that same template.
- Generated clients build against `github.com/gagliardetto/solana-go` v1.23.0.
- Updated npm dependencies (`@codama/*` 1.10, `@solana/codecs-strings` ^8.2.0, and dev tooling), including support for codama's optional node collections and `injectedValueNode` (rendered via its fallback value).
