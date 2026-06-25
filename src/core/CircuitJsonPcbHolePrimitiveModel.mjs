import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'
import { CircuitJsonPcbPrimitiveGeometry } from './CircuitJsonPcbPrimitiveGeometry.mjs'

/**
 * Normalizes drilled PCB elements into shared primitive geometry.
 */
export class CircuitJsonPcbHolePrimitiveModel {
    /**
     * Builds shape and bounds metadata for a drilled PCB element.
     * @param {object} element Drilled PCB element.
     * @param {{ x: number, y: number }} center Drill center.
     * @returns {object}
     */
    static build(element, center) {
        const shape = CircuitJsonPcbHolePrimitiveModel.#outerShape(element)
        const points = CircuitJsonPcbHolePrimitiveModel.#outerPoints(element)
        const size = CircuitJsonPcbHolePrimitiveModel.#outerSize(element, shape)
        const hole = CircuitJsonPcbHolePrimitiveModel.#holeSize(
            element,
            shape,
            size
        )
        const bounds = points.length
            ? CircuitJsonPcbPrimitiveGeometry.pointsBounds(points)
            : CircuitJsonPcbPrimitiveGeometry.centerBounds(
                  center,
                  size.width,
                  size.height
              )

        return {
            shape,
            width: size.width,
            height: size.height,
            diameter: Math.max(size.width, size.height),
            holeShape: hole.shape,
            holeDiameter: hole.diameter,
            holeWidth: hole.width,
            holeHeight: hole.height,
            rotation: CircuitJsonUnits.angle(
                element.ccw_rotation ?? element.rotation,
                0
            ),
            points,
            bounds
        }
    }

    /**
     * Resolves the visible copper or board hole shape.
     * @param {object} element Drilled PCB element.
     * @returns {'circle' | 'pill' | 'polygon' | 'rect'}
     */
    static #outerShape(element) {
        const raw = CircuitJsonPcbHolePrimitiveModel.#shapeText(
            element.shape || element.hole_shape
        )
        if (raw.includes('polygon')) return 'polygon'
        if (raw.includes('rect')) return 'rect'
        if (
            raw.includes('pill') ||
            raw.includes('slot') ||
            raw.includes('oval')
        )
            return 'pill'
        return 'circle'
    }

    /**
     * Resolves the outer rendered size.
     * @param {object} element Drilled PCB element.
     * @param {string} shape Normalized outer shape.
     * @returns {{ width: number, height: number }}
     */
    static #outerSize(element, shape) {
        const diameter = CircuitJsonUnits.length(
            element.diameter ?? element.outer_diameter,
            0.6
        )
        const width = CircuitJsonUnits.length(
            element.rect_pad_width ?? element.pad_width ?? element.width,
            diameter
        )
        const height = CircuitJsonUnits.length(
            element.rect_pad_height ?? element.pad_height ?? element.height,
            shape === 'circle' ? width : diameter
        )

        return {
            width,
            height: shape === 'circle' ? width : height
        }
    }

    /**
     * Resolves polygonal outer pad points.
     * @param {object} element Drilled PCB element.
     * @returns {{ x: number, y: number }[]}
     */
    static #outerPoints(element) {
        return (Array.isArray(element?.pad_outline) ? element.pad_outline : [])
            .map((point) => CircuitJsonUnits.optionalPoint(point))
            .filter(Boolean)
    }

    /**
     * Resolves the drilled opening size.
     * @param {object} element Drilled PCB element.
     * @param {string} outerShape Normalized outer shape.
     * @param {{ width: number, height: number }} outerSize Outer size.
     * @returns {{ shape: 'circle' | 'pill' | 'rect', diameter: number, width: number, height: number }}
     */
    static #holeSize(element, outerShape, outerSize) {
        const shape = CircuitJsonPcbHolePrimitiveModel.#holeShape(
            element,
            outerShape
        )
        const fallbackDiameter =
            shape === 'circle'
                ? Math.min(outerSize.width, outerSize.height) * 0.45
                : Math.min(outerSize.width, outerSize.height)
        const diameter = CircuitJsonUnits.length(
            element.hole_diameter ??
                element.holeDiameter ??
                element.drill_diameter,
            fallbackDiameter
        )
        const width = CircuitJsonUnits.length(
            element.hole_width,
            shape === 'circle' ? diameter : outerSize.width
        )
        const height = CircuitJsonUnits.length(
            element.hole_height,
            shape === 'circle' ? diameter : outerSize.height
        )

        return { shape, diameter, width, height }
    }

    /**
     * Resolves the drilled opening shape.
     * @param {object} element Drilled PCB element.
     * @param {string} outerShape Normalized outer shape.
     * @returns {'circle' | 'pill' | 'rect'}
     */
    static #holeShape(element, outerShape) {
        const raw = CircuitJsonPcbHolePrimitiveModel.#shapeText(
            element.hole_shape || element.shape
        )
        if (raw === 'round') return 'circle'
        if (raw.includes('rect') && !raw.includes('rect_pad')) return 'rect'
        if (
            raw.includes('pill') ||
            raw.includes('slot') ||
            raw.includes('oval')
        )
            return 'pill'
        if (raw.includes('circular') || raw.includes('circle')) return 'circle'
        return element.type === 'pcb_hole' ? outerShape : 'circle'
    }

    /**
     * Normalizes a shape string.
     * @param {unknown} value Shape value.
     * @returns {string}
     */
    static #shapeText(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
    }
}
