---
"@codama/renderers-go": minor
---

Generate `pdas.go` with a `Find<Name>PDA` helper for every structurally distinct PDA in the IDL (from `program.pdas` and inline instruction account defaults). Constant seeds are inlined as byte literals, variable seeds become typed parameters, and PDAs owned by another program derive under that program's id.
