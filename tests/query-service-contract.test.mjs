import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
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
            value: 'MCU'
        },
        {
            type: 'source_component',
            source_component_id: 'source_r1',
            name: 'R1',
            ftype: 'simple_resistor',
            value: '10k'
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
            source_trace_id: 'source_trace_sig',
            connected_source_port_ids: ['source_u1_pin1', 'source_r1_pin1'],
            connected_source_net_ids: ['source_net_sig']
        },
        {
            type: 'source_trace',
            source_trace_id: 'source_trace_gnd',
            connected_source_port_ids: ['source_r1_pin2'],
            connected_source_net_ids: ['source_net_gnd']
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
            .traceConnectivity({ sourceComponentId: 'source_u1' })
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
        ['source_net_gnd', 'source_net_sig']
    )
    assert.deepEqual(
        first.traces.map((row) => row.id),
        ['source_trace_gnd', 'source_trace_sig']
    )
    assert.equal(service.statistics.netlistBuilds, 1)

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
    assert.equal(second.findNets().length, 2)
    assert.deepEqual(context.statistics.indexBuilds, before.indexBuilds)
    assert.equal(context.statistics.derivedBuilds['query:netlist-v1'], 1)
})

test('QueryService treats patterns only as bounded data', () => {
    const service = QueryService.create(createConnectedDocument())

    assert.deepEqual(
        service
            .findComponents({
                field: 'name',
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

    for (const criteria of [
        { pattern: '[', match: 'regex' },
        { pattern: 'U', match: 'regex', flags: 'g' },
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
                path: ['source_trace_sig']
            },
            {
                id: 'source_trace_gnd',
                depth: 1,
                path: ['source_trace_sig', 'source_trace_gnd']
            }
        ]
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
})
