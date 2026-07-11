import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { ManufacturingService } from '../src/core/ManufacturingService.mjs'

/**
 * Builds one canonical assembly with every core manufacturing export.
 * @returns {object[]} CircuitJSON document.
 */
function createAssemblyDocument() {
    return [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_manufacturing',
            center: { x: 0, y: 0 },
            width: 20,
            height: 10
        },
        {
            type: 'source_component',
            source_component_id: 'source_u1',
            name: 'U1',
            ftype: 'simple_chip',
            manufacturer_part_number: 'FAKE-1'
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            center: { x: 1.5, y: -0.5 },
            width: 4,
            height: 3,
            rotation: 90,
            layer: 'top'
        },
        {
            type: 'pcb_fabrication_note_text',
            pcb_fabrication_note_text_id: 'fab_note_1',
            layer: 'top_fabrication',
            text: 'Inspect assembly',
            anchor_position: { x: 1, y: 2 },
            font_size: 0.8
        }
    ]
}

test('ManufacturingService advertises, inspects, and exports core formats', () => {
    const context = CircuitJsonDocumentContext.prepare(createAssemblyDocument())
    const exports = ManufacturingService.listExports(context)
    const inspection = ManufacturingService.inspect(context)
    const file = ManufacturingService.export(context, {
        id: 'pick-place-csv',
        options: {}
    })

    assert.deepEqual(
        exports.map((entry) => entry.id),
        ['fabrication-notes-json', 'pick-place-csv', 'routing-dsn']
    )
    assert.equal(
        exports.every((entry) => entry.status === 'available'),
        true
    )
    assert.equal(inspection.schema, 'ecad-toolkit.manufacturing.v1')
    assert.equal(inspection.placements.length, 1)
    assert.equal(inspection.fabricationNotes.length, 1)
    assert.deepEqual(inspection.exports, exports)
    assert.deepEqual(inspection.diagnostics, [])
    assert.equal(file.fileName, 'manufacturing-pick-place.csv')
    assert.equal(file.mediaType, 'text/csv;charset=utf-8')
    assert.equal(file.data instanceof Uint8Array, true)
    assert.deepEqual(file.diagnostics, [])
    assert.match(new TextDecoder().decode(file.data), /U1,pcb_u1/)
    assert.equal(
        context.statistics.derivedBuilds['manufacturing:inspection-v1'],
        1
    )
    assert.equal(context.statistics.indexBuilds.elements, 1)
    assert.doesNotThrow(() => structuredClone(inspection))
    assert.doesNotThrow(() => structuredClone(file))
})

test('ManufacturingService reports unavailable formats with typed failures', () => {
    const document = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_without_assembly',
            center: { x: 0, y: 0 },
            width: 10,
            height: 5
        }
    ]
    const exports = ManufacturingService.listExports(document)

    assert.equal(
        exports.find((entry) => entry.id === 'pick-place-csv')?.status,
        'unavailable'
    )
    assert.equal(
        exports.find((entry) => entry.id === 'fabrication-notes-json')?.reason,
        'No fabrication note metadata is available.'
    )
    assert.equal(
        exports.find((entry) => entry.id === 'routing-dsn')?.status,
        'available'
    )
    assert.throws(
        () =>
            ManufacturingService.export(document, {
                id: 'pick-place-csv',
                options: {}
            }),
        { code: 'ERR_CAPABILITY_UNAVAILABLE', category: 'unsupported' }
    )
    assert.throws(
        () => ManufacturingService.export(document, { id: 'unknown' }),
        { code: 'ERR_CAPABILITY_UNAVAILABLE' }
    )
})

test('ManufacturingService does not advertise a synthetic DSN for an empty document', () => {
    const exports = ManufacturingService.listExports([])

    assert.equal(
        exports.find((entry) => entry.id === 'routing-dsn')?.status,
        'unavailable'
    )
    assert.throws(
        () =>
            ManufacturingService.export([], {
                id: 'routing-dsn',
                options: {}
            }),
        { code: 'ERR_CAPABILITY_UNAVAILABLE', category: 'unsupported' }
    )
})

test('ManufacturingService rejects accessor-backed requests without executing them', () => {
    let getterCalls = 0
    const request = {}
    Object.defineProperty(request, 'id', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 'pick-place-csv'
        }
    })

    assert.throws(
        () => ManufacturingService.export(createAssemblyDocument(), request),
        { code: 'ERR_MANUFACTURING_REQUEST' }
    )
    assert.equal(getterCalls, 0)
})
