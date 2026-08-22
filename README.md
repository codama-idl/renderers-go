# Codama ➤ Renderers ➤ Go

[![npm][npm-image]][npm-url]
[![npm-downloads][npm-downloads-image]][npm-url]

[npm-downloads-image]: https://img.shields.io/npm/dm/@codama/renderers-go.svg?style=flat
[npm-image]: https://img.shields.io/npm/v/@codama/renderers-go.svg?style=flat&label=%40codama%2Frenderers-go
[npm-url]: https://www.npmjs.com/package/@codama/renderers-go

This package generates Go clients from your Codama IDLs.

## Installation

```sh
pnpm install @codama/renderers-go
```

## Usage

Add the following script to your Codama configuration file.

```json
{
    "scripts": {
        "go": {
            "from": "@codama/renderers-go",
            "args": ["clients/go/generated"]
        }
    }
}
```

## PDA helpers

For every structurally distinct PDA found in the IDL (in `program.pdas` or inline in instruction account defaults), the renderer emits a `Find<Name>PDA` function in `pdas.go`. Constant seeds are inlined as byte literals (with a readable comment); variable seeds become typed parameters. The bump is returned alongside the address:

```go
global, _, err := pump.FindGlobalPDA()
bondingCurve, bump, err := pump.FindBondingCurvePDA(mint)
```

PDAs defined under another program (for example associated token accounts) derive under that program's id automatically. Each helper's doc comment lists the instructions that use the PDA.

## Contributing

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20.18.0
- [pnpm](https://pnpm.io/) 10.x
- [Go](https://go.dev/) (for running e2e tests)

### Setup

```sh
git clone https://github.com/codama-idl/renderers-go.git
cd renderers-go
pnpm install
```

### Build

```sh
pnpm build
```

### Test

Run all tests (type checks, unit tests, e2e tests, export tests):

```sh
pnpm test
```

Or run individual test suites:

```sh
pnpm test:types        # Type checking
pnpm test:unit         # Unit tests
pnpm test:e2e          # End-to-end tests (generates Go code and runs `go build`)
```

### E2E workflow

The e2e tests generate Go clients from sample IDLs and verify they compile. To manually test a specific project:

```sh
pnpm build
node e2e/generate.cjs <project>   # e.g. dummy, system, memo
cd e2e/<project> && go build ./...
```

Available e2e projects: `dummy`, `system`, `memo`, `pump-fun`, `jupiter`.

To add an Anchor program, convert its IDL to the Codama format first:

```sh
node e2e/anchor-to-codama.cjs path/to/anchor-idl.json e2e/<project>/idl.json
```

### Lint

```sh
pnpm lint          # Check for issues
pnpm lint:fix      # Auto-fix issues
```
