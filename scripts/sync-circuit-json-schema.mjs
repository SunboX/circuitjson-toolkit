import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { format } from 'prettier'

import { any_circuit_element as upstreamElement } from 'circuit-json'

import { CircuitJsonUpstreamSchemaCompiler } from './CircuitJsonUpstreamSchemaCompiler.mjs'
import {
    BaselineProvenance,
    ImmutableBaselineWriter
} from './BaselineArtifacts.mjs'

const REFERENCE_PACKAGE = 'circuit-json'
const REFERENCE_VERSION = '0.0.446'
const DISTRIBUTION_FILE = 'dist/index.mjs'
const COMPILER_DEPENDENCIES = Object.freeze([
    Object.freeze({
        package: 'format-si-unit',
        version: '0.0.7',
        distributionFile: 'dist/index.js'
    }),
    Object.freeze({
        package: 'zod',
        version: '3.25.76',
        distributionFile: 'index.js'
    })
])
const repositoryRoot = new URL('../', import.meta.url)

/**
 * Reads one JSON file relative to the repository root.
 * @param {string} relativePath Repository-relative file path.
 * @returns {Promise<Record<string, any>>} Parsed JSON value.
 */
async function readJson(relativePath) {
    return JSON.parse(
        await readFile(new URL(relativePath, repositoryRoot), 'utf8')
    )
}

/**
 * Writes one mutable generated JSON artifact with repository formatting.
 * @param {string} relativePath Repository-relative output path.
 * @param {unknown} value JSON value.
 * @returns {Promise<void>}
 */
async function writeJson(relativePath, value) {
    await writeFile(
        new URL(relativePath, repositoryRoot),
        await format(JSON.stringify(value), {
            parser: 'json',
            tabWidth: 4,
            trailingComma: 'none'
        })
    )
}

/**
 * Returns a lowercase SHA-256 for one byte sequence.
 * @param {string | Uint8Array} value Hash input.
 * @returns {string} Lowercase SHA-256.
 */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex')
}

/**
 * Verifies one exact compiler dependency against both the installed package
 * and npm lockfile, then records the bytes that enter schema interpretation.
 * @param {Record<string, any>} lock Parsed package lock.
 * @param {{ package: string, version: string, distributionFile: string }} expected Pinned dependency.
 * @returns {Promise<Record<string, string>>} Verified dependency provenance.
 */
async function compilerDependencyProvenance(lock, expected) {
    const installed = await readJson(
        `node_modules/${expected.package}/package.json`
    )
    const lockEntry = lock.packages?.[`node_modules/${expected.package}`]
    if (
        installed.name !== expected.package ||
        installed.version !== expected.version ||
        lockEntry?.version !== expected.version ||
        typeof lockEntry.integrity !== 'string' ||
        lockEntry.integrity.length === 0
    ) {
        throw new Error(
            `Expected ${expected.package}@${expected.version} with lockfile integrity.`
        )
    }
    const distribution = await readFile(
        new URL(
            `node_modules/${expected.package}/${expected.distributionFile}`,
            repositoryRoot
        )
    )
    return {
        package: expected.package,
        version: expected.version,
        integrity: lockEntry.integrity,
        distributionFile: expected.distributionFile,
        distributionSha256: sha256(distribution),
        license: installed.license ?? ''
    }
}

/**
 * Builds the pinned upstream union, browser runtime, and provenance artifacts.
 * @returns {Promise<{ source: Record<string, any>, snapshot: Record<string, any>, contract: Record<string, any>, generatedSource: string, provenanceArtifact: Record<string, any> }>} Expected artifacts.
 */
async function buildCircuitJsonSchemaArtifacts() {
    const lock = await readJson('package-lock.json')
    const referencePackage = await readJson(
        'node_modules/circuit-json/package.json'
    )
    const lockEntry = lock.packages?.['node_modules/circuit-json']

    if (
        referencePackage.name !== REFERENCE_PACKAGE ||
        referencePackage.version !== REFERENCE_VERSION ||
        lockEntry?.version !== REFERENCE_VERSION ||
        typeof lockEntry.integrity !== 'string' ||
        lockEntry.integrity.length === 0
    ) {
        throw new Error(
            `Expected ${REFERENCE_PACKAGE}@${REFERENCE_VERSION} with lockfile integrity.`
        )
    }

    const distribution = await readFile(
        new URL(
            `node_modules/${REFERENCE_PACKAGE}/${DISTRIBUTION_FILE}`,
            repositoryRoot
        )
    )
    const compilerDependencies = await Promise.all(
        COMPILER_DEPENDENCIES.map((dependency) =>
            compilerDependencyProvenance(lock, dependency)
        )
    )
    const contract = CircuitJsonUpstreamSchemaCompiler.compile(upstreamElement)
    const contractSha256 = CircuitJsonUpstreamSchemaCompiler.checksum(contract)
    const distributionSha256 = sha256(distribution)
    const source = {
        package: REFERENCE_PACKAGE,
        version: REFERENCE_VERSION,
        integrity: lockEntry.integrity,
        distributionFile: DISTRIBUTION_FILE,
        distributionSha256,
        contractSha256,
        compilerDependencies,
        sourceUrl: `https://www.npmjs.com/package/${REFERENCE_PACKAGE}/v/${REFERENCE_VERSION}`,
        license: referencePackage.license
    }
    const snapshot = {
        schema: 'circuitjson-toolkit.schema-snapshot.v1',
        package: REFERENCE_PACKAGE,
        version: REFERENCE_VERSION,
        contractSha256,
        elementTypes: contract.elementTypes,
        idFieldExceptions: contract.idFieldExceptions,
        variantSets: contract.variantSets
    }
    const generatedProvenance = {
        package: REFERENCE_PACKAGE,
        version: REFERENCE_VERSION,
        integrity: lockEntry.integrity,
        distributionFile: DISTRIBUTION_FILE,
        distributionSha256,
        contractSha256,
        compilerDependencies
    }
    const generatedSource = CircuitJsonUpstreamSchemaCompiler.moduleSource(
        contract,
        generatedProvenance
    )
    if (
        /from\s+['"](?:node:|circuit-json|zod|format-si-unit)/u.test(
            generatedSource
        )
    ) {
        throw new Error(
            'Generated runtime contract contains a Node dependency.'
        )
    }

    const provenance = await BaselineProvenance.capture(repositoryRoot)
    const provenanceArtifact = {
        schema: 'circuitjson-toolkit.baseline-provenance.v1',
        package: 'circuitjson-toolkit',
        packageVersion: '1.0.17',
        ...provenance
    }

    return {
        source,
        snapshot,
        contract,
        generatedSource,
        provenanceArtifact
    }
}

/**
 * Rejects generated schema drift through exact data and module comparisons.
 * @param {{ source: Record<string, any>, snapshot: Record<string, any>, generatedSource: string }} actual Checked-in artifacts.
 * @param {{ source: Record<string, any>, snapshot: Record<string, any>, generatedSource: string }} expected Fresh pinned artifacts.
 * @returns {void}
 */
export function assertCircuitJsonSchemaArtifacts(actual, expected) {
    if (
        !isDeepStrictEqual(actual?.source, expected?.source) ||
        !isDeepStrictEqual(actual?.snapshot, expected?.snapshot) ||
        actual?.generatedSource !== expected?.generatedSource
    ) {
        throw new Error(
            'CircuitJSON schema artifacts are out of sync. Run npm run sync:schema.'
        )
    }
}

/**
 * Synchronizes or read-only checks the pinned upstream schema artifacts.
 * @param {{ check?: boolean }} [options] Synchronization options.
 * @returns {Promise<{ source: Record<string, any>, snapshot: Record<string, any>, contract: Record<string, any> }>} Current artifacts.
 */
export async function syncCircuitJsonSchema(options = {}) {
    const artifacts = await buildCircuitJsonSchemaArtifacts()
    if (options.check === true) {
        const actual = {
            source: await readJson('spec/circuitjson-schema-source.json'),
            snapshot: await readJson('spec/circuitjson-schema-snapshot.json'),
            generatedSource: await readFile(
                new URL(
                    'src/core/CircuitJsonUpstreamSchema.mjs',
                    repositoryRoot
                ),
                'utf8'
            )
        }
        assertCircuitJsonSchemaArtifacts(actual, artifacts)
        return {
            source: artifacts.source,
            snapshot: artifacts.snapshot,
            contract: artifacts.contract
        }
    }

    await ImmutableBaselineWriter.writeJson(
        new URL('spec/baseline-provenance-v1.0.17.json', repositoryRoot),
        artifacts.provenanceArtifact
    )
    await Promise.all([
        writeJson('spec/circuitjson-schema-source.json', artifacts.source),
        writeJson('spec/circuitjson-schema-snapshot.json', artifacts.snapshot),
        writeFile(
            new URL('src/core/CircuitJsonUpstreamSchema.mjs', repositoryRoot),
            artifacts.generatedSource
        )
    ])

    return {
        source: artifacts.source,
        snapshot: artifacts.snapshot,
        contract: artifacts.contract
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
    const arguments_ = process.argv.slice(2)
    if (arguments_.some((argument) => argument !== '--check')) {
        throw new Error(
            `Unsupported schema synchronization option: ${arguments_[0]}.`
        )
    }
    const check = arguments_.includes('--check')
    await syncCircuitJsonSchema({ check })
    if (check) {
        process.stdout.write(
            'CircuitJSON schema artifacts verified without writing.\n'
        )
    }
}
