#!/usr/bin/env -S node

// Converts an Anchor IDL into the Codama root node JSON consumed by
// e2e/generate.cjs, e.g.:
//
//   node e2e/anchor-to-codama.cjs jupiter.json e2e/jupiter/idl.json

const fs = require('node:fs');
const process = require('node:process');

const { rootNodeFromAnchor } = require('@codama/nodes-from-anchor');

function main() {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) {
        throw new Error('Usage: anchor-to-codama.cjs <anchor-idl.json> <codama-idl.json>');
    }

    const anchorIdl = JSON.parse(fs.readFileSync(input, 'utf8'));
    const root = rootNodeFromAnchor(anchorIdl);
    fs.writeFileSync(output, JSON.stringify(root, null, 4) + '\n');
}

main();
