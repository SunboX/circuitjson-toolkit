import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { CircuitTraversal } from '../src/core/query/CircuitTraversal.mjs'
import { QueryService } from '../src/core/query/QueryService.mjs'

/**
 * Builds a small connected CircuitJSON model with a passive bridge.
 * @returns {object[]} Valid CircuitJSON model.
 */
function createConnectedDocument() {
    return [
        {
            type: 'source_component',
            source_component_id: 'source_u1',
            name: 'U1',
            ftype: 'simple_chip',
            value: 'MCU',
            display_name: 'Controller',
            display_value: 'MCU-X'
        },
        {
            type: 'source_component',
            source_component_id: 'source_r1',
            name: 'R1',
            ftype: 'simple_resistor',
            resistance: 10000,
            internally_connected_source_port_ids: [
                ['source_r1_pin1', 'source_r1_pin2']
            ]
        },
        {
            type: 'source_port',
            source_port_id: 'source_u1_pin2',
            source_component_id: 'source_u1',
            name: 'ALT',
            pin_number: 2
        },
        {
            type: 'source_port',
            source_port_id: 'source_u1_pin1',
            source_component_id: 'source_u1',
            name: 'IO',
            pin_number: 1
        },
        {
            type: 'source_port',
            source_port_id: 'source_r1_pin1',
            source_component_id: 'source_r1',
            name: '1',
            pin_number: 1
        },
        {
            type: 'source_port',
            source_port_id: 'source_r1_pin2',
            source_component_id: 'source_r1',
            name: '2',
            pin_number: 2
        },
        {
            type: 'source_net',
            source_net_id: 'source_net_aux',
            name: 'AUX'
        },
        {
            type: 'source_net',
            source_net_id: 'source_net_sig',
            name: 'SIG'
        },
        {
            type: 'source_net',
            source_net_id: 'source_net_gnd',
            name: 'GND'
        },
        {
            type: 'source_trace',
            source_trace_id: 'source_trace_aux',
            connected_source_port_ids: ['source_u1_pin2'],
            connected_source_net_ids: ['source_net_aux']
        },
        {
            type: 'source_trace',
            source_trace_id: 'source_trace_sig',
            connected_source_port_ids: ['source_u1_pin1', 'source_r1_pin1'],
            connected_source_net_ids: ['source_net_sig']
        },
        {
            type: 'source_trace',
            source_trace_id: 'source_trace_gnd',
            connected_source_port_ids: ['source_r1_pin2'],
            connected_source_net_ids: ['source_net_gnd']
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            center: { x: 0, y: 0 },
            layer: 'top',
            rotation: 0,
            width: 4,
            height: 4,
            metadata: {
                kicad_footprint: { footprintName: 'Package_QFP' }
            }
        }
    ]
}

test('QueryService reuses indexes and returns stable CircuitJSON ids', () => {
    const service = QueryService.create(createConnectedDocument())

    assert.deepEqual(
        service
            .findComponents({ pattern: '^U', match: 'regex' })
            .map((row) => row.id),
        ['source_u1']
    )
    assert.deepEqual(
        service
            .findNets({ pattern: 'GND', match: 'exact' })
            .map((row) => row.id),
        ['source_net_gnd']
    )
    assert.deepEqual(
        service
            .traceConnectivity({ sourcePortId: 'source_u1_pin1' })
            .map((row) => row.id),
        ['source_trace_sig', 'source_trace_gnd']
    )
    assert.deepEqual(service.statistics, {
        validationPasses: 1,
        elementIndexBuilds: 1,
        relationIndexBuilds: 1,
        connectivityIndexBuilds: 1,
        netlistBuilds: 1
    })
})

test('QueryService returns exact clone-safe query and netlist records', () => {
    const document = DocumentResult.createValidated({
        fileName: 'connected.json',
        format: 'circuitjson',
        model: createConnectedDocument()
    })
    const service = QueryService.create(document)
    const result = service.query({
        select: 'components',
        where: { pattern: '1', match: 'contains' }
    })

    assert.equal(result.schema, 'ecad-toolkit.query.v1')
    assert.deepEqual(
        result.items.map((row) => row.id),
        ['source_r1', 'source_u1']
    )
    assert.equal(Array.isArray(result.diagnostics), true)
    assert.equal(typeof result.statistics.connectivityIndexBuilds, 'number')
    assert.doesNotThrow(() => structuredClone(result))

    const first = service.buildNetlist()
    const second = service.buildNetlist()
    assert.equal(first.schema, 'ecad-toolkit.netlist.v1')
    assert.deepEqual(first, second)
    assert.notEqual(first, second)
    assert.deepEqual(
        first.components.map((row) => row.id),
        ['source_r1', 'source_u1']
    )
    assert.deepEqual(
        first.nets.map((row) => row.id),
        ['source_net_aux', 'source_net_gnd', 'source_net_sig']
    )
    assert.deepEqual(
        first.traces.map((row) => row.id),
        ['source_trace_aux', 'source_trace_gnd', 'source_trace_sig']
    )
    assert.deepEqual(
        first.traces.find((row) => row.id === 'source_trace_sig').endpoints,
        [
            { id: 'source_net_sig', kind: 'net' },
            {
                id: 'source_r1_pin1',
                kind: 'port',
                componentId: 'source_r1'
            },
            {
                id: 'source_u1_pin1',
                kind: 'port',
                componentId: 'source_u1'
            }
        ]
    )
    assert.deepEqual(
        first.components
            .find((row) => row.id === 'source_u1')
            .pins.map((pin) => ({ id: pin.id, netIds: pin.netIds })),
        [
            { id: 'source_u1_pin1', netIds: ['source_net_sig'] },
            { id: 'source_u1_pin2', netIds: ['source_net_aux'] }
        ]
    )
    assert.deepEqual(
        first.components
            .find((row) => row.id === 'source_r1')
            .pins.map((pin) => ({ id: pin.id, netIds: pin.netIds })),
        [
            { id: 'source_r1_pin1', netIds: ['source_net_sig'] },
            { id: 'source_r1_pin2', netIds: ['source_net_gnd'] }
        ]
    )
    assert.equal(service.statistics.netlistBuilds, 1)
    assert.deepEqual(first.internalConnections, [
        {
            id: 'source_r1:internal:source_r1_pin1+source_r1_pin2',
            sourceComponentId: 'source_r1',
            sourcePortIds: ['source_r1_pin1', 'source_r1_pin2']
        }
    ])

    first.components[0].name = 'mutated'
    assert.notEqual(service.buildNetlist().components[0].name, 'mutated')
})

test('QueryService accepts prepared contexts without rebuilding indexes', () => {
    const context = CircuitJsonDocumentContext.prepare(
        createConnectedDocument(),
        { indexes: ['elements', 'relations', 'connectivity'] }
    )
    const before = context.statistics
    const first = QueryService.create(context)
    const second = QueryService.create(context)

    assert.equal(first.findComponents().length, 2)
    assert.equal(second.findNets().length, 3)
    assert.deepEqual(context.statistics.indexBuilds, before.indexBuilds)
    assert.equal(context.statistics.derivedBuilds['query:netlist-v1'], 1)
})

test('QueryService treats patterns only as bounded data', () => {
    const service = QueryService.create(createConnectedDocument())

    assert.deepEqual(
        service
            .findComponents({
                field: 'designator',
                pattern: 'u1',
                match: 'exact'
            })
            .map((row) => row.id),
        ['source_u1']
    )
    assert.deepEqual(
        service
            .findComponents({
                field: 'value',
                pattern: '10',
                match: 'contains'
            })
            .map((row) => row.id),
        ['source_r1']
    )
    assert.deepEqual(
        service
            .findComponents({
                field: 'value',
                pattern: '10000',
                match: 'exact'
            })
            .map((row) => row.id),
        ['source_r1']
    )
    assert.deepEqual(
        service
            .findComponents({
                field: 'name',
                pattern: 'Controller',
                match: 'exact'
            })
            .map((row) => row.id),
        ['source_u1']
    )
    assert.deepEqual(
        service
            .findComponents({
                field: 'value',
                pattern: 'MCU-X',
                match: 'exact'
            })
            .map((row) => row.id),
        ['source_u1']
    )
    assert.deepEqual(
        service
            .findComponents({
                field: 'footprint',
                pattern: 'Package_QFP',
                match: 'exact'
            })
            .map((row) => row.id),
        ['source_u1']
    )

    for (const criteria of [
        { pattern: '[', match: 'regex' },
        { pattern: 'U', match: 'regex', flags: 'g' },
        { pattern: 'U', match: 'regex', flags: 'y' },
        { pattern: 'U', match: 'regex', flags: 'ii' },
        { pattern: 'U', match: 'unknown' },
        { pattern: () => true, match: 'regex' }
    ]) {
        assert.throws(() => service.findComponents(criteria), {
            name: 'ToolkitError',
            category: 'validation'
        })
    }

    let getterCalls = 0
    const accessorCriteria = {}
    Object.defineProperty(accessorCriteria, 'pattern', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 'U1'
        }
    })
    assert.throws(() => service.findComponents(accessorCriteria), {
        code: 'ERR_QUERY_REQUEST'
    })
    assert.equal(getterCalls, 0)

    assert.throws(
        () =>
            service.findComponents({
                pattern: 'U',
                match: 'regex',
                flags: false
            }),
        { code: 'ERR_QUERY_PATTERN' }
    )
})

test('QueryService connectivity traversal is ordered, bounded, and cycle-safe', () => {
    const service = QueryService.create(createConnectedDocument())
    const full = service.traceConnectivity({
        sourceTraceId: 'source_trace_sig'
    })

    assert.deepEqual(
        full.map((row) => ({ id: row.id, depth: row.depth, path: row.path })),
        [
            {
                id: 'source_trace_sig',
                depth: 0,
                path: [{ traceId: 'source_trace_sig', via: null }]
            },
            {
                id: 'source_trace_gnd',
                depth: 1,
                path: [
                    { traceId: 'source_trace_sig', via: null },
                    {
                        traceId: 'source_trace_gnd',
                        via: {
                            kind: 'internalConnection',
                            id: 'source_r1:internal:source_r1_pin1+source_r1_pin2'
                        }
                    }
                ]
            }
        ]
    )
    assert.deepEqual(
        service
            .traceConnectivity({ sourceTraceId: 'source_trace_sig' })
            .map((row) => row.id),
        ['source_trace_sig', 'source_trace_gnd']
    )
    assert.deepEqual(
        service
            .traceConnectivity(
                { sourceTraceId: 'source_trace_sig' },
                { maxDepth: 0 }
            )
            .map((row) => row.id),
        ['source_trace_sig']
    )
    assert.deepEqual(
        service
            .traceConnectivity(
                { sourceTraceId: 'source_trace_sig' },
                { maxResults: 1 }
            )
            .map((row) => row.id),
        ['source_trace_sig']
    )

    full[0].endpoints[0].id = 'mutated'
    full[1].path[1].via.id = 'mutated'
    const repeated = service.traceConnectivity({
        sourceTraceId: 'source_trace_sig'
    })
    assert.notEqual(repeated[0].endpoints[0].id, 'mutated')
    assert.notEqual(repeated[1].path[1].via.id, 'mutated')

    assert.throws(() => service.traceConnectivity({}), {
        code: 'ERR_QUERY_REQUEST'
    })
    assert.throws(
        () =>
            service.traceConnectivity(
                { sourceTraceId: 'source_trace_sig' },
                { maxDepth: Infinity }
            ),
        { code: 'ERR_QUERY_REQUEST' }
    )
})

test('QueryService validates select, fields, paging, and caller records', () => {
    const service = QueryService.create(createConnectedDocument())

    assert.throws(() => service.query({ select: 'unknown' }), {
        code: 'ERR_QUERY_REQUEST'
    })
    assert.throws(
        () => service.findComponents({ field: 'constructor', pattern: 'x' }),
        { code: 'ERR_QUERY_REQUEST' }
    )
    assert.throws(() => service.findComponents({}, { limit: 0 }), {
        code: 'ERR_QUERY_REQUEST'
    })
    assert.throws(() => service.findComponents({}, { offset: -1 }), {
        code: 'ERR_QUERY_REQUEST'
    })
    assert.throws(() => service.query(null), {
        code: 'ERR_QUERY_REQUEST'
    })
    assert.throws(() => service.query({ select: 'components', where: null }), {
        code: 'ERR_QUERY_REQUEST'
    })
})

test('QueryService honors explicit source internal-connection elements', () => {
    const model = createConnectedDocument().map((element) => {
        if (
            element.source_component_id !== 'source_r1' ||
            element.type !== 'source_component'
        ) {
            return element
        }
        const { internally_connected_source_port_ids: _omitted, ...rest } =
            element
        return rest
    })
    model.push({
        type: 'source_component_internal_connection',
        source_component_internal_connection_id: 'internal_r1',
        source_component_id: 'source_r1',
        source_port_ids: ['source_r1_pin1', 'source_r1_pin2']
    })
    const service = QueryService.create(model)
    const result = service.traceConnectivity({
        sourceTraceId: 'source_trace_sig'
    })

    assert.deepEqual(
        result.map((row) => row.id),
        ['source_trace_sig', 'source_trace_gnd']
    )
    assert.deepEqual(result[1].path[1].via, {
        kind: 'internalConnection',
        id: 'internal_r1'
    })
})

test('CircuitTraversal expands shared memberships once and bounds fanout work', () => {
    const traceIds = Array.from(
        { length: 100 },
        (_, index) => `trace_${String(index).padStart(3, '0')}`
    )
    const graph = CircuitTraversal.prepare({
        traces: traceIds.map((id) => ({
            id,
            sourcePortIds: [],
            sourceNetIds: ['shared_net'],
            sourceComponentIds: [],
            internalConnectionIds: []
        }))
    })
    const yielded = { count: 0 }
    graph.traceIdsByMembership.set(
        'net:shared_net',
        countedIterable(traceIds, yielded)
    )

    assert.deepEqual(
        CircuitTraversal.trace(
            graph,
            { sourceTraceId: 'trace_000' },
            { maxDepth: 64, maxResults: 2 }
        ).map((row) => row.id),
        ['trace_000', 'trace_001']
    )
    assert.equal(yielded.count, 2)

    yielded.count = 0
    assert.deepEqual(
        CircuitTraversal.trace(
            graph,
            { sourceNetId: 'shared_net' },
            { maxDepth: 64, maxResults: 1 }
        ).map((row) => row.id),
        ['trace_000']
    )
    assert.equal(yielded.count, 1)
})

test('QueryService query matrix is stable across labels, order, and Unicode', () => {
    const document = [
        ...createConnectedDocument(),
        {
            type: 'source_component',
            source_component_id: 'source_duplicate_a',
            name: 'D1',
            display_name: 'Δevice',
            ftype: 'simple_chip'
        },
        {
            type: 'source_component',
            source_component_id: 'source_duplicate_b',
            name: 'D2',
            display_name: 'Δevice',
            ftype: 'simple_chip'
        }
    ]
    const service = QueryService.create(document)

    assert.deepEqual(
        service
            .findComponents({
                field: 'id',
                pattern: 'source_u1',
                match: 'exact'
            })
            .map((row) => row.id),
        ['source_u1']
    )
    assert.deepEqual(
        service
            .findNets({
                field: 'id',
                pattern: '^source_net_[ag]',
                match: 'regex'
            })
            .map((row) => row.id),
        ['source_net_aux', 'source_net_gnd']
    )
    assert.deepEqual(
        service
            .findNets({ pattern: 'nd', match: 'contains' })
            .map((row) => row.id),
        ['source_net_gnd']
    )
    assert.deepEqual(
        service
            .findComponents({ pattern: 'δEVICE', match: 'exact' })
            .map((row) => row.id),
        ['source_duplicate_a', 'source_duplicate_b']
    )
    assert.deepEqual(
        service
            .findComponents({
                pattern: 'δEVICE',
                match: 'exact',
                caseSensitive: true
            })
            .map((row) => row.id),
        []
    )
    const repeatedRegex = {
        field: 'designator',
        pattern: '^D',
        match: 'regex'
    }
    assert.deepEqual(
        service.findComponents(repeatedRegex),
        service.findComponents(repeatedRegex)
    )
    assert.deepEqual(
        QueryService.create([...document].reverse()).buildNetlist(),
        service.buildNetlist()
    )
})

test('inline internal-connection ids derive from stable port membership', () => {
    const groups = [
        ['port_4', 'port_3'],
        ['port_2', 'port_1']
    ]
    const createDocument = (connectionGroups) => [
        {
            type: 'source_component',
            source_component_id: 'component_a',
            name: 'U1',
            ftype: 'simple_chip',
            internally_connected_source_port_ids: connectionGroups
        },
        ...Array.from({ length: 4 }, (_, index) => ({
            type: 'source_port',
            source_port_id: `port_${index + 1}`,
            source_component_id: 'component_a',
            name: String(index + 1),
            pin_number: index + 1
        }))
    ]
    const forward = QueryService.create(createDocument(groups)).buildNetlist()
    const reversed = QueryService.create(
        createDocument([...groups].reverse())
    ).buildNetlist()

    assert.deepEqual(forward.internalConnections, reversed.internalConnections)
    assert.deepEqual(
        forward.internalConnections.map((row) => row.id),
        [
            'component_a:internal:port_1+port_2',
            'component_a:internal:port_3+port_4'
        ]
    )
})

/**
 * Wraps sorted ids with a deterministic yield counter.
 * @param {string[]} ids Sorted trace ids.
 * @param {{ count: number }} counter Mutable yield counter.
 * @returns {Iterable<string>} Counted iterable.
 */
function countedIterable(ids, counter) {
    return {
        *[Symbol.iterator]() {
            for (const id of ids) {
                counter.count += 1
                yield id
            }
        }
    }
}
