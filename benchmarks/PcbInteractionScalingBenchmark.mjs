import { performance } from 'node:perf_hooks'

import { PcbInteractionIndex } from '../src/interaction.mjs'

/**
 * Measures interaction-only preparation over distinct-net pad populations.
 */
export class PcbInteractionScalingBenchmark {
    /**
     * Runs a median wall-clock scaling probe with fresh immutable documents.
     * @param {{ sizes?: number[], samples?: number }} [options] Probe options.
     * @returns {Record<string, any>} Clone-safe scaling report.
     */
    static run(options = {}) {
        const sizes = PcbInteractionScalingBenchmark.#sizes(options.sizes)
        const samples = PcbInteractionScalingBenchmark.#positiveInteger(
            options.samples,
            3
        )
        PcbInteractionIndex.create(PcbInteractionScalingBenchmark.#document(32))
        const measurements = sizes.map((size) =>
            PcbInteractionScalingBenchmark.#measure(size, samples)
        )
        const adjacentGrowth = measurements
            .slice(1)
            .map((measurement, index) =>
                PcbInteractionScalingBenchmark.#ratio(
                    measurement.medianMilliseconds,
                    measurements[index].medianMilliseconds
                )
            )
        return {
            schema: 'circuitjson-toolkit.pcb-interaction-scaling.v1',
            samples,
            measurements,
            adjacentGrowth,
            maximumAdjacentGrowth: Math.max(...adjacentGrowth),
            overallGrowth: PcbInteractionScalingBenchmark.#ratio(
                measurements.at(-1).medianMilliseconds,
                measurements[0].medianMilliseconds
            )
        }
    }

    /**
     * Measures one pad population with fresh source data per sample.
     * @param {number} size Pad count.
     * @param {number} samples Sample count.
     * @returns {Record<string, any>} Population measurement.
     */
    static #measure(size, samples) {
        const timings = []
        let statistics = null
        for (let sample = 0; sample < samples; sample += 1) {
            const document = PcbInteractionScalingBenchmark.#document(size)
            const start = performance.now()
            const index = PcbInteractionIndex.create(document)
            timings.push(performance.now() - start)
            statistics = index.statistics
        }
        timings.sort((left, right) => left - right)
        return {
            pads: size,
            records: size + 1,
            medianMilliseconds: PcbInteractionScalingBenchmark.#round(
                timings[Math.floor(timings.length / 2)]
            ),
            timings: timings.map(PcbInteractionScalingBenchmark.#round),
            primitiveBuilds: statistics.primitiveBuilds,
            spatialIndexBuilds: statistics.spatialIndexBuilds
        }
    }

    /**
     * Builds one deterministic distinct-net pad population with clearance
     * rules that would expose accidental quadratic report preparation.
     * @param {number} count Pad count.
     * @returns {object[]} Standards-shaped CircuitJSON document.
     */
    static #document(count) {
        return [
            {
                type: 'pcb_board',
                pcb_board_id: 'pcb_board_scaling',
                center: { x: 0, y: 0 },
                width: count * 2,
                height: 4,
                min_trace_clearance: 0.2
            },
            ...Array.from({ length: count }, (_entry, index) => ({
                type: 'pcb_smtpad',
                pcb_smtpad_id: `pcb_pad_scaling_${index}`,
                shape: 'rect',
                x: index * 1.5 - count * 0.75,
                y: 0,
                width: 0.5,
                height: 0.5,
                layer: 'top',
                net: `NET_${index}`
            }))
        ]
    }

    /**
     * Normalizes a strictly increasing benchmark size list.
     * @param {unknown} sizes Size candidate.
     * @returns {number[]} Normalized sizes.
     */
    static #sizes(sizes) {
        const values = Array.isArray(sizes) ? sizes : [400, 800, 1600]
        const normalized = values.map((value) =>
            PcbInteractionScalingBenchmark.#positiveInteger(value, 0)
        )
        if (
            normalized.length < 2 ||
            normalized.some(
                (value, index) => index > 0 && value <= normalized[index - 1]
            )
        ) {
            throw new TypeError(
                'Interaction scaling sizes must be strictly increasing.'
            )
        }
        return normalized
    }

    /**
     * Normalizes one positive integer.
     * @param {unknown} value Integer candidate.
     * @param {number} fallback Fallback integer.
     * @returns {number} Positive integer.
     */
    static #positiveInteger(value, fallback) {
        const number = value === undefined ? fallback : Number(value)
        if (!Number.isSafeInteger(number) || number <= 0) {
            throw new TypeError('Benchmark counts must be positive integers.')
        }
        return number
    }

    /**
     * Builds one finite rounded growth ratio.
     * @param {number} value Numerator.
     * @param {number} baseline Denominator.
     * @returns {number} Rounded ratio.
     */
    static #ratio(value, baseline) {
        return PcbInteractionScalingBenchmark.#round(value / baseline)
    }

    /**
     * Rounds one timing or ratio for stable evidence output.
     * @param {number} value Numeric value.
     * @returns {number} Six-decimal number.
     */
    static #round(value) {
        return Number(value.toFixed(6))
    }
}
