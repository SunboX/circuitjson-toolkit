import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { CircuitJsonElementValidator } from '../src/index.mjs'
import {
    BaselineProvenance,
    ImmutableBaselineWriter
} from './BaselineArtifacts.mjs'

const REFERENCE_PACKAGE = 'circuit-json'
const REFERENCE_VERSION = '0.0.446'
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
 * Synchronizes the pinned reference metadata and local validator snapshot.
 * @returns {Promise<{ source: Record<string, any>, snapshot: Record<string, any> }>} Written artifacts.
 */
export async function syncCircuitJsonSchema() {
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

    const source = {
        package: 'circuit-json',
        version: '0.0.446',
        integrity: lock.packages['node_modules/circuit-json'].integrity,
        sourceUrl: 'https://www.npmjs.com/package/circuit-json/v/0.0.446',
        license: referencePackage.license
    }
    const snapshot = structuredClone(
        CircuitJsonElementValidator.schemaSnapshot()
    )
    const provenance = await BaselineProvenance.capture(repositoryRoot, {
        requireCurrentTree: true
    })
    const provenanceArtifact = {
        schema: 'circuitjson-toolkit.baseline-provenance.v1',
        package: 'circuitjson-toolkit',
        packageVersion: '1.0.17',
        ...provenance
    }

    await ImmutableBaselineWriter.writeJson(
        new URL('spec/baseline-provenance-v1.0.17.json', repositoryRoot),
        provenanceArtifact
    )
    await ImmutableBaselineWriter.writeJson(
        new URL('spec/circuitjson-schema-source.json', repositoryRoot),
        source
    )
    await ImmutableBaselineWriter.writeJson(
        new URL('spec/circuitjson-schema-snapshot.json', repositoryRoot),
        snapshot
    )

    return { source, snapshot }
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
    await syncCircuitJsonSchema()
}
