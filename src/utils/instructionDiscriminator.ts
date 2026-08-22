import {
    AccountNode,
    DiscriminatorNode,
    InstructionArgumentNode,
    InstructionNode,
    isNode,
    pascalCase,
    resolveNestedTypeNode,
    StructFieldTypeNode,
    TypeNode,
    VALUE_NODES,
    ValueNode,
} from '@codama/nodes';

import { getBytesFromBytesValueNode } from './codecs';

// A discriminator with a fixed byte representation that the generated codec
// writes, validates and dispatches on.
export type LeadingDiscriminator = {
    // Wire bytes of the discriminator, in the order they are serialized.
    bytes: number[];
    // Name of the argument/field carrying the discriminator (`field` kind),
    // or null for a constant that is not part of the struct.
    fieldName: string | null;
    kind: 'constant' | 'field';
    // Byte offset of the discriminator in the serialized data.
    offset: number;
    // Name of the generated Go variable holding the bytes (e.g. `RouteDiscriminator`).
    varName: string;
};

// Byte widths of the integer formats a discriminator can use.
const NUMBER_WIDTHS: Record<string, number> = {
    i16: 2,
    i32: 4,
    i64: 8,
    i8: 1,
    u16: 2,
    u32: 4,
    u64: 8,
    u8: 1,
};

// Name of the Go variable holding a discriminator constant; shared by the
// constant emitter and the codec so the two cannot drift.
export function getDiscriminatorVarName(prefix: string, fieldName: string): string {
    return pascalCase(`${prefix}_${fieldName}`);
}

// Serialized bytes of a constant discriminator value, or null when the value
// cannot be expressed as a fixed byte sequence.
export function getDiscriminatorBytes(type: TypeNode, value: ValueNode): number[] | null {
    if (isNode(value, 'bytesValueNode')) {
        return Array.from(getBytesFromBytesValueNode(value));
    }

    if (isNode(value, 'arrayValueNode')) {
        const bytes: number[] = [];
        for (const item of value.items) {
            if (!isNode(item, 'numberValueNode') || !Number.isInteger(item.number)) return null;
            if (item.number < 0 || item.number > 255) return null;
            bytes.push(item.number);
        }
        return bytes;
    }

    if (isNode(value, 'numberValueNode')) {
        const resolved = resolveNestedTypeNode(type);
        if (!isNode(resolved, 'numberTypeNode')) return null;
        const width = NUMBER_WIDTHS[resolved.format];
        if (!width || !Number.isInteger(value.number)) return null;

        const unsigned = BigInt.asUintN(width * 8, BigInt(value.number));
        const bytes: number[] = [];
        for (let i = 0; i < width; i++) {
            bytes.push(Number((unsigned >> BigInt(8 * i)) & BigInt(0xff)));
        }
        if (resolved.endian === 'be') bytes.reverse();
        return bytes;
    }

    return null;
}

// The first discriminator the codec can handle:
// - a field discriminator whose field carries a constant default value that is
//   omitted from the public struct (any byte offset), or
// - a constant discriminator at offset 0 (written before the fields).
// Size discriminators, constants at a non-zero offset and fields without a
// constant default return null and are left to the caller's fallback.
export function getLeadingDiscriminator(scope: {
    discriminators: DiscriminatorNode[];
    fields: InstructionArgumentNode[] | StructFieldTypeNode[];
    prefix: string;
}): LeadingDiscriminator | null {
    for (const discriminator of scope.discriminators) {
        if (isNode(discriminator, 'fieldDiscriminatorNode')) {
            const field = (scope.fields as { name: string }[]).find(f => f.name === discriminator.name) as
                | InstructionArgumentNode
                | StructFieldTypeNode
                | undefined;
            if (!field?.defaultValue || !isNode(field.defaultValue, VALUE_NODES)) continue;
            if (field.defaultValueStrategy !== 'omitted') continue;
            const bytes = getDiscriminatorBytes(field.type, field.defaultValue);
            if (!bytes || bytes.length === 0) continue;
            return {
                bytes,
                fieldName: field.name,
                kind: 'field',
                offset: discriminator.offset,
                varName: getDiscriminatorVarName(scope.prefix, discriminator.name),
            };
        }
        if (isNode(discriminator, 'constantDiscriminatorNode') && discriminator.offset === 0) {
            const bytes = getDiscriminatorBytes(discriminator.constant.type, discriminator.constant.value);
            if (!bytes || bytes.length === 0) continue;
            return {
                bytes,
                fieldName: null,
                kind: 'constant',
                offset: 0,
                varName: getDiscriminatorVarName(scope.prefix, 'discriminator'),
            };
        }
    }
    return null;
}

export function getInstructionDiscriminator(node: InstructionNode): LeadingDiscriminator | null {
    return getLeadingDiscriminator({
        discriminators: node.discriminators ?? [],
        fields: node.arguments,
        prefix: node.name,
    });
}

export function getAccountDiscriminator(node: AccountNode): LeadingDiscriminator | null {
    return getLeadingDiscriminator({
        discriminators: node.discriminators ?? [],
        fields: resolveNestedTypeNode(node.data).fields,
        prefix: node.name,
    });
}
