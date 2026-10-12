import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { serialize } from 'node:v8'

import { BenchmarkCaseCatalog } from './BenchmarkCaseCatalog.mjs'
import { SyntheticCircuitJsonFactory } from './SyntheticCircuitJsonFactory.mjs'

const candidatePackageRoot = String(
    process.env.CIRCUITJSON_BENCHMARK_PACKAGE_ROOT || ''
)

/**
 * Resolves one toolkit runtime module from the extracted npm candidate when a
 * candidate execution was requested, otherwise from the local source tree.
 * @param {string} packagePath Package-relative module path.
 * @returns {Promise<Record<string, any>>} Loaded module namespace.
 */
async function toolkitModule(packagePath) {
    const url = candidatePackageRoot
        ? pathToFileURL(resolve(candidatePackageRoot, packagePath)).href
        : new URL(`../${packagePath}`, import.meta.url).href
    return await import(url)
}

const [rootApi, extensionsApi, interactionApi, legacyApi] = await Promise.all([
    toolkitModule('src/index.mjs'),
    toolkitModule('src/extensions.mjs'),
    toolkitModule('src/interaction.mjs'),
    toolkitModule('src/core/context/CircuitJsonLegacyNormalizer.mjs')
])
const { CircuitJsonDocumentContext, CircuitJsonIndexer } = rootApi
const {
    CircuitJsonParser,
    CircuitJsonPcbPrimitiveBuilder,
    CircuitJsonPcbSvgRenderer
} = extensionsApi
const { PcbInteractionIndex } = interactionApi
const { CircuitJsonLegacyNormalizer } = legacyApi

/**
 * Creates an auditable marker for the exact extracted package under test.
 * @param {string} packageVersion Report package version.
 * @returns {Record<string, string> | null} Candidate execution marker.
 */
function candidateExecution(packageVersion) {
    if (!candidatePackageRoot) return null
    const environmentVersion = String(
        process.env.CIRCUITJSON_BENCHMARK_PACKAGE_VERSION || ''
    )
    const sourceDigest = String(
        process.env.CIRCUITJSON_BENCHMARK_SOURCE_DIGEST || ''
    )
    if (
        environmentVersion !== packageVersion ||
        !/^[a-f0-9]{64}$/u.test(sourceDigest)
    ) {
        throw new Error('Packed benchmark candidate identity is incomplete.')
    }
    return {
        schema: 'ecad-toolkit.benchmark-execution.v1',
        target: 'packed-candidate',
        packageVersion,
        sourceDigest
    }
}

/**
 * Runs the immutable CircuitJSON 1.0.17 benchmark workload.
 */
export class CircuitJsonBenchmarkSuite {
    /**
     * Runs every frozen benchmark case and returns a clone-safe report.
     * @param {{ packageVersion?: string, provenance?: { sourceCommit: string, sourceTree: string } }} options Report metadata.
     * @returns {Record<string, any>} Benchmark report.
     */
    static run(options = {}) {
        if (typeof globalThis.gc !== 'function') {
            throw new Error(
                'Benchmarks require controlled garbage collection via --expose-gc.'
            )
        }
        const catalog = BenchmarkCaseCatalog.load()
        const packageVersion = String(
            options.packageVersion || catalog.packageVersion
        )
        const enforceBaselineCloneBytes =
            packageVersion === catalog.packageVersion
        const fixture = CircuitJsonBenchmarkSuite.#fixture(catalog.fixture)
        const fixtureChecksum = CircuitJsonBenchmarkSuite.#checksum(
            fixture.data
        )
        if (fixtureChecksum !== catalog.fixture.checksum) {
            throw new Error(
                'Benchmark fixture differs from the versioned case catalog.'
            )
        }
        const execution = candidateExecution(packageVersion)
        return {
            schema: 'circuitjson-toolkit.benchmark.v1',
            packageVersion,
            provenance: structuredClone(options.provenance || {}),
            ...(execution ? { execution } : {}),
            environment: CircuitJsonBenchmarkSuite.#environment(),
            caseCatalogChecksum: catalog.catalogChecksum,
            measurementContract: structuredClone(catalog.measurement),
            fixtureChecksum,
            cases: catalog.cases.map((definition) =>
                CircuitJsonBenchmarkSuite.#measure(
                    CircuitJsonBenchmarkSuite.#benchmarkCase(
                        definition,
                        fixture,
                        catalog.measurement
                    ),
                    enforceBaselineCloneBytes
                )
            )
        }
    }

    /**
     * Creates the shared fixture graph from its frozen catalog definition.
     * @param {Record<string, any>} definition Fixture definition.
     * @returns {Record<string, any>} Suite fixture and derived indexes.
     */
    static #fixture(definition) {
        const largeDocument = SyntheticCircuitJsonFactory.largeDocument(
            definition.largeDocument.elementCount
        )
        const interactiveDocument =
            SyntheticCircuitJsonFactory.interactiveBoard(
                definition.interactiveBoard
            )
        const renderDocument = CircuitJsonLegacyNormalizer.normalize(
            structuredClone(interactiveDocument),
            { owned: true }
        )
        const netlistDocument = SyntheticCircuitJsonFactory.netlistDocument(
            definition.netlistDocument
        )
        const largeText = JSON.stringify(largeDocument)
        const netlistIndex = CircuitJsonDocumentContext.prepare(
            netlistDocument,
            { indexes: ['identifiers'] }
        ).getIndex('identifiers')
        const netlistPads = netlistDocument.filter(
            (element) => element.type === 'pcb_smtpad'
        )
        CircuitJsonPcbPrimitiveBuilder.buildInteraction(renderDocument)
        const interactionIndex = PcbInteractionIndex.create(
            structuredClone(renderDocument)
        )

        return {
            data: {
                largeDocument,
                interactiveDocument,
                netlistDocument
            },
            values: {
                largeDocument,
                interactiveDocument,
                netlistDocument,
                netlistIndex
            },
            runtimeValues: {
                interactiveDocument: renderDocument
            },
            interactionIndex,
            largeText,
            netlistPads
        }
    }

    /**
     * Binds one catalog definition to its deterministic fixture values.
     * @param {Record<string, any>} definition Frozen case definition.
     * @param {Record<string, any>} fixture Shared benchmark fixture.
     * @param {Record<string, string>} measurement Measurement semantics.
     * @returns {Record<string, any>} Executable benchmark case.
     */
    static #benchmarkCase(definition, fixture, measurement) {
        const cloneValue = fixture.values[definition.cloneTarget]
        if (cloneValue === undefined) {
            throw new Error(
                `Unknown benchmark clone target: ${definition.cloneTarget}`
            )
        }
        return {
            ...definition,
            measurement,
            cloneValue,
            run: CircuitJsonBenchmarkSuite.#workload(
                definition.workload,
                fixture
            )
        }
    }

    /**
     * Resolves one versioned workload operation to executable code.
     * @param {Record<string, any>} workload Frozen workload descriptor.
     * @param {Record<string, any>} fixture Shared benchmark fixture.
     * @returns {() => number} Deterministic workload.
     */
    static #workload(workload, fixture) {
        const operations = {
            'parse-and-index': CircuitJsonBenchmarkSuite.#parseAndIndex.bind(
                null,
                workload,
                fixture
            ),
            'grid-hit-test': CircuitJsonBenchmarkSuite.#gridHitTest.bind(
                null,
                workload,
                fixture
            ),
            'net-name-filter': CircuitJsonBenchmarkSuite.#netNameFilter.bind(
                null,
                workload,
                fixture
            ),
            'render-sides': CircuitJsonBenchmarkSuite.#renderSides.bind(
                null,
                workload,
                fixture
            ),
            'indexed-id-lookup':
                CircuitJsonBenchmarkSuite.#indexedIdLookup.bind(
                    null,
                    workload,
                    fixture
                )
        }
        const run = operations[workload.operation]
        if (!run) {
            throw new Error(
                `Unknown benchmark workload operation: ${workload.operation}`
            )
        }
        return run
    }

    /**
     * Parses and indexes the frozen large document.
     * @param {Record<string, any>} _workload Workload descriptor.
     * @param {Record<string, any>} fixture Shared benchmark fixture.
     * @returns {number} Parsed element count.
     */
    static #parseAndIndex(_workload, fixture) {
        const parsed = CircuitJsonParser.parseText(fixture.largeText)
        return CircuitJsonIndexer.index(parsed).elements.length
    }

    /**
     * Repeats hit testing over a catalog-defined coordinate grid.
     * @param {Record<string, any>} workload Workload descriptor.
     * @param {Record<string, any>} fixture Shared benchmark fixture.
     * @returns {number} Total number of returned hit candidates.
     */
    static #gridHitTest(workload, fixture) {
        let candidateCount = 0
        for (let index = 0; index < workload.iterations; index += 1) {
            const candidates = fixture.interactionIndex.hitTest(
                {
                    x:
                        (index % workload.xCycle) * workload.spacing +
                        workload.xOffset,
                    y:
                        (index % workload.yCycle) * workload.spacing +
                        workload.yOffset
                },
                { tolerance: workload.tolerance }
            )
            candidateCount += candidates.length
        }
        return candidateCount
    }

    /**
     * Repeats catalog-defined net-name filters over the indexed pad set.
     * @param {Record<string, any>} workload Workload descriptor.
     * @param {Record<string, any>} fixture Shared benchmark fixture.
     * @returns {number} Number of matched pads.
     */
    static #netNameFilter(workload, fixture) {
        let matches = 0
        for (let index = 0; index < workload.netCount; index += 1) {
            const netName = `${workload.netNamePrefix}${index}`
            matches += fixture.netlistPads.filter(
                (pad) => pad.net === netName
            ).length
        }
        return matches
    }

    /**
     * Renders every catalog-defined board side.
     * @param {Record<string, any>} workload Workload descriptor.
     * @param {Record<string, any>} fixture Shared benchmark fixture.
     * @returns {number} Combined SVG byte-like length.
     */
    static #renderSides(workload, fixture) {
        return CircuitJsonPcbSvgRenderer.renderSides(
            fixture.runtimeValues[workload.source] ||
                fixture.values[workload.source],
            workload.sides
        ).reduce((length, svg) => length + svg.length, 0)
    }

    /**
     * Reuses one prepared index for catalog-defined id lookups.
     * @param {Record<string, any>} workload Workload descriptor.
     * @param {Record<string, any>} fixture Shared benchmark fixture.
     * @returns {number} Number of successful lookups.
     */
    static #indexedIdLookup(workload, fixture) {
        let matches = 0
        const indexModel = fixture.values[workload.source]
        for (let index = 0; index < workload.iterations; index += 1) {
            const itemIndex = index % workload.modulus
            matches += indexModel.elementsById.has(
                `${workload.idPrefix}${itemIndex}`
            )
                ? 1
                : 0
        }
        return matches
    }

    /**
     * Measures one benchmark case after its configured warmups.
     * @param {Record<string, any>} benchmarkCase Benchmark definition.
     * @param {boolean} enforceBaselineCloneBytes Whether clone bytes are frozen.
     * @returns {Record<string, any>} Clone-safe case report.
     */
    static #measure(benchmarkCase, enforceBaselineCloneBytes) {
        for (let index = 0; index < benchmarkCase.warmups; index += 1) {
            CircuitJsonBenchmarkSuite.#assertResult(
                benchmarkCase,
                benchmarkCase.run()
            )
        }

        CircuitJsonBenchmarkSuite.#forceGc()
        const beforeBytes = process.memoryUsage().heapUsed
        const samples = []
        for (let index = 0; index < benchmarkCase.sampleCount; index += 1) {
            const start = performance.now()
            const result = benchmarkCase.run()
            samples.push(
                CircuitJsonBenchmarkSuite.#round(performance.now() - start)
            )
            CircuitJsonBenchmarkSuite.#assertResult(benchmarkCase, result)
        }
        CircuitJsonBenchmarkSuite.#forceGc()
        const afterBytes = process.memoryUsage().heapUsed
        const cloneBytes = serialize(benchmarkCase.cloneValue).byteLength
        if (
            benchmarkCase.measurement.clonePhase !== 'after-workload' ||
            (enforceBaselineCloneBytes &&
                cloneBytes !== benchmarkCase.expectedCloneBytes)
        ) {
            throw new Error(
                `Benchmark clone size differs for ${benchmarkCase.id}.`
            )
        }

        return {
            id: benchmarkCase.id,
            primary: benchmarkCase.primary,
            warmups: benchmarkCase.warmups,
            sampleCount: benchmarkCase.sampleCount,
            workload: structuredClone(benchmarkCase.workload),
            cloneTarget: benchmarkCase.cloneTarget,
            expectedResult: benchmarkCase.expectedResult,
            samples,
            medianMilliseconds: CircuitJsonBenchmarkSuite.#median(samples),
            cloneBytes,
            retainedHeap: {
                gcControlled: true,
                beforeBytes,
                afterBytes,
                retainedBytes: Math.max(0, afterBytes - beforeBytes)
            }
        }
    }

    /**
     * Rejects nondeterministic workload output before accepting a sample.
     * @param {Record<string, any>} benchmarkCase Benchmark definition.
     * @param {unknown} result Workload result.
     * @returns {void}
     */
    static #assertResult(benchmarkCase, result) {
        if (result !== benchmarkCase.expectedResult) {
            throw new Error(
                `Benchmark workload result differs for ${benchmarkCase.id}.`
            )
        }
    }

    /**
     * Runs repeated full garbage collection around retained-heap boundaries.
     * @returns {void}
     */
    static #forceGc() {
        globalThis.gc()
        globalThis.gc()
    }

    /**
     * Captures the runtime environment needed to interpret timings.
     * @returns {Record<string, string | number>} Environment description.
     */
    static #environment() {
        const processors = cpus()
        return {
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
            cpu: String(processors[0]?.model || 'unknown'),
            logicalCpuCount: processors.length
        }
    }

    /**
     * Hashes the complete deterministic fixture graph.
     * @param {unknown} value Fixture graph.
     * @returns {string} SHA-256 checksum.
     */
    static #checksum(value) {
        return createHash('sha256').update(JSON.stringify(value)).digest('hex')
    }

    /**
     * Returns the median of numeric samples.
     * @param {number[]} samples Timing samples.
     * @returns {number} Median sample.
     */
    static #median(samples) {
        const sorted = [...samples].sort((left, right) => left - right)
        const middle = Math.floor(sorted.length / 2)
        if (sorted.length % 2 === 1) {
            return sorted[middle]
        }
        return CircuitJsonBenchmarkSuite.#round(
            (sorted[middle - 1] + sorted[middle]) / 2
        )
    }

    /**
     * Rounds a timing without erasing sub-millisecond observations.
     * @param {number} value Numeric value.
     * @returns {number} Stable rounded value.
     */
    static #round(value) {
        return Number(value.toFixed(6))
    }
}
