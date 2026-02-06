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
