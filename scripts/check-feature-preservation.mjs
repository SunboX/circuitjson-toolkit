import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const ALLOWED_DISPOSITIONS = new Set([
    'shared',
    'native-extension',
    'unavailable'
])

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

    const modules = new Map()
    for (const entrypoint of apiBaseline.entrypoints || []) {
        const moduleUrl = pathToFileURL(
            resolve(packageRoot, entrypoint.target)
        ).href
        modules.set(entrypoint.entrypoint, await import(moduleUrl))
    }
    return modules
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
    const module = modules.get(feature.entrypoint)
    const exported = module?.[feature.exportName]
    if (feature.kind === 'export') {
        return exported !== undefined
    }
    if (feature.methodType === 'instance') {
        return typeof exported?.prototype?.[feature.methodName] === 'function'
    }
    return typeof exported?.[feature.methodName] === 'function'
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
    const capabilityIds = new Set(
        (Array.isArray(inventory) ? inventory : []).map((row) => row.id)
    )
    const fictitious = [
        ...new Set(
            ledger
                .map((row) => row.capabilityId)
                .filter((capabilityId) => !capabilityIds.has(capabilityId))
        )
    ]
    if (fictitious.length > 0) {
        throw new Error(
            `Fictitious capabilityId mappings: ${fictitious.join(', ')}`
        )
    }
}

/**
 * Verifies every referenced test and documentation path exists.
 * @param {Record<string, any>[]} ledger Preservation ledger.
 * @param {string} repositoryRoot Repository root.
 * @returns {Promise<void>}
 */
async function validateEvidencePaths(ledger, repositoryRoot) {
    const paths = [
        ...new Set(
            ledger.flatMap((row) => [...row.tests, ...row.documentation])
        )
    ]
    const missing = []
    for (const path of paths) {
        try {
            await access(resolve(repositoryRoot, path))
        } catch {
            missing.push(path)
        }
    }
    if (missing.length > 0) {
        throw new Error(`Missing evidence paths: ${missing.join(', ')}`)
    }
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
 * Returns whether a ledger row has the required preservation decision fields.
 * @param {Record<string, any>} row Ledger row.
 * @returns {boolean} True for a complete row.
 */
function isCompleteRow(row) {
    return (
        isNonEmptyString(row.package) &&
        isNonEmptyString(row.feature) &&
        ['export', 'method', 'option', 'field', 'behavior'].includes(
            row.kind
        ) &&
        isNonEmptyString(row.capabilityId) &&
        ALLOWED_DISPOSITIONS.has(row.disposition) &&
        isNonEmptyString(row.replacement) &&
        row.availability !== null &&
        typeof row.availability === 'object' &&
        !Array.isArray(row.availability) &&
        isNonEmptyString(row.reason) &&
        isNonEmptyStringArray(row.tests) &&
        isNonEmptyStringArray(row.documentation)
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
    const invalidRow = ledger.find((row) => !isCompleteRow(row))
    if (invalidRow) {
        throw new Error(
            `Invalid feature-preservation row for ${String(invalidRow.feature)}`
        )
    }
    if (options.strict) {
        const modules = await importPackedEntrypoints(
            options.apiBaseline,
            options.packageRoot
        )
        validatePackedApi(options.apiBaseline, modules)
        validateCapabilities(ledger, modules)
        await validateEvidencePaths(
            ledger,
            resolve(options.repositoryRoot || process.cwd())
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
