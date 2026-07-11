import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import { CircuitJsonIndexer } from '../src/core/CircuitJsonIndexer.mjs'
import { CircuitJsonSupportMatrixBuilder } from '../src/core/CircuitJsonSupportMatrixBuilder.mjs'
import { Parser } from '../src/core/Parser.mjs'
import { SchematicGeometryBounds } from '../src/ui/SchematicGeometryBounds.mjs'
import { SchematicSvgRenderer } from '../src/ui/SchematicSvgRenderer.mjs'

/**
 * Builds one complete canonical schematic image row.
 * @param {Record<string, unknown>} [fields] Field overrides.
 * @returns {Record<string, unknown>} Image row.
 */
function imageElement(fields = {}) {
    return {
        type: 'schematic_image',
        schematic_image_id: 'schematic_image_logo',
        asset_id: 'asset_logo',
        center: { x: 10, y: 20 },
        size: { width: 8, height: 4 },
        rotation: 90,
        opacity: 0.5,
        preserve_aspect_ratio: true,
        render_order: 7,
        source_name: 'logo.png',
        source_path: 'art/logo.png',
        schematic_sheet_id: 'schematic_sheet_main',
        ...fields
    }
}

/**
 * Builds one canonical hierarchical child-sheet symbol.
 * @param {string} id Stable suffix.
 * @param {number} x Horizontal center.
 * @returns {Record<string, unknown>} Sheet-symbol row.
 */
function sheetSymbol(id, x) {
    return {
        type: 'schematic_sheet_symbol',
        schematic_sheet_symbol_id: `schematic_sheet_symbol_${id}`,
        name: `Child ${id}`,
        source_file_name: `child-${id}.kicad_sch`,
        center: { x, y: 10 },
        width: 12,
        height: 8,
        stroke_width: 0.2,
        color: '#123456',
        fill_color: '#ddeeff',
        is_filled: true,
        is_dashed: true,
        render_order: x
    }
}

test('schematic_image is a strict canonical element and indexed primitive', () => {
    const valid = imageElement()

    assert.equal(CircuitJsonDocument.isElement(valid), true)
    assert.equal(
        CircuitJsonDocument.isElement(imageElement({ asset_id: undefined })),
        false
    )
    assert.equal(
        CircuitJsonDocument.isElement(imageElement({ opacity: 1.1 })),
        false
    )
    assert.equal(
        CircuitJsonDocument.isElement(
            imageElement({ size: { width: 0, height: 4 } })
        ),
        false
    )
    assert.equal(
        CircuitJsonDocument.isElement(imageElement({ render_order: 1.5 })),
        false
    )

    const model = [
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_main',
            name: 'Main'
        },
        valid
    ]
    const index = CircuitJsonIndexer.index(model)
    assert.equal(
        index.elementsById.get('schematic_image:schematic_image_logo'),
        valid
    )
    assert.deepEqual(index.elementsByType.get('schematic_image'), [valid])
    assert.deepEqual(index.relationsByField.get('asset_id').get('asset_logo'), [
        valid
    ])
    const support = CircuitJsonSupportMatrixBuilder.build(model).rows.find(
        (row) => row.type === 'schematic_image'
    )
    assert.equal(support?.status, 'full')
    assert.equal(support?.capabilities.schematic, 'rendered')
})

test('schematic image bounds include rotation about the canonical center', () => {
    const model = [imageElement()]
    const index = CircuitJsonIndexer.index(model)

    assert.deepEqual(SchematicGeometryBounds.resolve(index), {
        minX: 8,
        minY: 16,
        maxX: 12,
        maxY: 24,
        width: 4,
        height: 8
    })
})

test('schematic image SVG resolves exact document assets without placeholders', () => {
    const first = imageElement({
        schematic_image_id: 'schematic_image_later',
        asset_id: 'asset_later',
        render_order: 20,
        rotation: 0,
        center: { x: 20, y: 20 }
    })
    const second = imageElement({
        schematic_image_id: 'schematic_image_earlier',
        asset_id: 'asset_earlier',
        render_order: 10
    })
    const unresolved = imageElement({
        schematic_image_id: 'schematic_image_unresolved',
        asset_id: 'asset_unresolved',
        render_order: 30
    })
    const document = Parser.parse(
        {
            fileName: 'images.circuitjson',
            data: JSON.stringify([first, unresolved, second]),
            assets: [
                {
                    id: 'asset_later',
                    kind: 'schematic-image',
                    name: 'later.png',
                    mediaType: 'image/png',
                    data: new Uint8Array([4, 5, 6])
                },
                {
                    id: 'asset_earlier',
                    kind: 'schematic-image',
                    name: 'earlier.png',
                    mediaType: 'image/png',
                    data: new Uint8Array([1, 2, 3])
                },
                {
                    id: 'asset_unresolved',
                    kind: 'schematic-image',
                    name: 'missing.png',
                    mediaType: 'image/png',
                    data: null
                }
            ]
        },
        { decodeAssets: 'full' }
    )
    const svg = SchematicSvgRenderer.render(document)

    assert.equal(svg.includes('class="schematic-images"'), true)
    assert.equal(
        svg.includes('data-schematic-image-id="schematic_image_earlier"'),
        true
    )
    assert.equal(
        svg.indexOf('schematic_image_earlier') <
            svg.indexOf('schematic_image_later'),
        true
    )
    assert.equal(svg.includes('href="data:image/png;base64,AQID"'), true)
    assert.equal(svg.includes('href="data:image/png;base64,BAUG"'), true)
    assert.equal(svg.includes('x="6" y="18" width="8" height="4"'), true)
    assert.equal(svg.includes('transform="rotate(90 10 20)"'), true)
    assert.equal(svg.includes('opacity="0.5"'), true)
    assert.equal(svg.includes('preserveAspectRatio="xMidYMid meet"'), true)
    assert.equal(svg.includes('schematic_image_unresolved'), false)
    assert.equal(svg.includes('placeholder'), false)
})

test('metadata-only schematic image assets remain render-safe and payload-free', () => {
    const document = Parser.parse({
        fileName: 'metadata-image.circuitjson',
        data: JSON.stringify([imageElement()]),
        assets: [
            {
                id: 'asset_logo',
                kind: 'schematic-image',
                name: 'logo.png',
                mediaType: 'image/png',
                data: new Uint8Array([1, 2, 3])
            }
        ]
    })

    assert.equal(document.assets[0].byteLength, 3)
    assert.equal(document.assets[0].data, null)
    assert.equal(
        SchematicSvgRenderer.render(document).includes('<image'),
        false
    )
})

test('hierarchical sheet symbols are canonical primitives, not page rows', () => {
    const first = sheetSymbol('a', 10)
    const second = sheetSymbol('b', 30)
    const model = [
        first,
        second,
        {
            type: 'schematic_text',
            schematic_text_id: 'schematic_text_root',
            text: 'ROOT_GRAPHIC',
            position: { x: 20, y: 25 }
        },
        {
            type: 'source_port',
            source_port_id: 'source_port_child',
            name: 'IN',
            pin_number: 1
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_port_child',
            source_port_id: 'source_port_child',
            schematic_sheet_symbol_id: first.schematic_sheet_symbol_id,
            center: { x: 4, y: 10 }
        }
    ]

    assert.equal(CircuitJsonDocument.isElement(first), true)
    assert.equal(
        CircuitJsonDocument.isElement({ ...first, source_file_name: 42 }),
        false
    )
    assert.equal(CircuitJsonDocument.isElement({ ...first, width: 0 }), false)
    const index = CircuitJsonIndexer.index(model)
    assert.deepEqual(index.elementsByType.get('schematic_sheet_symbol'), [
        first,
        second
    ])
    assert.deepEqual(
        index.relationsByField
            .get('schematic_sheet_symbol_id')
            .get(first.schematic_sheet_symbol_id),
        [model[4]]
    )

    const svg = SchematicSvgRenderer.render(model)
    assert.equal(svg.includes('schematic_sheet_symbol_a'), true)
    assert.equal(svg.includes('schematic_sheet_symbol_b'), true)
    assert.equal(
        svg.includes('data-source-file-name="child-a.kicad_sch"'),
        true
    )
    assert.equal(svg.includes('ROOT_GRAPHIC'), true)
    assert.equal(svg.includes('stroke="#123456"'), true)
    assert.equal(svg.includes('fill="#ddeeff"'), true)
})
