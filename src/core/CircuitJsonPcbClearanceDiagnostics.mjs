import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'
import { CircuitJsonPcbCopperGeometry } from './CircuitJsonPcbCopperGeometry.mjs'

/**
 * Builds copper clearance diagnostics for CircuitJSON PCB primitives.
 */
export class CircuitJsonPcbClearanceDiagnostics {
    /**
     * Builds generic copper clearance diagnostics when board rules are present.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static build(index, primitives) {
        const minimum = this.#minimumClearance(index)
        if (minimum === null || minimum <= 0) return []

        const copper = primitives.filter((primitive) =>
            this.#isCopperPrimitive(primitive)
        )
        const keepouts = primitives.filter((primitive) =>
            this.#isKeepoutPrimitive(primitive)
        )
        const diagnostics = []
        for (let leftIndex = 0; leftIndex < copper.length; leftIndex += 1) {
            for (
                let rightIndex = leftIndex + 1;
                rightIndex < copper.length;
                rightIndex += 1
            ) {
                const left = copper[leftIndex]
                const right = copper[rightIndex]
                if (left.netName === right.netName) continue
                if (!this.#sameClearanceLayer(left, right)) continue
                const actual =
                    CircuitJsonPcbCopperGeometry.clearance(left, right) ??
                    this.#boundsClearance(left.bounds, right.bounds)
                if (actual >= minimum) continue
                diagnostics.push(
                    this.#clearanceDiagnostic(
                        left,
                        right,
                        minimum,
                        actual,
                        diagnostics.length
                    )
                )
            }
        }
        for (const copperPrimitive of copper) {
            for (const keepout of keepouts) {
                if (!this.#keepoutAppliesToCopper(copperPrimitive, keepout)) {
                    continue
                }
                const actual =
                    CircuitJsonPcbCopperGeometry.clearance(
                        copperPrimitive,
                        keepout
                    ) ??
                    this.#boundsClearance(
                        copperPrimitive.bounds,
                        keepout.bounds
                    )
                if (actual >= minimum) continue
                diagnostics.push(
                    this.#keepoutDiagnostic(
                        copperPrimitive,
                        keepout,
                        minimum,
                        actual,
                        diagnostics.length
                    )
                )
            }
        }
        return diagnostics
    }

    /**
     * Resolves the configured minimum copper clearance.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {number | null}
     */
    static #minimumClearance(index) {
        for (const board of index.elementsByType.get('pcb_board') || []) {
            const value = CircuitJsonUnits.optionalLength(
                board.min_trace_clearance ??
                    board.minimum_trace_clearance ??
                    board.minimum_copper_clearance ??
                    board.minimumCopperClearance ??
                    board.minCopperClearance
            )
            if (value !== null) return value
        }
        return null
    }

    /**
     * Returns true when a primitive participates in copper spacing checks.
     * @param {object} primitive Primitive row.
     * @returns {boolean}
     */
    static #isCopperPrimitive(primitive) {
        return (
            ['pad', 'track', 'via', 'zone'].includes(primitive.kind) &&
            String(primitive.netName || '').trim() &&
            primitive.bounds
        )
    }

    /**
     * Returns true when a primitive represents a keepout region.
     * @param {object} primitive Primitive row.
     * @returns {boolean}
     */
    static #isKeepoutPrimitive(primitive) {
        return primitive.kind === 'keepout' && Boolean(primitive.bounds)
    }

    /**
     * Returns true when two copper primitives should share clearance checks.
     * @param {object} left First primitive.
     * @param {object} right Second primitive.
     * @returns {boolean}
     */
    static #sameClearanceLayer(left, right) {
        if (left.kind === 'via' || right.kind === 'via') return true
        const leftLayer = String(left.layer || '').trim()
        const rightLayer = String(right.layer || '').trim()
        return !leftLayer || !rightLayer || leftLayer === rightLayer
    }

    /**
     * Returns true when a keepout applies to the copper primitive layer.
     * @param {object} copper Copper primitive.
     * @param {object} keepout Keepout primitive.
     * @returns {boolean}
     */
    static #keepoutAppliesToCopper(copper, keepout) {
        if (copper.kind === 'via') return true
        const keepoutSides = this.#keepoutSides(keepout)
        if (!keepoutSides.length) return true
        const copperSide = this.#surfaceSide(copper.layer || copper.side)
        return !copperSide || keepoutSides.includes(copperSide)
    }

    /**
     * Resolves the positive distance between two axis-aligned bounds.
     * @param {object} left First bounds.
     * @param {object} right Second bounds.
     * @returns {number}
     */
    static #boundsClearance(left, right) {
        const gapX = Math.max(left.minX - right.maxX, right.minX - left.maxX, 0)
        const gapY = Math.max(left.minY - right.maxY, right.minY - left.maxY, 0)
        return Math.hypot(gapX, gapY)
    }

    /**
     * Builds one copper clearance diagnostic.
     * @param {object} left First primitive.
     * @param {object} right Second primitive.
     * @param {number} minimum Minimum clearance.
     * @param {number} actual Actual clearance.
     * @param {number} index Diagnostic index.
     * @returns {object}
     */
    static #clearanceDiagnostic(left, right, minimum, actual, index) {
        const leftCenter = this.#boundsCenter(left.bounds)
        const rightCenter = this.#boundsCenter(right.bounds)
        const netName = [left.netName, right.netName].sort().join(' / ')

        return {
            id: 'clearance:' + index,
            kind: 'error',
            severity: 'error',
            category: 'clearance',
            code: 'pcb_copper_clearance',
            message:
                'Copper clearance is below the configured minimum for ' +
                netName +
                '.',
            point: {
                x: (leftCenter.x + rightCenter.x) / 2,
                y: (leftCenter.y + rightCenter.y) / 2
            },
            bounds: this.#mergeBounds([left.bounds, right.bounds]),
            relatedPrimitiveIds: [left.id, right.id].filter(Boolean).sort(),
            componentKey: '',
            netName,
            clearance: {
                minimum,
                actual: Number(actual.toFixed(6))
            }
        }
    }

    /**
     * Builds one keepout clearance diagnostic.
     * @param {object} copper Copper primitive.
     * @param {object} keepout Keepout primitive.
     * @param {number} minimum Minimum clearance.
     * @param {number} actual Actual clearance.
     * @param {number} index Diagnostic index.
     * @returns {object}
     */
    static #keepoutDiagnostic(copper, keepout, minimum, actual, index) {
        const copperCenter = this.#boundsCenter(copper.bounds)
        const keepoutCenter = this.#boundsCenter(keepout.bounds)
        const keepoutId = String(keepout.id || '')

        return {
            id: 'keepout-clearance:' + index,
            kind: 'error',
            severity: 'error',
            category: 'clearance',
            code: 'pcb_keepout_clearance',
            message:
                'Copper clearance is below the configured minimum around keepout ' +
                keepoutId +
                '.',
            point: {
                x: (copperCenter.x + keepoutCenter.x) / 2,
                y: (copperCenter.y + keepoutCenter.y) / 2
            },
            bounds: this.#mergeBounds([copper.bounds, keepout.bounds]),
            relatedPrimitiveIds: [copper.id, keepout.id].filter(Boolean).sort(),
            componentKey: String(copper.componentKey || ''),
            netName: String(copper.netName || ''),
            keepoutId,
            clearance: {
                minimum,
                actual: Number(actual.toFixed(6))
            }
        }
    }

    /**
     * Resolves the center point of bounds.
     * @param {object} bounds Bounds record.
     * @returns {{ x: number, y: number }}
     */
    static #boundsCenter(bounds) {
        return {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2
        }
    }

    /**
     * Merges bounds rows.
     * @param {object[]} rows Bounds rows.
     * @returns {object | null}
     */
    static #mergeBounds(rows) {
        const validRows = rows.filter(Boolean)
        if (!validRows.length) return null
        const minX = Math.min(...validRows.map((bounds) => bounds.minX))
        const minY = Math.min(...validRows.map((bounds) => bounds.minY))
        const maxX = Math.max(...validRows.map((bounds) => bounds.maxX))
        const maxY = Math.max(...validRows.map((bounds) => bounds.maxY))
        return {
            minX: this.#round(minX),
            minY: this.#round(minY),
            maxX: this.#round(maxX),
            maxY: this.#round(maxY),
            width: this.#round(maxX - minX),
            height: this.#round(maxY - minY)
        }
    }

    /**
     * Resolves keepout surface sides from source layer fields.
     * @param {object} keepout Keepout primitive.
     * @returns {string[]}
     */
    static #keepoutSides(keepout) {
        const source = keepout.source || {}
        const layers = [
            ...(Array.isArray(source.layers) ? source.layers : []),
            source.layer,
            source.side
        ]
        return [
            ...new Set(
                layers.map((layer) => this.#surfaceSide(layer)).filter(Boolean)
            )
        ]
    }

    /**
     * Resolves top or bottom from common layer values.
     * @param {unknown} layer Layer value.
     * @returns {'top' | 'bottom' | ''}
     */
    static #surfaceSide(layer) {
        const value =
            typeof layer === 'object' && layer !== null ? layer.name : layer
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
        if (
            normalized === 'top' ||
            normalized === 'front' ||
            normalized === 'f.cu' ||
            normalized === '1'
        ) {
            return 'top'
        }
        if (
            normalized === 'bottom' ||
            normalized === 'back' ||
            normalized === 'b.cu' ||
            normalized === '32'
        ) {
            return 'bottom'
        }
        return ''
    }

    /**
     * Rounds one computed geometry value.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value).toFixed(6))
    }
}
