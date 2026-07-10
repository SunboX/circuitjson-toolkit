/**
 * Estimates conservative bounds for SVG text in schematic user units.
 */
export class SchematicTextBounds {
    /**
     * Resolves rotated text bounds around its anchor point.
     * @param {{ x: number, y: number }} point Text anchor point.
     * @param {unknown} value Text value.
     * @param {{ fontSize?: number, anchor?: unknown, rotation?: number }} [options] Text geometry.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static resolve(point, value, options = {}) {
        const lines = String(value ?? '').split(/\r?\n/u)
        const fontSize =
            Number.isFinite(options.fontSize) && options.fontSize > 0
                ? options.fontSize
                : 1
        let characters = 1
        for (const line of lines) {
            characters = Math.max(characters, [...line].length)
        }
        const width = Math.max(fontSize * 0.3, characters * fontSize)
        const height = Math.max(fontSize, lines.length * fontSize * 1.2)
        const origin = SchematicTextBounds.#origin(
            point,
            width,
            height,
            options.anchor
        )
        const corners = [
            { x: origin.x, y: origin.y },
            { x: origin.x + width, y: origin.y },
            { x: origin.x + width, y: origin.y + height },
            { x: origin.x, y: origin.y + height }
        ].map((corner) =>
            SchematicTextBounds.#rotate(
                corner,
                point,
                Number(options.rotation) || 0
            )
        )
        return {
            minX: Math.min(...corners.map((corner) => corner.x)),
            minY: Math.min(...corners.map((corner) => corner.y)),
            maxX: Math.max(...corners.map((corner) => corner.x)),
            maxY: Math.max(...corners.map((corner) => corner.y))
        }
    }

    /**
     * Resolves the top-left text box origin from a named anchor.
     * @param {{ x: number, y: number }} point Anchor point.
     * @param {number} width Text width.
     * @param {number} height Text height.
     * @param {unknown} anchor Named anchor.
     * @returns {{ x: number, y: number }} Top-left origin.
     */
    static #origin(point, width, height, anchor) {
        const { horizontal, vertical } = SchematicTextAnchor.resolve(anchor)
        return {
            x:
                horizontal === 'right'
                    ? point.x - width
                    : horizontal === 'center'
                      ? point.x - width / 2
                      : point.x,
            y:
                vertical === 'top'
                    ? point.y
                    : vertical === 'bottom'
                      ? point.y - height
                      : vertical === 'center'
                        ? point.y - height / 2
                        : point.y - height
        }
    }

    /**
     * Rotates one corner around the text anchor.
     * @param {{ x: number, y: number }} point Corner.
     * @param {{ x: number, y: number }} center Rotation center.
     * @param {number} degrees Counter-clockwise degrees.
     * @returns {{ x: number, y: number }} Rotated corner.
     */
    static #rotate(point, center, degrees) {
        if (!degrees) return point
        const radians = (degrees * Math.PI) / 180
        const cos = Math.cos(radians)
        const sin = Math.sin(radians)
        const x = point.x - center.x
        const y = point.y - center.y
        return {
            x: center.x + x * cos - y * sin,
            y: center.y + x * sin + y * cos
        }
    }
}
import { SchematicTextAnchor } from './SchematicTextAnchor.mjs'
