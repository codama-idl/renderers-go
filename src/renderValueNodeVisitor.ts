import {
    arrayValueNode,
    bytesValueNode,
    isNode,
    isScalarEnum,
    numberValueNode,
    pascalCase,
    RegisteredValueNode,
    ValueNode,
} from '@codama/nodes';
import { LinkableDictionary, NodeStack, visit, Visitor } from '@codama/visitors-core';

import { ImportMap } from './ImportMap';
import { getBytesFromBytesValueNode, GetImportFromFunction } from './utils';

// Lets the renderer resolve links (e.g. the enum a value refers to).
export type ValueRenderScope = { linkables: LinkableDictionary; stack: NodeStack };

type ValueRender = { imports: ImportMap; render: string };

export function renderValueNode(
    value: ValueNode,
    _getImportFrom?: GetImportFromFunction,
    _useStr?: boolean,
    scope?: ValueRenderScope,
): ValueRender {
    return visit(value, renderValueNodeVisitor(_getImportFrom, _useStr, scope));
}

export function renderValueNodeVisitor(
    _getImportFrom?: GetImportFromFunction,
    _useStr?: boolean,
    scope?: ValueRenderScope,
): Visitor<ValueRender, RegisteredValueNode['kind']> {
    return {
        visitArrayValue(node) {
            const list = (node.items ?? []).map(v => visit(v, this));
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
            const constName = `${enumName}_${variantName}`;

            // Scalar enums are typed integer constants; data enums are BorshEnum
            // structs whose `Enum` field holds the variant index. Without a scope
            // the enum cannot be resolved and the scalar form is assumed.
            const definedType = scope ? scope.linkables.get([...scope.stack.getPath(), node.enum]) : undefined;
            const isDataEnum =
                definedType !== undefined &&
                isNode(definedType.type, 'enumTypeNode') &&
                !isScalarEnum(definedType.type);

            if (!isDataEnum) {
                if (!node.value) {
                    return { imports, render: constName };
                }
                const enumValue = visit(node.value, this);
                return {
                    imports: imports.mergeWith(enumValue.imports),
                    render: `${constName} ${enumValue.render}`,
                };
            }

            if (!node.value) {
                return { imports, render: `${enumName}{Enum: ${constName}}` };
            }

            // Variant payloads are anonymous struct fields, so build the value
            // by assigning into a zero value instead of spelling out the type.
            const assignments = renderVariantAssignments(`v.${variantName}`, node.value, this);
            return {
                imports: imports.mergeWith(...assignments.map(a => a.imports)),
                render:
                    `func() (v ${enumName}) { v.Enum = ${constName}; ` +
                    `${assignments.map(a => a.render).join('; ')}; return v }()`,
            };
        },
        visitInjectedValue(node) {
            // Injected values are resolved by a surrounding provider at
            // resolution time; the renderer can only use the fallback.
            if (node.fallback) return visit(node.fallback, this);
            throw new Error(`Cannot render injected value [${node.key}] without a fallback in Go.`);
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
            const map = (node.entries ?? []).map(entry => visit(entry, this));
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
            const set = (node.items ?? []).map(v => visit(v, this));
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
            const struct = (node.fields ?? []).map(field => visit(field, this));
            return {
                imports: new ImportMap().mergeWith(...struct.map(c => c.imports)),
                render: `{${struct.map(c => c.render).join(', ')}}`,
            };
        },
        visitTupleValue(node) {
            const tuple = (node.items ?? []).map(v => visit(v, this));
            return {
                imports: new ImportMap().mergeWith(...tuple.map(c => c.imports)),
                render: tuple.length === 1 ? tuple[0].render : `[${tuple.map(c => c.render).join(', ')}]`,
            };
        },
    };
}

// Go assignments that populate `target` (a data-enum variant field) from a
// struct or tuple value node, mirroring the shapes getTypeManifestVisitor
// emits for enum variants (anonymous struct, single item, or Field0..N).
function renderVariantAssignments(
    target: string,
    value: ValueNode,
    visitor: Visitor<ValueRender, RegisteredValueNode['kind']>,
): ValueRender[] {
    if (isNode(value, 'structValueNode')) {
        return (value.fields ?? []).map(field => {
            const fieldValue = visit(field.value, visitor);
            return { ...fieldValue, render: `${target}.${pascalCase(field.name)} = ${fieldValue.render}` };
        });
    }
    const tupleItems = isNode(value, 'tupleValueNode') ? (value.items ?? []) : null;
    if (tupleItems && tupleItems.length !== 1) {
        return tupleItems.map((item, index) => {
            const itemValue = visit(item, visitor);
            return { ...itemValue, render: `${target}.Field${index} = ${itemValue.render}` };
        });
    }
    const single = tupleItems ? tupleItems[0] : value;
    const rendered = visit(single, visitor);
    return [{ ...rendered, render: `${target} = ${rendered.render}` }];
}
