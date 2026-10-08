/** Optional source-font geometry, independent of a renderer or font library. */
export class CircuitJsonTextStrokeGeometry {
    /**
     * Checks version 1 board-space millimetre polylines without invoking getters.
     * Empty paths represent text with no visible strokes (for example spaces).
     * @param {unknown} value Candidate geometry.
     * @returns {boolean} Whether the complete optional geometry is valid.
     */
    static isValid(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false
        const fields = Object.getOwnPropertyDescriptors(value)
        const read = (name) => fields[name]?.value
        const paths = read('paths')
        return (
            read('version') === 1 &&
            read('units') === 'mm' &&
            read('coordinate_space') === 'board' &&
            Number.isFinite(read('stroke_width')) &&
            read('stroke_width') > 0 &&
            CircuitJsonTextStrokeGeometry.#array(
                paths,
                (path) =>
                    Array.isArray(path) &&
                    path.length >= 2 &&
                    CircuitJsonTextStrokeGeometry.#array(
                        path,
                        (point) =>
                            Array.isArray(point) &&
                            point.length === 2 &&
                            CircuitJsonTextStrokeGeometry.#array(
                                point,
                                Number.isFinite
                            )
                    )
            )
        )
    }

    /**
     * Transforms already laid-out paths by a uniform scale/rotation/reflection.
     * Non-uniform scales/shears cannot preserve a scalar stroke width.
     * @param {object} value Valid version 1 geometry.
     * @param {number[]} matrix SVG-order affine [a,b,c,d,e,f] in millimetres.
     * @returns {object} Detached transformed geometry.
     */
    static transform(value, matrix) {
        if (!CircuitJsonTextStrokeGeometry.isValid(value)) {
            throw new TypeError('Invalid source stroke geometry')
        }
        if (
            !Array.isArray(matrix) ||
            matrix.length !== 6 ||
            !CircuitJsonTextStrokeGeometry.#array(matrix, Number.isFinite)
        ) {
            throw new TypeError('Expected a finite similarity transform')
        }
        const [a, b, c, d, e, f] = matrix
        const scale = Math.hypot(a, b)
        const other = Math.hypot(c, d)
        if (
            !(scale > 0) ||
            !Number.isFinite(scale) ||
            Math.abs(scale - other) > 1e-10 * scale ||
            Math.abs((a / scale) * (c / other) + (b / scale) * (d / other)) >
                1e-10
        ) {
            throw new TypeError(
                'Expected a non-degenerate similarity transform'
            )
        }
        const result = {
            version: 1,
            units: 'mm',
            coordinate_space: 'board',
            stroke_width: value.stroke_width * scale,
            paths: value.paths.map((path) =>
                path.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
            )
        }
        if (!CircuitJsonTextStrokeGeometry.isValid(result)) {
            throw new RangeError(
                'Transformed source stroke geometry is not finite'
            )
        }
        return result
    }

    /**
     * Validates dense own-data arrays without evaluating accessors.
     * @param {unknown} value Candidate array.
     * @param {(entry: unknown) => boolean} check Element predicate.
     * @returns {boolean} Whether every array entry satisfies the predicate.
     */
    static #array(value, check) {
        if (!Array.isArray(value)) return false
        for (let index = 0; index < value.length; index++) {
            const field = Object.getOwnPropertyDescriptor(value, String(index))
            if (!field || !Object.hasOwn(field, 'value') || !check(field.value))
                return false
        }
        return true
    }
}
