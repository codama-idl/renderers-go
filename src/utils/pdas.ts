import { logWarn } from '@codama/errors';
import {
    bytesValueNode,
    camelCase,
    ConstantPdaSeedNode,
    getAllInstructionsWithSubs,
    InstructionAccountNode,
    isNode,
    NumberTypeNode,
    pascalCase,
    PdaNode,
    ProgramNode,
    resolveNestedTypeNode,
    snakeCase,
    VariablePdaSeedNode,
} from '@codama/nodes';
import { LinkableDictionary, NodeStack } from '@codama/visitors-core';

import { ImportMap } from '../ImportMap';
import { getBytesFromBytesValueNode } from './codecs';

export type PdaSeedRender = {
    comment: string | null;
    render: string;
};

export type PdaHelper = {
    // Doc comment lines for the generated function (without the `// ` prefix).
    docs: string[];
    goName: string;
    hasDuplicateParams: boolean;
    imports: ImportMap;
    params: { goType: string; name: string }[];
    pdaName: string;
    // Go expression for the program the address is derived under
    // (`ProgramID` or a package-level foreign program variable).
    programExpr: string;
    programId: string | null;
    // One entry per seed: `"..."` for printable constants, `0x...` for other
    // constants, the parameter name for variable seeds.
    seedDocs: string[];
    seeds: PdaSeedRender[];
    usedBy: string[];
};

export type PdaRegistry = {
    entries: PdaHelper[];
    // Distinct foreign program ids referenced by the helpers, hoisted to
    // package-level variables so they are parsed once, at init.
    foreignPrograms: { base58: string; varName: string }[];
};

type LinkableScope = { linkables: LinkableDictionary; stack: NodeStack };

// Go reserved words that cannot be used as parameter names.
const GO_KEYWORDS = new Set([
    'break',
    'case',
    'chan',
    'const',
    'continue',
    'default',
    'defer',
    'else',
    'fallthrough',
    'for',
    'func',
    'go',
    'goto',
    'if',
    'import',
    'interface',
    'map',
    'package',
    'range',
    'return',
    'select',
    'struct',
    'switch',
    'type',
    'var',
]);

const DOC_WRAP_COLUMN = 100;

// Collects every structurally distinct pdaNode reachable from the program:
// the `program.pdas` list plus inline pdaNodes used as instruction account
// default values. Identical definitions collapse into a single Find helper;
// same-name definitions with different seeds get a numeric suffix.
export function collectProgramPdas(
    program: ProgramNode,
    options: LinkableScope & { leavesOnly: boolean },
): PdaRegistry {
    const byKey = new Map<string, PdaHelper | null>();
    const entries: PdaHelper[] = [];
    const nameCounts = new Map<string, number>();

    const register = (pda: PdaNode, usedBy: string): void => {
        const key = getPdaStructuralKey(program, pda);
        const existing = byKey.get(key);
        if (existing !== undefined) {
            if (existing && !existing.usedBy.includes(usedBy)) existing.usedBy.push(usedBy);
            return;
        }
        const helper = buildPdaHelper(program, pda, nameCounts, usedBy);
        byKey.set(key, helper);
        if (helper) entries.push(helper);
    };

    (program.pdas ?? []).forEach(pda => register(pda, 'program'));
    getAllInstructionsWithSubs(program, { leavesOnly: options.leavesOnly }).forEach(instruction =>
        (instruction.accounts ?? []).forEach(account => {
            const pda = resolvePdaFromAccountDefault(account, options);
            if (pda) register(pda, instruction.name);
        }),
    );

    const foreignPrograms = assignProgramExpressions(entries);
    entries.forEach(entry => {
        entry.docs = buildHelperDocs(entry);
    });

    return { entries, foreignPrograms };
}

// Gives every entry its derivation-program expression, hoisting each distinct
// foreign program id into one shared package-level variable.
function assignProgramExpressions(entries: PdaHelper[]): PdaRegistry['foreignPrograms'] {
    const foreignPrograms: PdaRegistry['foreignPrograms'] = [];
    const varByProgram = new Map<string, string>();
    for (const entry of entries) {
        if (!entry.programId) {
            entry.programExpr = 'ProgramID';
            continue;
        }
        let varName = varByProgram.get(entry.programId);
        if (!varName) {
            varName = `pdaProgram${entry.programId}`;
            varByProgram.set(entry.programId, varName);
            foreignPrograms.push({ base58: entry.programId, varName });
        }
        entry.programExpr = varName;
    }
    return foreignPrograms;
}

function buildHelperDocs(entry: PdaHelper): string[] {
    const docs = [`Find${entry.goName}PDA derives the address of the "${snakeCase(entry.pdaName)}" PDA.`];
    if (entry.programId) {
        docs.push(`The address is derived under the ${entry.programId} program.`);
    }
    if (entry.seedDocs.length > 0) {
        docs.push(`Seeds: ${entry.seedDocs.join(', ')}.`);
    }
    if (entry.hasDuplicateParams) {
        docs.push('Numbered parameters are the same seed name occurring more than once;');
        docs.push('callers typically pass the same value for each occurrence.');
    }
    if (entry.usedBy.length > 0) {
        docs.push(...wrapDocLine(`Used by: ${entry.usedBy.join(', ')}.`));
    }
    return docs;
}

function wrapDocLine(line: string): string[] {
    if (line.length <= DOC_WRAP_COLUMN) return [line];
    const words = line.split(' ');
    const lines: string[] = [];
    let current = words[0];
    for (const word of words.slice(1)) {
        if (current.length + 1 + word.length > DOC_WRAP_COLUMN) {
            lines.push(current);
            current = word;
        } else {
            current += ` ${word}`;
        }
    }
    lines.push(current);
    return lines;
}

function getPdaStructuralKey(program: ProgramNode, pda: PdaNode): string {
    return JSON.stringify({ name: pda.name, programId: getForeignProgramId(program, pda), seeds: pda.seeds });
}

function getForeignProgramId(program: ProgramNode, pda: PdaNode): string | null {
    return pda.programId && pda.programId !== program.publicKey ? pda.programId : null;
}

function resolvePdaFromAccountDefault(account: InstructionAccountNode, options: LinkableScope): PdaNode | null {
    const defaultValue = account.defaultValue;
    if (!defaultValue || !isNode(defaultValue, 'pdaValueNode')) return null;
    // A per-use derivation-program override (pdaValueNode.programId) changes
    // the program the address is derived under at runtime; the static Find
    // helper cannot express that, so this use does not contribute a helper.
    if (defaultValue.programId) return null;
    if (isNode(defaultValue.pda, 'pdaNode')) return defaultValue.pda;
    // A link into another program's PDA would have to derive under that
    // program's id, which the resolved pdaNode does not carry; skip it
    // rather than derive under the wrong program.
    if (defaultValue.pda.program) return null;
    return options.linkables.get([...options.stack.getPath(), defaultValue.pda]) ?? null;
}

function buildPdaHelper(
    program: ProgramNode,
    pda: PdaNode,
    nameCounts: Map<string, number>,
    usedBy: string,
): PdaHelper | null {
    const imports = new ImportMap().add('github.com/gagliardetto/solana-go');
    const seeds: PdaSeedRender[] = [];
    const seedDocs: string[] = [];
    const params: { goType: string; name: string }[] = [];
    const paramCounts = new Map<string, number>();
    let hasDuplicateParams = false;

    for (const seed of pda.seeds ?? []) {
        if (isNode(seed, 'constantPdaSeedNode')) {
            if (isNode(seed.value, 'programIdValueNode')) {
                seeds.push({ comment: 'program id', render: 'ProgramID[:]' });
                seedDocs.push('ProgramID');
                continue;
            }
            const bytes = getConstantSeedBytes(seed);
            if (bytes === null) {
                logWarn(
                    `[Go] PDA [${pda.name}] has an unsupported constant seed value [${seed.value.kind}]. ` +
                        'No Find helper will be generated for it.',
                );
                return null;
            }
            const rendered = renderConstantSeedBytes(bytes);
            seeds.push(rendered.seed);
            seedDocs.push(rendered.doc);
            continue;
        }
        const param = getVariableSeedParam(seed);
        if (param === null) {
            logWarn(
                `[Go] PDA [${pda.name}] has an unsupported variable seed type [${seed.type.kind}]. ` +
                    'No Find helper will be generated for it.',
            );
            return null;
        }
        // Seed names that normalize to the same Go identifier (including
        // duplicates within one PDA) become numbered parameters (mint,
        // mint2); Go keywords get an underscore suffix.
        const base = camelCase(seed.name);
        const occurrence = (paramCounts.get(base) ?? 0) + 1;
        paramCounts.set(base, occurrence);
        if (occurrence > 1) hasDuplicateParams = true;
        let paramName = base + (occurrence > 1 ? String(occurrence) : '');
        if (GO_KEYWORDS.has(paramName)) paramName += '_';
        imports.mergeWith(param.imports);
        params.push({ goType: param.goType, name: paramName });
        seedDocs.push(paramName);
        seeds.push({ comment: null, render: param.toBytes(paramName) });
    }

    const baseName = pascalCase(pda.name);
    const nameCount = (nameCounts.get(baseName) ?? 0) + 1;
    nameCounts.set(baseName, nameCount);

    return {
        docs: [],
        goName: baseName + (nameCount > 1 ? String(nameCount) : ''),
        hasDuplicateParams,
        imports,
        params,
        pdaName: pda.name,
        programExpr: 'ProgramID',
        programId: getForeignProgramId(program, pda),
        seedDocs,
        seeds,
        usedBy: [usedBy],
    };
}

type SeedParam = { goType: string; imports: ImportMap; toBytes: (name: string) => string };

function getVariableSeedParam(seed: VariablePdaSeedNode): SeedParam | null {
    const resolved = resolveNestedTypeNode(seed.type);
    switch (resolved.kind) {
        case 'publicKeyTypeNode':
            return {
                goType: 'ag_solanago.PublicKey',
                imports: new ImportMap().add('github.com/gagliardetto/solana-go'),
                toBytes: name => `${name}[:]`,
            };
        case 'bytesTypeNode':
            return { goType: '[]byte', imports: new ImportMap(), toBytes: name => name };
        case 'stringTypeNode':
            return { goType: 'string', imports: new ImportMap(), toBytes: name => `[]byte(${name})` };
        case 'numberTypeNode':
            return getNumberSeedParam(resolved);
        default:
            return null;
    }
}

function getNumberSeedParam(node: NumberTypeNode): SeedParam | null {
    // PDA seeds use the borsh byte representation: fixed-width little-endian.
    if (node.endian !== 'le') return null;
    const match = /^([iu])(8|16|32|64)$/.exec(node.format);
    if (!match) return null;
    const [, signedness, bits] = match;
    const goType = `${signedness === 'i' ? 'int' : 'uint'}${bits}`;
    if (bits === '8') {
        return { goType, imports: new ImportMap(), toBytes: name => `[]byte{byte(${name})}` };
    }
    const cast = signedness === 'i' ? (name: string) => `uint${bits}(${name})` : (name: string) => name;
    return {
        goType,
        imports: new ImportMap().add('encoding/binary'),
        toBytes: name => `binary.LittleEndian.AppendUint${bits}(nil, ${cast(name)})`,
    };
}

function getConstantSeedBytes(seed: ConstantPdaSeedNode): Uint8Array | null {
    const { type, value } = seed;
    if (isNode(value, 'bytesValueNode')) return getBytesFromBytesValueNode(value);
    if (isNode(type, 'stringTypeNode') && isNode(value, 'stringValueNode')) {
        return getBytesFromBytesValueNode(bytesValueNode('utf8', value.string));
    }
    if (isNode(type, 'numberTypeNode') && isNode(value, 'numberValueNode')) {
        return getNumberBytes(type, value.number);
    }
    return null;
}

function getNumberBytes(type: NumberTypeNode, value: number): Uint8Array | null {
    const match = /^[iu](8|16|32|64)$/.exec(type.format);
    if (!match) return null;
    const byteLength = Number(match[1]) / 8;
    let bits = BigInt(value);
    if (bits < 0n) bits += 1n << BigInt(byteLength * 8);
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
        const shift = type.endian === 'le' ? i : byteLength - 1 - i;
        out[i] = Number((bits >> BigInt(shift * 8)) & 0xffn);
    }
    return out;
}

function renderConstantSeedBytes(bytes: Uint8Array): { doc: string; seed: PdaSeedRender } {
    const list = [...bytes];
    const printable = list.length > 0 && list.every(b => b >= 0x20 && b <= 0x7e);
    if (printable) {
        // JSON string escaping is valid Go string escaping for ASCII.
        const literal = JSON.stringify(String.fromCharCode(...list));
        return { doc: literal, seed: { comment: null, render: `[]byte(${literal})` } };
    }
    const hex = list.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ');
    const hexDoc = `0x${list.map(b => b.toString(16).padStart(2, '0')).join('')}`;
    return { doc: hexDoc, seed: { comment: `(hex) ${hexDoc.slice(2)}`, render: `{${hex}}` } };
}
