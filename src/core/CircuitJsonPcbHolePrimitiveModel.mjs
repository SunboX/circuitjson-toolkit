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
        const rotation =
            CircuitJsonPcbHolePrimitiveModel.#outerRotation(element)
        const holeRotation =
            CircuitJsonPcbHolePrimitiveModel.#holeRotation(element)
        const size =
            CircuitJsonPcbHolePrimitiveModel.#polygonOuterSize(
                points,
                center,
                rotation
            ) || CircuitJsonPcbHolePrimitiveModel.#outerSize(element, shape)
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
            holeRotation,
            rotation,
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
            element.pad_shape || element.shape || element.hole_shape
        )
        if (raw.includes('polygon')) return 'polygon'
        if (raw.includes('rect') || raw.includes('square')) return 'rect'
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
        if (element.type === 'pcb_hole') {
            const holeDiameter = CircuitJsonUnits.length(
                element.hole_diameter,
                0.6
            )
            const holeWidth = CircuitJsonUnits.length(
                element.hole_width,
                holeDiameter
            )
            const holeHeight = CircuitJsonUnits.length(
                element.hole_height,
                shape === 'circle' ? holeWidth : holeDiameter
            )
            return {
                width: holeWidth,
                height: shape === 'circle' ? holeWidth : holeHeight
            }
        }
        const diameter = CircuitJsonUnits.length(
            element.diameter ?? element.outer_diameter,
            0.6
        )
        const width = CircuitJsonUnits.length(
            element.outer_width ??
                element.rect_pad_width ??
                element.pad_width ??
                element.width,
            diameter
        )
        const height = CircuitJsonUnits.length(
            element.outer_height ??
                element.rect_pad_height ??
                element.pad_height ??
                element.height,
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
     * Resolves polygon extents in the pad's rotation-local coordinate system.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @param {{ x: number, y: number }} center Pad center.
     * @param {number} rotation Rotation in degrees.
     * @returns {{ width: number, height: number } | null} Local polygon size.
     */
    static #polygonOuterSize(points, center, rotation) {
        if (points.length < 3) return null
        const centerX = Number(center?.x)
        const centerY = Number(center?.y)
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null

        const angle = (-Number(rotation || 0) * Math.PI) / 180
        const cosine = Math.cos(angle)
        const sine = Math.sin(angle)
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const point of points) {
            const deltaX = point.x - centerX
            const deltaY = point.y - centerY
            const x = deltaX * cosine - deltaY * sine
            const y = deltaX * sine + deltaY * cosine
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x)
            maxY = Math.max(maxY, y)
        }
        const width = maxX - minX
        const height = maxY - minY
        return width > 0 && height > 0 ? { width, height } : null
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
        if (
            raw.includes('square') ||
            (raw.includes('rect') && !raw.includes('rect_pad'))
        )
            return 'rect'
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
     * Resolves the board-space outer pad rotation independently from its drill.
     * @param {object} element Drilled PCB element.
     * @returns {number}
     */
    static #outerRotation(element) {
        return CircuitJsonUnits.angle(
            element.rect_ccw_rotation ??
                element.ccw_rotation ??
                element.rotation,
            0
        )
    }

    /**
     * Resolves the board-space drill rotation independently from its outer pad.
     * @param {object} element Drilled PCB element.
     * @returns {number}
     */
    static #holeRotation(element) {
        return CircuitJsonUnits.angle(
            element.hole_ccw_rotation ??
                element.ccw_rotation ??
                element.rotation,
            0
        )
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
