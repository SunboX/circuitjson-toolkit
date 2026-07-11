import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import {
    PcbScene3dBuilder,
    PcbScene3dPreparator,
    SceneAssetResolver
} from '../src/scene3d.mjs'
import {
    createAssemblyModel,
    createNativeDocument,
    withCadPlacement
} from './helpers/FakeScene3dDocuments.mjs'

test('PcbScene3dBuilder returns the exact canonical data-only scene shape', () => {
    const scene = PcbScene3dBuilder.build(createAssemblyModel())

    assert.deepEqual(Object.keys(scene), [
        'schema',
        'units',
        'coordinateSystem',
        'board',
        'components',
        'pads',
        'tracks',
        'vias',
        'zones',
        'texts',
        'objects',
        'materials',
        'assets',
        'externalPlacements',
        'diagnostics',
        'statistics'
    ])
    assert.equal(scene.schema, 'ecad-toolkit.scene3d.v1')
    assert.equal(scene.units, 'mm')
    assert.equal(scene.coordinateSystem, 'right-handed-z-up')
    assert.deepEqual(scene.board, {
        id: 'board_1',
        center: { x: 0, y: 0, z: 0 },
        size: { x: 20, y: 10, z: 1.6 },
        material: 'fr4',
        solderMaskColor: '',
        silkscreenColor: '',
        outlines: [
            {
                id: 'board_1',
                center: { x: 0, y: 0 },
                size: { x: 20, y: 10 },
                thickness: 1.6,
                material: 'fr4',
                solderMaskColor: '',
                silkscreenColor: '',
                points: []
            }
        ],
        cutouts: ['cutout_1']
    })
    assert.deepEqual(scene.components[0], {
        id: 'pcb_u1',
        sourceComponentId: 'source_u1',
        side: 'top',
        position: { x: 2, y: 1, z: 0.8 },
        rotation: { x: 0, y: 0, z: 90 },
        size: { x: 3, y: 2, z: 0 },
        materialId: 'component-body'
    })
    assert.equal(scene.pads[0].id, 'pad_1')
    assert.equal(scene.pads[0].position.z, 0.8)
    assert.equal(scene.tracks[0].route[0].position.z, 0.8)
    assert.equal(scene.vias[0].position.z, 0)
    assert.equal(scene.zones[0].position.z, -0.8)
    assert.equal(scene.texts[0].position.z, 0.8)
    assert.deepEqual(
        scene.objects.map((object) => object.id),
        ['hole_1', 'cutout_1']
    )
    assert.deepEqual(
        scene.materials.map((material) => material.id),
        ['board-core', 'component-body', 'copper', 'silkscreen']
    )
    assert.deepEqual(scene.assets, [])
    assert.deepEqual(scene.externalPlacements, [])
    assert.equal(scene.statistics.elementCount, 10)
    assert.equal(scene.statistics.boardCount, 1)
    assert.equal(scene.statistics.objectCount, 2)
    assert.doesNotThrow(() => structuredClone(scene))
})

test('canonical scene preparation is deterministic, immutable, and context-cached', () => {
    const context = CircuitJsonDocumentContext.prepare(createAssemblyModel())
    const first = PcbScene3dBuilder.build(context)
    const second = PcbScene3dBuilder.build(context)

    assert.strictEqual(second, first)
    assert.equal(Object.isFrozen(first), true)
    assert.equal(Object.isFrozen(first.components), true)
    assert.equal(Object.isFrozen(first.components[0]), true)
    assert.equal(context.statistics.derivedBuilds['scene3d:canonical:1.6'], 1)
    assert.equal(context.statistics.indexBuilds.elements, 1)
})

test('canonical scene cache rejects pre-seeded and cross-context values', () => {
    const poisoned = CircuitJsonDocumentContext.prepare(createAssemblyModel())
    poisoned.getOrCreateDerived('scene3d', 'canonical:1.6', () => ({
        schema: 'forged'
    }))
    assert.throws(() => PcbScene3dBuilder.build(poisoned), {
        name: 'ToolkitError',
        code: 'ERR_CONTEXT_CACHE_COLLISION'
    })

    const firstContext = CircuitJsonDocumentContext.prepare(
        createAssemblyModel()
    )
    const firstScene = PcbScene3dBuilder.build(firstContext)
    const secondModel = createAssemblyModel()
    secondModel[0].pcb_board_id = 'board_2'
    secondModel[0].center = { x: 100, y: 100 }
    const secondContext = CircuitJsonDocumentContext.prepare(secondModel)
    assert.throws(
        () =>
            secondContext.getOrCreateDerived(
                'scene3d',
                'canonical:1.6',
                () => firstScene
            ),
        /cannot be transplanted between cache entries/u
    )
})

test('scene options use millimeters and reject accessors without invoking them', () => {
    const scene = PcbScene3dBuilder.build(createAssemblyModel(), {
        boardThickness: '2.4mm'
    })
    const authoredModel = createAssemblyModel()
    authoredModel[0].thickness = '2mm'
    authoredModel[0].material = 'fr1'
    authoredModel[0].solder_mask_color = '#112233'
    authoredModel[0].silkscreen_color = 'white'
    const authored = PcbScene3dBuilder.build(authoredModel)
    let reads = 0
    const hostile = {}
    Object.defineProperty(hostile, 'fidelity', {
        enumerable: true,
        get() {
            reads += 1
            return 'canonical'
        }
    })

    assert.equal(scene.board.size.z, 2.4)
    assert.equal(authored.board.size.z, 2)
    assert.equal(authored.components[0].position.z, 1)
    assert.equal(authored.board.material, 'fr1')
    assert.equal(authored.materials[0].color, '#112233')
    assert.equal(authored.materials[3].color, 'white')
    assert.throws(
        () => PcbScene3dBuilder.build(createAssemblyModel(), hostile),
        {
            name: 'TypeError'
        }
    )
    assert.equal(reads, 0)
    assert.throws(
        () =>
            PcbScene3dBuilder.build(createAssemblyModel(), {
                fidelity: 'best'
            }),
        { name: 'ToolkitError', code: 'ERR_OPTION_INVALID' }
    )
})

test('native fidelity requires a source extension and the first CAD asset id', () => {
    assert.throws(
        () =>
            PcbScene3dBuilder.build(createAssemblyModel(), {
                fidelity: 'native'
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_EXTENSION_DATA_REQUIRED',
            category: 'unsupported'
        }
    )
    assert.throws(
        () =>
            PcbScene3dBuilder.build(
                createNativeDocument('none', {
                    withModelReference: false
                }),
                { fidelity: 'native' }
            ),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_DATA_REQUIRED',
            details: { cadComponentId: 'cad_u1' }
        }
    )
    const extensionWithoutPlacements = DocumentResult.createValidated({
        fileName: 'bare.PcbDoc',
        format: 'altium',
        model: createAssemblyModel(),
        extensions: {
            altium: {
                $meta: {
                    completeness: 'canonical',
                    included: ['scene3d.placements']
                }
            }
        }
    })
    assert.throws(
        () =>
            PcbScene3dBuilder.build(extensionWithoutPlacements, {
                fidelity: 'native'
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_EXTENSION_DATA_REQUIRED',
            details: {
                format: 'altium',
                feature: 'scene3d-placements'
            }
        }
    )
})

test('auto preserves canonical CAD placements and marks native fidelity only when ready', () => {
    const metadata = PcbScene3dBuilder.build(createNativeDocument('metadata'), {
        fidelity: 'auto'
    })
    const full = PcbScene3dBuilder.build(createNativeDocument('full'), {
        fidelity: 'auto'
    })
    const canonical = PcbScene3dBuilder.build(createNativeDocument('full'), {
        fidelity: 'canonical'
    })

    assert.equal(metadata.assets.length, 1)
    assert.equal(metadata.assets[0].data, null)
    assert.equal(metadata.externalPlacements.length, 1)
    assert.equal(metadata.statistics.nativeFidelity, 0)
    assert.equal(full.assets.length, 1)
    assert.equal(full.externalPlacements.length, 1)
    assert.equal(full.statistics.nativeFidelity, 1)
    assert.equal(full.externalPlacements[0].model.assetId, 'asset-body')
    assert.equal(full.externalPlacements[0].model.format, 'step')
    assert.equal(full.externalPlacements[0].extensionRef.format, 'altium')
    assert.equal(canonical.assets.length, 1)
    assert.equal(canonical.externalPlacements.length, 1)
    assert.equal(canonical.statistics.nativeFidelity, 0)
    assert.doesNotThrow(() => structuredClone(full))
})

test('canonical CircuitJSON CAD models remain usable without a source extension', async () => {
    const model = withCadPlacement(createAssemblyModel())
    const built = PcbScene3dBuilder.build(model, { fidelity: 'canonical' })
    const prepared = await PcbScene3dPreparator.prepare(model, {
        fidelity: 'canonical'
    })

    assert.equal(built.assets.length, 1)
    assert.equal(built.assets[0].name, 'models/body.step')
    assert.equal(built.assets[0].data, null)
    assert.equal(built.externalPlacements.length, 1)
    assert.equal(built.externalPlacements[0].model.format, 'step')
    assert.equal(built.externalPlacements[0].extensionRef.format, 'circuitjson')
    assert.equal(prepared.assets[0].data, null)
    assert.doesNotThrow(() => structuredClone(prepared))
})

test('canonical scenes preserve data-only JSCAD and footprinter model generators', () => {
    const jscadModel = withCadPlacement(createAssemblyModel(), false)
    jscadModel.at(-1).model_jscad = {
        kind: 'cuboid',
        size: [3, 2, 1]
    }
    const footprinterModel = withCadPlacement(createAssemblyModel(), false)
    footprinterModel.at(-1).footprinter_string = 'qfn32'
    const jscad = PcbScene3dBuilder.build(jscadModel, {
        fidelity: 'canonical'
    })
    const footprinter = PcbScene3dBuilder.build(footprinterModel, {
        fidelity: 'canonical'
    })

    assert.deepEqual(jscad.externalPlacements[0].model.inlineModel, {
        kind: 'cuboid',
        size: [3, 2, 1]
    })
    assert.equal(jscad.externalPlacements[0].model.assetId, null)
    assert.deepEqual(jscad.assets, [])
    assert.equal(footprinter.externalPlacements[0].model.generator, 'qfn32')
    assert.equal(footprinter.externalPlacements[0].model.format, 'footprinter')
    assert.doesNotThrow(() => structuredClone({ jscad, footprinter }))
})

test('native preparation reports missing bytes without an injected resolver', async () => {
    await assert.rejects(
        () =>
            PcbScene3dPreparator.prepare(createNativeDocument('metadata'), {
                fidelity: 'native'
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_DATA_REQUIRED',
            category: 'unsupported',
            details: { assetId: 'asset-body' }
        }
    )
})

test('async preparation resolves assets through the injected boundary', async () => {
    const calls = []
    const progress = []
    const resolvedBytes = new Uint8Array([9, 8, 7])
    const controller = new AbortController()
    const scene = await PcbScene3dPreparator.prepare(
        createNativeDocument('metadata'),
        {
            fidelity: 'native',
            signal: controller.signal,
            onProgress: (row) => progress.push(row),
            resolveAsset: async (request, runtime) => {
                calls.push({ request, runtime })
                return resolvedBytes
            }
        }
    )

    assert.equal(calls.length, 1)
    assert.equal(calls[0].request.id, 'asset-body')
    assert.strictEqual(calls[0].runtime.signal, controller.signal)
    assert.deepEqual(progress, [
        {
            stage: 'decode',
            detail: 'scene-assets',
            completed: 0,
            total: 1
        },
        {
            stage: 'decode',
            detail: 'scene-assets',
            completed: 1,
            total: 1
        },
        {
            stage: 'complete',
            detail: 'scene-assets',
            completed: 1,
            total: 1
        }
    ])
    assert.deepEqual([...scene.assets[0].data], [9, 8, 7])
    assert.notStrictEqual(scene.assets[0].data, resolvedBytes)
    assert.equal(scene.statistics.resolvedAssetCount, 1)
    assert.doesNotThrow(() => structuredClone(scene))
})

test('auto preparation may select resolvable native assets while build stays synchronous', async () => {
    let calls = 0
    const scene = await PcbScene3dPreparator.prepare(
        createNativeDocument('metadata'),
        {
            fidelity: 'auto',
            resolveAsset: async () => {
                calls += 1
                return new Uint8Array([1, 2, 3])
            }
        }
    )

    assert.equal(calls, 1)
    assert.equal(scene.externalPlacements.length, 1)
    assert.deepEqual([...scene.assets[0].data], [1, 2, 3])
})

test('asset resolution is cancellation-aware and normalizes resolver failures', async () => {
    const controller = new AbortController()
    controller.abort('stop')
    let calls = 0

    await assert.rejects(
        () =>
            PcbScene3dPreparator.prepare(createNativeDocument('metadata'), {
                fidelity: 'native',
                signal: controller.signal,
                resolveAsset: async () => {
                    calls += 1
                    return new Uint8Array([1])
                }
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_CANCELLED',
            category: 'cancelled'
        }
    )
    assert.equal(calls, 0)

    await assert.rejects(
        () =>
            PcbScene3dPreparator.prepare(createNativeDocument('metadata'), {
                fidelity: 'native',
                resolveAsset: async () => {
                    throw new Error('offline')
                }
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_RESOLUTION',
            cause: { name: 'Error', message: 'offline', code: null }
        }
    )
})

test('cancellation uses the AbortSignal brand state and interrupts pending resolvers', async () => {
    const controller = new AbortController()
    Object.defineProperty(controller.signal, 'aborted', {
        configurable: true,
        value: false
    })
    Object.defineProperty(controller.signal, 'addEventListener', {
        configurable: true,
        value() {
            throw new Error('shadowed listener must not run')
        }
    })
    const pending = PcbScene3dPreparator.prepare(
        createNativeDocument('metadata'),
        {
            fidelity: 'native',
            signal: controller.signal,
            resolveAsset: async () => await new Promise(() => {})
        }
    )
    setImmediate(() => controller.abort('stop'))

    await assert.rejects(
        () =>
            Promise.race([
                pending,
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error('cancellation timed out')),
                        100
                    )
                )
            ]),
        {
            name: 'ToolkitError',
            code: 'ERR_CANCELLED',
            category: 'cancelled'
        }
    )
})

test('asset progress stops immediately when its callback cancels the request', async () => {
    const controller = new AbortController()
    const completed = []
    await assert.rejects(
        () =>
            SceneAssetResolver.resolveAll(
                Array.from({ length: 3 }, (_, index) => ({
                    id: `asset-${index}`,
                    name: `model-${index}.step`,
                    data: new Uint8Array([index])
                })),
                {
                    signal: controller.signal,
                    onProgress: (row) => {
                        completed.push(row.completed)
                        if (row.completed === 1) controller.abort()
                    }
                }
            ),
        { name: 'ToolkitError', code: 'ERR_CANCELLED' }
    )
    assert.deepEqual(completed, [0, 1])
})

test('SceneAssetResolver preserves order and bounds resolver concurrency', async () => {
    const requests = Array.from({ length: 17 }, (_, index) => ({
        id: `asset-${index}`,
        kind: 'model3d',
        name: `model-${index}.step`,
        mediaType: 'model/step',
        byteLength: 1,
        data: null,
        source: { index }
    }))
    let active = 0
    let maximum = 0
    const resolved = await SceneAssetResolver.resolveAll(requests, {
        resolveAsset: async (request) => {
            active += 1
            maximum = Math.max(maximum, active)
            await new Promise((resolve) => setImmediate(resolve))
            active -= 1
            return new Uint8Array([Number(request.source.index)])
        }
    })

    assert.ok(maximum > 1)
    assert.ok(maximum <= 8)
    assert.deepEqual(
        resolved.map((asset) => asset.id),
        requests.map((asset) => asset.id)
    )
    assert.deepEqual(
        resolved.map((asset) => asset.data[0]),
        Array.from({ length: 17 }, (_, index) => index)
    )
})

test('SceneAssetResolver rejects missing, accessor-backed, and oversized data', async () => {
    const request = {
        id: 'asset-body',
        kind: 'model3d',
        name: 'body.step',
        mediaType: 'model/step',
        byteLength: 1,
        data: null,
        source: null
    }
    await assert.rejects(
        () =>
            SceneAssetResolver.resolveAll([request], {
                resolveAsset: async () => null
            }),
        { name: 'ToolkitError', code: 'ERR_ASSET_DATA_REQUIRED' }
    )

    await assert.rejects(() => SceneAssetResolver.resolveAll(new Array(1)), {
        name: 'TypeError'
    })
    let requestReads = 0
    const accessorRequests = new Array(1)
    Object.defineProperty(accessorRequests, '0', {
        enumerable: true,
        get() {
            requestReads += 1
            return request
        }
    })
    await assert.rejects(
        () => SceneAssetResolver.resolveAll(accessorRequests),
        { name: 'TypeError' }
    )
    assert.equal(requestReads, 0)

    let reads = 0
    const hostileResult = {}
    Object.defineProperty(hostileResult, 'data', {
        enumerable: true,
        get() {
            reads += 1
            return new Uint8Array([1])
        }
    })
    await assert.rejects(
        () =>
            SceneAssetResolver.resolveAll([request], {
                resolveAsset: async () => hostileResult
            }),
        { name: 'TypeError' }
    )
    assert.equal(reads, 0)

    await assert.rejects(
        () =>
            SceneAssetResolver.resolveAll([request], {
                maxAssetBytes: 2,
                resolveAsset: async () => new Uint8Array([1, 2, 3])
            }),
        { name: 'ToolkitError', code: 'ERR_ASSET_LIMIT' }
    )
})

test('CAD asset matching is exact and rejects ambiguous normalized paths', () => {
    const document = structuredClone(createNativeDocument('full'))
    document.assets.push({
        id: 'asset-body-duplicate',
        kind: 'model3d',
        name: '.\\models\\body.step',
        mediaType: 'model/step',
        byteLength: 3,
        data: new Uint8Array([4, 5, 6]),
        source: { entryName: 'models/body.step' }
    })

    assert.throws(
        () => PcbScene3dBuilder.build(document, { fidelity: 'canonical' }),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_AMBIGUOUS',
            category: 'unsupported'
        }
    )
    assert.throws(
        () =>
            PcbScene3dBuilder.build(createNativeDocument('full'), {
                fidelity: 'canonical',
                maxAssetBytes: 2
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_LIMIT',
            details: {
                assetId: 'asset-body',
                scope: 'asset',
                actual: 3,
                maximum: 2
            }
        }
    )
    assert.throws(
        () =>
            PcbScene3dBuilder.build(createNativeDocument('full'), {
                fidelity: 'canonical',
                maxAssetBytes: 3,
                maxTotalAssetBytes: 2
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_LIMIT',
            details: {
                assetId: 'asset-body',
                scope: 'total',
                actual: 3,
                maximum: 2
            }
        }
    )

    const structuredSource = structuredClone(createNativeDocument('full'))
    structuredSource.assets[0].source.metadata = {
        matcher: /body/giu,
        tags: new Set(['mechanical']),
        values: new Map([['scale', 1]])
    }
    const structuredScene = PcbScene3dBuilder.build(structuredSource, {
        fidelity: 'canonical'
    })
    assert.equal(
        structuredScene.assets[0].source.metadata.matcher.source,
        'body'
    )
    assert.deepEqual(
        [...structuredScene.assets[0].source.metadata.tags],
        ['mechanical']
    )
    assert.deepEqual(
        [...structuredScene.assets[0].source.metadata.values],
        [['scale', 1]]
    )
})

test('SceneAssetResolver copies exact views, isolates shared memory, and enforces a global byte limit', async () => {
    const backing = new Uint8Array([83, 69, 67, 82, 69, 84])
    const exact = await SceneAssetResolver.resolveAll(
        [
            {
                id: 'view',
                kind: 'model3d',
                name: 'view.glb',
                mediaType: 'model/gltf-binary',
                byteLength: 1,
                data: null,
                source: null
            }
        ],
        { resolveAsset: async () => backing.subarray(5, 6) }
    )
    assert.deepEqual([...exact[0].data], [84])
    assert.equal(exact[0].data.byteLength, 1)
    exact[0].data[0] = 0
    assert.equal(backing[5], 84)

    if (typeof SharedArrayBuffer === 'function') {
        const shared = new Uint8Array(new SharedArrayBuffer(1))
        shared[0] = 7
        const isolated = await SceneAssetResolver.resolveAll(
            [
                {
                    id: 'shared',
                    kind: 'model3d',
                    name: 'shared.glb',
                    mediaType: 'model/gltf-binary',
                    byteLength: 1,
                    data: null,
                    source: null
                }
            ],
            { resolveAsset: async () => shared }
        )
        isolated[0].data[0] = 99
        assert.equal(shared[0], 7)
    }

    await assert.rejects(
        () =>
            SceneAssetResolver.resolveAll(
                [
                    {
                        id: 'one',
                        name: 'one.step',
                        data: new Uint8Array([1, 2])
                    },
                    {
                        id: 'two',
                        name: 'two.step',
                        data: new Uint8Array([3, 4])
                    }
                ],
                { maxAssetBytes: 2, maxTotalAssetBytes: 3 }
            ),
        {
            name: 'ToolkitError',
            code: 'ERR_ASSET_LIMIT',
            details: {
                assetId: 'two',
                scope: 'total',
                actual: 4,
                maximum: 3
            }
        }
    )
})

test('scene option and document asset proxies fail as data errors without getter execution', async () => {
    const hostileOptions = new Proxy(
        {},
        {
            getPrototypeOf() {
                throw new Error('prototype trap')
            }
        }
    )
    assert.throws(
        () => PcbScene3dBuilder.build(createAssemblyModel(), hostileOptions),
        { name: 'TypeError' }
    )
    await assert.rejects(
        () =>
            SceneAssetResolver.resolveAll([
                new Proxy(
                    {},
                    {
                        getPrototypeOf() {
                            throw new Error('asset prototype trap')
                        }
                    }
                )
            ]),
        { name: 'TypeError' }
    )

    const document = structuredClone(createNativeDocument('full'))
    let reads = 0
    Object.defineProperty(document.assets[0], 'data', {
        configurable: true,
        enumerable: true,
        get() {
            reads += 1
            return new Uint8Array([1, 2, 3])
        }
    })
    assert.throws(
        () => PcbScene3dBuilder.build(document, { fidelity: 'native' }),
        { name: 'TypeError' }
    )
    assert.equal(reads, 0)

    const accessorEnvelope = structuredClone(createNativeDocument('full'))
    const envelopeAssets = accessorEnvelope.assets
    let envelopeReads = 0
    Object.defineProperty(accessorEnvelope, 'assets', {
        configurable: true,
        enumerable: true,
        get() {
            envelopeReads += 1
            return envelopeAssets
        }
    })
    assert.throws(() => PcbScene3dBuilder.build(accessorEnvelope), {
        name: 'TypeError'
    })
    assert.equal(envelopeReads, 0)

    const iterableDocument = structuredClone(createNativeDocument('full'))
    let iteratorCalls = 0
    Object.defineProperty(iterableDocument.assets, Symbol.iterator, {
        configurable: true,
        value() {
            iteratorCalls += 1
            throw new Error('custom asset iterator must not run')
        }
    })
    assert.throws(
        () =>
            PcbScene3dBuilder.build(iterableDocument, {
                fidelity: 'canonical'
            }),
        { name: 'TypeError' }
    )
    assert.equal(iteratorCalls, 0)

    const sourceDocument = structuredClone(createNativeDocument('full'))
    let sourceReads = 0
    Object.defineProperty(sourceDocument.assets[0].source, 'entryName', {
        configurable: true,
        enumerable: true,
        get() {
            sourceReads += 1
            return 'models/body.step'
        }
    })
    assert.throws(
        () =>
            PcbScene3dBuilder.build(sourceDocument, {
                fidelity: 'canonical'
            }),
        { name: 'TypeError' }
    )
    assert.equal(sourceReads, 0)

    const proxySourceDocument = structuredClone(createNativeDocument('full'))
    proxySourceDocument.assets[0].source = new Proxy(
        {},
        {
            getPrototypeOf() {
                throw new Error('source proxy trap')
            }
        }
    )
    assert.throws(() => PcbScene3dBuilder.build(proxySourceDocument), {
        name: 'TypeError'
    })

    const scalarDocument = structuredClone(createNativeDocument('full'))
    let scalarReads = 0
    scalarDocument.assets[0].name = {
        [Symbol.toPrimitive]() {
            scalarReads += 1
            return 'models/body.step'
        }
    }
    assert.throws(
        () =>
            PcbScene3dBuilder.build(scalarDocument, {
                fidelity: 'canonical'
            }),
        { name: 'TypeError' }
    )
    assert.equal(scalarReads, 0)

    const frozenAssetDocument = structuredClone(createNativeDocument('full'))
    Object.freeze(frozenAssetDocument.assets[0])
    assert.throws(
        () =>
            PcbScene3dBuilder.build(frozenAssetDocument, {
                fidelity: 'canonical'
            }),
        { name: 'TypeError' }
    )
})

test('scene3d core modules do not expose host-runtime objects', async () => {
    const scene = await PcbScene3dPreparator.prepare(
        createNativeDocument('full'),
        { fidelity: 'native' }
    )
    const serialized = JSON.stringify(scene)

    assert.equal(serialized.includes('three'), false)
    assert.equal(serialized.includes('HTMLElement'), false)
    assert.equal(serialized.includes('FileSystem'), false)
    assert.doesNotThrow(() => structuredClone(scene))
})

test('scene3d runtime graph has no Three.js, DOM, process, filesystem, or network dependency', async () => {
    const directory = new URL('../src/core/scene3d/', import.meta.url)
    const names = (await readdir(directory)).filter((name) =>
        name.endsWith('.mjs')
    )
    const sources = await Promise.all(
        [
            new URL('../src/scene3d.mjs', import.meta.url),
            ...names.map((name) => new URL(name, directory))
        ].map(async (url) => await readFile(url, 'utf8'))
    )
    const packageJson = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8')
    )

    assert.equal(packageJson.dependencies?.three, undefined)
    for (const source of sources) {
        assert.doesNotMatch(
            source,
            /from\s+['"](?:three|node:(?:fs|path|child_process|http|https)|https?:)/u
        )
        assert.doesNotMatch(
            source,
            /\b(?:fetch|XMLHttpRequest|WebGLRenderer|HTMLElement)\s*\(/u
        )
        assert.doesNotMatch(source, /\bprocess\s*\./u)
    }
})
