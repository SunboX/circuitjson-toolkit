import { freezeScene } from './Scene3dFreeze.mjs'

/**
 * Builds canonical scene materials while preserving CircuitJSON appearance.
 */
export class Scene3dMaterials {
    /**
     * Builds one frozen material list from the primary board appearance.
     * @param {object[]} boards PCB board elements.
     * @returns {object[]} Canonical materials.
     */
    static build(boards) {
        const board = boards[0] || {}
        return freezeScene([
            {
                id: 'board-core',
                kind: String(board.material || 'board'),
                color: Scene3dMaterials.#color(
                    board.solder_mask_color,
                    '#2f7d32'
                ),
                opacity: 1
            },
            {
                id: 'component-body',
                kind: 'component',
                color: '#252525',
                opacity: 1
            },
            {
                id: 'copper',
                kind: 'copper',
                color: '#b87333',
                opacity: 1
            },
            {
                id: 'silkscreen',
                kind: 'silkscreen',
                color: Scene3dMaterials.#color(
                    board.silkscreen_color,
                    '#f3f3e7'
                ),
                opacity: 1
            }
        ])
    }

    /**
     * Preserves one bounded color token or returns the canonical fallback.
     * @param {unknown} value Color candidate.
     * @param {string} fallback Fallback color.
     * @returns {string} Color token.
     */
    static #color(value, fallback) {
        const color = String(value || '').trim()
        return color && color.length <= 64 ? color : fallback
    }
}
