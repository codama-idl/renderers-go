import { isNode, TypeNode } from '@codama/nodes';

// Types that are serialized without a length prefix and consume the rest of
// the buffer when decoding. ag_binary always writes a u32 length prefix for
// strings and slices, so these need a hand-written codec.
export type RemainderEncoding = {
    // Element type of a remainder array (null for strings and bytes).
    item: TypeNode | null;
    kind: 'array' | 'bytes' | 'string';
};

export function getRemainderEncoding(type: TypeNode): RemainderEncoding | null {
    if (isNode(type, 'stringTypeNode')) return { item: null, kind: 'string' };
    if (isNode(type, 'bytesTypeNode')) return { item: null, kind: 'bytes' };
    if (isNode(type, 'arrayTypeNode') && isNode(type.count, 'remainderCountNode')) {
        if (isNode(type.item, 'numberTypeNode') && type.item.format === 'u8') return { item: null, kind: 'bytes' };
        return { item: type.item, kind: 'array' };
    }
    return null;
}
