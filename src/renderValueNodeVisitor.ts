import {
    arrayValueNode,
    bytesValueNode,
    isNode,
    numberValueNode,
    pascalCase,
    RegisteredValueNode,
    ValueNode,
} from '@codama/nodes';
import { visit, Visitor } from '@codama/visitors-core';

import { ImportMap } from './ImportMap';
import { getBytesFromBytesValueNode, GetImportFromFunction } from './utils';

export function renderValueNode(
    value: ValueNode,
    _getImportFrom?: GetImportFromFunction,
    _useStr?: boolean,
): {
    imports: ImportMap;
    render: string;
} {
    return visit(value, renderValueNodeVisitor());
}

export function renderValueNodeVisitor(
    _getImportFrom?: GetImportFromFunction,
    _useStr?: boolean,
): Visitor<
    {
        imports: ImportMap;
        render: string;
    },
    RegisteredValueNode['kind']
> {
    return {
        visitArrayValue(node) {
            const list = node.items.map(v => visit(v, this));
            return {
                imports: new ImportMap().mergeWith(...list.map(c => c.imports)),
                render: `[]byte{${list.map(c => c.render).join(', ')}}`,
            };
        },
        visitBooleanValue(node) {
            return {
                imports: new ImportMap(),
                render: JSON.stringify(node.boolean),
            };
        },
        visitBytesValue(node) {
            const bytes = getBytesFromBytesValueNode(node);
            const numbers = Array.from(bytes).map(numberValueNode);
            return visit(arrayValueNode(numbers), this);
        },
        visitConstantValue(node) {
            if (isNode(node.value, 'bytesValueNode')) {
                return visit(node.value, this);
            }
            if (isNode(node.type, 'stringTypeNode') && isNode(node.value, 'stringValueNode')) {
                return visit(bytesValueNode(node.type.encoding, node.value.string), this);
            }
            if (isNode(node.type, 'numberTypeNode') && isNode(node.value, 'numberValueNode')) {
                const numberManifest = visit(node.value, this);
                // In Go, convert number to bytes using encoding/binary
                const { format, endian } = node.type;
                const goEndian = endian === 'le' ? 'LittleEndian' : 'BigEndian';
                // For simple byte values, just use the number directly
                if (format === 'u8') {
                    numberManifest.render = `byte(${numberManifest.render})`;
                } else {
                    numberManifest.imports.add('encoding/binary');
                    numberManifest.render = `binary.${goEndian}.AppendUint${format.slice(1)}(nil, ${numberManifest.render})`;
                }
                return numberManifest;
            }
            throw new Error('Unsupported constant value type.');
        },
        visitEnumValue(node) {
            const imports = new ImportMap();
            const enumName = pascalCase(node.enum.name);
            const variantName = pascalCase(node.variant);
            // In Go, enum variants are TypeName_VariantName for scalar enums
            if (!node.value) {
                return { imports, render: `${enumName}_${variantName}` };
            }
            const enumValue = visit(node.value, this);
            const fields = enumValue.render;
            return {
                imports: imports.mergeWith(enumValue.imports),
                render: `${enumName}_${variantName} ${fields}`,
            };
        },
        visitMapEntryValue(node) {
            const mapKey = visit(node.key, this);
            const mapValue = visit(node.value, this);
            return {
                imports: mapKey.imports.mergeWith(mapValue.imports),
                render: `${mapKey.render}: ${mapValue.render}`,
            };
        },
        visitMapValue(node) {
            const map = node.entries.map(entry => visit(entry, this));
            return {
                imports: new ImportMap().mergeWith(...map.map(c => c.imports)),
                render: `map[string]interface{}{${map.map(c => c.render).join(', ')}}`,
            };
        },
        visitNoneValue() {
            return {
                imports: new ImportMap(),
                render: 'nil',
            };
        },
        visitNumberValue(node) {
            return {
                imports: new ImportMap(),
                render: node.number.toString(),
            };
        },
        visitPublicKeyValue(node) {
            return {
                imports: new ImportMap().add('github.com/gagliardetto/solana-go'),
                render: `ag_solanago.MustPublicKeyFromBase58("${node.publicKey}")`,
            };
        },
        visitSetValue(node) {
            const set = node.items.map(v => visit(v, this));
            return {
                imports: new ImportMap().mergeWith(...set.map(c => c.imports)),
                render: `map[interface{}]struct{}{${set.map(c => `${c.render}: {}`).join(', ')}}`,
            };
        },
        visitSomeValue(node) {
            const child = visit(node.value, this);
            return {
                ...child,
                render: `func() *interface{} { v := ${child.render}; return &v }()`,
            };
        },
        visitStringValue(node) {
            return {
                imports: new ImportMap(),
                render: JSON.stringify(node.string),
            };
        },
        visitStructFieldValue(node) {
            const structValue = visit(node.value, this);
            return {
                imports: structValue.imports,
                render: `${pascalCase(node.name)}: ${structValue.render}`,
            };
        },
        visitStructValue(node) {
            const struct = node.fields.map(field => visit(field, this));
            return {
                imports: new ImportMap().mergeWith(...struct.map(c => c.imports)),
                render: `{${struct.map(c => c.render).join(', ')}}`,
            };
        },
        visitTupleValue(node) {
            const tuple = node.items.map(v => visit(v, this));
            return {
                imports: new ImportMap().mergeWith(...tuple.map(c => c.imports)),
                render: tuple.length === 1 ? tuple[0].render : `[${tuple.map(c => c.render).join(', ')}]`,
            };
        },
    };
}
