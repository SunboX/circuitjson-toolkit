import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const defaultCatalogUrl = new URL(
    './case-catalog-v1.0.17.json',
    import.meta.url
)
const approvedCatalogChecksum =
    'aa5a3a80cd4d8c3a3b40cffb53a750673076c17108ce2e9764de1fc82e8fe05e'

/**
 * Loads and verifies the immutable benchmark case-definition catalog.
 */
export class BenchmarkCaseCatalog {
    /**
     * Loads the versioned catalog and protects it against runtime mutation.
     * @param {string | URL} [catalogUrl] Catalog location.
     * @returns {Readonly<Record<string, any>>} Verified frozen catalog.
     */
    static load(catalogUrl = defaultCatalogUrl) {
        const catalog = JSON.parse(readFileSync(catalogUrl, 'utf8'))
        BenchmarkCaseCatalog.#validate(catalog)
        return BenchmarkCaseCatalog.#deepFreeze(catalog)
    }

    /**
     * Hashes one catalog or report body with stable JSON property order.
     * @param {Record<string, any>} value JSON-compatible value.
     * @returns {string} SHA-256 checksum.
     */
    static checksum(value) {
        return createHash('sha256').update(JSON.stringify(value)).digest('hex')
    }

    /**
     * Verifies catalog identity and checksum before any workload runs.
     * @param {Record<string, any>} catalog Parsed catalog.
     * @returns {void}
     */
    static #validate(catalog) {
        const { catalogChecksum, ...catalogBody } = catalog
        const cases = Array.isArray(catalog.cases) ? catalog.cases : []
        const ids = cases.map((entry) => entry.id)
        if (
            catalog.schema !== 'circuitjson-toolkit.benchmark-catalog.v1' ||
            catalog.packageVersion !== '1.0.17' ||
            catalogChecksum !== approvedCatalogChecksum ||
            catalogChecksum !== BenchmarkCaseCatalog.checksum(catalogBody) ||
            !catalog.fixture?.checksum ||
            catalog.measurement?.clonePhase !== 'after-workload' ||
            cases.length === 0 ||
            new Set(ids).size !== cases.length
        ) {
            throw new Error(
                'Benchmark case catalog differs from the immutable versioned contract.'
            )
        }
    }

    /**
     * Recursively freezes a JSON-compatible value.
     * @param {any} value Value to freeze.
     * @returns {any} Frozen value.
     */
    static #deepFreeze(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
            return value
        }
        for (const nestedValue of Object.values(value)) {
            BenchmarkCaseCatalog.#deepFreeze(nestedValue)
        }
        return Object.freeze(value)
    }
}
