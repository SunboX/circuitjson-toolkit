import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { serialize } from 'node:v8'

import {
    CircuitJsonIndexer,
    CircuitJsonParser,
    CircuitJsonPcbPrimitiveBuilder,
    CircuitJsonPcbSvgRenderer
} from '../src/index.mjs'
import { PcbInteractionIndex } from '../src/interaction.mjs'
import { BenchmarkCaseCatalog } from './BenchmarkCaseCatalog.mjs'
import { SyntheticCircuitJsonFactory } from './SyntheticCircuitJsonFactory.mjs'

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
        if (packageVersion !== catalog.packageVersion) {
            throw new Error(
                'Benchmark package version differs from the versioned case catalog.'
            )
        }
        const fixture = CircuitJsonBenchmarkSuite.#fixture(catalog.fixture)
        const fixtureChecksum = CircuitJsonBenchmarkSuite.#checksum(
            fixture.data
        )
        if (fixtureChecksum !== catalog.fixture.checksum) {
            throw new Error(
                'Benchmark fixture differs from the versioned case catalog.'
            )
        }
        return {
            schema: 'circuitjson-toolkit.benchmark.v1',
            packageVersion,
            provenance: structuredClone(options.provenance || {}),
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
                    )
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
        const netlistDocument = SyntheticCircuitJsonFactory.netlistDocument(
            definition.netlistDocument
        )
        const largeText = JSON.stringify(largeDocument)
        const netlistIndex = CircuitJsonIndexer.index(netlistDocument)
        const netlistPads = netlistIndex.elementsByType.get('pcb_smtpad') || []
        // Retain the immutable 1.0.17 after-workload clone contract while the
        // measured repeated queries below use the new reusable index.
        CircuitJsonPcbPrimitiveBuilder.buildInteraction(interactiveDocument)
        const interactionIndex = PcbInteractionIndex.create(
            structuredClone(interactiveDocument)
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
        return workload.sides.reduce(
            (length, side) =>
                length +
                CircuitJsonPcbSvgRenderer.render(
                    fixture.values[workload.source],
                    { side }
                ).length,
            0
        )
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
     * @returns {Record<string, any>} Clone-safe case report.
     */
    static #measure(benchmarkCase) {
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
            cloneBytes !== benchmarkCase.expectedCloneBytes
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
