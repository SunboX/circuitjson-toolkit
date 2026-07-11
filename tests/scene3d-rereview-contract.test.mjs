import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { PcbScene3dBuilder, SceneAssetResolver } from '../src/scene3d.mjs'
import {
    createAssemblyModel,
    createNativeDocument,
    withCadPlacement
} from './helpers/FakeScene3dDocuments.mjs'

/**
 * Creates a validated scene context with one selected and optional unused assets.
 * @param {number} count Asset count.
 * @returns {CircuitJsonDocumentContext} Prepared context.
 */
function assetContext(count) {
    const assets = Array.from({ length: count }, (_entry, index) => {
        const name =
            index === 0 ? 'models/body.step' : `models/unused-${index}.step`
        return {
            id: `asset-${index}`,
            kind: 'model3d',
            name,
            data: null,
            source: {
                entryName: name,
                metadata: { nested: { index } }
            }
        }
    })
    return CircuitJsonDocumentContext.prepare(
        DocumentResult.createValidated({
            model: withCadPlacement(createAssemblyModel()),
            assets
        })
    )
}

/**
 * Counts defineProperty work while building one already validated context.
 * @param {CircuitJsonDocumentContext} context Prepared context.
 * @returns {number} Observed defineProperty calls.
 */
function sceneDefinePropertyCalls(context) {
    const original = Object.defineProperty
    let calls = 0
    Object.defineProperty = function (...args) {
        calls += 1
        return Reflect.apply(original, Object, args)
    }
    try {
        PcbScene3dBuilder.build(context, { fidelity: 'canonical' })
    } finally {
        Object.defineProperty = original
    }
    return calls
}

/**
 * Creates a validated worst-case board-surface lookup context.
 * @param {number} count Equal board and pad count.
 * @returns {CircuitJsonDocumentContext} Prepared context.
 */
function surfaceScalingContext(count) {
    const model = []
    for (let index = 0; index < count; index += 1) {
        model.push({
            type: 'pcb_board',
            pcb_board_id: `board-${index}`,
            center: { x: index * 3, y: 0 },
            width: 2,
            height: 2,
            thickness: index % 2 ? 2 : 1
        })
    }
    const x = (count - 1) * 3
    for (let index = 0; index < count; index += 1) {
        model.push({
            type: 'pcb_smtpad',
            pcb_smtpad_id: `pad-${index}`,
            x,
            y: 0,
            width: 0.5,
            height: 0.5,
            shape: 'rect',
            layer: 'top'
        })
    }
    return CircuitJsonDocumentContext.prepare(
        DocumentResult.createValidated({ model })
    )
}

/**
 * Measures one first scene build on an already validated context.
 * @param {CircuitJsonDocumentContext} context Prepared context.
 * @returns {number} Elapsed milliseconds.
 */
function buildMilliseconds(context) {
    const started = performance.now()
    PcbScene3dBuilder.build(context)
    return performance.now() - started
}

test('explicit native build rejects a referenced asset without resident or resolvable data', () => {
    assert.throws(
        () =>
            PcbScene3dBuilder.build(createNativeDocument('none'), {
                fidelity: 'native'
            }),
        { name: 'ToolkitError', code: 'ERR_ASSET_DATA_REQUIRED' }
    )
})

test('canonical cache distinguishes an explicit global thickness override', () => {
    const model = createAssemblyModel()
    model[0].thickness = 1
    model.push({
        type: 'pcb_board',
        pcb_board_id: 'board_2',
        center: { x: 30, y: 0 },
        width: 10,
        height: 10,
        thickness: 4
    })
    const context = CircuitJsonDocumentContext.prepare(model)

    const authored = PcbScene3dBuilder.build(context)
    const overridden = PcbScene3dBuilder.build(context, {
        boardThickness: 1
    })

    assert.notStrictEqual(overridden, authored)
    assert.deepEqual(
        authored.board.outlines.map((outline) => outline.thickness),
        [1, 4]
    )
    assert.deepEqual(
        overridden.board.outlines.map((outline) => outline.thickness),
        [1, 1]
    )
    assert.equal(overridden.board.size.z, 1)
})

test('polygon-only geometry derives a representative board-surface point', () => {
    const model = createAssemblyModel()
    model[0].thickness = 1
    model.push(
        {
            type: 'pcb_board',
            pcb_board_id: 'board_2',
            center: { x: 30, y: 0 },
            width: 10,
            height: 10,
            thickness: 4
        },
        {
            type: 'pcb_copper_pour',
            pcb_copper_pour_id: 'zone_2',
            shape: 'polygon',
            points: [
                { x: 28, y: -2 },
                { x: 32, y: -2 },
                { x: 32, y: 2 },
                { x: 28, y: 2 }
            ],
            layer: 'bottom',
            net: 'GND_2'
        }
    )

    const scene = PcbScene3dBuilder.build(model)
    const zone = scene.zones.find((row) => row.id === 'zone_2')

    assert.equal(zone.position.x, 30)
    assert.equal(zone.position.y, 0)
    assert.equal(zone.position.z, -2)
})

test('top-level document proxy builds without ordinary get-trap execution', () => {
    const document = DocumentResult.create({ model: createAssemblyModel() })
    let reads = 0
    const proxy = new Proxy(document, {
        get(target, key, receiver) {
            reads += 1
            return Reflect.get(target, key, receiver)
        }
    })

    const scene = PcbScene3dBuilder.build(proxy)

    assert.equal(scene.board.id, 'board_1')
    assert.equal(reads, 0)
})

test('source format rejects object coercion without executing it', () => {
    const document = DocumentResult.create({ model: createAssemblyModel() })
    let coercions = 0
    document.source.format = {
        [Symbol.toPrimitive]() {
            coercions += 1
            return 'circuitjson'
        }
    }

    assert.throws(() => PcbScene3dBuilder.build(document), TypeError)
    assert.equal(coercions, 0)
})

test('resident resolver text is UTF-8 bounded before ToolkitAsset encoding', async () => {
    const original = TextEncoder.prototype.encode
    let encodes = 0
    TextEncoder.prototype.encode = function (...args) {
        encodes += 1
        return Reflect.apply(original, this, args)
    }
    try {
        await assert.rejects(
            () =>
                SceneAssetResolver.resolveAll(
                    [{ id: 'resident-text', data: '€' }],
                    { maxAssetBytes: 1, maxTotalAssetBytes: 1 }
                ),
            { name: 'ToolkitError', code: 'ERR_ASSET_LIMIT' }
        )
    } finally {
        TextEncoder.prototype.encode = original
    }
    assert.equal(encodes, 0)
})

test('resident resolver views use intrinsic DataView slots', async () => {
    const view = new DataView(new Uint8Array([4, 5, 6]).buffer, 1, 1)
    let reads = 0
    Object.defineProperty(view, 'buffer', {
        configurable: true,
        get() {
            reads += 1
            throw new Error('buffer getter must not run')
        }
    })

    const [asset] = await SceneAssetResolver.resolveAll([
        { id: 'resident-view', data: view }
    ])

    assert.deepEqual([...asset.data], [5])
    assert.equal(reads, 0)
})

test('document assets share one bounded source-metadata graph budget', () => {
    const assets = Array.from({ length: 101 }, (_entry, assetIndex) => ({
        id: `asset-${assetIndex}`,
        kind: 'model3d',
        name: `unused-${assetIndex}.step`,
        data: null,
        source: {
            uri: `unused-${assetIndex}.step`,
            metadata: {
                nodes: Array.from({ length: 1000 }, (_node, index) => index)
            }
        }
    }))
    const document = DocumentResult.create({
        model: createAssemblyModel(),
        assets
    })
    assert.throws(() => {
        const context = CircuitJsonDocumentContext.prepare(document)
        PcbScene3dBuilder.build(context)
    }, /asset source is too large/u)
})

test('scene asset indexing does not clone unreferenced source metadata', () => {
    const single = assetContext(1)
    const many = assetContext(20)

    const singleCalls = sceneDefinePropertyCalls(single)
    const manyCalls = sceneDefinePropertyCalls(many)

    assert.ok(
        manyCalls <= singleCalls + 2,
        `unreferenced metadata added ${manyCalls - singleCalls} clone operations`
    )
})

test('board-surface lookup remains subquadratic from 3200 to 6400 boards', () => {
    buildMilliseconds(surfaceScalingContext(128))
    const small = buildMilliseconds(surfaceScalingContext(3200))
    const large = buildMilliseconds(surfaceScalingContext(6400))

    assert.ok(
        large < small * 2.8,
        `surface lookup scaled ${Number((large / small).toFixed(2))}x (${small.toFixed(1)} ms -> ${large.toFixed(1)} ms)`
    )
})
