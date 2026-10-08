/** Tests original round stroke geometry against the visible print rectangle. */
export class PrintSvgGlyphVisibility {
    /** @param {object} run Source layout. @param {number[]} matrix Page transform. @param {object} clip Page rectangle. @param {number} strokeWidth Actual inherited local stroke width. @param {object} runBox Page run bounds. @returns {object[]} */
    static resolve(run, matrix, clip, strokeWidth, runBox) {
        const complete =
            runBox.x >= clip.x &&
            runBox.y >= clip.y &&
            runBox.x + runBox.width <= clip.x + clip.width &&
            runBox.y + runBox.height <= clip.y + clip.height
        const polygon = this.#localClip(matrix, clip)
        const glyphs = run.glyphs.map((glyph) => {
            if (!Array.isArray(glyph.strokes)) {
                if (!complete)
                    throw new Error(
                        'Partially clipped stroke text requires original per-glyph stroke geometry'
                    )
                return { ...glyph, visible: true }
            }
            return {
                ...glyph,
                visible: glyph.strokes.some((stroke) =>
                    this.#strokeVisible(
                        stroke,
                        polygon,
                        Math.max(0, strokeWidth) / 2
                    )
                )
            }
        })
        // Whitespace has no ink; retain only separators between surviving glyphs.
        const first = glyphs.findIndex((glyph) => glyph.visible)
        const last = glyphs.findLastIndex((glyph) => glyph.visible)
        return glyphs.map((glyph, index) =>
            /^\s+$/u.test(glyph.text) && !glyph.strokes?.length
                ? { ...glyph, visible: index > first && index < last }
                : glyph
        )
    }

    /** @param {number[]} m Affine transform. @param {object} c Page clip. @returns {object[]} Local convex clip polygon. */
    static #localClip(m, c) {
        const determinant = m[0] * m[3] - m[1] * m[2]
        if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15)
            throw new Error('Degenerate stroke text transform')
        return [
            [c.x, c.y],
            [c.x + c.width, c.y],
            [c.x + c.width, c.y + c.height],
            [c.x, c.y + c.height]
        ].map(([x, y]) => ({
            x: (m[3] * (x - m[4]) - m[2] * (y - m[5])) / determinant,
            y: (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / determinant
        }))
    }

    /** @param {object[]} stroke Original polyline. @param {object[]} polygon Local clip. @param {number} radius Round stroke radius. @returns {boolean} */
    static #strokeVisible(stroke, polygon, radius) {
        if (stroke.some((point) => this.#inside(point, polygon))) return true
        for (let index = 0; index < stroke.length; index++) {
            const a = stroke[index],
                b = stroke[Math.min(index + 1, stroke.length - 1)]
            for (let edge = 0; edge < polygon.length; edge++) {
                const c = polygon[edge],
                    d = polygon[(edge + 1) % polygon.length]
                if (
                    this.#intersects(a, b, c, d) ||
                    Math.min(
                        this.#distance(a, c, d),
                        this.#distance(b, c, d),
                        this.#distance(c, a, b),
                        this.#distance(d, a, b)
                    ) <=
                        radius + 1e-10
                )
                    return true
            }
        }
        return false
    }

    /** @param {object} p Point. @param {object[]} polygon Convex rectangle transformed to local coordinates. @returns {boolean} */
    static #inside(p, polygon) {
        const sides = polygon.map((a, i) =>
            this.#cross(a, polygon[(i + 1) % polygon.length], p)
        )
        return sides.every((v) => v >= -1e-10) || sides.every((v) => v <= 1e-10)
    }

    /** @param {object} a Segment start. @param {object} b Segment end. @param {object} p Point. @returns {number} */
    static #cross(a, b, p) {
        return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    }

    /** @param {object} a First start. @param {object} b First end. @param {object} c Second start. @param {object} d Second end. @returns {boolean} */
    static #intersects(a, b, c, d) {
        if (
            Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
            Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
            Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
            Math.max(c.y, d.y) < Math.min(a.y, b.y)
        )
            return false
        return (
            this.#cross(a, b, c) * this.#cross(a, b, d) <= 0 &&
            this.#cross(c, d, a) * this.#cross(c, d, b) <= 0
        )
    }

    /** @param {object} p Point. @param {object} a Segment start. @param {object} b Segment end. @returns {number} Euclidean distance. */
    static #distance(p, a, b) {
        const dx = b.x - a.x,
            dy = b.y - a.y
        const length = dx * dx + dy * dy
        const t = length
            ? Math.max(
                  0,
                  Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)
              )
            : 0
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    }
}
