import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { CircuitJsonBomBuilder } from '../src/core/CircuitJsonBomBuilder.mjs'
import { CircuitJsonIndexer } from '../src/core/CircuitJsonIndexer.mjs'
import { PcbInteractionPrimitiveModel } from '../src/core/PcbInteractionPrimitiveModel.mjs'
import { CanonicalRenderOptions } from '../src/core/rendering/CanonicalRenderOptions.mjs'
import { PcbRenderPlan } from '../src/core/rendering/PcbRenderPlan.mjs'
import { SchematicSheetSelector } from '../src/core/rendering/SchematicSheetSelector.mjs'
import { BomTableRenderer } from '../src/ui/BomTableRenderer.mjs'
import { CircuitJsonPcbPrimitiveAttributeRenderer } from '../src/ui/CircuitJsonPcbPrimitiveAttributeRenderer.mjs'
import { CircuitJsonPcbSvgRenderer } from '../src/ui/CircuitJsonPcbSvgRenderer.mjs'
import { PcbSvgRenderer } from '../src/ui/PcbSvgRenderer.mjs'
import { SchematicSvgRenderer } from '../src/ui/SchematicSvgRenderer.mjs'
import { createRichCircuitJsonDocument } from './helpers/FakePcbInteractionDocuments.mjs'

test('PcbSvgRenderer renders selected layers from one prepared plan', () => {
    const context = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    const result = PcbSvgRenderer.renderLayers(context, {
        side: 'top',
        layers: ['top_copper', 'top_silkscreen']
    })

    assert.equal(result.schema, 'ecad-toolkit.render-set.v1')
    assert.deepEqual(
        result.items.map((item) => item.id),
        ['top_copper', 'top_silkscreen']
    )
    assert.deepEqual(
        result.items.map((item) => item.layerIds),
        [['top_copper'], ['top_silkscreen']]
    )
    assert.equal(
        result.items.every((item) => item.side === 'top'),
        true
    )
    assert.equal(
        result.items.every((item) => item.svg.startsWith('<svg')),
        true
    )
    assert.equal(result.items[0].svg.includes('pcb-track'), true)
    assert.equal(result.items[0].svg.includes('pcb-silkscreen'), false)
    assert.equal(result.items[1].svg.includes('pcb-silkscreen'), true)
    assert.equal(result.items[1].svg.includes('pcb-track'), false)
    assert.equal(
        context.statistics.derivedBuilds['render:pcb-primitives-v1'],
        1
    )
    assert.equal(result.statistics.primitiveBuilds, 1)
    assert.doesNotThrow(() => structuredClone(result))

    PcbSvgRenderer.renderLayers(context, {
        side: 'top',
        layers: ['top_copper']
    })
    assert.equal(
        context.statistics.derivedBuilds['render:pcb-primitives-v1'],
        1
    )
})

test('PcbRenderPlan normalizes deterministic canonical layer selection', () => {
    const document = createRichCircuitJsonDocument()
    const plan = PcbRenderPlan.prepare(document, {
        side: 'top',
        layers: ['top_silkscreen', 'top_copper']
    })

    assert.equal(plan.schema, 'ecad-toolkit.pcb-render-plan.v1')
    assert.equal(plan.side, 'top')
    assert.deepEqual(
        plan.layers.map((layer) => layer.id),
        ['top_silkscreen', 'top_copper']
    )
    assert.equal(plan.model.primitives.length > 0, true)
    assert.equal(plan.diagnostics === plan.model.diagnostics, false)
    assert.throws(() => plan.model.primitives.push({}), TypeError)
})

test('PcbRenderPlan never freezes its caller-owned context', () => {
    const context = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )

    PcbRenderPlan.prepare(context)

    assert.equal(Object.isFrozen(context), false)
    assert.equal(Object.isExtensible(context), true)
    context.hostMetadata = 'still mutable'
    assert.equal(context.hostMetadata, 'still mutable')
    delete context.hostMetadata
})

test('canonical PCB render preserves legacy full-document SVG', () => {
    const document = createRichCircuitJsonDocument()
    const legacy = CircuitJsonPcbSvgRenderer.render(document, {
        side: 'bottom'
    })

    assert.equal(PcbSvgRenderer.render(document, { side: 'bottom' }), legacy)
})

test('legacy multi-side rendering prepares primitives once', () => {
    const document = createRichCircuitJsonDocument()
    const original = PcbInteractionPrimitiveModel.build
    let builds = 0
    PcbInteractionPrimitiveModel.build = (...args) => {
        builds += 1
        return original.call(PcbInteractionPrimitiveModel, ...args)
    }

    try {
        const rendered = CircuitJsonPcbSvgRenderer.renderSides(document, [
            'top',
            'bottom'
        ])
        assert.equal(builds, 1)
        assert.deepEqual(rendered, [
            CircuitJsonPcbSvgRenderer.render(document, { side: 'top' }),
            CircuitJsonPcbSvgRenderer.render(document, { side: 'bottom' })
        ])
    } finally {
        PcbInteractionPrimitiveModel.build = original
    }
})

test('prepared PCB rendering rejects forged plans before serialization', () => {
    const forged = {
        model: {
            bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
            primitives: [],
            layers: [],
            virtualLayers: [],
            diagnostics: [],
            airwires: []
        },
        selectedLayerIds: null,
        side: 'top" onload="globalThis.pwned=1',
        svg: { attributes: { onclick: 'globalThis.pwned=2' } },
        layers: []
    }

    assert.throws(() => CircuitJsonPcbSvgRenderer.renderPlan(forged), {
        code: 'ERR_RENDER_OPTIONS'
    })
})

test('legacy PCB paint remains limited to hexadecimal colors', () => {
    const attributes = CircuitJsonPcbPrimitiveAttributeRenderer.render({
        id: 'legacy_named_paint',
        kind: 'line',
        strokeColor: 'red',
        fillColor: 'blue',
        netColor: 'green'
    })

    assert.equal(attributes.includes('stroke="red"'), false)
    assert.equal(attributes.includes('fill="blue"'), false)
    assert.equal(attributes.includes('--pcb-net-color: green'), false)
})

test('canonical PCB render sets retain neutral panel and breakout layers', () => {
    const document = createRichCircuitJsonDocument()
    const full = PcbSvgRenderer.render(document, { side: 'top' })
    const set = PcbSvgRenderer.renderLayers(document, { side: 'top' })
    const panel = set.items.find((item) => item.id === 'panel')
    const breakout = set.items.find((item) => item.id === 'breakout_points')
    const fabrication = set.items.find((item) => item.id === 'top_fabrication')

    assert.equal(full.includes('pcb-panel-outline'), true)
    assert.equal(full.includes('pcb-breakout-point'), true)
    assert.equal(panel?.svg.includes('pcb-panel-outline'), true)
    assert.equal(breakout?.svg.includes('pcb-breakout-point'), true)
    assert.equal(
        full.includes('data-pcb-primitive-id="note_dimension_1:0"'),
        true
    )
    assert.equal(
        fabrication?.svg.includes('data-pcb-primitive-id="note_dimension_1:0"'),
        true
    )
    assert.equal(
        fabrication?.svg.includes('data-pcb-primitive-id="fab_dimension_1:0"'),
        true
    )
    assert.equal(full.includes('data-pcb-primitive-id="hint_1:0"'), true)
    assert.equal(
        fabrication?.svg.includes('data-pcb-primitive-id="hint_1:0"'),
        true
    )
})

test('canonical PCB render sets derive complete physical layer unions', () => {
    for (const [document, layerId, primitiveId] of [
        [
            createImplicitFourLayerDocument(),
            'inner1_copper',
            'trace_inner:segment:0'
        ],
        [
            createMultiBoardLayerDocument(),
            'inner4_copper',
            'trace_inner4:segment:0'
        ]
    ]) {
        const full = PcbSvgRenderer.render(document, { side: 'top' })
        const set = PcbSvgRenderer.renderLayers(document, { side: 'top' })
        const layer = set.items.find((item) => item.id === layerId)

        assert.equal(
            full.includes(`data-pcb-primitive-id="${primitiveId}"`),
            true
        )
        assert.equal(
            layer?.svg.includes(`data-pcb-primitive-id="${primitiveId}"`),
            true
        )
    }
    const multiBoardLayers = PcbSvgRenderer.renderLayers(
        createMultiBoardLayerDocument(),
        { side: 'top' }
    )
    assert.equal(
        multiBoardLayers.items
            .find((item) => item.id === 'inner4_copper')
            ?.svg.includes('data-pcb-primitive-id="via_union"'),
        true
    )
})

test('canonical PCB rendering serializes every board substrate', () => {
    const svg = PcbSvgRenderer.render(createMultiBoardLayerDocument(), {
        side: 'top'
    })

    assert.equal(svg.match(/class="pcb-board"/gu)?.length, 2)
    assert.equal(svg.includes('<rect class="pcb-board" x="-11"'), true)
    assert.equal(svg.includes('<rect class="pcb-board" x="1"'), true)
})

test('canonical PCB physical layer discovery stays bounded', () => {
    const document = createLayerUnionDocument(
        [
            {
                type: 'pcb_board',
                pcb_board_id: 'board_oversized_layers',
                center: { x: 0, y: 0 },
                width: 10,
                height: 8,
                num_layers: 999
            }
        ],
        'inner6',
        'trace_oversized_inner'
    )
    const physical = PcbRenderPlan.prepare(document).model.layers

    assert.deepEqual(
        physical.map((layer) => layer.id),
        [
            'top',
            'inner1',
            'inner2',
            'inner3',
            'inner4',
            'inner5',
            'inner6',
            'bottom'
        ]
    )
})

test('canonical PCB layers honor explicit blind and buried via spans', () => {
    const document = createViaSpanDocument()
    const hasVia = Object.fromEntries(
        ['top_copper', 'inner1_copper', 'inner2_copper', 'bottom_copper'].map(
            (layer) => [
                layer,
                PcbSvgRenderer.render(document, {
                    side: layer === 'bottom_copper' ? 'bottom' : 'top',
                    layers: [layer]
                }).includes('pcb-via')
            ]
        )
    )

    assert.deepEqual(hasVia, {
        top_copper: true,
        inner1_copper: true,
        inner2_copper: false,
        bottom_copper: false
    })

    const conflicting = createViaSpanDocument()
    conflicting[1].from_layer = 'top'
    conflicting[1].to_layer = 'bottom'
    assert.equal(
        PcbSvgRenderer.render(conflicting, {
            side: 'top',
            layers: ['inner2_copper']
        }).includes('data-pcb-primitive-id="via_blind"'),
        false
    )
})

test('canonical PCB layers normalize standard visible-side detail layers', () => {
    const document = createStandardSilkscreenDocument()
    const defaults = PcbSvgRenderer.renderLayers(document, { side: 'top' })
    assert.equal(
        defaults.items.some((item) => item.id === 'top_silkscreen'),
        true
    )

    const top = PcbSvgRenderer.render(document, {
        side: 'top',
        layers: ['top_silkscreen']
    })
    assert.equal(top.includes('data-pcb-primitive-id="silk_line_top:0"'), true)
    assert.equal(top.includes('data-pcb-primitive-id="silk_text_top"'), true)
    assert.equal(top.includes('silk_line_bottom'), false)
    assert.equal(
        top.indexOf('data-pcb-primitive-id="silk_line_top:0"') >
            top.indexOf('pcb-copper--surface'),
        true
    )

    const bottom = PcbSvgRenderer.render(document, {
        side: 'bottom',
        layers: ['bottom_silkscreen']
    })
    assert.equal(
        bottom.includes('data-pcb-primitive-id="silk_line_bottom:0"'),
        true
    )
    assert.equal(
        bottom.includes('data-pcb-primitive-id="silk_text_bottom"'),
        true
    )
    assert.equal(bottom.includes('silk_line_top'), false)
    assert.equal(
        bottom.indexOf('data-pcb-primitive-id="silk_line_bottom:0"') >
            bottom.indexOf('pcb-copper--surface'),
        true
    )

    const bottomDefaults = PcbSvgRenderer.renderLayers(document, {
        side: 'bottom'
    })
    assert.equal(
        bottomDefaults.items.some((item) => item.id === 'top_silkscreen'),
        false
    )
    assert.equal(
        bottomDefaults.items.some((item) => item.id === 'bottom_silkscreen'),
        true
    )
    assert.throws(
        () =>
            PcbSvgRenderer.render(document, {
                side: 'bottom',
                layers: ['top_silkscreen']
            }),
        { code: 'ERR_RENDER_OPTIONS' }
    )
})

test('canonical SVG controls are safe, deterministic, and cache-independent', () => {
    const controls = {
        id: 'host-board',
        className: 'host-svg export-preview',
        title: 'Board <top>',
        description: 'Host & preview',
        attributes: {
            'aria-label': 'PCB <preview>',
            'data-host-view': 'main'
        },
        style: {
            '--ecad-board-fill': '#123456',
            '--ecad-copper-fill': 'rgb(1 2 3)'
        }
    }
    const svg = PcbSvgRenderer.render(createRichCircuitJsonDocument(), controls)

    assert.match(svg, /^<svg id="host-board" /)
    assert.equal(svg.includes('host-svg export-preview'), true)
    assert.equal(svg.includes('<title>Board &lt;top&gt;</title>'), true)
    assert.equal(svg.includes('<desc>Host &amp; preview</desc>'), true)
    assert.equal(svg.includes('aria-label="PCB &lt;preview&gt;"'), true)
    assert.equal(svg.includes('data-host-view="main"'), true)
    assert.equal(
        svg.includes(
            'style="--ecad-board-fill:#123456;--ecad-copper-fill:rgb(1 2 3)"'
        ),
        true
    )

    const context = CircuitJsonDocumentContext.prepare([
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_svg_controls',
            name: 'SVG controls'
        }
    ])
    const first = SchematicSvgRenderer.render(context, { title: 'First' })
    const second = SchematicSvgRenderer.render(context, { title: 'Second' })
    assert.equal(first.includes('<title>First</title>'), true)
    assert.equal(first.includes('<title>Second</title>'), false)
    assert.equal(second.includes('<title>Second</title>'), true)
})

test('canonical renderers reject unsupported options and unavailable fidelity', () => {
    const document = createRichCircuitJsonDocument()
    for (const options of [
        { side: 'left' },
        { layers: 'top_copper' },
        { layers: ['top_copper', 'top_copper'] },
        { layers: ['missing_layer'] },
        { fidelity: 'lossy' },
        { attributes: { onclick: 'alert(1)' } },
        { attributes: { 'data-host:mode': 'invalid-namespace' } },
        { className: 'invalid"class' },
        { style: { '--host-image': 'url(https://example.invalid/a)' } },
        { style: { '--host-image': 'url(//example.invalid/a)' } },
        { style: { '--host-image': 'image-set(/remote.svg)' } },
        { style: { '--host-image': '-webkit-image-set(//example.invalid/a)' } },
        { style: { '--host-image': '-moz-element(#target)' } },
        { style: { '--host-value': 'var(--host-resource)' } },
        { style: { '--ecad-board-fill': 'red;display:none' } },
        { title: 'invalid\u0000title' },
        { attributes: { 'data-host': 'invalid\u0000value' } },
        { style: { '--ecad-board-fill': '#fff\f' } },
        { description: 'invalid\ud800text' },
        { unknown: true }
    ]) {
        assert.throws(() => PcbSvgRenderer.renderLayers(document, options), {
            code: 'ERR_RENDER_OPTIONS'
        })
    }
    assert.throws(
        () => PcbSvgRenderer.render(document, { fidelity: 'native' }),
        { code: 'ERR_EXTENSION_DATA_REQUIRED' }
    )
    let getterCalls = 0
    const accessorOptions = {}
    Object.defineProperty(accessorOptions, 'side', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 'top'
        }
    })
    assert.throws(
        () => PcbSvgRenderer.renderLayers(document, accessorOptions),
        { code: 'ERR_RENDER_OPTIONS' }
    )
    assert.equal(getterCalls, 0)

    const accessorLayers = []
    Object.defineProperty(accessorLayers, '0', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 'top_copper'
        }
    })
    accessorLayers.length = 1
    assert.throws(
        () => PcbSvgRenderer.renderLayers(document, { layers: accessorLayers }),
        { code: 'ERR_RENDER_OPTIONS' }
    )
    assert.equal(getterCalls, 0)

    const proxyLayers = new Proxy(['top_copper'], {
        get(target, key, receiver) {
            getterCalls += 1
            return Reflect.get(target, key, receiver)
        }
    })
    assert.doesNotThrow(() =>
        PcbSvgRenderer.renderLayers(document, { layers: proxyLayers })
    )
    assert.equal(getterCalls, 0)

    const accessorAttributes = {}
    Object.defineProperty(accessorAttributes, 'data-host', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 'unsafe'
        }
    })
    assert.throws(
        () =>
            PcbSvgRenderer.render(document, { attributes: accessorAttributes }),
        { code: 'ERR_RENDER_OPTIONS' }
    )
    assert.equal(getterCalls, 0)

    const oversizedClass = Array.from({ length: 64 }, () =>
        'a'.repeat(128)
    ).join(' ')
    for (const [options, features] of [
        [{ className: oversizedClass }, { svg: true }],
        [{ layers: ['x'.repeat(257)] }, { layers: true }],
        [{ layers: ['bad\ud800layer'] }, { layers: true }],
        [{ sheetId: 'x'.repeat(257) }, { sheetId: true }],
        [{ sheetId: 'bad\ud800sheet' }, { sheetId: true }]
    ]) {
        assert.throws(
            () => CanonicalRenderOptions.normalize(options, features),
            {
                code: 'ERR_RENDER_OPTIONS'
            }
        )
    }
})

test('SchematicSheetSelector bounds shared-subcircuit scope work', () => {
    const elements = []
    for (let index = 0; index < 256; index += 1) {
        elements.push({
            type: 'schematic_sheet',
            schematic_sheet_id: `shared_sheet_${index}`,
            subcircuit_id: 'shared_subcircuit_stress'
        })
        elements.push({
            type: 'schematic_debug_object',
            shape: 'point',
            center: { x: index, y: 0 },
            subcircuit_id: 'shared_subcircuit_stress'
        })
    }
    const result = SchematicSheetSelector.select(
        CircuitJsonIndexer.index(elements),
        'shared_sheet_0'
    )

    assert.equal(
        result.elementsByType.get('schematic_debug_object')?.length,
        256
    )
    assert.equal(result.statistics.scopeUpdates <= elements.length * 2, true)
})

test('renderers entry point exports every canonical renderer', async () => {
    const renderers = await import('../src/renderers.mjs')

    assert.equal(renderers.PcbSvgRenderer, PcbSvgRenderer)
    assert.equal(renderers.SchematicSvgRenderer, SchematicSvgRenderer)
    assert.equal(renderers.BomTableRenderer, BomTableRenderer)
})

test('BomTableRenderer returns deterministic escaped HTML from DocumentInput', () => {
    const document = [
        {
            type: 'source_component',
            source_component_id: 'source_r2',
            name: 'R2',
            ftype: 'simple_resistor',
            resistance: 1000,
            display_value: '1k <safe>'
        },
        {
            type: 'source_component',
            source_component_id: 'source_r1',
            name: 'R1',
            ftype: 'simple_resistor',
            resistance: 1000,
            display_value: '1k <safe>'
        },
        {
            type: 'source_component',
            source_component_id: 'source_c1',
            name: 'C1',
            ftype: 'simple_capacitor',
            capacitance: 0.000001,
            display_value: '1uF'
        }
    ]
    const context = CircuitJsonDocumentContext.prepare(document)
    const html = BomTableRenderer.render(context)

    assert.equal(html.startsWith('<table class="bom-table">'), true)
    assert.equal(html.includes('R1, R2'), true)
    assert.equal(html.includes('1k &lt;safe&gt;'), true)
    assert.equal(html.includes('<safe>'), false)
    assert.equal(BomTableRenderer.render(context), html)
    assert.equal(BomTableRenderer.render([...document].reverse()), html)
    const caseDistinct = [
        {
            type: 'source_component',
            source_component_id: 'source_upper_r1',
            name: 'R1',
            resistance: 1
        },
        {
            type: 'source_component',
            source_component_id: 'source_lower_r1',
            name: 'r1',
            resistance: 2
        }
    ]
    const caseDistinctHtml = BomTableRenderer.render(caseDistinct)
    assert.equal(
        BomTableRenderer.render([...caseDistinct].reverse()),
        caseDistinctHtml
    )
    assert.equal(
        caseDistinctHtml.indexOf('R1') < caseDistinctHtml.indexOf('r1'),
        true
    )
    const duplicateDesignatorDocument = [
        {
            type: 'source_component',
            source_component_id: 'source_duplicate_high',
            name: 'R1',
            resistance: 2
        },
        {
            type: 'source_component',
            source_component_id: 'source_duplicate_low',
            name: 'R1',
            resistance: 1
        }
    ]
    assert.equal(
        BomTableRenderer.render([...duplicateDesignatorDocument].reverse()),
        BomTableRenderer.render(duplicateDesignatorDocument)
    )
    const duplicateGroupedRows = [
        {
            designators: ['R1'],
            quantity: 1,
            value: 2,
            pattern: 'B',
            source: 'second'
        },
        {
            designators: ['R1'],
            quantity: 1,
            value: 1,
            pattern: 'A',
            source: 'first'
        }
    ]
    assert.equal(
        BomTableRenderer.render([...duplicateGroupedRows].reverse()),
        BomTableRenderer.render(duplicateGroupedRows)
    )
    assert.equal(
        BomTableRenderer.render([
            {
                designators: ['R0'],
                quantity: 1,
                value: 0,
                pattern: 0,
                source: false
            }
        ]).includes('<td>0</td><td>0</td><td>false</td>'),
        true
    )
    const invalidXmlHtml = BomTableRenderer.render([
        {
            designators: ['R\u0000\ud800'],
            quantity: 1,
            value: '1\u0000\ud800k',
            pattern: '',
            source: ''
        }
    ])
    assert.equal(invalidXmlHtml.includes('\u0000'), false)
    assert.equal(invalidXmlHtml.includes('\ud800'), false)
    assert.equal(invalidXmlHtml.includes('R��'), true)
    assert.equal(invalidXmlHtml.includes('1��k'), true)
    assert.throws(() => BomTableRenderer.render(context, { unknown: true }), {
        code: 'ERR_RENDER_OPTIONS'
    })

    let getterCalls = 0
    const circuitJsonRow = { ...document[0] }
    Object.defineProperty(circuitJsonRow, 'designators', {
        enumerable: true,
        get() {
            getterCalls += 1
            return ['INJECTED']
        }
    })
    assert.throws(() => BomTableRenderer.render([circuitJsonRow]))
    assert.equal(getterCalls, 0)

    const legacyRow = { value: '1k' }
    Object.defineProperty(legacyRow, 'designators', {
        enumerable: true,
        get() {
            getterCalls += 1
            return ['R1']
        }
    })
    assert.throws(() => BomTableRenderer.render([legacyRow]), {
        code: 'ERR_RENDER_OPTIONS'
    })
    assert.equal(getterCalls, 0)
})

test('canonical BOM presentation leaves legacy builder semantics unchanged', () => {
    const document = [
        {
            type: 'source_component',
            source_component_id: 'source_r2',
            name: 'R2',
            resistance: 1000,
            display_value: '1k'
        },
        {
            type: 'source_component',
            source_component_id: 'source_c1',
            name: 'C1',
            capacitance: 0.000001,
            display_value: '1uF'
        },
        {
            type: 'source_component',
            source_component_id: 'source_r1',
            name: 'R1',
            resistance: 1000,
            display_value: '1k'
        }
    ]

    assert.deepEqual(
        CircuitJsonBomBuilder.build(document).map((row) => ({
            designators: row.designators,
            value: row.value
        })),
        [
            { designators: ['R1', 'R2'], value: '1000' },
            { designators: ['C1'], value: '0.000001' }
        ]
    )
})

/**
 * Builds a four-layer board with one top-to-inner1 blind via.
 * @returns {object[]} CircuitJSON PCB model.
 */
function createViaSpanDocument() {
    return [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_via_span',
            center: { x: 0, y: 0 },
            width: 10,
            height: 8,
            num_layers: 4
        },
        {
            type: 'pcb_via',
            pcb_via_id: 'via_blind',
            x: 0,
            y: 0,
            outer_diameter: 0.8,
            hole_diameter: 0.3,
            layers: ['top', 'inner1']
        }
    ]
}

/**
 * Builds a board using the standard implicit four-copper-layer default.
 * @returns {object[]} CircuitJSON PCB model.
 */
function createImplicitFourLayerDocument() {
    return createLayerUnionDocument(
        [
            {
                type: 'pcb_board',
                pcb_board_id: 'board_implicit_layers',
                center: { x: 0, y: 0 },
                width: 10,
                height: 8
            }
        ],
        'inner1',
        'trace_inner'
    )
}

/**
 * Builds two boards whose physical layer model must be unioned.
 * @returns {object[]} CircuitJSON PCB model.
 */
function createMultiBoardLayerDocument() {
    const document = createLayerUnionDocument(
        [
            {
                type: 'pcb_board',
                pcb_board_id: 'board_two_layers',
                center: { x: -6, y: 0 },
                width: 10,
                height: 8,
                num_layers: 2
            },
            {
                type: 'pcb_board',
                pcb_board_id: 'board_six_layers',
                center: { x: 6, y: 0 },
                width: 10,
                height: 8,
                num_layers: 6
            }
        ],
        'inner4',
        'trace_inner4'
    )
    document.push({
        type: 'pcb_via',
        pcb_via_id: 'via_union',
        x: 0,
        y: 0,
        outer_diameter: 0.8,
        hole_diameter: 0.3,
        layers: ['top', 'bottom']
    })
    return document
}

/**
 * Adds one inner-layer trace to a board list.
 * @param {object[]} boards Board rows.
 * @param {string} layer Physical inner layer.
 * @param {string} id Trace id.
 * @returns {object[]} CircuitJSON PCB model.
 */
function createLayerUnionDocument(boards, layer, id) {
    return [
        ...boards,
        {
            type: 'pcb_trace',
            pcb_trace_id: id,
            route: [
                { route_type: 'wire', x: -1, y: 0, width: 0.2, layer },
                { route_type: 'wire', x: 1, y: 0, width: 0.2, layer }
            ]
        }
    ]
}

/**
 * Builds standard top and bottom CircuitJSON silkscreen rows.
 * @returns {object[]} CircuitJSON PCB model.
 */
function createStandardSilkscreenDocument() {
    return [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_standard_silk',
            center: { x: 0, y: 0 },
            width: 10,
            height: 8,
            num_layers: 2
        },
        {
            type: 'source_component',
            source_component_id: 'source_top',
            name: 'U1',
            ftype: 'simple_chip'
        },
        {
            type: 'source_component',
            source_component_id: 'source_bottom',
            name: 'U2',
            ftype: 'simple_chip'
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'component_top',
            source_component_id: 'source_top',
            center: { x: -2, y: 0 },
            width: 2,
            height: 2,
            layer: 'top'
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'component_bottom',
            source_component_id: 'source_bottom',
            center: { x: 2, y: 0 },
            width: 2,
            height: 2,
            layer: 'bottom'
        },
        {
            type: 'pcb_silkscreen_line',
            pcb_silkscreen_line_id: 'silk_line_top',
            pcb_component_id: 'component_top',
            x1: -3,
            y1: -1,
            x2: -1,
            y2: -1,
            stroke_width: 0.1,
            layer: 'top'
        },
        {
            type: 'pcb_silkscreen_text',
            pcb_silkscreen_text_id: 'silk_text_top',
            pcb_component_id: 'component_top',
            text: 'TOP',
            font: 'tscircuit2024',
            font_size: 1,
            anchor_position: { x: -2, y: 1 },
            anchor_alignment: 'center',
            layer: 'top'
        },
        {
            type: 'pcb_silkscreen_line',
            pcb_silkscreen_line_id: 'silk_line_bottom',
            pcb_component_id: 'component_bottom',
            x1: 1,
            y1: -1,
            x2: 3,
            y2: -1,
            stroke_width: 0.1,
            layer: 'bottom'
        },
        {
            type: 'pcb_silkscreen_text',
            pcb_silkscreen_text_id: 'silk_text_bottom',
            pcb_component_id: 'component_bottom',
            text: 'BOTTOM',
            font: 'tscircuit2024',
            font_size: 1,
            anchor_position: { x: 2, y: 1 },
            anchor_alignment: 'center',
            layer: 'bottom'
        }
    ]
}
