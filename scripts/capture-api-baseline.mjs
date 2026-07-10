import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { format } from 'prettier'

const repositoryRoot = new URL('../', import.meta.url)
const BASELINE_VERSION = '1.0.17'
const IGNORED_CLASS_MEMBERS = new Set(['length', 'name', 'prototype'])

const CONTRACT_FEATURES = [
    contractFeature(
        'CircuitJsonParser.parseText.options.fileName',
        'option',
        'parse.document'
    ),
    contractFeature(
        'CircuitJsonParser.parseBytes.options.fileName',
        'option',
        'parse.document'
    ),
    contractFeature(
        'CircuitJsonPcbSvgRenderer.render.options.side',
        'option',
        'render.pcb'
    ),
    contractFeature(
        'PcbBoundsSelectionModel.resolve.options.side',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'PcbBoundsSelectionModel.resolve.options.hiddenLayers',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'PcbBoundsSelectionModel.resolve.options.hiddenObjects',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'PcbInteractionPrimitiveModel.resolveSnapPoint.options.tolerance',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'PcbInteractionPrimitiveModel.hitTest.options.side',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'PcbInteractionPrimitiveModel.hitTest.options.hiddenLayers',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'PcbInteractionPrimitiveModel.hitTest.options.hiddenObjects',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'PcbInteractionPrimitiveModel.hitTest.options.tolerance',
        'option',
        'interaction.pcb'
    ),
    contractFeature(
        'CircuitJsonSourceMetadata.normalizeSourceNetName.options.fallback',
        'option',
        'metadata.normalize'
    ),
    contractFeature(
        'CircuitJsonSourceMetadata.normalizeSourceNetName.options.usedNames',
        'option',
        'metadata.normalize'
    ),
    contractFeature(
        'CircuitJsonSourceMetadata.normalizeSourcePortName.options.fallback',
        'option',
        'metadata.normalize'
    ),
    contractFeature(
        'CircuitJsonSourceMetadata.normalizeSourcePortName.options.usedNames',
        'option',
        'metadata.normalize'
    ),
    contractFeature(
        'CircuitJsonSchematicSvgPrimitiveAttributes.attributes.options.fill',
        'option',
        'render.schematic'
    ),
    contractFeature(
        'SpiceSimulationService.constructor.dependencies.engine',
        'option',
        'simulation.spice'
    ),
    contractFeature('parserResult.fileName', 'field', 'parse.document'),
    contractFeature('parserResult.fileType', 'field', 'parse.document'),
    contractFeature('parserResult.kind', 'field', 'parse.document'),
    contractFeature('parserResult.sourceFormat', 'field', 'parse.document'),
    contractFeature('indexResult.elements', 'field', 'query.document'),
    contractFeature('indexResult.elementsByType', 'field', 'query.document'),
    contractFeature('indexResult.elementsById', 'field', 'query.document'),
    contractFeature(
        'indexResult.sourceComponentById',
        'field',
        'query.document'
    ),
    contractFeature('indexResult.pcbComponentById', 'field', 'query.document'),
    contractFeature(
        'simulationResult.simulationResultCircuitJson',
        'field',
        'simulation.spice'
    ),
    contractFeature(
        'simulationResult.simulationCircuitJson',
        'field',
        'simulation.spice'
    ),
    contractFeature(
        'simulationResult.graphSummary',
        'field',
        'simulation.spice'
    ),
    contractFeature(
        'simulationResult.diagnostics',
        'field',
        'simulation.spice'
    ),
    contractFeature(
        'parser rejects malformed JSON with SyntaxError',
        'behavior',
        'parse.document'
    ),
    contractFeature(
        'parser rejects non-CircuitJSON JSON with TypeError',
        'behavior',
        'parse.document'
    ),
    contractFeature(
        'validator rejects unknown element types',
        'behavior',
        'validation.document'
    ),
    contractFeature(
        'parser metadata survives structured cloning',
        'behavior',
        'parse.document'
    ),
    contractFeature(
        'indexer builds deterministic type and id lookups',
        'behavior',
        'query.document'
    ),
    contractFeature(
        'PCB renderer selects top or bottom side deterministically',
        'behavior',
        'render.pcb'
    ),
    contractFeature(
        'SPICE simulation returns deterministic transient graph summaries',
        'behavior',
        'simulation.spice'
    ),
    contractFeature(
        'manufacturing downloads reject unsupported formats',
        'behavior',
        'manufacturing.export'
    )
]

/**
 * Creates one manually documented API contract feature.
 * @param {string} feature Stable feature description.
 * @param {'option' | 'field' | 'behavior'} kind Feature kind.
 * @param {string} capabilityId Owning capability id.
 * @returns {Record<string, string>} Baseline feature.
 */
function contractFeature(feature, kind, capabilityId) {
    return {
        feature,
        kind,
        capabilityId
    }
}

/**
 * Reads JSON relative to the repository root.
 * @param {string} relativePath Repository-relative path.
 * @returns {Promise<Record<string, any>>} Parsed object.
 */
async function readJson(relativePath) {
    return JSON.parse(
        await readFile(new URL(relativePath, repositoryRoot), 'utf8')
    )
}

/**
 * Writes deterministic JSON relative to the repository root.
 * @param {string} relativePath Repository-relative path.
 * @param {unknown} value JSON value.
 * @returns {Promise<void>}
 */
async function writeJson(relativePath, value) {
    const serialized = await format(JSON.stringify(value), {
        parser: 'json',
        tabWidth: 4,
        singleQuote: true,
        semi: false,
        trailingComma: 'none'
    })
    await writeFile(new URL(relativePath, repositoryRoot), serialized)
}

/**
 * Returns the import target for one package export definition.
 * @param {string | Record<string, string>} definition Export definition.
 * @returns {string} Relative module target.
 */
function exportTarget(definition) {
    if (typeof definition === 'string') {
        return definition
    }

    const target = definition?.import || definition?.default
    if (typeof target !== 'string') {
        throw new Error('Package export does not define an import target.')
    }
    return target
}

/**
 * Lists public static members on an exported class or function.
 * @param {unknown} value Exported value.
 * @returns {string[]} Sorted member names.
 */
function staticMethods(value) {
    if (typeof value !== 'function') {
        return []
    }
    return Object.getOwnPropertyNames(value)
        .filter(
            (member) =>
                !IGNORED_CLASS_MEMBERS.has(member) &&
                typeof value[member] === 'function'
        )
        .sort()
}

/**
 * Lists public instance members on an exported class.
 * @param {unknown} value Exported value.
 * @returns {string[]} Sorted member names.
 */
function instanceMethods(value) {
    if (typeof value !== 'function' || !value.prototype) {
        return []
    }
    return Object.getOwnPropertyNames(value.prototype)
        .filter(
            (member) =>
                member !== 'constructor' &&
                typeof value.prototype[member] === 'function'
        )
        .sort()
}

/**
 * Maps one baseline export to its stable shared capability group.
 * @param {string} exportName Exported symbol name.
 * @returns {string} Capability id.
 */
function capabilityForExport(exportName) {
    if (exportName.includes('Spice')) return 'simulation.spice'
    if (exportName.includes('Manufacturing')) return 'manufacturing.export'
    if (exportName.includes('Bom')) return 'bom.build'
    if (exportName.includes('Parser')) return 'parse.document'
    if (exportName.includes('Document') || exportName.includes('Validator')) {
        return 'validation.document'
    }
    if (exportName.includes('Indexer')) return 'query.document'
    if (exportName.includes('Units')) return 'units.convert'
    if (
        exportName.includes('SourceMetadata') ||
        exportName.includes('SupportMatrix')
    ) {
        return 'metadata.normalize'
    }
    if (exportName.includes('Schematic')) return 'render.schematic'
    if (exportName.includes('SelectedPart')) return 'export.selected-part'
    if (
        exportName.includes('Interaction') ||
        exportName.includes('Candidate') ||
        exportName.includes('DiagnosticFocus') ||
        exportName.includes('BoundsSelection')
    ) {
        return 'interaction.pcb'
    }
    return 'render.pcb'
}

/**
 * Captures exports and callable members from one entrypoint.
 * @param {string} entrypoint Package export key.
 * @param {string | Record<string, string>} definition Package export definition.
 * @returns {Promise<Record<string, any>>} Entrypoint baseline.
 */
async function captureEntrypoint(entrypoint, definition) {
    const target = exportTarget(definition)
    const api = await import(new URL(target, repositoryRoot))
    const exports = Object.keys(api)
        .sort()
        .map((name) => ({
            name,
            type: typeof api[name],
            staticMethods: staticMethods(api[name]),
            instanceMethods: instanceMethods(api[name])
        }))

    return { entrypoint, target, exports }
}

/**
 * Flattens captured entrypoints into preservation-ledger features.
 * @param {Record<string, any>[]} entrypoints Entrypoint baselines.
 * @returns {Record<string, any>[]} Flat public API features.
 */
function flattenEntrypoints(entrypoints) {
    const features = []
    for (const entrypoint of entrypoints) {
        for (const exported of entrypoint.exports) {
            const capabilityId = capabilityForExport(exported.name)
            features.push({
                feature: `${entrypoint.entrypoint}#${exported.name}`,
                kind: 'export',
                capabilityId,
                entrypoint: entrypoint.entrypoint,
                exportName: exported.name
            })
            for (const methodName of exported.staticMethods) {
                features.push({
                    feature: `${entrypoint.entrypoint}#${exported.name}.${methodName}()`,
                    kind: 'method',
                    capabilityId,
                    entrypoint: entrypoint.entrypoint,
                    exportName: exported.name,
                    methodName,
                    methodType: 'static'
                })
            }
            for (const methodName of exported.instanceMethods) {
                features.push({
                    feature: `${entrypoint.entrypoint}#${exported.name}.prototype.${methodName}()`,
                    kind: 'method',
                    capabilityId,
                    entrypoint: entrypoint.entrypoint,
                    exportName: exported.name,
                    methodName,
                    methodType: 'instance'
                })
            }
        }
    }
    return features
}

/**
 * Returns existing evidence paths for a feature category.
 * @param {string} capabilityId Capability id.
 * @returns {{ tests: string[], documentation: string[] }} Evidence paths.
 */
function evidenceForCapability(capabilityId) {
    if (capabilityId === 'simulation.spice') {
        return {
            tests: ['tests/spice-simulation-service.test.mjs'],
            documentation: ['docs/api.md']
        }
    }
    if (capabilityId.startsWith('render.')) {
        return {
            tests: ['tests/api-entrypoints.test.mjs'],
            documentation: ['docs/model-format.md']
        }
    }
    if (capabilityId === 'interaction.pcb') {
        return {
            tests: ['tests/pcb-interaction-primitive-model.test.mjs'],
            documentation: ['docs/model-format.md']
        }
    }
    if (capabilityId === 'manufacturing.export') {
        return {
            tests: ['tests/circuit-json-manufacturing.test.mjs'],
            documentation: ['spec/library-scope.md']
        }
    }
    return {
        tests: ['tests/api-entrypoints.test.mjs'],
        documentation: ['docs/api.md']
    }
}

/**
 * Creates the complete baseline feature-preservation ledger.
 * @param {Record<string, any>[]} features Baseline API features.
 * @returns {Record<string, any>[]} Ledger rows.
 */
function createLedger(features) {
    return features.map((feature) => {
        const evidence = evidenceForCapability(feature.capabilityId)
        return {
            package: `circuitjson-toolkit@${BASELINE_VERSION}`,
            feature: feature.feature,
            kind: feature.kind,
            capabilityId: feature.capabilityId,
            disposition: 'shared',
            replacement: `circuitjson-toolkit baseline ${feature.feature}`,
            availability: {
                'circuitjson-toolkit': 'shared',
                'gerber-toolkit': 'shared',
                'altium-toolkit': 'shared',
                'kicad-toolkit': 'shared'
            },
            reason: 'Frozen for explicit preservation during API convergence.',
            tests: evidence.tests,
            documentation: evidence.documentation
        }
    })
}

/**
 * Captures the immutable 1.0.17 API and feature-preservation baselines.
 * @returns {Promise<{ baseline: Record<string, any>, ledger: Record<string, any>[] }>} Written artifacts.
 */
export async function captureApiBaseline() {
    const pkg = await readJson('package.json')
    if (pkg.version !== BASELINE_VERSION) {
        throw new Error(
            `API baseline capture requires package version ${BASELINE_VERSION}.`
        )
    }

    const entrypoints = await Promise.all(
        Object.entries(pkg.exports)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([entrypoint, definition]) =>
                captureEntrypoint(entrypoint, definition)
            )
    )
    const features = [
        ...flattenEntrypoints(entrypoints),
        ...CONTRACT_FEATURES
    ].sort((left, right) => left.feature.localeCompare(right.feature))
    const baseline = {
        schema: 'circuitjson-toolkit.api-baseline.v1',
        package: pkg.name,
        packageVersion: pkg.version,
        entrypoints,
        features
    }
    const ledger = createLedger(features)

    await writeJson('spec/api-baseline-v1.0.17.json', baseline)
    await writeJson('spec/feature-preservation.json', ledger)
    return { baseline, ledger }
}

/**
 * Returns whether this module is the active Node entry script.
 * @returns {boolean} True for direct command-line execution.
 */
function isMain() {
    return Boolean(
        process.argv[1] &&
        pathToFileURL(process.argv[1]).href === import.meta.url
    )
}

if (isMain()) {
    await captureApiBaseline()
}
