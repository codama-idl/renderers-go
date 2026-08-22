import {
    accountNode,
    arrayValueNode,
    bytesTypeNode,
    bytesValueNode,
    constantDiscriminatorNode,
    constantValueNode,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    numberValueNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { describe, expect, it } from 'vitest';

import { getAccountDiscriminator, getDiscriminatorBytes, getInstructionDiscriminator } from '../src/utils';

const ANCHOR_BYTES = [229, 23, 203, 151, 122, 227, 173, 42];

const anchorDiscriminatorArg = (name = 'discriminator') =>
    instructionArgumentNode({
        defaultValue: bytesValueNode('base16', 'e517cb977ae3ad2a'),
        defaultValueStrategy: 'omitted',
        name,
        type: fixedSizeTypeNode(bytesTypeNode(), 8),
    });

const amountArg = instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') });

describe('getDiscriminatorBytes', () => {
    it('decodes bytes values', () => {
        expect(getDiscriminatorBytes(bytesTypeNode(), bytesValueNode('base16', 'e517cb977ae3ad2a'))).toEqual(
            ANCHOR_BYTES,
        );
        expect(getDiscriminatorBytes(bytesTypeNode(), bytesValueNode('utf8', 'ab'))).toEqual([97, 98]);
    });

    it('serializes numbers little-endian at the width of their type', () => {
        expect(getDiscriminatorBytes(numberTypeNode('u8'), numberValueNode(7))).toEqual([7]);
        expect(getDiscriminatorBytes(numberTypeNode('u16'), numberValueNode(0x0102))).toEqual([2, 1]);
        expect(getDiscriminatorBytes(numberTypeNode('u32'), numberValueNode(2))).toEqual([2, 0, 0, 0]);
        expect(getDiscriminatorBytes(numberTypeNode('u64'), numberValueNode(1))).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
        expect(getDiscriminatorBytes(numberTypeNode('u32', 'be'), numberValueNode(2))).toEqual([0, 0, 0, 2]);
        expect(getDiscriminatorBytes(numberTypeNode('i8'), numberValueNode(-1))).toEqual([255]);
        expect(getDiscriminatorBytes(fixedSizeTypeNode(numberTypeNode('u32'), 4), numberValueNode(42))).toEqual([
            42, 0, 0, 0,
        ]);
    });

    it('accepts arrays of byte-sized numbers', () => {
        expect(
            getDiscriminatorBytes(bytesTypeNode(), arrayValueNode([numberValueNode(1), numberValueNode(255)])),
        ).toEqual([1, 255]);
        expect(getDiscriminatorBytes(bytesTypeNode(), arrayValueNode([numberValueNode(256)]))).toBeNull();
    });

    it('rejects values without a fixed wire representation', () => {
        expect(getDiscriminatorBytes(numberTypeNode('f32'), numberValueNode(1))).toBeNull();
        expect(getDiscriminatorBytes(bytesTypeNode(), numberValueNode(1))).toBeNull();
    });
});

describe('getInstructionDiscriminator', () => {
    it('returns a leading field discriminator', () => {
        const node = instructionNode({
            arguments: [anchorDiscriminatorArg(), amountArg],
            discriminators: [fieldDiscriminatorNode('discriminator', 0)],
            name: 'route',
        });
        expect(getInstructionDiscriminator(node)).toEqual({
            bytes: ANCHOR_BYTES,
            fieldName: 'discriminator',
            kind: 'field',
            offset: 0,
            varName: 'RouteDiscriminator',
        });
    });

    it('handles numeric discriminators', () => {
        const node = instructionNode({
            arguments: [
                instructionArgumentNode({
                    defaultValue: numberValueNode(2),
                    defaultValueStrategy: 'omitted',
                    name: 'discriminator',
                    type: numberTypeNode('u32'),
                }),
            ],
            discriminators: [fieldDiscriminatorNode('discriminator', 0)],
            name: 'transferSol',
        });
        expect(getInstructionDiscriminator(node)?.bytes).toEqual([2, 0, 0, 0]);
    });

    it('keeps the byte offset of field discriminators that are not first', () => {
        const node = instructionNode({
            arguments: [
                instructionArgumentNode({ name: 'version', type: numberTypeNode('u8') }),
                instructionArgumentNode({
                    defaultValue: numberValueNode(9),
                    defaultValueStrategy: 'omitted',
                    name: 'discriminator',
                    type: numberTypeNode('u8'),
                }),
            ],
            discriminators: [fieldDiscriminatorNode('discriminator', 1)],
            name: 'versioned',
        });
        expect(getInstructionDiscriminator(node)).toMatchObject({ bytes: [9], kind: 'field', offset: 1 });
    });

    it('returns constant discriminators at offset 0', () => {
        const node = instructionNode({
            arguments: [amountArg],
            discriminators: [constantDiscriminatorNode(constantValueNode(numberTypeNode('u8'), numberValueNode(8)))],
            name: 'tagged',
        });
        expect(getInstructionDiscriminator(node)).toEqual({
            bytes: [8],
            fieldName: null,
            kind: 'constant',
            offset: 0,
            varName: 'TaggedDiscriminator',
        });
    });

    it('ignores discriminators without a constant omitted value', () => {
        const cases = [
            instructionNode({ arguments: [amountArg], name: 'none' }),
            instructionNode({
                arguments: [
                    instructionArgumentNode({ name: 'discriminator', type: fixedSizeTypeNode(bytesTypeNode(), 8) }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator', 0)],
                name: 'noDefault',
            }),
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: bytesValueNode('base16', 'e517cb977ae3ad2a'),
                        defaultValueStrategy: 'optional',
                        name: 'discriminator',
                        type: fixedSizeTypeNode(bytesTypeNode(), 8),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator', 0)],
                name: 'optionalStrategy',
            }),
            instructionNode({
                arguments: [amountArg],
                discriminators: [
                    constantDiscriminatorNode(constantValueNode(numberTypeNode('u8'), numberValueNode(1)), 2),
                ],
                name: 'constantAtOffset',
            }),
        ];
        cases.forEach(node => expect(getInstructionDiscriminator(node), node.name).toBeNull());
    });
});

describe('getAccountDiscriminator', () => {
    it('returns the account field discriminator', () => {
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({
                    defaultValue: bytesValueNode('base16', 'e517cb977ae3ad2a'),
                    defaultValueStrategy: 'omitted',
                    name: 'discriminator',
                    type: fixedSizeTypeNode(bytesTypeNode(), 8),
                }),
                structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
            ]),
            discriminators: [fieldDiscriminatorNode('discriminator', 0)],
            name: 'bondingCurve',
        });
        expect(getAccountDiscriminator(node)).toEqual({
            bytes: ANCHOR_BYTES,
            fieldName: 'discriminator',
            kind: 'field',
            offset: 0,
            varName: 'BondingCurveDiscriminator',
        });
    });

    it('returns null for accounts without discriminators', () => {
        const node = accountNode({
            data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
            name: 'nonce',
        });
        expect(getAccountDiscriminator(node)).toBeNull();
    });
});
