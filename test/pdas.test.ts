import {
    accountValueNode,
    bytesTypeNode,
    bytesValueNode,
    constantPdaSeedNode,
    instructionAccountNode,
    instructionNode,
    numberTypeNode,
    numberValueNode,
    pdaLinkNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { LinkableDictionary, NodeStack } from '@codama/visitors-core';
import { describe, expect, it } from 'vitest';

import { collectProgramPdas } from '../src/utils';

const PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const OTHER_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

function collect(instructions: ReturnType<typeof instructionNode>[], pdas: ReturnType<typeof pdaNode>[] = []) {
    const program = programNode({
        instructions,
        name: 'test',
        pdas,
        publicKey: PROGRAM_ID,
    });
    return collectProgramPdas(program, {
        leavesOnly: true,
        linkables: new LinkableDictionary(),
        stack: new NodeStack(),
    });
}

function account(name: string, defaultValue?: ReturnType<typeof pdaValueNode>) {
    return instructionAccountNode({ defaultValue, isSigner: false, isWritable: false, name });
}

const constSeed = (text: string) => constantPdaSeedNode(bytesTypeNode(), bytesValueNode('utf8', text));

describe('collectProgramPdas', () => {
    it('dedupes identical pdaNodes across instructions and merges usedBy', () => {
        const globalPda = pdaNode({ name: 'global', seeds: [constSeed('global')] });
        const registry = collect([
            instructionNode({ accounts: [account('global', pdaValueNode(globalPda))], name: 'one' }),
            instructionNode({ accounts: [account('global', pdaValueNode(globalPda))], name: 'two' }),
        ]);
        expect(registry.entries).toHaveLength(1);
        expect(registry.entries[0].goName).toBe('Global');
        expect(registry.entries[0].usedBy).toEqual(['one', 'two']);
        expect(registry.entries[0].seeds[0]).toEqual({ comment: null, render: '[]byte("global")' });
        expect(registry.entries[0].programExpr).toBe('ProgramID');
        expect(registry.entries[0].docs).toContain('Seeds: "global".');
        expect(registry.entries[0].docs).toContain('Used by: one, two.');
    });

    it('suffixes same-name pdaNodes with different seed structures', () => {
        const v1 = pdaNode({ name: 'vault', seeds: [constSeed('vault')] });
        const v2 = pdaNode({
            name: 'vault',
            seeds: [constSeed('vault'), variablePdaSeedNode('owner', publicKeyTypeNode())],
        });
        const registry = collect([
            instructionNode({
                accounts: [
                    account('a', pdaValueNode(v1)),
                    account('b', pdaValueNode(v2, [pdaSeedValueNode('owner', accountValueNode('a'))])),
                ],
                name: 'one',
            }),
        ]);
        expect(registry.entries.map(e => e.goName)).toEqual(['Vault', 'Vault2']);
    });

    it('numbers duplicate seed params and sanitizes Go keywords', () => {
        const pda = pdaNode({
            name: 'thing',
            seeds: [
                variablePdaSeedNode('mint', publicKeyTypeNode()),
                variablePdaSeedNode('mint', publicKeyTypeNode()),
                variablePdaSeedNode('type', numberTypeNode('u8')),
            ],
        });
        const registry = collect([instructionNode({ accounts: [account('a', pdaValueNode(pda))], name: 'one' })]);
        expect(registry.entries[0].params.map(p => p.name)).toEqual(['mint', 'mint2', 'type_']);
        expect(registry.entries[0].params.map(p => p.goType)).toEqual([
            'ag_solanago.PublicKey',
            'ag_solanago.PublicKey',
            'uint8',
        ]);
    });

    it('skips uses with a per-use derivation program override', () => {
        const pda = pdaNode({ name: 'ata', seeds: [variablePdaSeedNode('wallet', publicKeyTypeNode())] });
        const overridden = {
            ...pdaValueNode(pda, [pdaSeedValueNode('wallet', accountValueNode('payer'))]),
            programId: accountValueNode('tokenProgram'),
        };
        const registry = collect([instructionNode({ accounts: [account('a', overridden)], name: 'one' })]);
        expect(registry.entries).toHaveLength(0);
    });

    it('skips links into other programs instead of deriving under the wrong id', () => {
        const registry = collect([
            instructionNode({
                accounts: [account('a', pdaValueNode(pdaLinkNode('counter', 'otherProgram')))],
                name: 'one',
            }),
        ]);
        expect(registry.entries).toHaveLength(0);
    });

    it('records foreign program ids and renders numeric constant seeds little-endian', () => {
        const pda = pdaNode({
            name: 'pool',
            programId: OTHER_PROGRAM_ID,
            seeds: [constantPdaSeedNode(numberTypeNode('u16'), numberValueNode(1))],
        });
        const registry = collect([instructionNode({ accounts: [account('a', pdaValueNode(pda))], name: 'one' })]);
        expect(registry.entries[0].programId).toBe(OTHER_PROGRAM_ID);
        expect(registry.entries[0].seeds[0].render).toBe('{0x01, 0x00}');
        expect(registry.entries[0].seeds[0].comment).toBe('(hex) 0100');
        expect(registry.entries[0].programExpr).toBe(`pdaProgram${OTHER_PROGRAM_ID}`);
        expect(registry.foreignPrograms).toEqual([
            { base58: OTHER_PROGRAM_ID, varName: `pdaProgram${OTHER_PROGRAM_ID}` },
        ]);
    });

    it('collects program-level pdas and skips unsupported seed types with no entry', () => {
        const supported = pdaNode({ name: 'config', seeds: [constSeed('config')] });
        const unsupported = pdaNode({
            name: 'weird',
            seeds: [variablePdaSeedNode('flag', numberTypeNode('u64', 'be'))],
        });
        const registry = collect([], [supported, unsupported]);
        expect(registry.entries.map(e => e.goName)).toEqual(['Config']);
        expect(registry.entries[0].usedBy).toEqual(['program']);
    });
});
