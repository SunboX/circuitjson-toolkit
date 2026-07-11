import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'

import { JavaScriptEvidenceAnalyzer } from './JavaScriptEvidenceAnalyzer.mjs'
import { BaselineProvenance } from './BaselineArtifacts.mjs'

const execFileAsync = promisify(execFile)

const ALLOWED_DISPOSITIONS = new Set([
    'shared',
    'native-extension',
    'unavailable'
])
const ALLOWED_AVAILABILITY = new Set([
    'native',
    'shared',
    'derived',
    'unavailable'
])
const TOOLKIT_NAMES = [
    'altium-toolkit',
    'circuitjson-toolkit',
    'gerber-toolkit',
    'kicad-toolkit'
]
const EVIDENCE_MODES = new Set([
    'packed-contract',
    'runtime-reference',
    'executable'
])
const REPLACEMENT_PATTERN =
    /^(circuitjson-toolkit(?:\/(?:parser|project|renderers|interaction|query|manufacturing|simulation|scene3d|capabilities|extensions|testing|workers\/parser\.worker\.mjs))?)#([A-Za-z_$][\w$]*)(?:\.(prototype\.)?([A-Za-z_$][\w$]*)\(\))?$/u
const MAPPING_FIELDS = [
    'feature',
    'kind',
    'capabilityId',
    'disposition',
    'replacement',
    'availability',
    'reason',
    'evidenceToken',
    'evidenceMode',
    'sourceContract',
    'tests',
    'documentation'
]
const HISTORICAL_FEATURE_COUNT = 1207
const HISTORICAL_INVENTORY_CHECKSUM =
    'f1f8243cc977089e2ede533d9c13866568d56f21739a7c8c71ddbbc3b25658f8'

/**
 * Selects the immutable source-contract portion of one historical baseline.
 * Mapping decisions intentionally remain outside this pin so they can become
 * more accurate without allowing source inventory deletion.
 * @param {Record<string, any>} apiBaseline Historical API baseline.
 * @returns {Record<string, any>} Canonical immutable inventory.
 */
function historicalInventory(apiBaseline) {
    return {
        entrypoints: apiBaseline.entrypoints,
        features: (apiBaseline.features || []).map((row) => ({
            feature: row.feature,
            kind: row.kind,
            entrypoint: row.entrypoint ?? null,
            exportName: row.exportName ?? null,
            methodName: row.methodName ?? null,
            methodType: row.methodType ?? null,
            sourceContract: row.sourceContract ?? null,
            evidenceToken: row.kind === 'behavior' ? row.evidenceToken : null
        }))
    }
}

/**
 * Verifies the exact historical inventory against a source-independent pin.
 * @param {Record<string, any>} apiBaseline Historical API baseline.
 * @param {string} repositoryRoot Git repository root.
 * @returns {Promise<void>}
 */
async function validateHistoricalInventory(apiBaseline, repositoryRoot) {
    if (
        apiBaseline.package !== 'circuitjson-toolkit' ||
        apiBaseline.packageVersion !== '1.0.17'
    ) {
        return
    }
    const provenance = await BaselineProvenance.capture(repositoryRoot)
    const inventory = historicalInventory(apiBaseline)
    const checksum = createHash('sha256')
        .update(JSON.stringify(inventory))
        .digest('hex')
    if (
        inventory.features.length !== HISTORICAL_FEATURE_COUNT ||
        checksum !== HISTORICAL_INVENTORY_CHECKSUM ||
        !isDeepStrictEqual(apiBaseline.provenance, provenance)
    ) {
        throw new Error(
            'The immutable historical API inventory differs from the approved v1.0.17 source contract.'
        )
    }
}

/**
 * Packs and extracts a repository into a temporary package root.
 * @param {string} repositoryRoot Repository to pack.
 * @returns {Promise<{ packageRoot: string, cleanup: () => Promise<void> }>} Extracted package and cleanup callback.
 */
async function packRepository(repositoryRoot) {
    const temporaryRoot = await mkdtemp(
        join(tmpdir(), 'circuitjson-feature-pack-')
    )
    try {
        const { stdout } = await execFileAsync(
            'npm',
            ['pack', '--json', '--pack-destination', temporaryRoot],
            {
                cwd: repositoryRoot,
                maxBuffer: 10 * 1024 * 1024
            }
        )
        const result = JSON.parse(stdout)
        const filename = result?.[0]?.filename
        if (!isNonEmptyString(filename)) {
            throw new Error('npm pack did not report a tarball filename.')
        }
        await execFileAsync(
            'tar',
            ['-xzf', join(temporaryRoot, filename), '-C', temporaryRoot],
            { maxBuffer: 10 * 1024 * 1024 }
        )
        return {
            packageRoot: join(temporaryRoot, 'package'),
            cleanup: () => rm(temporaryRoot, { recursive: true, force: true })
        }
    } catch (error) {
        await rm(temporaryRoot, { recursive: true, force: true })
        throw error
    }
}

/**
 * Imports every captured entrypoint from an extracted package root.
 * @param {Record<string, any>} apiBaseline API baseline.
 * @param {string} packageRoot Extracted package directory.
 * @returns {Promise<Map<string, Record<string, any>>>} Imported entrypoints.
 */
async function importPackedEntrypoints(apiBaseline, packageRoot) {
    if (!isNonEmptyString(packageRoot)) {
        throw new Error(
            'Strict feature validation requires a packed package root.'
        )
    }

    let entrypoints = apiBaseline.entrypoints || []
    try {
        const pkg = JSON.parse(
            await readFile(resolve(packageRoot, 'package.json'), 'utf8')
        )
        entrypoints = Object.entries(pkg.exports || {})
            .map(([entrypoint, definition]) => ({
                entrypoint,
                target: packedExportTarget(definition)
            }))
            .filter((entrypoint) => /\.(?:c|m)?js$/u.test(entrypoint.target))
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }

    const modules = new Map()
    for (const entrypoint of entrypoints) {
        const moduleUrl = pathToFileURL(
            resolve(packageRoot, entrypoint.target)
        ).href
        modules.set(entrypoint.entrypoint, await import(moduleUrl))
    }
    return modules
}

/**
 * Resolves one JavaScript target from a package export definition.
 * @param {string | Record<string, string>} definition Package export definition.
 * @returns {string} Relative package target.
 */
function packedExportTarget(definition) {
    if (typeof definition === 'string') return definition
    const target = definition?.import || definition?.default
    if (!isNonEmptyString(target)) {
        throw new Error('Packed package export has no import target.')
    }
    return target
}

/**
 * Returns whether one exported API feature still exists in packed modules.
 * @param {Record<string, any>} feature Baseline feature.
 * @param {Map<string, Record<string, any>>} modules Imported entrypoints.
 * @returns {boolean} True when the packed API still exposes the feature.
 */
function packedFeatureExists(feature, modules) {
    if (!['export', 'method'].includes(feature.kind)) {
        return true
    }
    const candidates = []
    const original = modules.get(feature.entrypoint)
    if (original) candidates.push(original)
    for (const module of modules.values()) {
        if (module !== original) candidates.push(module)
    }
    return candidates.some((module) => {
        const exported = module?.[feature.exportName]
        if (feature.kind === 'export') return exported !== undefined
        if (feature.methodType === 'instance') {
            return (
                typeof exported?.prototype?.[feature.methodName] === 'function'
            )
        }
        return typeof exported?.[feature.methodName] === 'function'
    })
}

/**
 * Verifies that frozen exports and methods still resolve from packed modules.
 * @param {Record<string, any>} apiBaseline API baseline.
 * @param {Map<string, Record<string, any>>} modules Imported entrypoints.
 * @returns {void}
 */
function validatePackedApi(apiBaseline, modules) {
    const stale = (apiBaseline.features || [])
        .filter((feature) => !packedFeatureExists(feature, modules))
        .map((feature) => feature.feature)
    if (stale.length > 0) {
        throw new Error(`Stale packed API features: ${stale.join(', ')}`)
    }
}

/**
 * Verifies exact replacement grammar and resolves every target in package modules.
 * @param {Record<string, any>[]} ledger Preservation ledger.
 * @param {Map<string, Record<string, any>>} modules Imported package entrypoints.
 * @returns {void}
 */
export function validateReplacementTargets(ledger, modules) {
    for (const row of ledger) {
        const match = REPLACEMENT_PATTERN.exec(row.replacement)
        if (!match) {
            throw new Error(
                `Invalid replacement target for ${row.feature}: ${row.replacement}`
            )
        }
        const [, packageSpecifier, exportName, prototypeMarker, methodName] =
            match
        const entrypoint =
            packageSpecifier === 'circuitjson-toolkit'
                ? '.'
                : `./${packageSpecifier.slice('circuitjson-toolkit/'.length)}`
        const exported = modules.get(entrypoint)?.[exportName]
        if (exported === undefined) {
            throw new Error(
                `Replacement export does not exist in the packed package: ${row.replacement}`
            )
        }
        if (!methodName) continue
        const owner = prototypeMarker ? exported?.prototype : exported
        if (typeof owner?.[methodName] !== 'function') {
            throw new Error(
                `Replacement method does not exist in the packed package: ${row.replacement}`
            )
        }
    }
}

/**
 * Validates ledger capability ids against a packed capability inventory.
 * @param {Record<string, any>[]} ledger Preservation ledger.
 * @param {Map<string, Record<string, any>>} modules Imported entrypoints.
 * @returns {void}
 */
function validateCapabilities(ledger, modules) {
    const toolkit = [...modules.values()].find(
        (module) => typeof module.ToolkitCapabilities?.inventory === 'function'
    )
    if (!toolkit) {
        throw new Error(
            'Packed entrypoints do not export ToolkitCapabilities.inventory().'
        )
    }

    const inventory = toolkit.ToolkitCapabilities.inventory()
    const inventoryRows = Array.isArray(inventory) ? inventory : []
    const duplicateInventory = duplicateValues(
        inventoryRows.map((row) => row.id)
    )
    if (duplicateInventory.length > 0) {
        throw new Error(
            `Duplicate capability inventory ids: ${duplicateInventory.join(', ')}`
        )
    }
    const inventoryById = new Map(inventoryRows.map((row) => [row.id, row]))
    const fictitious = [
        ...new Set(
            ledger
                .map((row) => row.capabilityId)
                .filter((capabilityId) => !inventoryById.has(capabilityId))
        )
    ]
    if (fictitious.length > 0) {
        throw new Error(
            `Fictitious capabilityId mappings: ${fictitious.join(', ')}`
        )
    }
    const identityMismatch = ledger.find((row) => {
        const capability = inventoryById.get(row.capabilityId)
        return (
            `${String(capability.category)}.${String(capability.operation)}` !==
            row.capabilityId
        )
    })
    if (identityMismatch) {
        throw new Error(
            `Capability inventory identity mismatch: ${identityMismatch.capabilityId}`
        )
    }
}

/**
 * Verifies every referenced test and documentation path exists.
 * @param {Record<string, any>[]} ledger Preservation ledger.
 * @param {string} repositoryRoot Repository root.
 * @param {Record<string, any>} apiBaseline Captured API baseline.
 * @returns {Promise<void>}
 */
async function validateEvidencePaths(ledger, repositoryRoot, apiBaseline) {
    const paths = [
        ...new Set(
            ledger.flatMap((row) => [...row.tests, ...row.documentation])
        )
    ]
    const absoluteRepositoryRoot = resolve(repositoryRoot)
    const realRepositoryRoot = await realpath(absoluteRepositoryRoot)
    const resolvedPaths = new Map()
    const missing = []
    for (const path of paths) {
        const candidate = resolve(absoluteRepositoryRoot, path)
        assertEvidencePathInside(absoluteRepositoryRoot, candidate, path)
        try {
            const realCandidate = await realpath(candidate)
            assertEvidencePathInside(realRepositoryRoot, realCandidate, path)
            resolvedPaths.set(path, realCandidate)
        } catch {
            missing.push(path)
        }
    }
    if (missing.length > 0) {
        throw new Error(`Missing evidence paths: ${missing.join(', ')}`)
    }

    const allowedTargets = await evidenceModuleTargets(
        apiBaseline,
        realRepositoryRoot
    )
    const testEvidence = new Map()
    for (const row of ledger) {
        if (row.evidenceMode === 'packed-contract') continue
        const referencesSymbol = await Promise.all(
            row.tests.map(async (path) => {
                if (!testEvidence.has(path)) {
                    testEvidence.set(
                        path,
                        await JavaScriptEvidenceAnalyzer.analyze(
                            await readFile(resolvedPaths.get(path), 'utf8'),
                            {
                                path: resolvedPaths.get(path),
                                repositoryRoot: realRepositoryRoot,
                                allowedTargets
                            }
                        )
                    )
                }
                const evidence = testEvidence.get(path)
                const tokens =
                    row.evidenceMode === 'executable'
                        ? evidence.executable
                        : evidence.references
                return tokens.has(row.evidenceToken)
            })
        )
        if (!referencesSymbol.some(Boolean)) {
            throw new Error(
                `Evidence tests do not bind ${row.evidenceToken} for ${row.feature}`
            )
        }
    }
}

/**
 * Rejects lexical and real evidence paths outside the selected repository.
 * @param {string} repositoryRoot Absolute repository root.
 * @param {string} candidate Absolute candidate path.
 * @param {string} evidencePath User-provided repository-relative path.
 * @returns {void}
 */
function assertEvidencePathInside(repositoryRoot, candidate, evidencePath) {
    const relationship = relative(repositoryRoot, candidate)
    if (
        relationship === '..' ||
        relationship.startsWith(`..${sep}`) ||
        isAbsolute(relationship)
    ) {
        throw new Error(`Evidence path escapes repository: ${evidencePath}`)
    }
}

/**
 * Resolves captured package entrypoint targets for semantic import evidence.
 * @param {Record<string, any>} apiBaseline Captured API baseline.
 * @param {string} repositoryRoot Canonical repository root.
 * @returns {Promise<Set<string>>} Canonical allowed target paths.
 */
async function evidenceModuleTargets(apiBaseline, repositoryRoot) {
    const targets = new Set()
    for (const entrypoint of apiBaseline.entrypoints || []) {
        try {
            targets.add(
                await realpath(resolve(repositoryRoot, entrypoint.target))
            )
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
    }
    return targets
}

/**
 * Returns whether a value is a non-empty string.
 * @param {unknown} value Candidate value.
 * @returns {boolean} True for non-empty strings.
 */
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0
}

/**
 * Returns whether a value is a non-empty array of non-empty strings.
 * @param {unknown} value Candidate value.
 * @returns {boolean} True for complete path arrays.
 */
function isNonEmptyStringArray(value) {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((entry) => isNonEmptyString(entry))
    )
}

/**
 * Returns whether availability has every known toolkit and only allowed values.
 * @param {unknown} value Availability candidate.
 * @returns {boolean} True for the exact availability contract.
 */
function isValidAvailability(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false
    }
    const keys = Object.keys(value).sort()
    return (
        isDeepStrictEqual(keys, TOOLKIT_NAMES) &&
        keys.every((key) => ALLOWED_AVAILABILITY.has(value[key]))
    )
}

/**
 * Returns whether a feature has a complete preservation mapping.
 * @param {Record<string, any>} row Feature or ledger row.
 * @returns {boolean} True for a complete mapping.
 */
function isCompleteMapping(row) {
    return (
        isNonEmptyString(row.feature) &&
        ['export', 'method', 'option', 'field', 'behavior'].includes(
            row.kind
        ) &&
        isNonEmptyString(row.capabilityId) &&
        ALLOWED_DISPOSITIONS.has(row.disposition) &&
        isNonEmptyString(row.replacement) &&
        isValidAvailability(row.availability) &&
        isNonEmptyString(row.reason) &&
        isNonEmptyString(row.evidenceToken) &&
        EVIDENCE_MODES.has(row.evidenceMode) &&
        row.evidenceMode === expectedEvidenceMode(row.kind) &&
        isNonEmptyStringArray(row.tests) &&
        isNonEmptyStringArray(row.documentation)
    )
}

/**
 * Returns the required evidence mode for one feature kind.
 * @param {string} kind Feature kind.
 * @returns {'packed-contract' | 'runtime-reference' | 'executable'} Evidence mode.
 */
function expectedEvidenceMode(kind) {
    if (['export', 'method'].includes(kind)) return 'packed-contract'
    if (kind === 'behavior') return 'executable'
    return 'runtime-reference'
}

/**
 * Returns whether a ledger row has the required preservation decision fields.
 * @param {Record<string, any>} row Ledger row.
 * @returns {boolean} True for a complete row.
 */
function isCompleteRow(row) {
    return isNonEmptyString(row.package) && isCompleteMapping(row)
}

/**
 * Returns duplicate non-empty values from a sequence.
 * @param {unknown[]} values Candidate values.
 * @returns {string[]} Unique duplicate strings.
 */
function duplicateValues(values) {
    const seen = new Set()
    const duplicates = new Set()
    for (const value of values) {
        const normalized = String(value || '')
        if (seen.has(normalized)) duplicates.add(normalized)
        seen.add(normalized)
    }
    return [...duplicates].filter(Boolean)
}

/**
 * Selects the exact fields shared by API features and ledger rows.
 * @param {Record<string, any>} row Feature or ledger row.
 * @returns {Record<string, any>} Comparable mapping.
 */
function featureMapping(row) {
    return Object.fromEntries(
        MAPPING_FIELDS.map((field) => [field, row[field]])
    )
}

/**
 * Validates that every frozen API feature has a preservation-ledger mapping.
 * @param {{ apiBaseline: Record<string, any>, ledger: Record<string, any>[], strict?: boolean, packageRoot?: string, repositoryRoot?: string }} options Validation inputs.
 * @returns {Promise<{ featureCount: number }>} Validation summary.
 */
export async function validateFeaturePreservation(options) {
    const baselineFeatures = Array.isArray(options.apiBaseline?.features)
        ? options.apiBaseline.features
        : []
    const ledger = Array.isArray(options.ledger) ? options.ledger : []
    const duplicateBaseline = duplicateValues(
        baselineFeatures.map((feature) => feature.feature)
    )
    if (duplicateBaseline.length > 0) {
        throw new Error(
            `Duplicate baseline features: ${duplicateBaseline.join(', ')}`
        )
    }
    const duplicateLedger = duplicateValues(ledger.map((row) => row.feature))
    if (duplicateLedger.length > 0) {
        throw new Error(
            `Duplicate ledger features: ${duplicateLedger.join(', ')}`
        )
    }
    const ledgerFeatures = new Set(ledger.map((row) => row.feature))
    const baselineFeatureNames = new Set(
        baselineFeatures.map((feature) => feature.feature)
    )
    const missing = baselineFeatures
        .map((feature) => feature.feature)
        .filter((feature) => !ledgerFeatures.has(feature))

    if (missing.length > 0) {
        throw new Error(
            `Missing feature-preservation mappings: ${missing.join(', ')}`
        )
    }
    const stale = ledger
        .map((row) => row.feature)
        .filter((feature) => !baselineFeatureNames.has(feature))
    if (stale.length > 0) {
        throw new Error(
            `Stale feature-preservation mappings: ${stale.join(', ')}`
        )
    }
    const invalidFeature = baselineFeatures.find(
        (feature) => !isCompleteMapping(feature)
    )
    if (invalidFeature) {
        throw new Error(
            `Invalid API baseline feature for ${String(invalidFeature.feature)}`
        )
    }
    const invalidRow = ledger.find((row) => !isCompleteRow(row))
    if (invalidRow) {
        throw new Error(
            `Invalid feature-preservation row for ${String(invalidRow.feature)}`
        )
    }
    const ledgerByFeature = new Map(ledger.map((row) => [row.feature, row]))
    const mismatch = baselineFeatures.find((feature) => {
        const row = ledgerByFeature.get(feature.feature)
        return !isDeepStrictEqual(featureMapping(feature), featureMapping(row))
    })
    if (mismatch) {
        throw new Error(
            `Baseline and ledger mapping differ for ${mismatch.feature}`
        )
    }
    if (
        isNonEmptyString(options.apiBaseline.package) &&
        isNonEmptyString(options.apiBaseline.packageVersion)
    ) {
        const expectedPackage = `${options.apiBaseline.package}@${options.apiBaseline.packageVersion}`
        const wrongPackage = ledger.find(
            (row) => row.package !== expectedPackage
        )
        if (wrongPackage) {
            throw new Error(
                `Baseline and ledger package differ for ${wrongPackage.feature}`
            )
        }
    }
    if (options.strict) {
        const modules = await importPackedEntrypoints(
            options.apiBaseline,
            options.packageRoot
        )
        validatePackedApi(options.apiBaseline, modules)
        validateReplacementTargets(ledger, modules)
        validateCapabilities(ledger, modules)
        await validateEvidencePaths(
            ledger,
            resolve(options.repositoryRoot || process.cwd()),
            options.apiBaseline
        )
    }
    return { featureCount: baselineFeatures.length }
}

/**
 * Loads baseline artifacts and runs feature-preservation validation.
 * @param {{ apiPath?: string, ledgerPath?: string, strict?: boolean, packageRoot?: string, repositoryRoot?: string }} options File-backed validation options.
 * @returns {Promise<{ featureCount: number }>} Validation summary.
 */
export async function checkFeaturePreservation(options = {}) {
    const repositoryRoot = resolve(options.repositoryRoot || process.cwd())
    const apiPath = resolve(
        repositoryRoot,
        options.apiPath || 'spec/api-baseline-v1.0.17.json'
    )
    const ledgerPath = resolve(
        repositoryRoot,
        options.ledgerPath || 'spec/feature-preservation.json'
    )
    const [apiBaseline, ledger] = await Promise.all(
        [apiPath, ledgerPath].map(async (path) =>
            JSON.parse(await readFile(path, 'utf8'))
        )
    )
    await validateHistoricalInventory(apiBaseline, repositoryRoot)
    const packed =
        options.strict && !options.packageRoot
            ? await packRepository(repositoryRoot)
            : null
    try {
        return await validateFeaturePreservation({
            apiBaseline,
            ledger,
            strict: options.strict,
            packageRoot: options.packageRoot || packed?.packageRoot,
            repositoryRoot
        })
    } finally {
        await packed?.cleanup()
    }
}

/**
 * Returns the value following one command-line flag.
 * @param {string[]} args Command-line arguments.
 * @param {string} flag Flag name.
 * @returns {string | undefined} Flag value.
 */
function flagValue(args, flag) {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
}

/**
 * Converts command-line flags into checker options.
 * @param {string[]} args Command-line arguments.
 * @returns {Record<string, any>} Checker options.
 */
function commandOptions(args) {
    return {
        strict: args.includes('--strict'),
        apiPath: flagValue(args, '--api'),
        ledgerPath: flagValue(args, '--ledger'),
        packageRoot: flagValue(args, '--package-root'),
        repositoryRoot: flagValue(args, '--repository-root')
    }
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
    const result = await checkFeaturePreservation(
        commandOptions(process.argv.slice(2))
    )
    process.stdout.write(
        `Validated ${result.featureCount} feature-preservation mappings.\n`
    )
}
