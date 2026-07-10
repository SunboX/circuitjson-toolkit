/**
 * Builds deterministic synthetic CircuitJSON documents for benchmarks.
 */
export class SyntheticCircuitJsonFactory {
    /**
     * Builds an exact-size document suited to parsing and indexing benchmarks.
     * @param {number} elementCount Total number of elements.
     * @returns {object[]} CircuitJSON document.
     */
    static largeDocument(elementCount = 50000) {
        const count = Math.max(1, Math.floor(elementCount))
        const document = [SyntheticCircuitJsonFactory.#board('large', 100, 80)]
        for (let index = 1; index < count; index += 1) {
            document.push({
                type: 'source_net',
                source_net_id: `source_net_${index}`,
                name: `NET_${index}`
            })
        }
        return document
    }

    /**
     * Builds a multi-layer board with regular pad geometry.
     * @param {{ rows?: number, columns?: number }} options Fixture dimensions.
     * @returns {object[]} CircuitJSON document.
     */
    static interactiveBoard(options = {}) {
        const rows = Math.max(1, Math.floor(options.rows || 12))
        const columns = Math.max(1, Math.floor(options.columns || 16))
        const document = [
            SyntheticCircuitJsonFactory.#board(
                'interactive',
                columns * 2,
                rows * 2
            )
        ]
        const layers = ['top', 'bottom', 'inner1', 'inner2']

        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                const index = row * columns + column
                document.push({
                    type: 'pcb_smtpad',
                    pcb_smtpad_id: `pad_${index}`,
                    shape: index % 3 === 0 ? 'circle' : 'rect',
                    x: column * 1.5 - columns * 0.75,
                    y: row * 1.5 - rows * 0.75,
                    width: 0.9,
                    height: 0.6,
                    layer: layers[index % layers.length],
                    net: `NET_${index % 24}`
                })
            }
        }
        return document
    }

    /**
     * Builds repeated nets and pads for lookup benchmarks.
     * @param {{ netCount?: number, padsPerNet?: number }} options Fixture dimensions.
     * @returns {object[]} CircuitJSON document.
     */
    static netlistDocument(options = {}) {
        const netCount = Math.max(1, Math.floor(options.netCount || 128))
        const padsPerNet = Math.max(1, Math.floor(options.padsPerNet || 8))
        const document = [
            SyntheticCircuitJsonFactory.#board('netlist', 120, 80)
        ]

        for (let netIndex = 0; netIndex < netCount; netIndex += 1) {
            const netName = `BUS_${netIndex}`
            document.push({
                type: 'source_net',
                source_net_id: `source_net_bus_${netIndex}`,
                name: netName
            })
            for (let padIndex = 0; padIndex < padsPerNet; padIndex += 1) {
                const index = netIndex * padsPerNet + padIndex
                document.push({
                    type: 'pcb_smtpad',
                    pcb_smtpad_id: `net_pad_${index}`,
                    shape: 'rect',
                    x: (index % 64) * 1.4 - 44,
                    y: Math.floor(index / 64) * 1.2 - 10,
                    width: 0.8,
                    height: 0.5,
                    layer: index % 2 === 0 ? 'top' : 'bottom',
                    net: netName
                })
            }
        }
        return document
    }

    /**
     * Builds a valid board element.
     * @param {string} id Stable board suffix.
     * @param {number} width Board width.
     * @param {number} height Board height.
     * @returns {object} CircuitJSON board element.
     */
    static #board(id, width, height) {
        return {
            type: 'pcb_board',
            pcb_board_id: `pcb_board_${id}`,
            center: { x: 0, y: 0 },
            width,
            height,
            num_layers: 4
        }
    }
}
