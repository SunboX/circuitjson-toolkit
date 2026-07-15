const NO_STANDARD_COLLECTION = Symbol('NoStandardCollection')
const MAP_ENTRIES = Map.prototype.entries
const MAP_ITERATOR_NEXT = Object.getPrototypeOf(new Map().entries()).next
const MAP_SIZE = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get
const SET_ITERATOR_NEXT = Object.getPrototypeOf(new Set().values()).next
const SET_SIZE = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get
const SET_VALUES = Set.prototype.values

/**
 * Normalizes standard structured-clone collections in bounded entry slices.
 */
export class StructuredCloneCollectionNormalizer {
    /**
     * Returns the private sentinel for a non-collection candidate.
     * @returns {symbol} Non-collection sentinel.
     */
    static get notHandled() {
        return NO_STANDARD_COLLECTION
    }

    /**
     * Normalizes one Map or Set through captured platform iteration.
     * @param {object} value Collection candidate.
     * @param {object | null} prototype Captured prototype.
     * @param {PropertyKey[]} keys Captured own keys.
     * @param {number} depth Current collection depth.
     * @param {{ adopt: (value: unknown, depth: number) => Generator<void, unknown, void>, checkpoint: () => Generator<void, void, void>, collect: (value: unknown) => Generator<void, void, void>, remember: (source: object, result: unknown[]) => void, reserve: (count: number) => void }} operations Traversal operations.
     * @returns {Generator<void, unknown, void>} Normalized collection or sentinel.
     */
    static *normalize(value, prototype, keys, depth, operations) {
        const map = prototype === Map.prototype
        const set = prototype === Set.prototype
        if (!map && !set) return NO_STANDARD_COLLECTION
        if (keys.length) {
            throw new TypeError(
                `Canonical asset source ${map ? 'maps' : 'sets'} may not have custom properties.`
            )
        }
        const sizeGetter = map ? MAP_SIZE : SET_SIZE
        if (typeof sizeGetter !== 'function') {
            throw new TypeError(
                `Canonical asset source contains an invalid ${map ? 'map' : 'set'}.`
            )
        }
        let size
        let iterator
        try {
            size = Reflect.apply(sizeGetter, value, [])
            iterator = Reflect.apply(map ? MAP_ENTRIES : SET_VALUES, value, [])
        } catch {
            throw new TypeError(
                `Canonical asset source contains an invalid ${map ? 'map' : 'set'}.`
            )
        }
        operations.reserve(1)
        operations.reserve(map ? size * 2 : size)
        const result = []
        operations.remember(value, result)
        const iteratorNext = map ? MAP_ITERATOR_NEXT : SET_ITERATOR_NEXT
        for (let index = 0; index < size; index += 1) {
            const row = Reflect.apply(iteratorNext, iterator, [])
            if (row.done || (map && !Array.isArray(row.value))) {
                throw new TypeError(
                    `Canonical asset source ${map ? 'map' : 'set'} changed during inspection.`
                )
            }
            result[index] = map
                ? [
                      yield* operations.adopt(row.value[0], depth + 1),
                      yield* operations.adopt(row.value[1], depth + 1)
                  ]
                : yield* operations.adopt(row.value, depth + 1)
            yield* operations.checkpoint()
        }
        if (!Reflect.apply(iteratorNext, iterator, []).done) {
            throw new TypeError(
                `Canonical asset source ${map ? 'map' : 'set'} changed during inspection.`
            )
        }
        yield* operations.collect(result)
        return result
    }
}

Object.freeze(StructuredCloneCollectionNormalizer.prototype)
Object.freeze(StructuredCloneCollectionNormalizer)
