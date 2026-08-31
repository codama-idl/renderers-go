#!/usr/bin/env -S node

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const { rootNode } = require('@codama/nodes');
const { readJson } = require('@codama/renderers-core');
const { visit } = require('@codama/visitors-core');

const { renderGoMod, renderVisitor } = require('../dist/index.node.cjs');

async function main() {
    const project = process.argv.slice(2)[0] ?? undefined;
    if (project === undefined) {
        throw new Error('Project name is required.');
    }
    await generateProject(project);
}

async function generateProject(project) {
    const idl = readJson(path.join(__dirname, project, 'idl.json'));
    const node = rootNode(idl.program);
    visit(
        node,
        renderVisitor(path.join(__dirname, project, 'generated'), {
            formatCode: true,
        }),
    );

    // The project's go.mod is rendered from the same template the renderer
    // uses (goMod.njk pins the Go dependency versions); `go mod tidy` in
    // e2e/test.sh expands the indirect requirements deterministically.
    fs.writeFileSync(
        path.join(__dirname, project, 'go.mod'),
        renderGoMod(`github.com/codama-idl/renderers-go/${project}`),
    );
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
