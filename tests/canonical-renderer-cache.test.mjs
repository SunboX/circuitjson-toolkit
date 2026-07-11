import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { BomTableRenderer } from '../src/ui/BomTableRenderer.mjs'
import { CircuitJsonSchematicSvgRenderer } from '../src/ui/CircuitJsonSchematicSvgRenderer.mjs'
import { CircuitJsonSchematicSvgPortMetadata } from '../src/ui/CircuitJsonSchematicSvgPortMetadata.mjs'
import { PcbSvgRenderer } from '../src/ui/PcbSvgRenderer.mjs'
import { SchematicSvgRenderer } from '../src/ui/SchematicSvgRenderer.mjs'
import { createRichCircuitJsonDocument } from './helpers/FakePcbInteractionDocuments.mjs'

/**
 * Builds one deterministic schematic cache test document.
 * @returns {object[]} CircuitJSON rows.
 */
function createSchematicDocument() {
    return [
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'cache_collision_sheet'
        }
    ]
}

test('canonical renderers reject caller-owned derived-cache collisions', () => {
    const pcbContext = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    const pcbCollision = {
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
        primitives: [],
        layers: [],
        virtualLayers: [],
        diagnostics: []
    }
    pcbContext.getOrCreateDerived(
        'render',
        'pcb-primitives-v1',
        () => pcbCollision
    )
    assert.throws(() => PcbSvgRenderer.render(pcbContext), {
        code: 'ERR_INTERACTION_CACHE_COLLISION'
    })
    assert.equal(Object.isFrozen(pcbCollision), false)
    assert.equal(Object.isFrozen(pcbCollision.bounds), false)

    const schematicContext = CircuitJsonDocumentContext.prepare(
        createSchematicDocument()
    )
    const schematicCollision = { svg: '<svg></svg>' }
    schematicContext.getOrCreateDerived(
        'render',
        'schematic-svg-v1:cache_collision_sheet',
        () => schematicCollision
    )
    assert.throws(() => SchematicSvgRenderer.render(schematicContext), {
        code: 'ERR_RENDER_OPTIONS'
    })
    assert.equal(Object.isFrozen(schematicCollision), false)

    const bomRowsContext = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    const bomRowsCollision = [
        { designators: ['X1'], quantity: 1, value: 'caller owned' }
    ]
    bomRowsContext.getOrCreateDerived(
        'render',
        'bom-rows-v1',
        () => bomRowsCollision
    )
    assert.throws(() => BomTableRenderer.render(bomRowsContext), {
        code: 'ERR_RENDER_OPTIONS'
    })
    assert.equal(Object.isFrozen(bomRowsCollision), false)

    const bomTableContext = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    const bomTableCollision = { html: '<table></table>' }
    bomTableContext.getOrCreateDerived(
        'render',
        'bom-table-v1',
        () => bomTableCollision
    )
    assert.throws(() => BomTableRenderer.render(bomTableContext), {
        code: 'ERR_RENDER_OPTIONS'
    })
    assert.equal(Object.isFrozen(bomTableCollision), false)
})

test('canonical renderer cache entries cannot be transplanted across contexts', () => {
    const firstPcb = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    PcbSvgRenderer.render(firstPcb)
    const pcbModel = firstPcb.getOrCreateDerived(
        'render',
        'pcb-primitives-v1',
        () => null
    )
    const secondPcb = CircuitJsonDocumentContext.prepare([
        {
            type: 'pcb_board',
            pcb_board_id: 'different_board',
            center: { x: 100, y: 100 },
            width: 2,
            height: 2
        }
    ])
    assert.throws(
        () =>
            secondPcb.getOrCreateDerived(
                'render',
                'pcb-primitives-v1',
                () => pcbModel
            ),
        TypeError
    )

    const firstSchematic = CircuitJsonDocumentContext.prepare(
        createSchematicDocument()
    )
    SchematicSvgRenderer.render(firstSchematic)
    const schematicEntry = firstSchematic.getOrCreateDerived(
        'render',
        'schematic-svg-v1:cache_collision_sheet',
        () => null
    )
    const secondSchematic = CircuitJsonDocumentContext.prepare(
        createSchematicDocument()
    )
    assert.throws(
        () =>
            secondSchematic.getOrCreateDerived(
                'render',
                'schematic-svg-v1:cache_collision_sheet',
                () => schematicEntry
            ),
        TypeError
    )

    const firstBom = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    BomTableRenderer.render(firstBom)
    const bomRows = firstBom.getOrCreateDerived(
        'render',
        'bom-rows-v1',
        () => null
    )
    const bomTable = firstBom.getOrCreateDerived(
        'render',
        'bom-table-v1',
        () => null
    )
    const secondBom = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    assert.throws(
        () =>
            secondBom.getOrCreateDerived(
                'render',
                'bom-rows-v1',
                () => bomRows
            ),
        TypeError
    )

    const thirdBom = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    assert.throws(
        () =>
            thirdBom.getOrCreateDerived(
                'render',
                'bom-table-v1',
                () => bomTable
            ),
        TypeError
    )
})

test('schematic cache entries cannot be transplanted across sheets', () => {
    const context = CircuitJsonDocumentContext.prepare([
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'cache_sheet_a',
            sheet_index: 0
        },
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'cache_sheet_b',
            sheet_index: 1
        },
        {
            type: 'schematic_text',
            schematic_text_id: 'cache_text_a',
            schematic_sheet_id: 'cache_sheet_a',
            text: 'ONLY_A',
            position: { x: 0, y: 0 }
        },
        {
            type: 'schematic_text',
            schematic_text_id: 'cache_text_b',
            schematic_sheet_id: 'cache_sheet_b',
            text: 'ONLY_B',
            position: { x: 0, y: 0 }
        }
    ])
    SchematicSvgRenderer.render(context, { sheetId: 'cache_sheet_a' })
    const firstSheetEntry = context.getOrCreateDerived(
        'render',
        'schematic-svg-v1:cache_sheet_a',
        () => null
    )
    assert.throws(
        () =>
            context.getOrCreateDerived(
                'render',
                'schematic-svg-v1:cache_sheet_b',
                () => firstSheetEntry
            ),
        TypeError
    )
})

test('legacy mutable source-port labels are never memoized', () => {
    const sourcePort = { port_hints: ['FIRST_HINT'] }

    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label({}, sourcePort),
        'FIRST_HINT'
    )
    sourcePort.port_hints[0] = 'SECOND_HINT'
    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label({}, sourcePort),
        'SECOND_HINT'
    )
})

test('frozen accessor-backed source-port hints are never memoized', () => {
    let hints = Object.freeze(['FIRST_HINT'])
    const sourcePort = {}
    Object.defineProperty(sourcePort, 'port_hints', {
        enumerable: true,
        get() {
            return hints
        }
    })
    Object.freeze(sourcePort)

    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label({}, sourcePort),
        'FIRST_HINT'
    )
    hints = Object.freeze(['SECOND_HINT'])
    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label({}, sourcePort),
        'SECOND_HINT'
    )
})

test('direct source-port labels never inspect unused hint fallbacks', () => {
    let iteratorReads = 0
    const hints = new Proxy(
        Array.from({ length: 150000 }, () => ''),
        {
            get(target, key, receiver) {
                if (key === Symbol.iterator) {
                    iteratorReads += 1
                    throw new Error('unused hints must remain lazy')
                }
                return Reflect.get(target, key, receiver)
            }
        }
    )
    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label(
            {},
            { name: 'CLK', port_hints: hints }
        ),
        'CLK'
    )
    assert.equal(iteratorReads, 0)

    const svg = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'source_port',
            source_port_id: 'source_port_lazy_hints',
            source_component_id: 'source_component_lazy_hints',
            name: 'CLK',
            port_hints: ['FALLBACK']
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_port_lazy_hints',
            source_port_id: 'source_port_lazy_hints',
            center: { x: 0, y: 0 }
        }
    ])
    assert.match(svg, />CLK<\/text>/u)
})

test('source-port label precedence never converts later candidates', () => {
    const poison = Object.freeze({
        /** @returns {never} Unused conversion trap. */
        [Symbol.toPrimitive]() {
            throw new Error('later label candidate was evaluated')
        }
    })

    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label(
            { name: 'ELEMENT', label: poison, pin_number: poison },
            { name: poison, pin_number: poison, port_hints: [poison] }
        ),
        'ELEMENT'
    )
    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label(
            { pin_number: '7' },
            {
                name: '',
                label: '',
                pin_label: '',
                pin_number: poison,
                port_hints: [poison]
            }
        ),
        '7'
    )
    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label(
            {},
            { name: 'SOURCE', label: poison, port_hints: [poison] }
        ),
        'SOURCE'
    )
    assert.equal(
        CircuitJsonSchematicSvgPortMetadata.label(
            {},
            { pin_number: '8', port_hints: [poison] }
        ),
        '8'
    )
})
