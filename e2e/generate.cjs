#!/usr/bin/env -S node

const { spawnSync } = require('node:child_process');
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
    // uses (goMod.njk pins the Go dependency versions), then `go mod tidy`
    // expands the indirect requirements deterministically, so a generate run
    // always leaves the committed files in their final state. CI's clean-tree
    // check fails the build on any drift.
    const projectDir = path.join(__dirname, project);
    fs.writeFileSync(path.join(projectDir, 'go.mod'), renderGoMod(`github.com/codama-idl/renderers-go/${project}`));
    const tidy = spawnSync('go', ['mod', 'tidy'], { cwd: projectDir, stdio: 'inherit' });
    if (tidy.error) {
        throw new Error(`Could not run go mod tidy: ${tidy.error.message}`);
    }
    if (tidy.status !== 0) {
        throw new Error(`go mod tidy failed with status ${tidy.status}.`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
