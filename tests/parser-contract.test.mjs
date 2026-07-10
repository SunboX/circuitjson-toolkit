import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { ToolkitAsset } from '../src/core/contracts/ToolkitAsset.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { Parser } from '../src/parser.mjs'

test('Parser returns a pure model inside DocumentResult', () => {
    const result = Parser.parse({ fileName: 'board.json', data: '[]' })

    assert.equal(result.schema, 'ecad-toolkit.document.v1')
    assert.deepEqual(result.model, [])
    assert.equal(Object.hasOwn(result.model, 'fileName'), false)
    assert.equal(Object.isFrozen(result.model), true)
    assert.equal(
        CircuitJsonDocumentContext.prepare(result).statistics.validationPasses,
        0
    )
})

test('Parser.tryParse returns exact discriminated results and ToolkitError failures', () => {
    const success = Parser.tryParse({ fileName: 'board.json', data: '[]' })

    assert.deepEqual(Object.keys(success), ['ok', 'value'])
    assert.equal(success.ok, true)
    assert.equal(success.value.schema, 'ecad-toolkit.document.v1')

    const failure = Parser.tryParse({ fileName: 'bad.json', data: '{' })

    assert.deepEqual(Object.keys(failure), ['ok', 'error', 'diagnostics'])
    assert.equal(failure.ok, false)
    assert.equal(failure.error instanceof ToolkitError, true)
    assert.equal(failure.error.code, 'ERR_CIRCUITJSON_PARSE')
    assert.equal(failure.error.category, 'parse')
    assert.equal(failure.error.format, 'circuitjson')
    assert.equal(failure.error.source, 'bad.json')
    assert.equal(failure.error.cause.name, 'SyntaxError')
    assert.equal(failure.error.cause.message.length > 0, true)
    assert.equal(failure.error.cause.code, null)
    assert.equal(Array.isArray(failure.diagnostics), true)
})

test('Parser supports only bounded CircuitJSON input hints', () => {
    const bytes = new TextEncoder().encode('  [ ]  ')

    assert.equal(
        Parser.supports({ fileName: 'board.json', data: '  []' }),
        true
    )
    assert.equal(
        Parser.supports({ fileName: 'board.circuitjson', data: bytes }),
        true
    )
    assert.equal(
        Parser.supports({ fileName: 'board.bin', data: bytes.buffer }),
        true
    )
    assert.equal(
        Parser.supports({ fileName: 'board.json', data: '{"pcb":{}}' }),
        false
    )
    assert.equal(
        Parser.supports({ fileName: 'top.gbr', data: 'G04 Gerber*' }),
        false
    )
    assert.equal(Parser.supports({ fileName: 'board.json', data: '' }), false)
    assert.equal(Parser.supports(null), false)
})

test('Parser normalizes extension, raw, and asset selection without polluting the model', () => {
    const data = new Uint8Array([1, 2, 3])
    const input = {
        fileName: 'board.json',
        data: '[]',
        assets: [
            {
                kind: 'model',
                name: 'body.step',
                mediaType: 'model/step',
                data,
                source: { entryName: 'body.step' }
            }
        ]
    }

    for (const extensions of [
        'none',
        'metadata',
        'canonical',
        'full',
        ['selected-feature']
    ]) {
        const result = Parser.parse(input, { extensions })
        assert.deepEqual(result.extensions, {})
    }

    const none = Parser.parse(input, { decodeAssets: 'none' })
    const metadata = Parser.parse(input, { decodeAssets: 'metadata' })
    const full = Parser.parse(input, {
        decodeAssets: 'full',
        preserveRaw: true
    })

    assert.deepEqual(none.assets, [])
    assert.equal(metadata.assets.length, 1)
    assert.equal(metadata.assets[0].data, null)
    assert.equal(metadata.assets[0].byteLength, 3)
    assert.deepEqual(metadata.assets[0].source, { entryName: 'body.step' })
    assert.equal(full.assets.length, 1)
    assert.equal(full.assets[0].data instanceof Uint8Array, true)
    assert.notEqual(full.assets[0].data, data)
    assert.deepEqual([...full.assets[0].data], [1, 2, 3])
    assert.equal(Object.hasOwn(full.model, 'rawSource'), false)
    assert.deepEqual(full.extensions, {})

    assert.throws(() => Parser.parse(input, { reports: ['unknown-report'] }), {
        name: 'ToolkitError',
        code: 'ERR_CAPABILITY_UNAVAILABLE',
        category: 'unsupported',
        format: 'circuitjson',
        source: 'board.json'
    })
})

test('Parser rejects falsy values outside the exact asset and source enums', () => {
    const input = { fileName: 'options.json', data: '[]' }

    for (const decodeAssets of ['', false, 0, null]) {
        assert.throws(() => Parser.parse(input, { decodeAssets }), {
            name: 'ToolkitError',
            code: 'ERR_CIRCUITJSON_PARSE',
            category: 'parse',
            format: 'circuitjson',
            source: 'options.json'
        })
    }

    for (const retainSource of ['', false, 0, null]) {
        assert.throws(() => Parser.parse(input, { retainSource }), {
            name: 'ToolkitError',
            code: 'ERR_CIRCUITJSON_PARSE',
            category: 'parse',
            format: 'circuitjson',
            source: 'options.json'
        })
    }
})

test('Parser enforces direct, unavailable-worker, and cancellation boundaries', async () => {
    const input = { fileName: 'board.json', data: '[]' }

    assert.throws(() => Parser.parse(input, { worker: true }), {
        name: 'ToolkitError',
        code: 'ERR_WORKER_SYNC_UNAVAILABLE',
        category: 'unsupported'
    })

    const direct = await Parser.parseAsync(input, { worker: false })
    const retained = await Parser.parseAsync(input, {
        retainSource: 'reference',
        worker: 'auto'
    })

    assert.equal(direct.schema, 'ecad-toolkit.document.v1')
    assert.equal(retained.schema, 'ecad-toolkit.document.v1')
    assert.equal(retained.sourceReference, input)
    assert.equal(
        Object.prototype.propertyIsEnumerable.call(retained, 'sourceReference'),
        false
    )
    assert.equal(
        Object.hasOwn(structuredClone(retained), 'sourceReference'),
        false
    )
    assert.deepEqual(Object.keys(retained), [
        'schema',
        'id',
        'modelSchema',
        'model',
        'source',
        'extensions',
        'assets',
        'diagnostics',
        'statistics'
    ])
    assert.doesNotThrow(() => structuredClone(retained))

    await assert.rejects(Parser.parseAsync(input, { worker: true }), {
        name: 'ToolkitError',
        code: 'ERR_CAPABILITY_UNAVAILABLE',
        category: 'unsupported'
    })

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
        Parser.parseAsync(input, {
            signal: controller.signal,
            worker: false
        }),
        {
            name: 'ToolkitError',
            code: 'ERR_CANCELLED',
            category: 'cancelled',
            format: 'circuitjson',
            source: 'board.json'
        }
    )
})

test('Parser.parseAsync emits ordered direct progress and preserves callback failures', async () => {
    const input = { fileName: 'progress.json', data: '[]' }
    const progress = []

    await Parser.parseAsync(input, {
        worker: false,
        onProgress: (row) => progress.push(row)
    })

    assert.deepEqual(
        progress.map((row) => row.stage),
        ['detect', 'decode', 'validate', 'complete']
    )
    assert.doesNotThrow(() => structuredClone(progress))

    const callbackError = new Error('host progress failed')
    await assert.rejects(
        Parser.parseAsync(input, {
            worker: false,
            onProgress: () => {
                throw callbackError
            }
        }),
        (error) => error === callbackError
    )
})

test('Parser canonicalizes full asset payloads exactly once', () => {
    const create = ToolkitAsset.create
    let canonicalizations = 0
    ToolkitAsset.create = (...args) => {
        canonicalizations += 1
        return create.call(ToolkitAsset, ...args)
    }

    try {
        const result = Parser.parse(
            {
                fileName: 'assets.json',
                data: '[]',
                assets: [
                    {
                        name: 'preview.bin',
                        data: new Uint8Array([1, 2, 3])
                    }
                ]
            },
            { decodeAssets: 'full' }
        )

        assert.deepEqual([...result.assets[0].data], [1, 2, 3])
        assert.equal(canonicalizations, 1)
    } finally {
        ToolkitAsset.create = create
    }
})

test('Parser accepts canonical byte inputs without eager derived work', () => {
    const input = {
        fileName: 'component.json',
        data: new TextEncoder().encode(
            JSON.stringify([
                {
                    type: 'source_component',
                    source_component_id: 'source_u1',
                    name: 'U1',
                    ftype: 'simple_chip'
                }
            ])
        )
    }
    const result = Parser.parse(input)
    const context = CircuitJsonDocumentContext.prepare(result)

    assert.equal(result.source.format, 'circuitjson')
    assert.equal(result.source.fileName, 'component.json')
    assert.equal(result.source.fileType, 'circuitjson')
    assert.deepEqual(result.diagnostics, [])
    assert.deepEqual(result.statistics, {})
    assert.equal(Object.hasOwn(result.model, 'fileName'), false)
    assert.equal(Object.hasOwn(result.model, 'bom'), false)
    assert.equal(Object.hasOwn(result.model, 'manufacturing'), false)
    assert.equal(Object.hasOwn(result.model, 'supportMatrix'), false)
    assert.deepEqual(context.statistics, {
        validationPasses: 0,
        indexBuilds: {},
        derivedBuilds: {}
    })
})
