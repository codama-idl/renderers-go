import { logError, logWarn } from '@codama/errors';
import { deleteDirectory, writeRenderMapVisitor } from '@codama/renderers-core';
import { rootNodeVisitor, visit } from '@codama/visitors-core';
import { spawnSync } from 'child_process';

import { GetRenderMapOptions, getRenderMapVisitor } from './getRenderMapVisitor';

export type RenderOptions = GetRenderMapOptions & {
    deleteFolderBeforeRendering?: boolean;
    formatCode?: boolean;
};

export function renderVisitor(path: string, options: RenderOptions = {}) {
    return rootNodeVisitor(root => {
        // Delete existing generated folder.
        if (options.deleteFolderBeforeRendering ?? true) {
            deleteDirectory(path);
        }

        // Render the new files.
        visit(root, writeRenderMapVisitor(getRenderMapVisitor(options), path));

        // Format the generated Go code.
        if (options.formatCode ?? true) {
            runFormatter('gofmt', ['-w', path]);
        }
    });
}

function runFormatter(cmd: string, args: string[]) {
    const { stdout, stderr, error } = spawnSync(cmd, args);
    if (error?.message?.includes('ENOENT')) {
        logWarn(`Could not find ${cmd}, skipping formatting.`);
        return;
    }
    if (stdout && stdout.length > 0) {
        logWarn(`(gofmt) ${stdout.toString()}`);
    }
    if (stderr && stderr.length > 0) {
        logError(`(gofmt) ${stderr.toString()}`);
    }
}
