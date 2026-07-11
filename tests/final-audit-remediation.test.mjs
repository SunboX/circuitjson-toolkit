import assert from 'node:assert/strict'
import test from 'node:test'

import * as rootApi from '../src/index.mjs'
import { Parser } from '../src/core/Parser.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'
import { ParserWorkerClient } from '../src/core/worker/ParserWorkerClient.mjs'
import { CircuitJsonLegacyNormalizer } from '../src/core/context/CircuitJsonLegacyNormalizer.mjs'
import { ToolkitLoopbackWorker } from '../src/testing/ToolkitLoopbackWorker.mjs'

test('legacy PCB normalization preserves viewer geometry and canonical layer sides', () => {
    const model = CircuitJsonLegacyNormalizer.normalize([
        {
            type: 'pcb_trace',
            pcb_trace_id: 'trace',
            route: [
                { x: 1, y: 2, width: 0.2, layer: 32 },
                { x: 3, y: 4, width: 0.2, layer: '1' },
                {
                    x: 5,
                    y: 6,
                    from_layer: 'F.Cu',
                    to_layer: { name: 'B.Cu' },
                    via_diameter: 0.4
                }
            ]
        },
        {
            type: 'pcb_via',
            pcb_via_id: 'via',
            x: 7,
            y: 8,
            outer_diameter: 0.6,
            hole_diameter: 0.25
        },
        {
            type: 'pcb_silkscreen_circle',
            pcb_silkscreen_circle_id: 'circle',
            x: 9,
            y: 10,
            radius: 1,
            layer: 'F.SilkS'
        },
        {
            type: 'pcb_silkscreen_oval',
            pcb_silkscreen_oval_id: 'oval',
            center: { x: 11, y: 12 },
            width: 5.08,
            height: 2.54,
            layer: 'B.SilkS'
        },
        {
            type: 'pcb_note_rect',
            pcb_note_rect_id: 'note',
            center: { x: 0, y: 0 },
            width: 1,
            height: 1,
            layer: { name: 'B.SilkS' }
        },
        {
            type: 'pcb_courtyard',
            pcb_courtyard_id: 'courtyard',
            center: { x: 0, y: 0 },
            width: 2,
            height: 3,
            layer: 'F.CrtYd'
        },
        {
            type: 'pcb_copper_pour',
            pcb_copper_pour_id: 'pour',
            shape: 'rect',
            center: { x: 0, y: 0 },
            width: 4,
            height: 5,
            layer: { name: 'B.Cu' }
        }
    ])

    assert.deepEqual(model[0].route[0], {
        x: 1,
        y: 2,
        width: 0.2,
        layer: 'bottom',
        route_type: 'wire'
    })
    assert.equal(model[0].route[1].layer, 'top')
    assert.deepEqual(model[0].route[2], {
        x: 5,
        y: 6,
        from_layer: 'top',
        to_layer: 'bottom',
        via_diameter: 0.4,
        route_type: 'via',
        outer_diameter: 0.4,
        hole_diameter: 0.2
    })
    assert.deepEqual(model[1].layers, ['top', 'bottom'])
    assert.deepEqual(model[2].center, { x: 9, y: 10 })
    assert.equal(model[2].layer, 'top')
    assert.equal(model[2].pcb_component_id, '')
    assert.equal(model[3].radius_x, 2.54)
    assert.equal(model[3].radius_y, 1.27)
    assert.equal(model[3].width, 5.08)
    assert.equal(model[3].height, 2.54)
    assert.equal(model[3].layer, 'bottom')
    assert.equal(model[4].layer, 'bottom')
    assert.equal(model[5].type, 'pcb_courtyard_rect')
    assert.equal(model[5].layer, 'top')
    assert.equal(model[5].pcb_component_id, '')
    assert.equal(model[6].layer, 'bottom')
})

test('legacy layer descriptors are read without executing accessors', () => {
    let reads = 0
    const layer = {}
    Object.defineProperty(layer, 'name', {
        enumerable: true,
        get() {
            reads += 1
            return 'B.Cu'
        }
    })
    const [pour] = CircuitJsonLegacyNormalizer.normalize([
        {
            type: 'pcb_copper_pour',
            pcb_copper_pour_id: 'pour',
            shape: 'rect',
            center: { x: 0, y: 0 },
            width: 1,
            height: 1,
            layer
        }
    ])

    assert.equal(pour.layer, 'top')
    assert.equal(reads, 0)
})

test('full parser accepts normalized viewer legacy PCB records without adapters', () => {
    const document = Parser.parse(
        {
            fileName: 'legacy-board.json',
            data: JSON.stringify([
                {
                    type: 'pcb_trace',
                    pcb_trace_id: 'trace',
                    route: [
                        { x: 0, y: 0, width: 0.2, layer: '32' },
                        {
                            x: 1,
                            y: 1,
                            from_layer: 'F.Cu',
                            to_layer: 'B.Cu',
                            via_diameter: 0.4
                        }
                    ]
                },
                { type: 'pcb_via', pcb_via_id: 'via', x: 1, y: 1 },
                {
                    type: 'pcb_silkscreen_circle',
                    pcb_silkscreen_circle_id: 'circle',
                    x: 2,
                    y: 3,
                    radius: 1,
                    layer: 'F.SilkS'
                },
                {
                    type: 'pcb_silkscreen_oval',
                    pcb_silkscreen_oval_id: 'oval',
                    center: { x: 4, y: 5 },
                    width: 5.08,
                    height: 2.54,
                    layer: 'B.SilkS'
                },
                {
                    type: 'pcb_courtyard',
                    pcb_courtyard_id: 'courtyard',
                    center: { x: 0, y: 0 },
                    width: 4,
                    height: 3,
                    layer: 'F.CrtYd'
                },
                {
                    type: 'pcb_copper_pour',
                    pcb_copper_pour_id: 'pour',
                    shape: 'rect',
                    center: { x: 0, y: 0 },
                    width: 3,
                    height: 2,
                    layer: { name: 'B.Cu' }
                }
            ])
        },
        { extensions: 'full' }
    )

    assert.equal(document.model.length, 6)
    assert.equal(document.model[0].route[0].layer, 'bottom')
    assert.equal(document.model[0].route[1].route_type, 'via')
    assert.deepEqual(document.model[1].layers, ['top', 'bottom'])
    assert.deepEqual(document.model[2].center, { x: 2, y: 3 })
    assert.equal(document.model[3].radius_x, 2.54)
    assert.equal(document.model[4].type, 'pcb_courtyard_rect')
    assert.equal(document.model[5].layer, 'bottom')
})

test('ProjectLoader enforces maxEntries before inspecting any entry record', () => {
    let inspected = 0
    const entry = (name) =>
        new Proxy(
            { name, data: '[]' },
            {
                getPrototypeOf(target) {
                    inspected += 1
                    return Reflect.getPrototypeOf(target)
                }
            }
        )

    assert.throws(
        () =>
            ProjectLoader.load([entry('a.json'), entry('b.json')], {
                archiveLimits: { maxEntries: 1 }
            }),
        { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
    )
    assert.equal(inspected, 0)
})

test('ProjectLoader loadAsync captures stateful entry proxies exactly once', async () => {
    let inspections = 0
    const entry = new Proxy(
        { name: 'board.json', data: '[]' },
        {
            getPrototypeOf(target) {
                inspections += 1
                if (inspections > 1) throw new Error('second inspection')
                return Reflect.getPrototypeOf(target)
            }
        }
    )

    const project = await ProjectLoader.loadAsync([entry], { worker: false })
    assert.equal(project.statistics.entryCount, 1)
    assert.equal(project.documents[0].source.fileName, 'board.json')
    assert.equal(inspections, 1)
})

test('ProjectLoader loadAsync classifies its stable snapshot before progress callbacks', async () => {
    const entry = { name: 'board.json', data: '[]' }
    const entries = [entry]
    const project = await ProjectLoader.loadAsync(entries, {
        worker: false,
        onProgress(progress) {
            if (progress.stage !== 'detect') return
            entry.name = 'readme.txt'
            entry.data = 'not CircuitJSON'
            entries.push({ name: 'late.json', data: '[]' })
        }
    })

    assert.equal(project.statistics.entryCount, 1)
    assert.equal(project.statistics.candidateCount, 1)
    assert.equal(project.documents[0].source.fileName, 'board.json')
})

test('ProjectLoader gives direct and worker paths the same selected entry fields', async () => {
    const entry = { name: 'board.json', data: '[]' }
    Object.defineProperty(entry, 'hidden', { value: 'ignored' })
    entry[Symbol('ignored')] = 'ignored'
    const entries = [entry]
    const direct = await ProjectLoader.loadAsync(entries, { worker: false })
    const workerDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'Worker'
    )
    Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: ToolkitLoopbackWorker.constructorFor(rootApi, {
            parse: 0,
            loadProject: 0
        }),
        writable: true
    })
    try {
        const worker = await ProjectLoader.loadAsync(entries, { worker: true })
        assert.deepEqual(worker, direct)
    } finally {
        ParserWorkerClient.disposeDefault()
        if (workerDescriptor) {
            Object.defineProperty(globalThis, 'Worker', workerDescriptor)
        } else {
            delete globalThis.Worker
        }
    }
})
