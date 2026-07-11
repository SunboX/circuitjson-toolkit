import assert from 'node:assert/strict'
import test from 'node:test'

import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { PcbScene3dBuilder, SceneAssetResolver } from '../src/scene3d.mjs'
import {
    createAssemblyModel,
    createNativeDocument,
    withCadPlacement
} from './helpers/FakeScene3dDocuments.mjs'

test('auto fidelity falls back to canonical models when native references are incomplete', () => {
    for (const assetMode of ['none', 'metadata', 'full']) {
        const scene = PcbScene3dBuilder.build(
            createNativeDocument(assetMode, { withModelReference: false }),
            { fidelity: 'auto' }
        )

        assert.equal(scene.statistics.nativeFidelity, 0)
        assert.equal(scene.assets.length, 0)
        assert.equal(scene.externalPlacements.length, 1)
        assert.equal(scene.externalPlacements[0].model.format, 'bounding-box')
    }
})

test('scene rows reject duplicate PCB and CAD identifiers', () => {
    const duplicateComponent = createAssemblyModel()
    duplicateComponent.push({
        ...duplicateComponent.find(
            (element) => element.type === 'pcb_component'
        ),
        center: { x: 8, y: 1 }
    })
    assert.throws(() => PcbScene3dBuilder.build(duplicateComponent), {
        name: 'ToolkitError',
        code: 'ERR_SCENE_ID_AMBIGUOUS',
        details: { collection: 'components', id: 'pcb_u1' }
    })

    const duplicateCad = withCadPlacement(createAssemblyModel())
    duplicateCad.push({
        ...duplicateCad.at(-1),
        position: { x: 8, y: 1, z: 1.6 }
    })
    assert.throws(
        () =>
            PcbScene3dBuilder.build(duplicateCad, {
                fidelity: 'canonical'
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_SCENE_ID_AMBIGUOUS',
            details: { collection: 'externalPlacements', id: 'cad_u1' }
        }
    )
})

test('multi-board scenes retain each thickness and place geometry on its containing board', () => {
    const model = createAssemblyModel()
    model[0].thickness = 1
    model.push(
        {
            type: 'pcb_board',
            pcb_board_id: 'board_2',
            center: { x: 30, y: 0 },
            width: 10,
            height: 10,
            thickness: 4,
            material: 'fr1'
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u2',
            source_component_id: 'source_u2',
            center: { x: 30, y: 0 },
            width: 2,
            height: 2,
            layer: 'top'
        }
    )

    const scene = PcbScene3dBuilder.build(model)

    assert.equal(scene.board.size.z, 4)
    assert.deepEqual(
        scene.board.outlines.map((outline) => outline.thickness),
        [1, 4]
    )
    assert.deepEqual(
        scene.components.map((component) => component.position.z),
        [0.5, 2]
    )
})

test('scene asset limits are checked before document payload protection copies bytes', () => {
    const document = DocumentResult.create({
        model: withCadPlacement(createAssemblyModel()),
        assets: [
            {
                id: 'asset-body',
                kind: 'model3d',
                name: 'models/body.step',
                data: new Uint8Array([1, 2, 3])
            }
        ]
    })
    const originalSlice = Uint8Array.prototype.slice
    let slices = 0
    Uint8Array.prototype.slice = function (...args) {
        slices += 1
        return Reflect.apply(originalSlice, this, args)
    }

    try {
        assert.throws(
            () =>
                PcbScene3dBuilder.build(document, {
                    fidelity: 'canonical',
                    maxAssetBytes: 1,
                    maxTotalAssetBytes: 1
                }),
            { name: 'ToolkitError', code: 'ERR_ASSET_LIMIT' }
        )
    } finally {
        Uint8Array.prototype.slice = originalSlice
    }

    assert.equal(slices, 0)
})

test('synchronous scene generation caps generated model requests', () => {
    const model = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board-limit',
            center: { x: 0, y: 0 },
            width: 10,
            height: 10
        },
        ...Array.from({ length: 10_001 }, (_entry, index) => ({
            type: 'cad_component',
            cad_component_id: `cad-${index}`,
            pcb_component_id: `pcb-${index}`,
            source_component_id: `source-${index}`,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            size: { x: 1, y: 1, z: 1 },
            model_step_url: `models/model-${index}.step`
        }))
    ]

    assert.throws(
        () => PcbScene3dBuilder.build(model, { fidelity: 'canonical' }),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_LIMIT',
            details: { count: 10_001, maximum: 10_000 }
        }
    )
})

test('scene source metadata isolates SharedArrayBuffer-backed views', () => {
    if (typeof SharedArrayBuffer !== 'function') return
    const shared = new Uint8Array(new SharedArrayBuffer(1))
    shared[0] = 7
    const document = DocumentResult.create({
        model: withCadPlacement(createAssemblyModel()),
        assets: [
            {
                id: 'asset-body',
                kind: 'model3d',
                name: 'models/body.step',
                data: null,
                source: {
                    entryName: 'models/body.step',
                    metadata: { shared }
                }
            }
        ]
    })

    const scene = PcbScene3dBuilder.build(document, {
        fidelity: 'canonical'
    })
    const output = scene.assets[0].source.metadata.shared
    shared[0] = 99

    assert.equal(output[0], 7)
    assert.notEqual(output.buffer, shared.buffer)
})

test('scene envelope and scalar options reject accessors without coercion', () => {
    const document = DocumentResult.create({ model: createAssemblyModel() })
    const source = document.source
    let sourceReads = 0
    Object.defineProperty(document, 'source', {
        configurable: true,
        enumerable: true,
        get() {
            sourceReads += 1
            return source
        }
    })
    assert.throws(() => PcbScene3dBuilder.build(document), TypeError)
    assert.equal(sourceReads, 0)

    const nestedDocument = DocumentResult.create({
        model: createAssemblyModel()
    })
    let formatReads = 0
    Object.defineProperty(nestedDocument.source, 'format', {
        configurable: true,
        enumerable: true,
        get() {
            formatReads += 1
            return 'circuitjson'
        }
    })
    assert.throws(() => PcbScene3dBuilder.build(nestedDocument), TypeError)
    assert.equal(formatReads, 0)

    let coercions = 0
    const fidelity = new Proxy(
        {},
        {
            get(_target, key) {
                if (key === Symbol.toPrimitive) {
                    coercions += 1
                    return () => 'canonical'
                }
                return undefined
            }
        }
    )
    assert.throws(
        () => PcbScene3dBuilder.build(createAssemblyModel(), { fidelity }),
        TypeError
    )
    assert.equal(coercions, 0)
})

test('resolver preflights UTF-8 byte length without allocating an encoded copy', async () => {
    const originalEncode = TextEncoder.prototype.encode
    let encodes = 0
    TextEncoder.prototype.encode = function (...args) {
        encodes += 1
        return Reflect.apply(originalEncode, this, args)
    }

    try {
        await assert.rejects(
            () =>
                SceneAssetResolver.resolveAll(
                    [{ id: 'text', name: 'model.gltf', data: null }],
                    {
                        maxAssetBytes: 1,
                        maxTotalAssetBytes: 1,
                        resolveAsset: async () => '€'
                    }
                ),
            { name: 'ToolkitError', code: 'ERR_ASSET_LIMIT' }
        )
    } finally {
        TextEncoder.prototype.encode = originalEncode
    }

    assert.equal(encodes, 0)
})

test('typed payload views use intrinsic slots rather than shadow accessors', async () => {
    const document = structuredClone(
        DocumentResult.create({
            model: withCadPlacement(createAssemblyModel()),
            assets: [
                {
                    id: 'asset-body',
                    name: 'models/body.step',
                    data: new Uint8Array([1])
                }
            ]
        })
    )
    const documentView = document.assets[0].data
    let documentReads = 0
    Object.defineProperty(documentView, 'buffer', {
        configurable: true,
        get() {
            documentReads += 1
            throw new Error('buffer getter must not run')
        }
    })
    const scene = PcbScene3dBuilder.build(document, {
        fidelity: 'canonical'
    })
    assert.deepEqual([...scene.assets[0].data], [1])
    assert.equal(documentReads, 0)

    const resolverView = new DataView(new Uint8Array([8, 9, 10]).buffer, 1, 1)
    let resolverReads = 0
    Object.defineProperty(resolverView, 'byteLength', {
        configurable: true,
        get() {
            resolverReads += 1
            throw new Error('byteLength getter must not run')
        }
    })
    const [resolved] = await SceneAssetResolver.resolveAll(
        [{ id: 'resolved', name: 'resolved.glb', data: null }],
        { resolveAsset: async () => resolverView }
    )
    assert.deepEqual([...resolved.data], [9])
    assert.equal(resolverReads, 0)
})
