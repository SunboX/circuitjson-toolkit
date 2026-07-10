import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonIndexer } from '../src/core/CircuitJsonIndexer.mjs'
import { CircuitJsonPcbPrimitiveFields } from '../src/core/CircuitJsonPcbPrimitiveFields.mjs'
import { CircuitJsonPcbPrimitiveOverlays } from '../src/core/CircuitJsonPcbPrimitiveOverlays.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { SchematicSheetSelector } from '../src/core/rendering/SchematicSheetSelector.mjs'
import { CanonicalBomRows } from '../src/core/rendering/CanonicalBomRows.mjs'
import { BomTableRenderer } from '../src/ui/BomTableRenderer.mjs'
import { PcbSvgRenderer } from '../src/ui/PcbSvgRenderer.mjs'
import { SchematicSvgRenderer } from '../src/ui/SchematicSvgRenderer.mjs'
import { SchematicTableGeometry } from '../src/ui/SchematicTableGeometry.mjs'

/**
 * Counts accidental full-span table-array slices.
 */
class SliceCountingArray extends Array {
    sliceCalls = 0

    /**
     * Counts and delegates one slice.
     * @param {number} [start] Start index.
     * @param {number} [end] End index.
     * @returns {SliceCountingArray} Sliced values.
     */
    slice(start, end) {
        this.sliceCalls += 1
        return super.slice(start, end)
    }
}

/**
 * Builds an instrumented display value for internal operation counting.
 * @param {string} label Display label.
 * @param {() => void} onConvert Conversion callback.
 * @returns {object} String-convertible value.
 */
function createCountingDisplayValue(label, onConvert) {
    return {
        /** @returns {string} Display label. */
        [Symbol.toPrimitive]() {
            onConvert()
            return label
        }
    }
}

test('canonical PCB physical layer discovery handles very many boards', () => {
    const boards = Array.from({ length: 150000 }, () => ({ num_layers: 2 }))

    assert.deepEqual(
        CircuitJsonPcbPrimitiveFields.layers(boards).map((layer) => layer.id),
        ['top', 'bottom']
    )
})

test('canonical PCB render sets bound and deduplicate discovered layers', () => {
    const document = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_bounded_virtual_layers',
            center: { x: 0, y: 0 },
            width: 10,
            height: 8,
            num_layers: 2
        },
        {
            type: 'pcb_copper_text',
            pcb_copper_text_id: 'colliding_virtual_layer',
            text: 'collision',
            x: 0,
            y: 0,
            layer: 'top_copper'
        },
        ...Array.from({ length: 2000 }, (_entry, index) => ({
            type: 'pcb_copper_text',
            pcb_copper_text_id: `unbounded_virtual_${index}`,
            text: 'x',
            x: index / 100,
            y: 0,
            layer: `attacker_layer_${index}`
        }))
    ]
    const set = PcbSvgRenderer.renderLayers(document)
    const ids = set.items.map((item) => item.id)

    assert.equal(ids.length <= 27, true)
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(ids.filter((id) => id === 'top_copper').length, 1)
    assert.equal(
        ids.some((id) => id.startsWith('attacker_layer_')),
        false
    )
})

test('canonical PCB diagnostics merge very many related primitive bounds', () => {
    const componentId = 'component_many_diagnostic_primitives'
    const diagnostic = {
        type: 'pcb_component_outside_board_error',
        pcb_component_outside_board_error_id: 'diagnostic_many_primitives',
        pcb_component_id: componentId,
        message: 'Many related primitives'
    }
    const primitives = Array.from({ length: 150000 }, (_entry, index) => ({
        id: `mask_${index}`,
        kind: 'solder-mask',
        componentId,
        bounds: {
            minX: index,
            minY: -1,
            maxX: index + 1,
            maxY: 1,
            width: 1,
            height: 2
        }
    }))
    const result = CircuitJsonPcbPrimitiveOverlays.build(
        {
            elementsByType: new Map([[diagnostic.type, [diagnostic]]])
        },
        new Map(),
        primitives,
        { minX: 0, minY: -1, maxX: 150000, maxY: 1, width: 150000, height: 2 }
    )

    assert.equal(result.diagnostics[0].bounds.minX, 0)
    assert.equal(result.diagnostics[0].bounds.maxX, 150000)
})

test('SchematicSheetSelector handles very large explicit sheets', () => {
    const elementCount = 150000
    const elements = [
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'large_explicit_sheet'
        },
        ...Array.from({ length: elementCount }, (_entry, index) => ({
            type: 'schematic_debug_object',
            schematic_debug_object_id: `large_debug_${index}`,
            schematic_sheet_id: 'large_explicit_sheet',
            shape: 'point',
            center: { x: index, y: 0 }
        }))
    ]

    const result = SchematicSheetSelector.select(
        CircuitJsonIndexer.index(elements),
        'large_explicit_sheet'
    )

    assert.equal(result.elements.length, elementCount + 1)
})

test('SchematicSvgRenderer handles very large source-port hint lists', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'source_port',
            source_port_id: 'source_port_many_hints',
            source_component_id: 'source_component_many_hints',
            port_hints: [
                ...Array.from({ length: 150000 }, () => ''),
                'LAST_HINT'
            ]
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_port_many_hints',
            source_port_id: 'source_port_many_hints',
            center: { x: 0, y: 0 }
        }
    ])

    assert.match(svg, />LAST_HINT<\/text>/u)
})

test('SchematicSvgRenderer scans shared immutable port hints once', () => {
    const marker = 'SHARED_LAST_HINT'
    const portCount = 512
    const context = CircuitJsonDocumentContext.prepare([
        {
            type: 'source_port',
            source_port_id: 'source_port_shared_hints',
            source_component_id: 'source_component_shared_hints',
            port_hints: [...Array.from({ length: 511 }, () => ''), marker]
        },
        ...Array.from({ length: portCount }, (_entry, index) => ({
            type: 'schematic_port',
            schematic_port_id: `schematic_port_shared_${index}`,
            source_port_id: 'source_port_shared_hints',
            center: { x: index, y: 0 }
        }))
    ])
    const NativeString = globalThis.String
    let emptyConversions = 0
    globalThis.String = new Proxy(NativeString, {
        apply(target, receiver, argumentsList) {
            if (argumentsList[0] === '') emptyConversions += 1
            return Reflect.apply(target, receiver, argumentsList)
        }
    })
    let svg
    try {
        svg = SchematicSvgRenderer.render(context)
    } finally {
        globalThis.String = NativeString
    }

    assert.equal(svg.match(/>SHARED_LAST_HINT<\/text>/gu)?.length, portCount)
    assert.equal(emptyConversions < 50000, true)
})

test('PcbSvgRenderer handles deeply nested validated source metadata', () => {
    let metadata = { terminal: true }
    for (let depth = 0; depth < 4000; depth += 1) {
        metadata = { child: metadata }
    }
    const context = CircuitJsonDocumentContext.prepare([
        {
            type: 'pcb_board',
            pcb_board_id: 'board_deep_metadata',
            center: { x: 0, y: 0 },
            width: 10,
            height: 8,
            metadata
        }
    ])

    assert.match(PcbSvgRenderer.render(context), /class="pcb-board"/u)
})

test('SchematicTableGeometry resolves large merged cells without span slices', () => {
    const table = SchematicTableGeometry.model({
        type: 'schematic_table',
        schematic_table_id: 'large_merged_table',
        anchor_position: { x: 0, y: 0 },
        column_widths: Array.from({ length: 3000 }, () => 1),
        row_heights: [1]
    })
    table.columns = SliceCountingArray.from(table.columns)
    table.rows = SliceCountingArray.from(table.rows)

    let rect
    for (let index = 0; index < 500; index += 1) {
        rect = SchematicTableGeometry.cellRect(
            { row: 0, column: 0, column_span: 3000 },
            table
        )
    }

    assert.equal(rect.width, 3000)
    assert.equal(table.columns.sliceCalls, 0)
    assert.equal(table.rows.sliceCalls, 0)
})

test('CanonicalBomRows resolves repeated designator labels in bounded passes', () => {
    const componentCount = 256
    let conversions = 0
    const model = Array.from({ length: componentCount }, (_entry, index) => ({
        type: 'source_component',
        source_component_id: `source_repeated_${index}`,
        name: 'R1',
        ftype: 'simple_resistor',
        resistance: index + 1,
        display_value: createCountingDisplayValue(`${index + 1} ohm`, () => {
            conversions += 1
        })
    }))

    assert.equal(CanonicalBomRows.build(model).length, componentCount)
    assert.equal(conversions, componentCount)

    const html = BomTableRenderer.render(
        model.map((component, index) => ({
            ...component,
            display_value: `${index + 1} ohm`
        }))
    )
    assert.equal(html.match(/<tr>/gu)?.length, componentCount + 1)
})
