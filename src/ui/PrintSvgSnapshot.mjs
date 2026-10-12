import { PrintSvgClip } from './PrintSvgClip.mjs'
import { PrintSvgOpacityRules } from './PrintSvgOpacityRules.mjs'
import { PrintSvgGlyphVisibility } from './PrintSvgGlyphVisibility.mjs'
/** Builds detached print artifacts from toolkit-produced SVG, never from path recognition. */
export class PrintSvgSnapshot {
    /**
     * Native SVG text stays native. Only owner-provided stroke layouts need a PDF text overlay.
     * @param {string} markup Renderer output, optionally an HTML wrapper.
     * @param {object} options Units, revision, sheet instance and optional DOM parser/serializer.
     * @returns {object} Immutable print contract.
     */
    static fromSvg(markup, options = {}) {
        const start = markup.indexOf('<svg')
        const end = markup.lastIndexOf('</svg>')
        if (start < 0 || end < start)
            throw new Error('Print export requires an SVG document')
        const svg = markup.slice(start, end + 6)
        const parse =
            options.parseSvg ||
            ((value) => new DOMParser().parseFromString(value, 'image/svg+xml'))
        const serialize =
            options.serializeSvg ||
            ((node) => new XMLSerializer().serializeToString(node))
        const document = parse(svg)
        if (document.getElementsByTagName('parsererror').length)
            throw new Error('Invalid print SVG')
        const root = document.documentElement
        const declaredUnit = Number(root.getAttribute('data-ecad-unit-mm') || 0)
        const units = {
            mm: 1,
            mil: 0.0254,
            inch: 25.4,
            pt: 25.4 / 72,
            px: 25.4 / 96
        }
        const unitScale = declaredUnit || units[options.units || 'mm']
        if (!(unitScale > 0) || !Number.isFinite(unitScale))
            throw new Error('Print SVG requires known physical units')
        const hiddenLayers = new Set([
            ...(options.includeOverlays
                ? []
                : ['diagnostics', 'measurements', 'hover', 'selection']),
            ...(options.hiddenLayers || []).map(String)
        ])
        const hiddenObjects = new Set((options.hiddenObjects || []).map(String))
        const opacityRules = PrintSvgOpacityRules.compile(options.opacityRules)
        const viewBox = (root.getAttribute('viewBox') || '')
            .trim()
            .split(/[ ,]+/u)
            .map(Number)
        if (
            viewBox.length !== 4 ||
            !viewBox.every(Number.isFinite) ||
            viewBox[2] <= 0 ||
            viewBox[3] <= 0
        )
            throw new Error('Print SVG requires a finite viewBox')
        const bounds = {
            x: viewBox[0] * unitScale,
            y: viewBox[1] * unitScale,
            width: viewBox[2] * unitScale,
            height: viewBox[3] * unitScale
        }
        root.setAttribute(
            'viewBox',
            [bounds.x, bounds.y, bounds.width, bounds.height].join(' ')
        )
        root.setAttribute('data-ecad-unit-mm', '1')
        root.setAttribute('width', `${bounds.width}mm`)
        root.setAttribute('height', `${bounds.height}mm`)
        if (unitScale !== 1) {
            const group = document.createElementNS(
                'http://www.w3.org/2000/svg',
                'g'
            )
            group.setAttribute('transform', `scale(${unitScale})`)
            while (root.firstChild) group.appendChild(root.firstChild)
            root.appendChild(group)
        }
        const textRuns = []
        const identity = [1, 0, 0, 1, 0, 0]
        const diagnostics = []
        const visit = (node, parent, path) => {
            if (node.nodeType !== 1) return
            if ((node.localName || node.nodeName) === 'metadata') {
                node.parentNode?.removeChild(node)
                return
            }
            PrintSvgOpacityRules.apply(node, opacityRules)
            const style = Object.fromEntries(
                (node.getAttribute('style') || '')
                    .split(';')
                    .filter(Boolean)
                    .map((item) => item.split(':').map((part) => part.trim()))
            )
            const filtered =
                [
                    'data-layer-id',
                    'data-layer-key',
                    'data-layer-name',
                    'data-layer'
                ].some((key) => hiddenLayers.has(node.getAttribute(key))) ||
                [
                    'data-element-key',
                    'data-source-id',
                    'data-component-id',
                    'data-component-unique-id',
                    'data-circuit-json-id'
                ].some((key) => hiddenObjects.has(node.getAttribute(key)))
            const hidden =
                filtered ||
                parent.hidden ||
                node.getAttribute('display') === 'none' ||
                style.display === 'none' ||
                Number(
                    String(
                        style.opacity || node.getAttribute('opacity') || 1
                    ).replace(/\s*!important\s*$/u, '')
                ) === 0
            if (hidden) {
                node.parentNode?.removeChild(node)
                return
            }
            const visibility =
                style.visibility ||
                node.getAttribute('visibility') ||
                parent.visibility ||
                'visible'
            const strokeWidth = Number(
                style['stroke-width'] ||
                    node.getAttribute('stroke-width') ||
                    parent.strokeWidth ||
                    0
            )
            const visible = !['hidden', 'collapse'].includes(visibility)
            if (!visible) {
                node.removeAttribute('aria-label')
                Array.from(node.childNodes)
                    .filter(
                        (child) => child.nodeType === 3 || child.nodeType === 4
                    )
                    .forEach((child) => node.removeChild(child))
            }
            const matrix = this.#multiply(
                parent.matrix,
                this.#transform(node.getAttribute('transform') || '')
            )
            const sourceId =
                node.getAttribute('data-element-key') ||
                node.getAttribute('data-source-id') ||
                parent.sourceId
            const clipReference =
                node.getAttribute('clip-path') || style['clip-path']
            let clip = parent.clip
            let clipError = parent.clipError
            const mask = node.getAttribute('mask') || style.mask || parent.mask
            if (clipReference && clipReference !== 'none') {
                try {
                    const localClip = PrintSvgClip.resolve(
                        document,
                        clipReference,
                        matrix,
                        {
                            multiply: this.#multiply,
                            transform: this.#transform.bind(this),
                            bounds: this.#bounds
                        }
                    )
                    clip = PrintSvgClip.intersect(clip || bounds, localClip)
                } catch (error) {
                    clipError = error.message
                }
            }
            const metadata = node.getAttribute('data-ecad-print-text')
            if (metadata && !parent.definition && visible) {
                if (clipError) throw new Error(clipError)
                if (mask && mask !== 'none')
                    throw new Error(
                        'Stroke text masking requires an owner-resolved visibility layout'
                    )
                const run = JSON.parse(metadata)
                const radius = Math.max(0, strokeWidth) / 2
                const box = this.#bounds(
                    {
                        x: run.bounds.x - radius,
                        y: run.bounds.y - radius,
                        width: run.bounds.width + radius * 2,
                        height: run.bounds.height + radius * 2
                    },
                    matrix
                )
                if (PrintSvgClip.overlaps(box, clip || bounds)) {
                    const glyphs = PrintSvgGlyphVisibility.resolve(
                        run,
                        matrix,
                        clip || bounds,
                        strokeWidth,
                        box
                    )
                    if (glyphs.some((glyph) => glyph.visible))
                        textRuns.push({
                            ...run,
                            glyphs,
                            sourceId: `${options.sheetId || 'sheet'}:${sourceId || 'layout'}:${path}:${run.lineIndex || 0}`,
                            semanticSourceId: sourceId,
                            ...(clip ? { clipBounds: clip } : {}),
                            matrix,
                            transform: matrix,
                            visible: true
                        })
                }
            }
            node.removeAttribute('data-ecad-print-text')
            const definition =
                parent.definition ||
                ['defs', 'symbol', 'clipPath', 'mask'].includes(
                    node.localName || node.nodeName
                )
            Array.from(node.childNodes).forEach((child, i) =>
                visit(
                    child,
                    {
                        matrix,
                        hidden,
                        visibility,
                        strokeWidth,
                        sourceId,
                        clip,
                        clipError,
                        mask,
                        definition
                    },
                    `${path}/${i}`
                )
            )
        }
        visit(
            root,
            {
                matrix: identity,
                hidden: false,
                sourceId: null,
                clip: null,
                definition: false
            },
            '0'
        )
        if (options.semanticTextAvailable === false)
            diagnostics.push({
                code: 'SOURCE_TEXT_UNAVAILABLE',
                severity: 'info',
                message:
                    'Source contains geometry without reliable original text semantics.'
            })
        return this.#freeze({
            apiVersion: 1,
            schemaVersion: 1,
            documentRevision: options.documentRevision ?? null,
            svg: serialize(root),
            bounds,
            units: 'mm',
            transform: identity,
            textRuns,
            diagnostics
        })
    }

    /** @param {number[]} a Left affine matrix. @param {number[]} b Right affine matrix. @returns {number[]} */
    static #multiply(a, b) {
        return [
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5]
        ]
    }

    /** @param {string} value SVG transform list. @returns {number[]} */
    static #transform(value) {
        let result = [1, 0, 0, 1, 0, 0]
        let consumed = ''
        for (const match of value.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/gu)) {
            consumed += match[0]
            const v = match[2].trim().split(/[ ,]+/u).map(Number)
            if (!v.every(Number.isFinite))
                throw new Error('Non-finite SVG transform')
            let matrix
            if (match[1] === 'matrix' && v.length === 6) matrix = v
            else if (match[1] === 'translate' && v.length <= 2)
                matrix = [1, 0, 0, 1, v[0], v[1] || 0]
            else if (match[1] === 'scale' && v.length <= 2)
                matrix = [v[0], 0, 0, v[1] ?? v[0], 0, 0]
            else if (match[1] === 'rotate' && [1, 3].includes(v.length)) {
                const angle = (v[0] * Math.PI) / 180,
                    c = Math.cos(angle),
                    s = Math.sin(angle),
                    x = v[1] || 0,
                    y = v[2] || 0
                matrix = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y]
            } else if (match[1] === 'skewX' && v.length === 1)
                matrix = [1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0]
            else if (match[1] === 'skewY' && v.length === 1)
                matrix = [1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0]
            else throw new Error(`Unsupported SVG transform: ${match[1]}`)
            result = this.#multiply(result, matrix)
        }
        if (consumed.replace(/\s/gu, '') !== value.replace(/\s/gu, ''))
            throw new Error('Invalid SVG transform list')
        return result
    }

    /** @param {object} bounds Local bounds. @param {number[]} m Matrix. @returns {object} */
    static #bounds(bounds, m) {
        const points = [
            [bounds.x, bounds.y],
            [bounds.x + bounds.width, bounds.y],
            [bounds.x, bounds.y + bounds.height],
            [bounds.x + bounds.width, bounds.y + bounds.height]
        ].map(([x, y]) => [
            m[0] * x + m[2] * y + m[4],
            m[1] * x + m[3] * y + m[5]
        ])
        const x = Math.min(...points.map((p) => p[0])),
            y = Math.min(...points.map((p) => p[1]))
        return {
            x,
            y,
            width: Math.max(...points.map((p) => p[0])) - x,
            height: Math.max(...points.map((p) => p[1])) - y
        }
    }

    /** @param {object} value Detached plain object. @returns {object} */
    static #freeze(value) {
        if (value && typeof value === 'object') {
            Object.values(value).forEach((child) => this.#freeze(child))
            Object.freeze(value)
        }
        return value
    }
}
