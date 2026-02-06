import { TypeManifest } from './getTypeManifestVisitor';

// Go package imports used by generated code.
// Keys used internally to reference generated code within the same package
// map to empty string (same package, no import needed).
const DEFAULT_MODULE_MAP: Record<string, string> = {
    generated: '',
    generatedAccounts: '',
    generatedErrors: '',
    generatedInstructions: '',
    generatedTypes: '',
    hooked: '',
};

// Well-known Go package aliases used in generated code.
export const GO_PACKAGE_ALIASES: Record<string, string> = {
    'github.com/gagliardetto/binary': 'ag_binary',
    'github.com/gagliardetto/solana-go': 'ag_solanago',
    'github.com/gagliardetto/solana-go/rpc': 'ag_rpc',
    'github.com/gagliardetto/treeout': 'ag_treeout',
};

export class ImportMap {
    protected readonly _imports: Set<string> = new Set();

    protected readonly _aliases: Map<string, string> = new Map();

    get imports(): Set<string> {
        return this._imports;
    }

    get aliases(): Map<string, string> {
        return this._aliases;
    }

    add(imports: Set<string> | string[] | string): ImportMap {
        const newImports = typeof imports === 'string' ? [imports] : imports;
        newImports.forEach(i => this._imports.add(i));
        return this;
    }

    remove(imports: Set<string> | string[] | string): ImportMap {
        const importsToRemove = typeof imports === 'string' ? [imports] : imports;
        importsToRemove.forEach(i => this._imports.delete(i));
        return this;
    }

    mergeWith(...others: ImportMap[]): ImportMap {
        others.forEach(other => {
            this.add(other._imports);
            other._aliases.forEach((alias, importName) => this.addAlias(importName, alias));
        });
        return this;
    }

    mergeWithManifest(manifest: TypeManifest): ImportMap {
        return this.mergeWith(manifest.imports);
    }

    addAlias(importName: string, alias: string): ImportMap {
        this._aliases.set(importName, alias);
        return this;
    }

    isEmpty(): boolean {
        return this._imports.size === 0;
    }

    resolveDependencyMap(dependencies: Record<string, string>): ImportMap {
        const dependencyMap = { ...DEFAULT_MODULE_MAP, ...dependencies };
        const newImportMap = new ImportMap();
        const resolveDependency = (i: string): string => {
            // Check if the import starts with a known internal key (e.g. generatedTypes::Foo)
            const dependencyKey = Object.keys(dependencyMap).find(key => i.startsWith(`${key}::`));
            if (!dependencyKey) return i;
            const dependencyValue = dependencyMap[dependencyKey];
            if (dependencyValue === '') {
                // Same package — no import needed, strip entirely
                return '';
            }
            return dependencyValue + i.slice(dependencyKey.length);
        };
        this._imports.forEach(i => {
            const resolved = resolveDependency(i);
            if (resolved !== '') {
                newImportMap.add(resolved);
            }
        });
        this._aliases.forEach((alias, i) => {
            const resolved = resolveDependency(i);
            if (resolved !== '') {
                newImportMap.addAlias(resolved, alias);
            }
        });
        return newImportMap;
    }

    toString(dependencies: Record<string, string>): string {
        const resolvedMap = this.resolveDependencyMap(dependencies);
        if (resolvedMap.imports.size === 0) return '';

        // Separate standard library imports from third-party imports
        const stdImports: string[] = [];
        const extImports: string[] = [];

        const sortedImports = [...resolvedMap.imports].sort();
        for (const imp of sortedImports) {
            const alias = resolvedMap.aliases.get(imp) || GO_PACKAGE_ALIASES[imp];
            const importLine = alias ? `\t${alias} "${imp}"` : `\t"${imp}"`;

            // Standard library packages don't contain a dot in the first path segment
            const firstSegment = imp.split('/')[0];
            if (firstSegment.includes('.')) {
                extImports.push(importLine);
            } else {
                stdImports.push(importLine);
            }
        }

        const groups: string[] = [];
        if (stdImports.length > 0) groups.push(stdImports.join('\n'));
        if (extImports.length > 0) groups.push(extImports.join('\n'));

        if (groups.length === 0) return '';
        return `import (\n${groups.join('\n\n')}\n)`;
    }
}
