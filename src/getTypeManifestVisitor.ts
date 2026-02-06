import { CODAMA_ERROR__RENDERERS__UNSUPPORTED_NODE, CodamaError } from '@codama/errors';
import {
    arrayTypeNode,
    CountNode,
    fixedCountNode,
    isNode,
    isScalarEnum,
    NumberTypeNode,
    numberTypeNode,
    parseDocs,
    pascalCase,
    prefixedCountNode,
    REGISTERED_TYPE_NODE_KINDS,
    remainderCountNode,
    resolveNestedTypeNode,
} from '@codama/nodes';
import { extendVisitor, mergeVisitor, pipe, visit } from '@codama/visitors-core';

import { ImportMap } from './ImportMap';
import { GetImportFromFunction, goDocComment } from './utils';

export type TypeManifest = {
    imports: ImportMap;
    nestedStructs: string[];
    type: string;
};

// Map Codama number formats to Go types.
const NUMBER_FORMAT_MAP: Record<string, string> = {
    f32: 'float32',
    f64: 'float64',
    i8: 'int8',
    i16: 'int16',
    i32: 'int32',
    i64: 'int64',
    i128: 'ag_binary.Int128',
    u8: 'uint8',
    u16: 'uint16',
    u32: 'uint32',
    u64: 'uint64',
    u128: 'ag_binary.Uint128',
    shortU16: 'uint16',
};

export function getTypeManifestVisitor(options: {
    getImportFrom: GetImportFromFunction;
    nestedStruct?: boolean;
    parentName?: string | null;
}) {
    let parentName: string | null = options.parentName ?? null;
    let nestedStruct: boolean = options.nestedStruct ?? false;
    let inlineStruct: boolean = false;
    let parentSize: NumberTypeNode | number | null = null;
    let isOptionField: boolean = false;

    return pipe(
        mergeVisitor(
            (): TypeManifest => ({ imports: new ImportMap(), nestedStructs: [], type: '' }),
            (_, values) => ({
                ...mergeManifests(values),
                type: values.map(v => v.type).join('\n'),
            }),
            { keys: [...REGISTERED_TYPE_NODE_KINDS, 'definedTypeLinkNode', 'definedTypeNode', 'accountNode'] },
        ),
        v =>
            extendVisitor(v, {
                visitAccount(account, { self }) {
                    parentName = pascalCase(account.name);
                    const manifest = visit(account.data, self);
                    parentName = null;
                    return manifest;
                },

                visitArrayType(arrayType, { self }) {
                    const childManifest = visit(arrayType.item, self);

                    if (isNode(arrayType.count, 'fixedCountNode')) {
                        return {
                            ...childManifest,
                            type: `[${arrayType.count.value}]${childManifest.type}`,
                        };
                    }

                    // Both remainder and prefixed counts map to Go slices.
                    // The binary encoder/decoder handles the prefix automatically.
                    return {
                        ...childManifest,
                        type: `[]${childManifest.type}`,
                    };
                },

                visitBooleanType(booleanType) {
                    const resolvedSize = resolveNestedTypeNode(booleanType.size);
                    if (resolvedSize.format === 'u8' && resolvedSize.endian === 'le') {
                        return {
                            imports: new ImportMap(),
                            nestedStructs: [],
                            type: 'bool',
                        };
                    }

                    throw new Error('Bool size not supported by Borsh');
                },

                visitBytesType(_bytesType, { self }) {
                    let arraySize: CountNode = remainderCountNode();
                    if (typeof parentSize === 'number') {
                        arraySize = fixedCountNode(parentSize);
                    } else if (parentSize && typeof parentSize === 'object') {
                        arraySize = prefixedCountNode(parentSize);
                    }
                    const arrayType = arrayTypeNode(numberTypeNode('u8'), arraySize);
                    return visit(arrayType, self);
                },

                visitDefinedType(definedType, { self }) {
                    parentName = pascalCase(definedType.name);
                    const manifest = visit(definedType.type, self);
                    parentName = null;

                    const renderedType = isNode(definedType.type, ['enumTypeNode', 'structTypeNode'])
                        ? manifest.type
                        : `type ${pascalCase(definedType.name)} = ${manifest.type}`;

                    return { ...manifest, type: renderedType };
                },

                visitDefinedTypeLink(node) {
                    const pascalCaseDefinedType = pascalCase(node.name);
                    // For same-package references, no import needed (flat package).
                    return {
                        imports: new ImportMap(),
                        nestedStructs: [],
                        type: pascalCaseDefinedType,
                    };
                },

                visitEnumEmptyVariantType(enumEmptyVariantType) {
                    const name = pascalCase(enumEmptyVariantType.name);
                    return {
                        imports: new ImportMap(),
                        nestedStructs: [],
                        type: name,
                    };
                },

                visitEnumStructVariantType(enumStructVariantType, { self }) {
                    const name = pascalCase(enumStructVariantType.name);
                    const originalParentName = parentName;

                    if (!originalParentName) {
                        throw new Error('Enum struct variant type must have a parent name.');
                    }

                    inlineStruct = true;
                    parentName = pascalCase(originalParentName) + name;
                    const typeManifest = visit(enumStructVariantType.struct, self);
                    inlineStruct = false;
                    parentName = originalParentName;

                    return {
                        ...typeManifest,
                        type: `${name} ${typeManifest.type}`,
                    };
                },

                visitEnumTupleVariantType(enumTupleVariantType, { self }) {
                    const name = pascalCase(enumTupleVariantType.name);
                    const originalParentName = parentName;

                    if (!originalParentName) {
                        throw new Error('Enum tuple variant type must have a parent name.');
                    }

                    parentName = pascalCase(originalParentName) + name;
                    const childManifest = visit(enumTupleVariantType.tuple, self);
                    parentName = originalParentName;

                    return {
                        ...childManifest,
                        type: `${name} ${childManifest.type}`,
                    };
                },

                visitEnumType(enumType, { self }) {
                    const originalParentName = parentName;
                    if (!originalParentName) {
                        throw new Error('Enum type must have a parent name.');
                    }

                    const typeName = pascalCase(originalParentName);

                    // Scalar enum: all variants are empty → use typed constants with iota.
                    if (isScalarEnum(enumType)) {
                        const variants = enumType.variants.map(variant => visit(variant, self));
                        const mergedManifest = mergeManifests(variants);

                        const constLines = variants.map((variant, index) => {
                            const variantName = `${typeName}_${variant.type}`;
                            if (index === 0) {
                                return `\t${variantName} ${typeName} = iota`;
                            }
                            return `\t${variantName}`;
                        });

                        const typeDecl = `type ${typeName} uint8`;
                        const constDecl = `const (\n${constLines.join('\n')}\n)`;

                        return {
                            ...mergedManifest,
                            type: `${typeDecl}\n\n${constDecl}`,
                        };
                    }

                    // Data enum: use BorshEnum struct pattern.
                    const variants = enumType.variants.map(variant => visit(variant, self));
                    const mergedManifest = mergeManifests(variants);
                    mergedManifest.imports.add('github.com/gagliardetto/binary');

                    const fieldLines = [
                        `\tEnum ag_binary.BorshEnum \`borsh_enum:"true"\``,
                    ];
                    for (const variant of variants) {
                        fieldLines.push(`\t${variant.type}`);
                    }

                    return {
                        ...mergedManifest,
                        type: `type ${typeName} struct {\n${fieldLines.join('\n')}\n}`,
                    };
                },

                visitFixedSizeType(fixedSizeType, { self }) {
                    parentSize = fixedSizeType.size;
                    const manifest = visit(fixedSizeType.type, self);
                    parentSize = null;
                    return manifest;
                },

                visitMapType(mapType, { self }) {
                    const key = visit(mapType.key, self);
                    const value = visit(mapType.value, self);
                    const mergedManifest = mergeManifests([key, value]);
                    return {
                        ...mergedManifest,
                        type: `map[${key.type}]${value.type}`,
                    };
                },

                visitNumberType(numberType) {
                    if (numberType.endian !== 'le') {
                        throw new Error('Number endianness not supported by Borsh');
                    }

                    const goType = NUMBER_FORMAT_MAP[numberType.format];
                    if (!goType) {
                        throw new Error(`Number format not supported: ${numberType.format}`);
                    }

                    const imports = new ImportMap();
                    if (goType.startsWith('ag_binary.')) {
                        imports.add('github.com/gagliardetto/binary');
                    }

                    return {
                        imports,
                        nestedStructs: [],
                        type: goType,
                    };
                },

                visitOptionType(optionType, { self }) {
                    isOptionField = true;
                    const childManifest = visit(optionType.item, self);
                    isOptionField = false;

                    return {
                        ...childManifest,
                        type: `*${childManifest.type}`,
                    };
                },

                visitPublicKeyType() {
                    return {
                        imports: new ImportMap().add('github.com/gagliardetto/solana-go'),
                        nestedStructs: [],
                        type: 'ag_solanago.PublicKey',
                    };
                },

                visitRemainderOptionType(node) {
                    throw new CodamaError(CODAMA_ERROR__RENDERERS__UNSUPPORTED_NODE, { kind: node.kind, node });
                },

                visitSetType(setType, { self }) {
                    const childManifest = visit(setType.item, self);
                    return {
                        ...childManifest,
                        type: `map[${childManifest.type}]struct{}`,
                    };
                },

                visitSizePrefixType(sizePrefixType, { self }) {
                    parentSize = resolveNestedTypeNode(sizePrefixType.prefix);
                    const manifest = visit(sizePrefixType.type, self);
                    parentSize = null;
                    return manifest;
                },

                visitStringType() {
                    if (!parentSize) {
                        // Remainder string — just a Go string.
                        return {
                            imports: new ImportMap(),
                            nestedStructs: [],
                            type: 'string',
                        };
                    }

                    if (typeof parentSize === 'number') {
                        // Fixed-size string → fixed byte array.
                        return {
                            imports: new ImportMap(),
                            nestedStructs: [],
                            type: `[${parentSize}]byte`,
                        };
                    }

                    // Prefixed string — Go string (borsh handles the prefix).
                    return {
                        imports: new ImportMap(),
                        nestedStructs: [],
                        type: 'string',
                    };
                },

                visitStructFieldType(structFieldType, { self }) {
                    const originalParentName = parentName;
                    const originalInlineStruct = inlineStruct;
                    const originalNestedStruct = nestedStruct;

                    if (!originalParentName) {
                        throw new Error('Struct field type must have a parent name.');
                    }

                    parentName = pascalCase(originalParentName) + pascalCase(structFieldType.name);
                    nestedStruct = true;
                    inlineStruct = false;

                    const fieldManifest = visit(structFieldType.type, self);

                    parentName = originalParentName;
                    inlineStruct = originalInlineStruct;
                    nestedStruct = originalNestedStruct;

                    // Go exported field names use PascalCase.
                    const fieldName = pascalCase(structFieldType.name);
                    const docblock = goDocComment(parseDocs(structFieldType.docs));

                    // Build struct tag if needed.
                    const tags: string[] = [];
                    if (isOptionField) {
                        tags.push(`bin:"optional"`);
                        isOptionField = false;
                    }
                    const tagStr = tags.length > 0 ? ` \`${tags.join(' ')}\`` : '';

                    return {
                        ...fieldManifest,
                        type: `${docblock}\t${fieldName} ${fieldManifest.type}${tagStr}`,
                    };
                },

                visitStructType(structType, { self }) {
                    const originalParentName = parentName;

                    if (!originalParentName) {
                        throw new Error('Struct type must have a parent name.');
                    }

                    const fields = structType.fields.map(field => visit(field, self));
                    const fieldTypes = fields.map(field => field.type).join('\n');
                    const mergedManifest = mergeManifests(fields);

                    if (nestedStruct) {
                        return {
                            ...mergedManifest,
                            nestedStructs: [
                                ...mergedManifest.nestedStructs,
                                `type ${pascalCase(originalParentName)} struct {\n${fieldTypes}\n}`,
                            ],
                            type: pascalCase(originalParentName),
                        };
                    }

                    if (inlineStruct) {
                        return { ...mergedManifest, type: `struct {\n${fieldTypes}\n}` };
                    }

                    return {
                        ...mergedManifest,
                        type: `type ${pascalCase(originalParentName)} struct {\n${fieldTypes}\n}`,
                    };
                },

                visitTupleType(tupleType, { self }) {
                    // Go doesn't have native tuples.
                    // For a single-element tuple, just use the element type.
                    // For multi-element, generate a struct.
                    const items = tupleType.items.map(item => visit(item, self));
                    const mergedManifest = mergeManifests(items);

                    if (items.length === 1) {
                        return { ...mergedManifest, type: items[0].type };
                    }

                    // Multi-element tuple: generate inline struct with Field0, Field1, etc.
                    const fieldLines = items.map((item, i) => `\tField${i} ${item.type}`);
                    return {
                        ...mergedManifest,
                        type: `struct {\n${fieldLines.join('\n')}\n}`,
                    };
                },

                visitZeroableOptionType(node) {
                    throw new CodamaError(CODAMA_ERROR__RENDERERS__UNSUPPORTED_NODE, { kind: node.kind, node });
                },
            }),
    );
}

function mergeManifests(manifests: TypeManifest[]): Pick<TypeManifest, 'imports' | 'nestedStructs'> {
    return {
        imports: new ImportMap().mergeWith(...manifests.map(td => td.imports)),
        nestedStructs: manifests.flatMap(m => m.nestedStructs),
    };
}
