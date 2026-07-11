import assert from 'node:assert/strict'
import test from 'node:test'

import { ManufacturingService } from '../src/core/ManufacturingService.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'

const PLACEMENT_COUNT = 150000
const MAX_LIST_EXPORTS_MILLISECONDS = 100
const MAX_LIST_EXPORTS_HEAP_GROWTH = 8 * 1024 * 1024

/**
 * Builds a large valid placement-only CircuitJSON document.
 * @returns {object[]} CircuitJSON rows.
 */
function createLargePlacementDocument() {
    return Array.from({ length: PLACEMENT_COUNT }, (_entry, index) => ({
        type: 'pcb_component',
        pcb_component_id: `pcb_component_${index}`,
        source_component_id: 'source_component_shared',
        center: { x: index, y: 0 },
        width: 1,
        height: 1,
        rotation: 0,
        layer: 'top'
    }))
}

test('ManufacturingService lists only detached export rows from a cached large model', (testContext) => {
    const context = CircuitJsonDocumentContext.prepare(
        createLargePlacementDocument()
    )
    const warmedInspection = ManufacturingService.inspect(context)
    const originalStructuredClone = globalThis.structuredClone
    let largePlacementClones = 0
    let exports
    let elapsedMilliseconds
    let heapGrowth

    globalThis.structuredClone = (value, options) => {
        if (Array.isArray(value) && value.length === PLACEMENT_COUNT) {
            largePlacementClones += 1
        }
        return originalStructuredClone(value, options)
    }
    try {
        const beforeHeap = process.memoryUsage().heapUsed
        const startedAt = performance.now()
        exports = ManufacturingService.listExports(context)
        elapsedMilliseconds = performance.now() - startedAt
        heapGrowth = Math.max(0, process.memoryUsage().heapUsed - beforeHeap)
    } finally {
        globalThis.structuredClone = originalStructuredClone
    }
    testContext.diagnostic(
        `cached listExports: ${largePlacementClones} large clones, ${elapsedMilliseconds} ms, ${heapGrowth} heap bytes`
    )

    assert.equal(warmedInspection.placements.length, PLACEMENT_COUNT)
    assert.equal(
        largePlacementClones === 0 &&
            elapsedMilliseconds < MAX_LIST_EXPORTS_MILLISECONDS &&
            heapGrowth < MAX_LIST_EXPORTS_HEAP_GROWTH,
        true,
        `listExports cloned ${largePlacementClones} large arrays, took ${elapsedMilliseconds} ms, and retained ${heapGrowth} heap bytes`
    )
    assert.deepEqual(
        exports.map((entry) => entry.id),
        ['fabrication-notes-json', 'pick-place-csv', 'routing-dsn']
    )
    assert.equal(
        context.statistics.derivedBuilds['manufacturing:inspection-v1'],
        1
    )

    exports[0].status = 'caller-mutation'
    assert.notEqual(
        ManufacturingService.listExports(context)[0].status,
        'caller-mutation'
    )
})
