import { logWarn } from '@codama/errors';
import {
    getAllAccounts,
    getAllDefinedTypes,
    getAllInstructionsWithSubs,
    getAllPrograms,
    InstructionNode,
    isNode,
    isNodeFilter,
    pascalCase,
    ProgramNode,
    resolveNestedTypeNode,
    snakeCase,
    structTypeNodeFromInstructionArgumentNodes,
    VALUE_NODES,
} from '@codama/nodes';
import { addToRenderMap, createRenderMap, mergeRenderMaps } from '@codama/renderers-core';
import {
    extendVisitor,
    LinkableDictionary,
    NodeStack,
    pipe,
    recordLinkablesOnFirstVisitVisitor,
    recordNodeStackVisitor,
    staticVisitor,
    visit,
} from '@codama/visitors-core';

import { getTypeManifestVisitor } from './getTypeManifestVisitor';
import { ImportMap } from './ImportMap';
import { renderValueNode } from './renderValueNodeVisitor';
import {
    collectProgramPdas,
    getAccountDiscriminator,
    getDiscriminatorConstants,
    getImportFromFactory,
    getInstructionDiscriminator,
    getRemainderEncoding,
    LinkOverrides,
    render,
} from './utils';

export type GetRenderMapOptions = {
    dependencyMap?: Record<string, string>;
    linkOverrides?: LinkOverrides;
    renderParentInstructions?: boolean;
};

export function getRenderMapVisitor(options: GetRenderMapOptions = {}) {
    const linkables = new LinkableDictionary();
    const stack = new NodeStack();
    let program: ProgramNode | null = null;

    const renderParentInstructions = options.renderParentInstructions ?? false;
    const dependencyMap = options.dependencyMap ?? {};
    const getImportFrom = getImportFromFactory(options.linkOverrides ?? {});
    const typeManifestVisitor = getTypeManifestVisitor({
        getImportFrom,
    });

    return pipe(
        staticVisitor(() => createRenderMap(), {
            keys: ['rootNode', 'programNode', 'instructionNode', 'accountNode', 'definedTypeNode'],
        }),
        v =>
            extendVisitor(v, {
                visitAccount(node) {
                    const typeManifest = visit(node, typeManifestVisitor);
                    typeManifest.imports.add('github.com/gagliardetto/binary');

                    // Discriminator constants.
                    const fields = resolveNestedTypeNode(node.data).fields;
                    const discriminatorConstants = getDiscriminatorConstants({
                        discriminatorNodes: node.discriminators ?? [],
                        fields,
                        getImportFrom,
                        prefix: node.name,
                        typeManifestVisitor,
                    });

                    // Seeds.
                    const seedsImports = new ImportMap();
                    const pda = node.pda ? linkables.get([...stack.getPath(), node.pda]) : undefined;
                    const pdaSeeds = pda?.seeds ?? [];
                    const seeds = pdaSeeds.map(seed => {
                        if (isNode(seed, 'variablePdaSeedNode')) {
                            const seedManifest = visit(seed.type, typeManifestVisitor);
                            seedsImports.mergeWith(seedManifest.imports);
                            const resolvedType = resolveNestedTypeNode(seed.type);
                            return { ...seed, resolvedType, typeManifest: seedManifest };
                        }
                        if (isNode(seed.value, 'programIdValueNode')) {
                            return seed;
                        }
                        const seedManifest = visit(seed.type, typeManifestVisitor);
                        const valueManifest = renderValueNode(seed.value, getImportFrom, true, { linkables, stack });
                        seedsImports.mergeWith(valueManifest.imports);
                        const resolvedType = resolveNestedTypeNode(seed.type);
                        return { ...seed, resolvedType, typeManifest: seedManifest, valueManifest };
                    });
                    const hasVariableSeeds = pdaSeeds.filter(isNodeFilter('variablePdaSeedNode')).length > 0;
                    const constantSeeds = seeds
                        .filter(isNodeFilter('constantPdaSeedNode'))
                        .filter(seed => !isNode(seed.value, 'programIdValueNode'));

                    const { imports } = typeManifest;

                    if (hasVariableSeeds) {
                        imports.mergeWith(seedsImports);
                    }

                    // Discriminator written on encode and validated on decode.
                    const accountDiscriminator = getAccountDiscriminator(node);
                    if (accountDiscriminator) {
                        imports.add('bytes');
                        imports.add('fmt');
                    }

                    // Account fields for field-by-field encoding/decoding.
                    const accountFields: {
                        discriminator: boolean;
                        innerOptionType: string | null;
                        itemType: string | null;
                        name: string;
                        remainder: string | null;
                    }[] = [];

                    fields.forEach(field => {
                        const fieldTypeVisitor = getTypeManifestVisitor({
                            getImportFrom,
                            nestedStruct: true,
                            parentName: pascalCase(node.name),
                        });
                        const manifest = visit(field.type, fieldTypeVisitor);
                        const innerOptionType = isNode(field.type, 'optionTypeNode')
                            ? manifest.type.slice(1) // Remove leading '*'
                            : null;
                        const remainder = getRemainderEncoding(field.type);
                        accountFields.push({
                            discriminator: accountDiscriminator?.fieldName === field.name,
                            innerOptionType,
                            itemType: remainder?.item ? visit(remainder.item, fieldTypeVisitor).type : null,
                            name: field.name,
                            remainder: remainder?.kind ?? null,
                        });
                    });

                    return createRenderMap(`account_${snakeCase(node.name)}.go`, {
                        content: render('accountsPage.njk', {
                            account: node,
                            accountFields,
                            constantSeeds,
                            discriminatorConstants: discriminatorConstants.render,
                            discriminatorKind: accountDiscriminator?.kind ?? null,
                            discriminatorVar: accountDiscriminator?.varName ?? null,
                            hasVariableSeeds,
                            imports: imports.mergeWith(discriminatorConstants.imports).toString(dependencyMap),
                            packageName: snakeCase(program?.name ?? 'generated'),
                            pda,
                            program,
                            seeds,
                            typeManifest,
                        }),
                    });
                },

                visitDefinedType(node) {
                    const typeManifest = visit(node, typeManifestVisitor);
                    const imports = new ImportMap().mergeWithManifest(typeManifest);

                    return createRenderMap(`type_${snakeCase(node.name)}.go`, {
                        content: render('definedTypesPage.njk', {
                            definedType: node,
                            imports: imports.toString(dependencyMap),
                            packageName: snakeCase(program?.name ?? 'generated'),
                            typeManifest,
                        }),
                    });
                },

                visitInstruction(node) {
                    // Discriminator the instruction is encoded with and decoded on.
                    const discriminator = getInstructionDiscriminator(node);

                    // Optional accounts: unset slots are filled with the program id
                    // (or dropped) in GetAccounts, and only the accounts up to the last
                    // required one must be present when decoding.
                    const optionalAccountIndexes = node.accounts.flatMap((account, index) =>
                        account.isOptional ? [index] : [],
                    );
                    const minRequiredAccounts = node.accounts.reduce(
                        (last, account, index) => (account.isOptional ? last : index + 1),
                        0,
                    );

                    // Imports.
                    const imports = new ImportMap();
                    imports.add('github.com/gagliardetto/solana-go');
                    imports.add('github.com/gagliardetto/binary');
                    if (minRequiredAccounts > 0) {
                        imports.add('errors'); // Validate
                        imports.add('fmt'); // SetAccounts
                    }
                    if (discriminator) {
                        imports.add('bytes');
                        imports.add('fmt');
                    }

                    // canMergeAccountsAndArgs
                    const accountsAndArgsConflicts = getConflictsForInstructionAccountsAndArgs(node);
                    if (accountsAndArgsConflicts.length > 0) {
                        logWarn(
                            `[Go] Accounts and args of instruction [${node.name}] have the following ` +
                                `conflicting attributes [${accountsAndArgsConflicts.join(', ')}]. ` +
                                `Thus, the conflicting arguments will be suffixed with "Arg". ` +
                                'You may want to rename the conflicting attributes.',
                        );
                    }

                    // Discriminator constants.
                    const discriminatorConstants = getDiscriminatorConstants({
                        discriminatorNodes: node.discriminators ?? [],
                        fields: node.arguments,
                        getImportFrom,
                        prefix: node.name,
                        typeManifestVisitor,
                    });

                    // Instruction args.
                    const instructionArgs: {
                        default: boolean;
                        discriminator: boolean;
                        innerOptionType: string | null;
                        itemType: string | null;
                        name: string;
                        optional: boolean;
                        remainder: string | null;
                        type: string;
                        value: string | null;
                    }[] = [];
                    let hasArgs = false;
                    let hasOptional = false;

                    node.arguments.forEach(argument => {
                        const argumentVisitor = getTypeManifestVisitor({
                            getImportFrom,
                            nestedStruct: true,
                            parentName: `${pascalCase(node.name)}InstructionData`,
                        });
                        const manifest = visit(argument.type, argumentVisitor);
                        imports.mergeWith(manifest.imports);
                        const innerOptionType = isNode(argument.type, 'optionTypeNode')
                            ? manifest.type.slice(1) // Remove the leading '*' from *T
                            : null;

                        const hasDefaultValue = !!argument.defaultValue && isNode(argument.defaultValue, VALUE_NODES);
                        let renderValue: string | null = null;
                        if (hasDefaultValue) {
                            const { imports: argImports, render: value } = renderValueNode(
                                argument.defaultValue,
                                getImportFrom,
                                undefined,
                                { linkables, stack },
                            );
                            imports.mergeWith(argImports);
                            renderValue = value;
                        }

                        hasArgs = hasArgs || argument.defaultValueStrategy !== 'omitted';
                        hasOptional = hasOptional || (hasDefaultValue && argument.defaultValueStrategy !== 'omitted');

                        const name = accountsAndArgsConflicts.includes(argument.name)
                            ? `${argument.name}Arg`
                            : argument.name;

                        const remainder = getRemainderEncoding(argument.type);
                        instructionArgs.push({
                            default: hasDefaultValue && argument.defaultValueStrategy === 'omitted',
                            discriminator: discriminator?.fieldName === argument.name,
                            innerOptionType,
                            itemType: remainder?.item ? visit(remainder.item, argumentVisitor).type : null,
                            name,
                            optional: hasDefaultValue && argument.defaultValueStrategy !== 'omitted',
                            remainder: remainder?.kind ?? null,
                            type: manifest.type,
                            value: renderValue,
                        });
                    });

                    const struct = structTypeNodeFromInstructionArgumentNodes(node.arguments);
                    const structVisitor = getTypeManifestVisitor({
                        getImportFrom,
                        parentName: `${pascalCase(node.name)}InstructionData`,
                    });
                    const typeManifest = visit(struct, structVisitor);

                    return createRenderMap(`instruction_${snakeCase(node.name)}.go`, {
                        content: render('instructionsPage.njk', {
                            discriminatorConstants: discriminatorConstants.render,
                            discriminatorKind: discriminator?.kind ?? null,
                            discriminatorVar: discriminator?.varName ?? null,
                            hasArgs,
                            hasOptional,
                            imports: imports.mergeWith(discriminatorConstants.imports).toString(dependencyMap),
                            instruction: node,
                            instructionArgs,
                            minRequiredAccounts,
                            optionalAccountIndexes,
                            optionalAccountStrategy: node.optionalAccountStrategy ?? 'programId',
                            packageName: snakeCase(program?.name ?? 'generated'),
                            program,
                            typeManifest,
                        }),
                    });
                },

                visitProgram(node, { self }) {
                    program = node;
                    const pdaRegistry = collectProgramPdas(node, {
                        leavesOnly: !renderParentInstructions,
                        linkables,
                        stack,
                    });
                    let renders = mergeRenderMaps([
                        ...node.accounts.map(account => visit(account, self)),
                        ...node.definedTypes.map(type => visit(type, self)),
                        ...getAllInstructionsWithSubs(node, {
                            leavesOnly: !renderParentInstructions,
                        }).map(ix => visit(ix, self)),
                    ]);

                    // Errors.
                    if (node.errors.length > 0) {
                        renders = addToRenderMap(renders, `errors.go`, {
                            content: render('errorsPage.njk', {
                                errors: node.errors,
                                imports: new ImportMap().toString(dependencyMap),
                                packageName: snakeCase(node.name),
                                program: node,
                            }),
                        });
                    }

                    // PDA find helpers.
                    if (pdaRegistry.entries.length > 0) {
                        const pdasImports = new ImportMap();
                        pdaRegistry.entries.forEach(entry => pdasImports.mergeWith(entry.imports));
                        renders = addToRenderMap(renders, `pdas.go`, {
                            content: render('pdasPage.njk', {
                                foreignPrograms: pdaRegistry.foreignPrograms,
                                imports: pdasImports.toString(dependencyMap),
                                packageName: snakeCase(node.name),
                                pdas: pdaRegistry.entries,
                                program: node,
                            }),
                        });
                    }

                    program = null;
                    return renders;
                },

                visitRoot(node, { self }) {
                    const programsToExport = getAllPrograms(node);
                    const accountsToExport = getAllAccounts(node);
                    const instructionsToExport = getAllInstructionsWithSubs(node, {
                        leavesOnly: !renderParentInstructions,
                    });
                    const definedTypesToExport = getAllDefinedTypes(node);
                    const hasAnythingToExport =
                        programsToExport.length > 0 ||
                        accountsToExport.length > 0 ||
                        instructionsToExport.length > 0 ||
                        definedTypesToExport.length > 0;

                    // Instructions DecodeInstruction can dispatch on, longest
                    // (offset + width) first so a short prefix never shadows a longer one.
                    const decodableInstructions = instructionsToExport
                        .flatMap(instruction => {
                            const discriminator = getInstructionDiscriminator(instruction);
                            return discriminator
                                ? [
                                      {
                                          bytes: discriminator.bytes,
                                          name: instruction.name,
                                          offset: discriminator.offset,
                                          varName: discriminator.varName,
                                      },
                                  ]
                                : [];
                        })
                        .sort(
                            (a, b) =>
                                b.offset + b.bytes.length - (a.offset + a.bytes.length) || a.name.localeCompare(b.name),
                        );
                    const singleUndiscriminatedInstruction =
                        instructionsToExport.length === 1 && decodableInstructions.length === 0
                            ? instructionsToExport[0]
                            : null;

                    if (instructionsToExport.length > 1) {
                        const decodableNames = new Set(decodableInstructions.map(i => i.name));
                        const undecodable = instructionsToExport.filter(i => !decodableNames.has(i.name));
                        if (undecodable.length > 0) {
                            logWarn(
                                `[Go] Instructions [${undecodable.map(i => i.name).join(', ')}] have no leading ` +
                                    'constant discriminator and cannot be decoded by DecodeInstruction.',
                            );
                        }
                    }
                    const seenDiscriminators = new Map<string, string>();
                    decodableInstructions.forEach(instruction => {
                        const key = `${instruction.offset}:${instruction.bytes.join(',')}`;
                        const previous = seenDiscriminators.get(key);
                        if (previous) {
                            logWarn(
                                `[Go] Instructions [${previous}] and [${instruction.name}] share the same ` +
                                    'discriminator; DecodeInstruction will always pick the former.',
                            );
                        } else {
                            seenDiscriminators.set(key, instruction.name);
                        }
                    });

                    const ctx = {
                        accountsToExport,
                        decodableInstructions,
                        definedTypesToExport,
                        hasAnythingToExport,
                        instructionsToExport,
                        packageName: programsToExport.length > 0 ? snakeCase(programsToExport[0].name) : 'generated',
                        programsToExport,
                        root: node,
                        singleUndiscriminatedInstruction,
                    };

                    return mergeRenderMaps([
                        createRenderMap({
                            ['instructions.go']: hasAnythingToExport
                                ? { content: render('instructionsMod.njk', ctx) }
                                : undefined,
                        }),
                        ...getAllPrograms(node).map(p => visit(p, self)),
                    ]);
                },
            }),
        v => recordNodeStackVisitor(v, stack),
        v => recordLinkablesOnFirstVisitVisitor(v, linkables),
    );
}

function getConflictsForInstructionAccountsAndArgs(instruction: InstructionNode): string[] {
    const allNames = [
        ...instruction.accounts.map(account => account.name),
        ...instruction.arguments.map(argument => argument.name),
    ];
    const duplicates = allNames.filter((e, i, a) => a.indexOf(e) !== i);
    return [...new Set(duplicates)];
}
