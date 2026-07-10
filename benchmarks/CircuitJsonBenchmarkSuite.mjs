import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { serialize } from 'node:v8'

import {
    CircuitJsonIndexer,
    CircuitJsonParser,
    CircuitJsonPcbSvgRenderer,
    PcbInteractionPrimitiveModel
} from '../src/index.mjs'
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
        const fixture = CircuitJsonBenchmarkSuite.#fixture()
        return {
            schema: 'circuitjson-toolkit.benchmark.v1',
            packageVersion: String(options.packageVersion || '1.0.17'),
            provenance: structuredClone(options.provenance || {}),
            environment: CircuitJsonBenchmarkSuite.#environment(),
            fixtureChecksum: CircuitJsonBenchmarkSuite.#checksum(fixture.data),
            cases: fixture.cases.map((benchmarkCase) =>
                CircuitJsonBenchmarkSuite.#measure(benchmarkCase)
            )
        }
    }

    /**
     * Creates all frozen benchmark cases and their shared fixture data.
     * @returns {{ data: object, cases: Record<string, any>[] }} Suite fixture.
     */
    static #fixture() {
        const largeDocument = SyntheticCircuitJsonFactory.largeDocument(50000)
        const interactiveDocument =
            SyntheticCircuitJsonFactory.interactiveBoard()
        const netlistDocument = SyntheticCircuitJsonFactory.netlistDocument()
        const largeText = JSON.stringify(largeDocument)
        const netlistIndex = CircuitJsonIndexer.index(netlistDocument)
        const netlistPads = netlistIndex.elementsByType.get('pcb_smtpad') || []

        return {
            data: {
                largeDocument,
                interactiveDocument,
                netlistDocument
            },
            cases: [
                {
                    id: 'parse-context-50000',
                    primary: true,
                    warmups: 1,
                    sampleCount: 5,
                    cloneValue: largeDocument,
                    /**
                     * Parses and indexes the 50,000-element fixture.
                     * @returns {number} Parsed element count.
                     */
                    run() {
                        const parsed = CircuitJsonParser.parseText(largeText)
                        return CircuitJsonIndexer.index(parsed).elements.length
                    }
                },
                {
                    id: 'repeated-query-hit-test',
                    primary: true,
                    warmups: 2,
                    sampleCount: 7,
                    cloneValue: interactiveDocument,
                    /**
                     * Repeats hit testing against an unchanged document.
                     * @returns {number} Number of successful hit tests.
                     */
                    run() {
                        let hits = 0
                        for (let index = 0; index < 40; index += 1) {
                            const hit = PcbInteractionPrimitiveModel.hitTest(
                                interactiveDocument,
                                {
                                    x: (index % 16) * 1.5 - 12,
                                    y: (index % 12) * 1.5 - 9
                                },
                                { tolerance: 0.25 }
                            )
                            hits += hit ? 1 : 0
                        }
                        return hits
                    }
                },
                {
                    id: 'repeated-netlist-query',
                    primary: false,
                    warmups: 3,
                    sampleCount: 9,
                    cloneValue: netlistDocument,
                    /**
                     * Repeats net-name queries over the frozen pad set.
                     * @returns {number} Number of matched pads.
                     */
                    run() {
                        let matches = 0
                        for (let index = 0; index < 128; index += 1) {
                            const netName = `BUS_${index}`
                            matches += netlistPads.filter(
                                (pad) => pad.net === netName
                            ).length
                        }
                        return matches
                    }
                },
                {
                    id: 'multi-layer-render',
                    primary: false,
                    warmups: 2,
                    sampleCount: 7,
                    cloneValue: interactiveDocument,
                    /**
                     * Renders both surface sides of a multi-layer board.
                     * @returns {number} Combined SVG byte-like length.
                     */
                    run() {
                        const top = CircuitJsonPcbSvgRenderer.render(
                            interactiveDocument,
                            { side: 'top' }
                        )
                        const bottom = CircuitJsonPcbSvgRenderer.render(
                            interactiveDocument,
                            { side: 'bottom' }
                        )
                        return top.length + bottom.length
                    }
                },
                {
                    id: 'context-reuse',
                    primary: false,
                    warmups: 3,
                    sampleCount: 9,
                    cloneValue: netlistIndex,
                    /**
                     * Reuses one prepared index for repeated id lookups.
                     * @returns {number} Number of successful lookups.
                     */
                    run() {
                        let matches = 0
                        for (let index = 0; index < 4096; index += 1) {
                            const netIndex = index % 128
                            matches += netlistIndex.elementsById.has(
                                `source_net:source_net_bus_${netIndex}`
                            )
                                ? 1
                                : 0
                        }
                        return matches
                    }
                }
            ]
        }
    }

    /**
     * Measures one benchmark case after its configured warmups.
     * @param {Record<string, any>} benchmarkCase Benchmark definition.
     * @returns {Record<string, any>} Clone-safe case report.
     */
    static #measure(benchmarkCase) {
        for (let index = 0; index < benchmarkCase.warmups; index += 1) {
            benchmarkCase.run()
        }

        CircuitJsonBenchmarkSuite.#forceGc()
        const beforeBytes = process.memoryUsage().heapUsed
        const samples = []
        for (let index = 0; index < benchmarkCase.sampleCount; index += 1) {
            const start = performance.now()
            benchmarkCase.run()
            samples.push(
                CircuitJsonBenchmarkSuite.#round(performance.now() - start)
            )
        }
        CircuitJsonBenchmarkSuite.#forceGc()
        const afterBytes = process.memoryUsage().heapUsed

        return {
            id: benchmarkCase.id,
            primary: benchmarkCase.primary,
            warmups: benchmarkCase.warmups,
            samples,
            medianMilliseconds: CircuitJsonBenchmarkSuite.#median(samples),
            cloneBytes: serialize(benchmarkCase.cloneValue).byteLength,
            retainedHeap: {
                gcControlled: true,
                beforeBytes,
                afterBytes,
                retainedBytes: Math.max(0, afterBytes - beforeBytes)
            }
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
