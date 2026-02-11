// Go does not have derive macros or trait attributes like Rust.
// This module is kept as a stub for API compatibility but returns
// empty renders — serialization in Go is handled via struct tags
// and explicit MarshalWithEncoder/UnmarshalWithDecoder methods.

import { AccountNode, DefinedTypeNode, InstructionNode } from '@codama/nodes';

import { ImportMap } from '../ImportMap';

export type TraitOptions = Record<string, never>;

export type GetTraitsFromNodeFunction = (node: AccountNode | DefinedTypeNode | InstructionNode) => {
    imports: ImportMap;
    render: string;
};

export function getTraitsFromNodeFactory(_options: TraitOptions = {}): GetTraitsFromNodeFunction {
    return () => ({ imports: new ImportMap(), render: '' });
}

export function getTraitsFromNode(
    _node: AccountNode | DefinedTypeNode | InstructionNode,
    _userOptions: TraitOptions = {},
): { imports: ImportMap; render: string } {
    // Go has no derive macros — return empty.
    return { imports: new ImportMap(), render: '' };
}
