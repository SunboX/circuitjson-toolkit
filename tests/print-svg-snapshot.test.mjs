import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { PrintSvgSnapshot } from '../src/renderers.mjs'

const options = {
    parseSvg: (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml'),
    serializeSvg: (node) => new XMLSerializer().serializeToString(node),
    sheetId: 'instance-b'
}

/** @returns {string} A synthetic owner-generated metadata line. */
function line() {
    const run = {
        text: 'µ Ω',
        renderMode: 'stroke',
        fontSize: 2,
        lineIndex: 0,
        bounds: { x: 1, y: 1, width: 4, height: 2 },
        glyphs: [{ text: 'µ', x: 1, y: 3, advance: 2 }]
    }
    return `<g data-ecad-print-text="${JSON.stringify(run).replace(/"/gu, '&quot;')}"><path d="M1 1L5 3"/></g>`
}

test('stroke owner metadata retains nested mirrored transforms, repeated sources and native text once', () => {
    const svg = `<svg viewBox="0 0 100 100"><g transform="translate(20 10) rotate(90) scale(-2 2)"><g data-element-key="a">${line()}</g><g data-element-key="b">${line()}</g></g><text x="1" y="2">native</text></svg>`
    const result = PrintSvgSnapshot.fromSvg(svg, options)
    assert.equal(result.textRuns.length, 2)
    assert.notEqual(result.textRuns[0].sourceId, result.textRuns[1].sourceId)
    assert.deepEqual(
        result.textRuns[0].matrix.map((n) => Math.round(n) || 0),
        [0, -2, -2, 0, 20, 10].map((n) => Math.round(n) || 0)
    )
    assert.equal(result.textRuns[0].text, 'µ Ω')
    assert.equal((result.svg.match(/native/gu) || []).length, 1)
    assert.ok(!result.svg.includes('data-ecad-print-text'))
    assert.ok(Object.isFrozen(result.textRuns[0].glyphs))
})

test('hidden and fully outside stroke labels never become extraction residue', () => {
    const result = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 10 10"><g visibility="hidden">${line()}<text>secret</text></g><g transform="translate(40 40)">${line()}</g>${line()}</svg>`,
        options
    )
    assert.equal(result.textRuns.length, 1)
    assert.ok(!result.svg.includes('secret'))
})

test('unresolved clipped stroke semantics fail explicitly rather than leaking hidden labels', () => {
    assert.throws(
        () =>
            PrintSvgSnapshot.fromSvg(
                `<svg viewBox="0 0 10 10"><g clip-path="url(#clip)">${line()}</g></svg>`,
                options
            ),
        /visibility layout/u
    )
})

test('source-only geometry has an explicit semantic capability diagnostic', () => {
    const result = PrintSvgSnapshot.fromSvg(
        '<svg viewBox="0 0 10 10"><path d="M0 0L1 1"/></svg>',
        { ...options, semanticTextAvailable: false }
    )
    assert.equal(result.textRuns.length, 0)
    assert.equal(result.diagnostics[0].code, 'SOURCE_TEXT_UNAVAILABLE')
})

test('owner physical units normalize geometry and semantic matrices together', () => {
    const result = PrintSvgSnapshot.fromSvg(
        `<svg data-ecad-unit-mm="0.1" viewBox="0 0 100 100">${line()}</svg>`,
        options
    )
    assert.deepEqual(result.bounds, { x: 0, y: 0, width: 10, height: 10 })
    assert.deepEqual(result.textRuns[0].matrix, [0.1, 0, 0, 0.1, 0, 0])
    assert.match(result.svg, /transform="scale\(0.1\)"/u)
    assert.equal(result.units, 'mm')
})

test('selected hidden layers and object identities remove vectors and semantics', () => {
    const result = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 10 10"><g data-layer-id="silk">${line()}</g><g data-element-key="secret">${line()}</g>${line()}</svg>`,
        { ...options, hiddenLayers: ['silk'], hiddenObjects: ['secret'] }
    )
    assert.equal(result.textRuns.length, 1)
    assert.ok(!result.svg.includes('secret'))
    assert.ok(!result.svg.includes('silk'))
})

test('rectangular clip removes fully clipped stroke labels using the same page transform', () => {
    const result = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 30 30"><defs><clipPath id="clip"><rect x="0" y="0" width="10" height="10"/></clipPath></defs><g clip-path="url(#clip)">${line()}<g transform="translate(20 0)">${line()}</g></g></svg>`,
        options
    )
    assert.equal(result.textRuns.length, 1)
    assert.deepEqual(result.textRuns[0].clipBounds, {
        x: 0,
        y: 0,
        width: 10,
        height: 10
    })
})

test('SVG visibility inheritance allows explicitly visible descendants without leaking hidden native text', () => {
    const result = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 10 10"><g visibility="hidden"><text>concealed</text><g visibility="visible">${line()}</g></g></svg>`,
        options
    )
    assert.equal(result.textRuns.length, 1)
    assert.ok(!result.svg.includes('concealed'))
})

test('vector-only clipping remains unchanged while unresolved masked stroke semantics fail explicitly', () => {
    const svg =
        '<svg viewBox="0 0 10 10"><defs><clipPath id="shape"><path d="M0 0L10 0L5 10Z"/></clipPath></defs><g clip-path="url(#shape)"><path d="M0 1L9 1"/></g></svg>'
    const result = PrintSvgSnapshot.fromSvg(svg, options)
    assert.match(result.svg, /clip-path="url\(#shape\)"/u)
    assert.throws(
        () =>
            PrintSvgSnapshot.fromSvg(
                `<svg viewBox="0 0 10 10"><g mask="url(#m)">${line()}</g></svg>`,
                options
            ),
        /masking requires/u
    )
})

test('caller category opacity rules retain vector alpha and remove invisible text without browser styles', () => {
    const result = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 10 10"><g class="pcb-text" style="opacity:1;fill:red">${line()}<text>concealed</text></g><path class="pcb-track" style="opacity:0.9" d="M0 0L1 1"/><g data-pcb-component-side="bottom"><text>bottom concealed</text></g>${line()}</svg>`,
        {
            ...options,
            opacityRules: [
                { selector: '.pcb-text', opacity: 0 },
                { selector: '.pcb-track', opacity: 0.4 },
                { selector: "[data-pcb-component-side='bottom']", opacity: 0 }
            ]
        }
    )
    assert.equal(result.textRuns.length, 1)
    assert.ok(!result.svg.includes('concealed'))
    assert.match(result.svg, /opacity:0.4 !important/u)
    assert.ok(!result.svg.includes('opacity:0.9'))
    assert.throws(
        () =>
            PrintSvgSnapshot.fromSvg('<svg viewBox="0 0 1 1"></svg>', {
                ...options,
                opacityRules: [{ selector: '.a > .b', opacity: 0 }]
            }),
        /selector/u
    )
})

test('partially clipped runs expose only glyphs whose original round stroke ink survives', () => {
    const run = {
        text: 'ABC',
        fontSize: 2,
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        glyphs: [
            {
                text: 'A',
                x: 0,
                y: 2,
                advance: 2,
                strokes: [
                    [
                        { x: 0, y: 1 },
                        { x: 1, y: 1 }
                    ]
                ]
            },
            {
                text: 'B',
                x: 2,
                y: 2,
                advance: 2,
                strokes: [
                    [
                        { x: 2.4, y: 0 },
                        { x: 2.4, y: 2 }
                    ]
                ]
            },
            {
                text: 'C',
                x: 4,
                y: 2,
                advance: 2,
                strokes: [
                    [
                        { x: 0, y: 0 },
                        { x: 10, y: 0 }
                    ],
                    [
                        { x: 0, y: 10 },
                        { x: 10, y: 10 }
                    ]
                ]
            }
        ]
    }
    const metadata = JSON.stringify(run).replace(/"/gu, '&quot;')
    const result = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 20 20"><defs><clipPath id="clip"><rect x="0" y="0.5" width="2" height="1"/></clipPath></defs><g clip-path="url(#clip)" stroke-width="1"><g data-ecad-print-text="${metadata}"/></g></svg>`,
        options
    )
    assert.deepEqual(
        result.textRuns[0].glyphs.map((glyph) => glyph.visible),
        [true, true, true]
    )
    const thin = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 20 20"><defs><clipPath id="clip"><rect x="0" y="0.5" width="2" height="1"/></clipPath></defs><g clip-path="url(#clip)" stroke-width="0.1"><g data-ecad-print-text="${metadata}"/></g></svg>`,
        options
    )
    assert.deepEqual(
        thin.textRuns[0].glyphs.map((glyph) => glyph.visible),
        [true, false, false]
    )
    assert.equal(thin.textRuns[0].text, 'ABC')
    assert.equal(thin.textRuns[0].glyphs[1].x, 2)
})

test('glyph visibility uses inverse affine clip for rotated mirrored source strokes', () => {
    const run = {
        text: 'AB',
        fontSize: 2,
        bounds: { x: 0, y: 0, width: 10, height: 1 },
        glyphs: [
            {
                text: 'A',
                x: 0,
                y: 1,
                advance: 2,
                strokes: [
                    [
                        { x: 0, y: 0 },
                        { x: 1, y: 0 }
                    ]
                ]
            },
            {
                text: 'B',
                x: 8,
                y: 1,
                advance: 2,
                strokes: [
                    [
                        { x: 8, y: 0 },
                        { x: 9, y: 0 }
                    ]
                ]
            }
        ]
    }
    const result = PrintSvgSnapshot.fromSvg(
        `<svg viewBox="0 0 4 4"><g transform="translate(2 2) rotate(90) scale(-1 2)" stroke-width="0.1" data-ecad-print-text="${JSON.stringify(run).replace(/"/gu, '&quot;')}"/></svg>`,
        options
    )
    assert.deepEqual(
        result.textRuns[0].glyphs.map((glyph) => glyph.visible),
        [true, false]
    )
})

test('print defaults exclude semantic diagnostic and transient overlay layers', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0L1 1"/><g data-layer="diagnostics"><text>Warning</text></g><g data-layer="measurements"><text>12mm</text></g></svg>'
    const result = PrintSvgSnapshot.fromSvg(svg, options)
    assert.doesNotMatch(result.svg, /Warning|12mm/u)
    assert.equal(result.textRuns.length, 0)
    const included = PrintSvgSnapshot.fromSvg(svg, {...options,includeOverlays:true})
    assert.match(included.svg,/Warning/u)
})
