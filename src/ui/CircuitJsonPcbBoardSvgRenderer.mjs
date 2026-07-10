import { SafeXmlText } from './SafeXmlText.mjs'

/**
 * Serializes every prepared PCB board substrate in stable primitive order.
 */
export class CircuitJsonPcbBoardSvgRenderer {
    /**
     * Renders all board primitives in one prepared primitive model.
     * @param {{ primitives?: object[] }} model Primitive model.
     * @returns {string} Board substrate markup.
     */
    static render(model) {
        const markup = []
        for (const board of model.primitives || []) {
            if (board.kind !== 'board' || !board.bounds) continue
            markup.push(CircuitJsonPcbBoardSvgRenderer.#renderBoard(board))
        }
        return markup.join('')
    }

    /**
     * Renders one polygonal or rectangular board primitive.
     * @param {object} board Board primitive.
     * @returns {string} Board markup.
     */
    static #renderBoard(board) {
        if (Array.isArray(board.points) && board.points.length >= 3) {
            return (
                '<polygon class="pcb-board" data-layer="board" points="' +
                SafeXmlText.escape(
                    CircuitJsonPcbBoardSvgRenderer.#points(board.points)
                ) +
                '"></polygon>'
            )
        }
        return (
            '<rect class="pcb-board" x="' +
            CircuitJsonPcbBoardSvgRenderer.#number(board.bounds.minX) +
            '" y="' +
            CircuitJsonPcbBoardSvgRenderer.#number(board.bounds.minY) +
            '" width="' +
            CircuitJsonPcbBoardSvgRenderer.#number(board.bounds.width) +
            '" height="' +
            CircuitJsonPcbBoardSvgRenderer.#number(board.bounds.height) +
            '" rx="' +
            CircuitJsonPcbBoardSvgRenderer.#number(
                Math.min(board.bounds.width, board.bounds.height) * 0.018
            ) +
            '" data-layer="board"></rect>'
        )
    }

    /**
     * Formats polygon points for an SVG attribute.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @returns {string} SVG point list.
     */
    static #points(points) {
        return points
            .map(
                (point) =>
                    CircuitJsonPcbBoardSvgRenderer.#number(point.x) +
                    ',' +
                    CircuitJsonPcbBoardSvgRenderer.#number(point.y)
            )
            .join(' ')
    }

    /**
     * Formats one finite SVG number.
     * @param {unknown} value Number candidate.
     * @returns {string} SVG number.
     */
    static #number(value) {
        const number = Number(value)
        return Number.isFinite(number)
            ? Number(number.toFixed(6)).toString()
            : '0'
    }
}
