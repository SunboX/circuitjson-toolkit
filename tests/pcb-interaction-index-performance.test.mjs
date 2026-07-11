import assert from 'node:assert/strict'
import test from 'node:test'

import { PcbInteractionScalingBenchmark } from '../benchmarks/PcbInteractionScalingBenchmark.mjs'

test('PcbInteractionIndex prepares 400/800/1600 distinct-net pads near-linearly', () => {
    const report = PcbInteractionScalingBenchmark.run({
        sizes: [400, 800, 1600],
        samples: 3
    })

    assert.deepEqual(
        report.measurements.map((measurement) => measurement.records),
        [401, 801, 1601]
    )
    assert.equal(
        report.measurements.every(
            (measurement) =>
                Number.isFinite(measurement.medianMilliseconds) &&
                measurement.medianMilliseconds > 0
        ),
        true
    )
    assert.equal(report.maximumAdjacentGrowth < 3.5, true, report)
    assert.equal(report.overallGrowth < 8, true, report)
    assert.doesNotThrow(() => structuredClone(report))
})
