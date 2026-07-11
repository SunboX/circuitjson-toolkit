import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonManufacturingBuilder } from '../src/core/CircuitJsonManufacturingBuilder.mjs'
import { CircuitJsonParser } from '../src/index.mjs'

/**
 * Counts full-array filter passes made by the manufacturing builder.
 */
class FilterCountingArray extends Array {
    filterCalls = 0

    /**
     * Counts and delegates one filter pass.
     * @param {Function} callback Filter callback.
     * @param {unknown} [thisArg] Callback receiver.
     * @returns {FilterCountingArray} Filtered array.
     */
    filter(callback, thisArg) {
        this.filterCalls += 1
        return super.filter(callback, thisArg)
    }
}

/**
 * Counts route-point visits made while iterating trace routes.
 */
class RoutePointCountingArray extends Array {
    /**
     * Counts each point yielded by the standard array iterator.
     * @returns {IterableIterator<unknown>} Counting iterator.
     */
    [Symbol.iterator]() {
        const iterator = super[Symbol.iterator]()
        return {
            next() {
                const result = iterator.next()
                if (!result.done) RoutePointCountingArray.pointVisits += 1
                return result
            },
            [Symbol.iterator]() {
                return this
            }
        }
    }

    static pointVisits = 0
}

test('CircuitJsonParser includes drill features and routing guides in manufacturing metadata', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 0, y: 0 },
                width: 8,
                height: 4
            },
            {
                type: 'source_net',
                source_net_id: 'source_net_1',
                name: 'SIG'
            },
            {
                type: 'pcb_via',
                pcb_via_id: 'via_1',
                source_net_id: 'source_net_1',
                x: 2,
                y: 0,
                outer_diameter: 0.6,
                hole_diameter: 0.25,
                layers: ['top', 'bottom']
            },
            {
                type: 'pcb_plated_hole',
                shape: 'circle',
                pcb_plated_hole_id: 'hole_1',
                source_net_id: 'source_net_1',
                x: 3,
                y: 0,
                outer_diameter: 1.2,
                hole_diameter: 0.7,
                layers: ['top', 'bottom']
            },
            {
                type: 'pcb_trace_hint',
                pcb_trace_hint_id: 'hint_1',
                pcb_component_id: 'pcb_u1',
                pcb_port_id: 'port_1',
                source_net_id: 'source_net_1',
                route: [
                    { x: 1, y: 0, layer: 'top' },
                    { x: 2, y: 0, layer: 'top' }
                ]
            },
            {
                type: 'pcb_breakout_point',
                pcb_breakout_point_id: 'breakout_1',
                pcb_group_id: 'group_1',
                source_net_id: 'source_net_1',
                x: 0.5,
                y: -0.5
            }
        ]),
        { fileName: 'guided-routing.json' }
    )

    assert.match(
        model.manufacturing.routingDsn,
        /\(via via_1 2 0 0\.25 0\.6 top bottom\)/
    )
    assert.match(
        model.manufacturing.routingDsn,
        /\(plated_hole hole_1 3 0 0\.7 1\.2 top bottom\)/
    )
    assert.deepEqual(model.manufacturing.routingGuides, [
        {
            type: 'trace_hint',
            id: 'hint_1',
            pcbComponentId: 'pcb_u1',
            pcbPortId: 'port_1',
            sourceNetId: 'source_net_1',
            netName: 'SIG',
            subcircuitId: '',
            route: [
                { x: 1, y: 0, layer: 'top' },
                { x: 2, y: 0, layer: 'top' }
            ]
        },
        {
            type: 'breakout_point',
            id: 'breakout_1',
            pcbGroupId: 'group_1',
            sourceTraceId: '',
            sourcePortId: '',
            sourceNetId: 'source_net_1',
            netName: 'SIG',
            subcircuitId: '',
            point: { x: 0.5, y: -0.5 }
        }
    ])
})

test('CircuitJsonParser extracts fabrication notes for manufacturing export', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_fabrication_note_text',
                pcb_fabrication_note_text_id: 'fab_text_1',
                pcb_component_id: 'pcb_u1',
                pcb_group_id: 'group_1',
                layer: 'top_fabrication',
                text: 'Inspect solder jumpers',
                anchor_position: { x: 1, y: 2 },
                font_size: 0.8,
                color: '#336699'
            },
            {
                type: 'pcb_fabrication_note_dimension',
                pcb_fabrication_note_dimension_id: 'fab_dim_1',
                pcb_component_id: 'pcb_u1',
                layer: 'top_fabrication',
                from: { x: 0, y: 0 },
                to: { x: 3, y: 0 },
                text: '3 mm',
                offset_distance: 0.4,
                arrow_size: 0.25
            }
        ]),
        { fileName: 'fabrication-notes.json' }
    )

    assert.deepEqual(model.manufacturing.fabricationNotes, [
        {
            type: 'text',
            elementType: 'pcb_fabrication_note_text',
            id: 'fab_text_1',
            pcbComponentId: 'pcb_u1',
            pcbGroupId: 'group_1',
            subcircuitId: '',
            layer: 'top_fabrication',
            text: 'Inspect solder jumpers',
            anchor: { x: 1, y: 2 },
            rotation: 0,
            fontSize: 0.8,
            color: '#336699'
        },
        {
            type: 'dimension',
            elementType: 'pcb_fabrication_note_dimension',
            id: 'fab_dim_1',
            pcbComponentId: 'pcb_u1',
            pcbGroupId: '',
            subcircuitId: '',
            layer: 'top_fabrication',
            from: { x: 0, y: 0 },
            to: { x: 3, y: 0 },
            text: '3 mm',
            offset: 0,
            offsetDistance: 0.4,
            offsetDirection: null,
            rotation: 0,
            fontSize: 1,
            arrowSize: 0.25,
            color: ''
        }
    ])
})

test('CircuitJsonManufacturingBuilder groups routing features in bounded passes', () => {
    const sourceNets = new FilterCountingArray()
    const traces = new FilterCountingArray()
    for (let index = 0; index < 64; index += 1) {
        sourceNets.push({
            type: 'source_net',
            source_net_id: `source_net_${index}`,
            name: `NET_${index}`
        })
        traces.push({
            type: 'pcb_trace',
            pcb_trace_id: `trace_${index}`,
            source_net_id: `source_net_${index}`,
            route: [
                { x: 0, y: index, width: 0.2, layer: 'top' },
                { x: 1, y: index, width: 0.2, layer: 'top' }
            ]
        })
    }
    const result = CircuitJsonManufacturingBuilder.build([], {
        elementsByType: new Map([
            ['source_net', sourceNets],
            ['pcb_trace', traces]
        ]),
        sourceComponentById: new Map()
    })

    assert.equal(traces.filterCalls <= 1, true)
    assert.match(result.routingDsn, /\(net NET_0/u)
    assert.match(result.routingDsn, /\(net NET_63/u)
})

test('CircuitJsonManufacturingBuilder skips netless trace routes before formatting at scale', () => {
    RoutePointCountingArray.pointVisits = 0
    const route = new RoutePointCountingArray()
    for (let index = 0; index < 100; index += 1) {
        route.push({ x: index, y: index, width: 0.2, layer: 'top' })
    }
    const traces = Array.from({ length: 5000 }, (_entry, index) => ({
        type: 'pcb_trace',
        pcb_trace_id: `netless_trace_${index}`,
        route
    }))

    const result = CircuitJsonManufacturingBuilder.build([], {
        elementsByType: new Map([
            [
                'source_net',
                [
                    {
                        type: 'source_net',
                        source_net_id: 'source_net_kept',
                        name: 'KEPT'
                    }
                ]
            ],
            ['pcb_trace', traces]
        ]),
        sourceComponentById: new Map()
    })

    assert.equal(RoutePointCountingArray.pointVisits, 0)
    assert.equal(
        result.routingDsn,
        [
            '(pcb assembly)',
            '  (unit mm)',
            '  (structure',
            '    (boundary (rect 0 0 0 0))',
            '    (layer top signal)',
            '    (layer bottom signal)',
            '  )',
            '  (placement',
            '  )',
            '  (network',
            '    (net KEPT',
            '    )',
            '  )',
            ')'
        ].join('\n')
    )
})

test('CircuitJsonManufacturingBuilder skips other netless features before geometry formatting', () => {
    let geometryReads = 0
    const netlessPad = { type: 'pcb_smtpad', pcb_smtpad_id: 'netless_pad' }
    const netlessVia = { type: 'pcb_via', pcb_via_id: 'netless_via' }
    const netlessHole = {
        type: 'pcb_plated_hole',
        pcb_plated_hole_id: 'netless_hole'
    }
    for (const element of [netlessPad, netlessVia, netlessHole]) {
        Object.defineProperty(element, 'center', {
            enumerable: true,
            get() {
                geometryReads += 1
                return { x: 1, y: 2 }
            }
        })
    }

    CircuitJsonManufacturingBuilder.build([], {
        elementsByType: new Map([
            ['pcb_smtpad', [netlessPad]],
            ['pcb_via', [netlessVia]],
            ['pcb_plated_hole', [netlessHole]]
        ]),
        sourceComponentById: new Map()
    })

    assert.equal(geometryReads, 0)
})

test('CircuitJsonManufacturingBuilder handles very large placement sets', () => {
    const componentCount = 150000
    const components = Array.from(
        { length: componentCount },
        (_entry, index) => ({
            type: 'pcb_component',
            pcb_component_id: `pcb_component_${index}`,
            center: { x: index, y: 0 },
            layer: 'top'
        })
    )

    const result = CircuitJsonManufacturingBuilder.build([], {
        elementsByType: new Map([['pcb_component', components]]),
        sourceComponentById: new Map()
    })

    assert.equal(result.pickAndPlaceRows.length, componentCount)
    assert.match(result.routingDsn, /\(component pcb_component_149999 /u)
})
