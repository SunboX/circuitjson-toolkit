import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
    BaselineProvenance,
    ImmutableBaselineWriter
} from './BaselineArtifacts.mjs'
import { JavaScriptEvidenceAnalyzer } from './JavaScriptEvidenceAnalyzer.mjs'
import { PublicContractExtractor } from './PublicContractExtractor.mjs'

const repositoryRoot = new URL('../', import.meta.url)
const BASELINE_VERSION = '1.0.17'
const IGNORED_CLASS_MEMBERS = new Set(['name', 'prototype'])
const LEGACY_EXPORTS = new Set([
    'CircuitJsonBomBuilder',
    'CircuitJsonElementValidator',
    'CircuitJsonManufacturingBuilder',
    'CircuitJsonManufacturingDownloadBuilder',
    'CircuitJsonParser',
    'CircuitJsonPcbClearanceDiagnostics',
    'CircuitJsonPcbCopperGeometry',
    'CircuitJsonPcbDrawingStyle',
    'CircuitJsonPcbHolePrimitiveModel',
    'CircuitJsonPcbNetMetadata',
    'CircuitJsonPcbPadPrimitiveModel',
    'CircuitJsonPcbPrimitiveArtwork',
    'CircuitJsonPcbPrimitiveAttributeRenderer',
    'CircuitJsonPcbPrimitiveBuilder',
    'CircuitJsonPcbPrimitiveFields',
    'CircuitJsonPcbPrimitiveGeometry',
    'CircuitJsonPcbPrimitiveGroups',
    'CircuitJsonPcbPrimitiveIndex',
    'CircuitJsonPcbPrimitiveOverlays',
    'CircuitJsonPcbSvgRenderer',
    'CircuitJsonPcbTraceLengthModel',
    'CircuitJsonPcbViaSvgRenderer',
    'CircuitJsonPcbZonePrimitiveBuilder',
    'CircuitJsonSchematicSvgArcPath',
    'CircuitJsonSchematicSvgPortMetadata',
    'CircuitJsonSchematicSvgPrimitiveAttributes',
    'CircuitJsonSchematicSvgRenderer',
    'CircuitJsonSchematicTableSvgRenderer',
    'CircuitJsonSourceMetadata',
    'CircuitJsonSupportMatrixBuilder',
    'PcbBoundsSelectionModel',
    'PcbCandidateSelectionModel',
    'PcbDiagnosticFocusModel',
    'PcbInteractionPrimitiveModel',
    'SelectedPartCircuitJsonExportAdapter',
    'SpiceCompatibilityPreprocessor',
    'SpiceSimulationService'
])
const RETAINED_ROOT_EXPORTS = new Set([
    'CircuitJsonDocument',
    'CircuitJsonIndexer',
    'CircuitJsonUnits'
])
const SHARED_AVAILABILITY = Object.freeze({
    'circuitjson-toolkit': 'shared',
    'gerber-toolkit': 'shared',
    'altium-toolkit': 'shared',
    'kicad-toolkit': 'shared'
})
const DERIVED_AVAILABILITY = Object.freeze({
    'circuitjson-toolkit': 'shared',
    'gerber-toolkit': 'derived',
    'altium-toolkit': 'derived',
    'kicad-toolkit': 'derived'
})
const CAPABILITY_POLICIES = Object.freeze({
    'parse.document': {
        replacement: 'circuitjson-toolkit/parser#Parser.parse()',
        availability: DERIVED_AVAILABILITY,
        reason: 'CircuitJSON parsing is source-neutral; source toolkits derive it after projection.',
        tests: ['tests/circuit-json-parser.test.mjs'],
        documentation: ['docs/api.md']
    },
    'validation.document': {
        replacement:
            'circuitjson-toolkit/parser#DocumentResult.createValidated()',
        availability: SHARED_AVAILABILITY,
        reason: 'CircuitJSON validation and prepared contexts are shared model operations.',
        tests: ['tests/circuit-json-document.test.mjs'],
        documentation: ['docs/api.md']
    },
    'query.document': {
        replacement: 'circuitjson-toolkit/query#QueryService.create()',
        availability: SHARED_AVAILABILITY,
        reason: 'Indexes and relationship queries operate only on neutral CircuitJSON.',
        tests: ['tests/circuit-json-indexer.test.mjs'],
        documentation: ['docs/api.md']
    },
    'units.convert': {
        replacement: 'circuitjson-toolkit#CircuitJsonUnits',
        availability: SHARED_AVAILABILITY,
        reason: 'Unit conversion is source-neutral and remains shared compatibility behavior.',
        tests: ['tests/circuit-json-document.test.mjs'],
        documentation: ['docs/api.md']
    },
    'metadata.normalize': {
        replacement: 'circuitjson-toolkit/parser#DocumentResult.create()',
        availability: DERIVED_AVAILABILITY,
        reason: 'Normalized source metadata is shared while source packages derive its values.',
        tests: ['tests/circuit-json-document.test.mjs'],
        documentation: ['docs/model-format.md']
    },
    'bom.build': {
        replacement: 'circuitjson-toolkit/renderers#BomTableRenderer.render()',
        availability: DERIVED_AVAILABILITY,
        reason: 'BOM rows derive from standard source-component elements.',
        tests: ['tests/circuit-json-document.test.mjs'],
        documentation: ['spec/library-scope.md']
    },
    'manufacturing.export': {
        replacement:
            'circuitjson-toolkit/manufacturing#ManufacturingService.export()',
        availability: DERIVED_AVAILABILITY,
        reason: 'Manufacturing outputs share a request contract and derive from standard elements.',
        tests: ['tests/circuit-json-manufacturing.test.mjs'],
        documentation: ['spec/library-scope.md']
    },
    'render.pcb': {
        replacement: 'circuitjson-toolkit/renderers#PcbSvgRenderer.render()',
        availability: DERIVED_AVAILABILITY,
        reason: 'PCB SVG rendering consumes standard CircuitJSON with source-derived fidelity.',
        tests: ['tests/circuitjson-variant-geometry.test.mjs'],
        documentation: ['docs/model-format.md']
    },
    'render.schematic': {
        replacement:
            'circuitjson-toolkit/renderers#SchematicSvgRenderer.render()',
        availability: DERIVED_AVAILABILITY,
        reason: 'Schematic SVG rendering consumes standard CircuitJSON.',
        tests: ['tests/api-entrypoints.test.mjs'],
        documentation: ['docs/model-format.md']
    },
    'interaction.pcb': {
        replacement:
            'circuitjson-toolkit/interaction#PcbInteractionIndex.create()',
        availability: DERIVED_AVAILABILITY,
        reason: 'PCB hit testing and selection derive from shared render primitives.',
        tests: ['tests/pcb-interaction-primitive-model.test.mjs'],
        documentation: ['docs/model-format.md']
    },
    'simulation.spice': {
        replacement: 'circuitjson-toolkit/simulation#SimulationService.run()',
        availability: DERIVED_AVAILABILITY,
        reason: 'Simulation uses a shared request/result contract with toolkit-specific engines.',
        tests: ['tests/spice-simulation-service.test.mjs'],
        documentation: ['docs/api.md']
    },
    'export.selected-part': {
        replacement:
            'circuitjson-toolkit/extensions#SelectedPartCircuitJsonExportAdapter',
        availability: DERIVED_AVAILABILITY,
        reason: 'Selected-part export adaptation operates on source-neutral CircuitJSON and is derived after source projection.',
        tests: ['tests/circuit-json-document.test.mjs'],
        documentation: ['spec/library-scope.md']
    }
})

const BEHAVIOR_FEATURES = [
    contractFeature(
        'parser rejects malformed JSON with SyntaxError',
        'behavior',
        'parse.document',
        'CircuitJsonParser'
    ),
    contractFeature(
        'parser rejects non-CircuitJSON JSON with TypeError',
        'behavior',
        'parse.document',
        'CircuitJsonParser'
    ),
    contractFeature(
        'validator rejects unknown element types',
        'behavior',
        'validation.document',
        'CircuitJsonElementValidator'
    ),
    contractFeature(
        'parser metadata survives structured cloning',
        'behavior',
        'parse.document',
        'CircuitJsonParser'
    ),
    contractFeature(
        'indexer builds deterministic type and id lookups',
        'behavior',
        'query.document',
        'CircuitJsonIndexer'
    ),
    contractFeature(
        'PCB renderer selects top or bottom side deterministically',
        'behavior',
        'render.pcb',
        'CircuitJsonPcbSvgRenderer'
    ),
    contractFeature(
        'SPICE simulation returns deterministic transient graph summaries',
        'behavior',
        'simulation.spice',
        'SpiceSimulationService'
    ),
    contractFeature(
        'manufacturing downloads reject unsupported formats',
        'behavior',
        'manufacturing.export',
        'CircuitJsonManufacturingDownloadBuilder'
    )
]

/**
 * Creates one explicitly tested observable behavior feature.
 * @param {string} feature Stable feature description.
 * @param {'behavior'} kind Feature kind.
 * @param {string} capabilityId Owning capability id.
 * @param {string} evidenceToken Symbol exercised by the evidence test.
 * @returns {Record<string, string>} Baseline feature.
 */
function contractFeature(feature, kind, capabilityId, evidenceToken) {
    return {
        feature,
        kind,
        capabilityId,
        evidenceToken
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
 * Returns the extension owner for a baseline feature, when applicable.
 * @param {Record<string, any>} feature Baseline feature.
 * @returns {string} Extension export name or an empty string.
 */
function extensionOwner(feature) {
    return LEGACY_EXPORTS.has(feature.exportName) ? feature.exportName : ''
}

/**
 * Returns the exact retained extension target for a historical source contract.
 * @param {Record<string, any>} feature Baseline feature.
 * @param {string} owner Historical export owner.
 * @returns {string} Exact extension replacement.
 */
function retainedReplacement(feature, owner, entrypoint = 'extensions') {
    if (!feature.methodName) {
        return `circuitjson-toolkit${entrypoint ? `/${entrypoint}` : ''}#${owner}`
    }
    const member =
        feature.methodType === 'instance'
            ? `prototype.${feature.methodName}()`
            : `${feature.methodName}()`
    return `circuitjson-toolkit${entrypoint ? `/${entrypoint}` : ''}#${owner}.${member}`
}

/**
 * Creates an explicit evidence-backed preservation mapping.
 * @param {Record<string, any>} feature Baseline feature.
 * @returns {Record<string, any>} Preservation mapping.
 */
function preservationMapping(feature) {
    const owner = extensionOwner(feature)
    if (owner) {
        const policy = CAPABILITY_POLICIES[feature.capabilityId]
        if (!policy) {
            throw new Error(
                `Missing preservation policy for ${feature.capabilityId}.`
            )
        }
        return {
            disposition: 'shared',
            replacement: retainedReplacement(feature, owner),
            availability: { ...policy.availability },
            reason: `${owner} remains an exact source-neutral compatibility contract; source toolkits share it directly or derive it after CircuitJSON projection.`,
            tests: ['tests/api-entrypoints.test.mjs'],
            documentation: ['docs/model-format.md']
        }
    }
    if (RETAINED_ROOT_EXPORTS.has(feature.exportName)) {
        const policy = CAPABILITY_POLICIES[feature.capabilityId]
        return {
            disposition: 'shared',
            replacement: retainedReplacement(feature, feature.exportName, ''),
            availability: { ...policy.availability },
            reason: `${feature.exportName} remains an exact deprecated root compatibility contract throughout 1.1.x.`,
            tests: ['tests/api-entrypoints.test.mjs'],
            documentation: ['docs/api.md']
        }
    }
    const policy = CAPABILITY_POLICIES[feature.capabilityId]
    if (!policy) {
        throw new Error(
            `Missing preservation policy for ${feature.capabilityId}.`
        )
    }
    return {
        disposition: 'shared',
        replacement: policy.replacement,
        availability: { ...policy.availability },
        reason: policy.reason,
        tests: [...policy.tests],
        documentation: [...policy.documentation]
    }
}

/**
 * Recursively reads repository-owned test sources for evidence discovery.
 * @param {URL} directory Current directory URL.
 * @param {string} relativeDirectory Repository-relative directory.
 * @returns {Promise<{ path: string, source: string }[]>} Test source records.
 */
async function readTestSources(directory, relativeDirectory = 'tests') {
    const records = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = `${relativeDirectory}/${entry.name}`
        const entryUrl = new URL(entry.name, directory)
        if (entry.isDirectory()) {
            records.push(
                ...(await readTestSources(
                    new URL(`${entry.name}/`, directory),
                    relativePath
                ))
            )
        } else if (entry.name.endsWith('.test.mjs')) {
            records.push({
                path: relativePath,
                source: await readFile(entryUrl, 'utf8')
            })
        }
    }
    return records.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Parses test sources once into semantic public-import evidence.
 * @param {{ path: string, source: string }[]} testSources Test source records.
 * @returns {Promise<{ path: string, references: Set<string>, executable: Set<string> }[]>} Semantic evidence records.
 */
async function analyzeTestSources(testSources) {
    const rootPath = fileURLToPath(repositoryRoot)
    return Promise.all(
        testSources.map(async (testSource) => ({
            path: testSource.path,
            ...(await JavaScriptEvidenceAnalyzer.analyze(testSource.source, {
                path: fileURLToPath(new URL(testSource.path, repositoryRoot)),
                repositoryRoot: rootPath
            }))
        }))
    )
}

/**
 * Finds repository tests with a semantically bound public symbol token.
 * @param {string} evidenceToken Public symbol token.
 * @param {'runtime-reference' | 'executable'} evidenceMode Evidence mode.
 * @param {{ path: string, references: Set<string>, executable: Set<string> }[]} testSources Test sources.
 * @returns {string[]} Matching repository-relative test paths.
 */
function evidenceTests(evidenceToken, evidenceMode, testSources) {
    return testSources
        .filter((testSource) =>
            (evidenceMode === 'executable'
                ? testSource.executable
                : testSource.references
            ).has(evidenceToken)
        )
        .map((testSource) => testSource.path)
}

/**
 * Returns the strict evidence mode for one feature kind.
 * @param {string} kind Feature kind.
 * @returns {'packed-contract' | 'runtime-reference' | 'executable'} Evidence mode.
 */
function evidenceMode(kind) {
    if (['export', 'method'].includes(kind)) return 'packed-contract'
    if (kind === 'behavior') return 'executable'
    return 'runtime-reference'
}

/**
 * Adds the complete preservation mapping to one baseline feature.
 * @param {Record<string, any>} feature Baseline feature.
 * @param {{ path: string, source: string }[]} testSources Test sources.
 * @returns {Record<string, any>} Mapped baseline feature.
 */
function mapFeature(feature, testSources) {
    const evidenceToken = feature.evidenceToken || feature.exportName
    const mode = evidenceMode(feature.kind)
    const mapping = preservationMapping(feature)
    const tests =
        mode === 'packed-contract'
            ? mapping.tests
            : evidenceTests(evidenceToken, mode, testSources)
    if (tests.length === 0) {
        throw new Error(
            `No repository test binds public symbol ${evidenceToken}.`
        )
    }
    return {
        ...feature,
        ...mapping,
        evidenceToken,
        evidenceMode: mode,
        tests
    }
}

/**
 * Creates the complete baseline feature-preservation ledger.
 * @param {Record<string, any>[]} features Baseline API features.
 * @returns {Record<string, any>[]} Ledger rows.
 */
function createLedger(features) {
    return features.map((feature) => ({
        package: `circuitjson-toolkit@${BASELINE_VERSION}`,
        feature: feature.feature,
        kind: feature.kind,
        capabilityId: feature.capabilityId,
        disposition: feature.disposition,
        replacement: feature.replacement,
        availability: feature.availability,
        reason: feature.reason,
        evidenceToken: feature.evidenceToken,
        evidenceMode: feature.evidenceMode,
        sourceContract: feature.sourceContract,
        tests: feature.tests,
        documentation: feature.documentation
    }))
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
    const [sourceContracts, rawTestSources] = await Promise.all([
        PublicContractExtractor.extract(repositoryRoot),
        readTestSources(new URL('tests/', repositoryRoot))
    ])
    const testSources = await analyzeTestSources(rawTestSources)
    const features = [
        ...sourceContracts.map((feature) => ({
            ...feature,
            capabilityId: capabilityForExport(feature.exportName)
        })),
        ...BEHAVIOR_FEATURES
    ]
        .map((feature) => mapFeature(feature, testSources))
        .sort((left, right) => left.feature.localeCompare(right.feature))
    const provenance = await BaselineProvenance.capture(repositoryRoot, {
        requireCurrentTree: true
    })
    const baseline = {
        schema: 'circuitjson-toolkit.api-baseline.v1',
        package: pkg.name,
        packageVersion: pkg.version,
        provenance,
        entrypoints,
        features
    }
    const ledger = createLedger(features)
    const provenanceArtifact = {
        schema: 'circuitjson-toolkit.baseline-provenance.v1',
        package: pkg.name,
        packageVersion: pkg.version,
        ...provenance
    }

    await ImmutableBaselineWriter.writeJson(
        new URL('spec/baseline-provenance-v1.0.17.json', repositoryRoot),
        provenanceArtifact
    )
    await ImmutableBaselineWriter.writeJson(
        new URL('spec/api-baseline-v1.0.17.json', repositoryRoot),
        baseline
    )
    await ImmutableBaselineWriter.writeJson(
        new URL('spec/feature-preservation.json', repositoryRoot),
        ledger
    )
    return { baseline, ledger }
}

/**
 * Regenerates mutable preservation mappings from the immutable captured contracts.
 * @returns {Promise<{ baseline: Record<string, any>, ledger: Record<string, any>[] }>} Synchronized artifacts.
 */
export async function synchronizeFeaturePreservation() {
    const baseline = await readJson('spec/api-baseline-v1.0.17.json')
    const testSources = await analyzeTestSources(
        await readTestSources(new URL('tests/', repositoryRoot))
    )
    const features = baseline.features
        .map((feature) => mapFeature(feature, testSources))
        .sort((left, right) => left.feature.localeCompare(right.feature))
    const synchronizedBaseline = { ...baseline, features }
    const ledger = createLedger(features)
    await Promise.all([
        writeCompactJson(
            new URL('spec/api-baseline-v1.0.17.json', repositoryRoot),
            synchronizedBaseline
        ),
        writeCompactJson(
            new URL('spec/feature-preservation.json', repositoryRoot),
            ledger
        )
    ])
    return { baseline: synchronizedBaseline, ledger }
}

/**
 * Writes deterministic compact JSON so generated catalogs obey the line cap.
 * @param {string | URL} path Output path.
 * @param {unknown} value JSON-compatible value.
 * @returns {Promise<void>}
 */
async function writeCompactJson(path, value) {
    await writeFile(path, JSON.stringify(value) + '\n', 'utf8')
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
