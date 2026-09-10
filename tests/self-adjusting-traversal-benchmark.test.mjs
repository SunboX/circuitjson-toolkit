import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Builds synthetic PCB pad data with the nested shape of an input document.
 * @returns {object} Small generated CircuitJSON input snapshot.
 */
function createInput() {
    return {
        project: {
            documents: [
                {
                    models: {
                        pcb: {
                            elements: Array.from(
                                { length: 5000 },
                                (_, index) => ({
                                    type: 'pcb_smtpad',
                                    pcb_smtpad_id: `pad-${index}`,
                                    x: index % 100,
                                    y: Math.floor(index / 100),
                                    width: 2,
                                    height: 3,
                                    layer: 'top'
                                })
                            )
                        }
                    }
                }
            ]
        }
    }
}

/**
 * Summarizes the same pad records over successive synthetic render passes.
 * @param {object} state Tracked input snapshot.
 * @returns {number} Deterministic checksum of all observed fields.
 */
function summarizePads(state) {
    const pads = state.project.documents[0].models.pcb.elements
    let total = 0
    for (let pass = 0; pass < 12; pass += 1) {
        for (const pad of pads) {
            total += pad.x + pad.y + pad.width * pad.height
            if (pad.layer === 'top') total += 1
        }
    }
    return total
}

test(
    'benchmarks repeated traversal of generated CircuitJSON pad records',
    { skip: process.env.SELF_ADJUSTING_BENCHMARK !== '1' },
    async (context) => {
        const { SelfAdjustingComputation } = await import(
            process.env.SELF_ADJUSTING_BENCHMARK_MODULE ||
                '../src/core/SelfAdjustingComputation.mjs'
        )
        const input = createInput()
        const durations = []
        for (let run = 0; run < 6; run += 1) {
            const runtime = new SelfAdjustingComputation()
            const start = performance.now()
            const result = runtime.evaluate('pads', input, summarizePads)
            const elapsed = performance.now() - start
            assert.equal(result.value, 4860000)
            assert.equal(runtime.getStatistics().dependencies, 30008)
            if (run > 0) durations.push(elapsed)
        }
        durations.sort((left, right) => left - right)
        context.diagnostic(
            JSON.stringify({
                padCount: 5000,
                passes: 12,
                medianMilliseconds: durations[2],
                durations
            })
        )
    }
)
