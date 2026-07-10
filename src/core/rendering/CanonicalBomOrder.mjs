/**
 * Provides one total deterministic ordering for canonical BOM presentation.
 */
export class CanonicalBomOrder {
    /**
     * Compares natural designator strings with a raw code-point tie break.
     * @param {unknown} left Left designator.
     * @param {unknown} right Right designator.
     * @returns {number} Ordering value.
     */
    static compareDesignators(left, right) {
        const leftText = String(left)
        const rightText = String(right)
        const natural = leftText.localeCompare(rightText, 'en-US', {
            numeric: true,
            sensitivity: 'base'
        })
        return natural || CanonicalBomOrder.#compareText(leftText, rightText)
    }

    /**
     * Compares every rendered row field after its complete designator list.
     * @param {object} left Left BOM row.
     * @param {object} right Right BOM row.
     * @returns {number} Total rendered-row order.
     */
    static compareRows(left, right) {
        const leftDesignators = left.designators || []
        const rightDesignators = right.designators || []
        const common = Math.min(leftDesignators.length, rightDesignators.length)
        for (let index = 0; index < common; index += 1) {
            const order = CanonicalBomOrder.compareDesignators(
                leftDesignators[index],
                rightDesignators[index]
            )
            if (order) return order
        }
        if (leftDesignators.length !== rightDesignators.length) {
            return leftDesignators.length - rightDesignators.length
        }
        for (const field of ['value', 'pattern', 'source', 'quantity']) {
            const order = CanonicalBomOrder.#compareScalar(
                left[field],
                right[field]
            )
            if (order) return order
        }
        return 0
    }

    /**
     * Compares primitive rendered scalar values by type and value.
     * @param {unknown} left Left scalar.
     * @param {unknown} right Right scalar.
     * @returns {number} Ordering value.
     */
    static #compareScalar(left, right) {
        if (left === right) return 0
        const leftType = typeof left
        const rightType = typeof right
        if (leftType !== rightType) {
            return CanonicalBomOrder.#compareText(leftType, rightType)
        }
        if (leftType === 'number') return left - right
        if (leftType === 'boolean') return left ? 1 : -1
        return CanonicalBomOrder.#compareText(
            String(left ?? ''),
            String(right ?? '')
        )
    }

    /**
     * Compares strings by code point.
     * @param {string} left Left text.
     * @param {string} right Right text.
     * @returns {number} Ordering value.
     */
    static #compareText(left, right) {
        return left < right ? -1 : left > right ? 1 : 0
    }
}
