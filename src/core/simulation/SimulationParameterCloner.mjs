import { ToolkitError } from '../contracts/ToolkitError.mjs'

const MAX_PARAMETER_ITEMS = 100000
const MAX_PARAMETER_BYTES = 100000000
const MAX_PARAMETER_DEPTH = 64
const MAX_PARAMETER_STRING_LENGTH = 10000000

const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    'byteLength'
)?.get
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
    typeof SharedArrayBuffer === 'function'
        ? Object.getOwnPropertyDescriptor(
              SharedArrayBuffer.prototype,
              'byteLength'
          )?.get
        : null
const DATA_VIEW_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
    DataView.prototype,
    'buffer'
)?.get
const DATA_VIEW_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    DataView.prototype,
    'byteLength'
)?.get
const DATA_VIEW_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
    DataView.prototype,
    'byteOffset'
)?.get
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype)
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'buffer'
)?.get
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'byteLength'
)?.get
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'byteOffset'
)?.get
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'length'
)?.get
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    Symbol.toStringTag
)?.get
const MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(
    Map.prototype,
    'size'
)?.get
const SET_SIZE_GETTER = Object.getOwnPropertyDescriptor(
    Set.prototype,
    'size'
)?.get
const REGEXP_SOURCE_GETTER = Object.getOwnPropertyDescriptor(
    RegExp.prototype,
    'source'
)?.get

const TYPED_ARRAY_CONSTRUCTORS = new Map([
    ['Int8Array', Int8Array],
    ['Uint8Array', Uint8Array],
    ['Uint8ClampedArray', Uint8ClampedArray],
    ['Int16Array', Int16Array],
    ['Uint16Array', Uint16Array],
    ['Int32Array', Int32Array],
    ['Uint32Array', Uint32Array],
    ['Float32Array', Float32Array],
    ['Float64Array', Float64Array],
    ['BigInt64Array', BigInt64Array],
    ['BigUint64Array', BigUint64Array]
])

/**
 * Copies bounded simulation parameters without retaining caller-owned memory.
 */
export class SimulationParameterCloner {
    /**
     * Copies one plain parameter record into isolated clone-safe data.
     * @param {unknown} value Parameter candidate.
     * @returns {object} Isolated parameters.
     */
    static cloneRecord(value) {
        try {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                throw SimulationParameterCloner.#error(
                    'Simulation parameters must be a plain object.'
                )
            }
            const prototype = Object.getPrototypeOf(value)
            if (prototype !== Object.prototype && prototype !== null) {
                throw SimulationParameterCloner.#error(
                    'Simulation parameters must be a plain object.'
                )
            }
            return SimulationParameterCloner.#clone(
                value,
                { clones: new WeakMap(), items: 0, bytes: 0 },
                0
            )
        } catch (error) {
            if (SimulationParameterCloner.#isRequestError(error)) throw error
            throw SimulationParameterCloner.#error(
                'Simulation parameters could not be inspected safely.'
            )
        }
    }

    /**
     * Copies one supported structured-clone value.
     * @param {unknown} value Value to copy.
     * @param {{ clones: WeakMap<object, any>, items: number, bytes: number }} state Traversal state.
     * @param {number} depth Current container depth.
     * @returns {any} Copied value.
     */
    static #clone(value, state, depth) {
        if (typeof value === 'string') {
            if (value.length > MAX_PARAMETER_STRING_LENGTH) {
                throw SimulationParameterCloner.#error(
                    'Simulation parameter strings are too large.'
                )
            }
            return value
        }
        if (
            value === null ||
            ['undefined', 'boolean', 'number', 'bigint'].includes(typeof value)
        ) {
            return value
        }
        if (typeof value !== 'object') {
            throw SimulationParameterCloner.#error(
                'Simulation parameters must contain clone-safe data.'
            )
        }
        if (depth > MAX_PARAMETER_DEPTH) {
            throw SimulationParameterCloner.#error(
                'Simulation parameters are nested too deeply.'
            )
        }
        if (state.clones.has(value)) return state.clones.get(value)
        SimulationParameterCloner.#consumeItems(state, 1)

        if (ArrayBuffer.isView(value)) {
            return SimulationParameterCloner.#cloneView(value, state)
        }
        const bufferLength = SimulationParameterCloner.#bufferLength(value)
        if (bufferLength !== null) {
            const copied = SimulationParameterCloner.#copyBytes(
                value,
                0,
                bufferLength,
                state
            ).buffer
            state.clones.set(value, copied)
            return copied
        }
        const date = SimulationParameterCloner.#date(value)
        if (date !== null) {
            state.clones.set(value, date)
            return date
        }
        const regexp = SimulationParameterCloner.#regexp(value)
        if (regexp !== null) {
            state.clones.set(value, regexp)
            return regexp
        }
        const mapSize = SimulationParameterCloner.#collectionSize(
            value,
            MAP_SIZE_GETTER
        )
        if (mapSize !== null) {
            return SimulationParameterCloner.#cloneMap(
                value,
                mapSize,
                state,
                depth
            )
        }
        const setSize = SimulationParameterCloner.#collectionSize(
            value,
            SET_SIZE_GETTER
        )
        if (setSize !== null) {
            return SimulationParameterCloner.#cloneSet(
                value,
                setSize,
                state,
                depth
            )
        }
        return SimulationParameterCloner.#cloneRecordValue(value, state, depth)
    }

    /**
     * Copies exactly the bytes exposed by one typed-array or DataView view.
     * @param {ArrayBufferView} value View candidate.
     * @param {{ clones: WeakMap<object, any>, items: number, bytes: number }} state Traversal state.
     * @returns {ArrayBufferView} Isolated view.
     */
    static #cloneView(value, state) {
        const dataView = SimulationParameterCloner.#viewInfo(
            value,
            DATA_VIEW_BUFFER_GETTER,
            DATA_VIEW_BYTE_OFFSET_GETTER,
            DATA_VIEW_BYTE_LENGTH_GETTER
        )
        if (dataView) {
            const bytes = SimulationParameterCloner.#copyBytes(
                dataView.buffer,
                dataView.byteOffset,
                dataView.byteLength,
                state
            )
            const clone = new DataView(bytes.buffer)
            state.clones.set(value, clone)
            return clone
        }

        const typedArray = SimulationParameterCloner.#typedArrayInfo(value)
        if (!typedArray) {
            throw SimulationParameterCloner.#error(
                'Simulation parameters contain unsupported binary views.'
            )
        }
        const bytes = SimulationParameterCloner.#copyBytes(
            typedArray.buffer,
            typedArray.byteOffset,
            typedArray.byteLength,
            state
        )
        const Constructor = TYPED_ARRAY_CONSTRUCTORS.get(typedArray.tag)
        if (!Constructor) {
            throw SimulationParameterCloner.#error(
                'Simulation parameters contain unsupported binary views.'
            )
        }
        const clone = new Constructor(bytes.buffer, 0, typedArray.length)
        state.clones.set(value, clone)
        return clone
    }

    /**
     * Reads DataView internal fields through built-in getters.
     * @param {unknown} value View candidate.
     * @param {Function | undefined} bufferGetter Buffer getter.
     * @param {Function | undefined} offsetGetter Offset getter.
     * @param {Function | undefined} lengthGetter Length getter.
     * @returns {{ buffer: ArrayBufferLike, byteOffset: number, byteLength: number } | null} View fields.
     */
    static #viewInfo(value, bufferGetter, offsetGetter, lengthGetter) {
        if (!bufferGetter || !offsetGetter || !lengthGetter) return null
        try {
            return {
                buffer: bufferGetter.call(value),
                byteOffset: offsetGetter.call(value),
                byteLength: lengthGetter.call(value)
            }
        } catch {
            return null
        }
    }

    /**
     * Reads typed-array internal fields through built-in getters.
     * @param {unknown} value Typed-array candidate.
     * @returns {{ buffer: ArrayBufferLike, byteOffset: number, byteLength: number, length: number, tag: string } | null} Typed-array fields.
     */
    static #typedArrayInfo(value) {
        const info = SimulationParameterCloner.#viewInfo(
            value,
            TYPED_ARRAY_BUFFER_GETTER,
            TYPED_ARRAY_BYTE_OFFSET_GETTER,
            TYPED_ARRAY_BYTE_LENGTH_GETTER
        )
        if (!info || !TYPED_ARRAY_LENGTH_GETTER || !TYPED_ARRAY_TAG_GETTER) {
            return null
        }
        try {
            return {
                ...info,
                length: TYPED_ARRAY_LENGTH_GETTER.call(value),
                tag: TYPED_ARRAY_TAG_GETTER.call(value)
            }
        } catch {
            return null
        }
    }

    /**
     * Copies one exact byte range into a new ArrayBuffer-backed array.
     * @param {ArrayBufferLike} buffer Source buffer.
     * @param {number} byteOffset First source byte.
     * @param {number} byteLength Number of source bytes.
     * @param {{ bytes: number }} state Traversal state.
     * @returns {Uint8Array} Isolated bytes.
     */
    static #copyBytes(buffer, byteOffset, byteLength, state) {
        SimulationParameterCloner.#assertByteBudget(state, byteLength)
        const copied = new Uint8Array(buffer, byteOffset, byteLength).slice()
        if (copied.byteLength !== byteLength) {
            throw SimulationParameterCloner.#error(
                'Simulation parameter buffers could not be copied safely.'
            )
        }
        state.bytes += copied.byteLength
        return copied
    }

    /**
     * Reads a genuine ArrayBuffer or SharedArrayBuffer byte length.
     * @param {unknown} value Buffer candidate.
     * @returns {number | null} Byte length or null for another object type.
     */
    static #bufferLength(value) {
        for (const getter of [
            ARRAY_BUFFER_BYTE_LENGTH_GETTER,
            SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER
        ]) {
            if (!getter) continue
            try {
                return getter.call(value)
            } catch {
                // Try the other supported buffer brand.
            }
        }
        return null
    }

    /**
     * Copies a genuine Date without reading shadowable properties.
     * @param {unknown} value Date candidate.
     * @returns {Date | null} Copied date or null.
     */
    static #date(value) {
        try {
            return new Date(Date.prototype.getTime.call(value))
        } catch {
            return null
        }
    }

    /**
     * Copies a genuine RegExp through its internal structured-clone slots.
     * @param {unknown} value RegExp candidate.
     * @returns {RegExp | null} Copied regular expression or null.
     */
    static #regexp(value) {
        if (!REGEXP_SOURCE_GETTER) return null
        try {
            REGEXP_SOURCE_GETTER.call(value)
            return structuredClone(value)
        } catch {
            return null
        }
    }

    /**
     * Reads a Map or Set size through its brand-checking built-in getter.
     * @param {unknown} value Collection candidate.
     * @param {Function | undefined} getter Native size getter.
     * @returns {number | null} Collection size or null.
     */
    static #collectionSize(value, getter) {
        if (!getter) return null
        try {
            return getter.call(value)
        } catch {
            return null
        }
    }

    /**
     * Copies Map entries while charging them to the global item budget.
     * @param {Map<unknown, unknown>} value Source map.
     * @param {number} size Map size.
     * @param {{ clones: WeakMap<object, any>, items: number, bytes: number }} state Traversal state.
     * @param {number} depth Current depth.
     * @returns {Map<unknown, unknown>} Copied map.
     */
    static #cloneMap(value, size, state, depth) {
        SimulationParameterCloner.#consumeItems(state, size)
        const clone = new Map()
        state.clones.set(value, clone)
        const entries = Map.prototype.entries.call(value)
        for (const [key, entry] of entries) {
            clone.set(
                SimulationParameterCloner.#clone(key, state, depth + 1),
                SimulationParameterCloner.#clone(entry, state, depth + 1)
            )
        }
        return clone
    }

    /**
     * Copies Set entries while charging them to the global item budget.
     * @param {Set<unknown>} value Source set.
     * @param {number} size Set size.
     * @param {{ clones: WeakMap<object, any>, items: number, bytes: number }} state Traversal state.
     * @param {number} depth Current depth.
     * @returns {Set<unknown>} Copied set.
     */
    static #cloneSet(value, size, state, depth) {
        SimulationParameterCloner.#consumeItems(state, size)
        const clone = new Set()
        state.clones.set(value, clone)
        const entries = Set.prototype.values.call(value)
        for (const entry of entries) {
            clone.add(SimulationParameterCloner.#clone(entry, state, depth + 1))
        }
        return clone
    }

    /**
     * Copies an Array or plain accessor-free object.
     * @param {object} value Source record.
     * @param {{ clones: WeakMap<object, any>, items: number, bytes: number }} state Traversal state.
     * @param {number} depth Current depth.
     * @returns {object | unknown[]} Copied record.
     */
    static #cloneRecordValue(value, state, depth) {
        const isArray = Array.isArray(value)
        const prototype = Object.getPrototypeOf(value)
        if (!isArray && prototype !== Object.prototype && prototype !== null) {
            throw SimulationParameterCloner.#error(
                'Simulation parameters contain unsupported objects.'
            )
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const keys = Reflect.ownKeys(descriptors)
        const length = isArray ? descriptors.length?.value : 0
        if (
            isArray &&
            (!Number.isSafeInteger(length) ||
                length < 0 ||
                length > MAX_PARAMETER_ITEMS)
        ) {
            throw SimulationParameterCloner.#error(
                'Simulation parameters contain too many values.'
            )
        }
        const dataKeys = keys.filter((key) => !(isArray && key === 'length'))
        SimulationParameterCloner.#consumeItems(state, dataKeys.length)
        const clone = isArray ? new Array(length) : {}
        state.clones.set(value, clone)

        for (const key of dataKeys) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                descriptor.enumerable !== true ||
                descriptor.get ||
                descriptor.set
            ) {
                throw SimulationParameterCloner.#error(
                    'Simulation parameters contain accessor-backed data.'
                )
            }
            Object.defineProperty(clone, key, {
                configurable: true,
                enumerable: true,
                value: SimulationParameterCloner.#clone(
                    descriptor.value,
                    state,
                    depth + 1
                ),
                writable: true
            })
        }
        return clone
    }

    /**
     * Charges values to the one request-global item budget.
     * @param {{ items: number }} state Traversal state.
     * @param {number} count Additional values.
     * @returns {void}
     */
    static #consumeItems(state, count) {
        if (
            !Number.isSafeInteger(count) ||
            count < 0 ||
            state.items + count > MAX_PARAMETER_ITEMS
        ) {
            throw SimulationParameterCloner.#error(
                'Simulation parameters contain too many values.'
            )
        }
        state.items += count
    }

    /**
     * Verifies the actual copied byte slice fits the request-global budget.
     * @param {{ bytes: number }} state Traversal state.
     * @param {number} byteLength Proposed copied byte length.
     * @returns {void}
     */
    static #assertByteBudget(state, byteLength) {
        if (
            !Number.isSafeInteger(byteLength) ||
            byteLength < 0 ||
            state.bytes + byteLength > MAX_PARAMETER_BYTES
        ) {
            throw SimulationParameterCloner.#error(
                'Simulation parameter buffers are too large.'
            )
        }
    }

    /**
     * Identifies request errors created by this helper without trusting proxies.
     * @param {unknown} error Error candidate.
     * @returns {boolean} Whether this is an internal request error.
     */
    static #isRequestError(error) {
        try {
            return (
                error instanceof ToolkitError &&
                error.code === 'ERR_SIMULATION_REQUEST'
            )
        } catch {
            return false
        }
    }

    /**
     * Creates one canonical simulation request error.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed error.
     */
    static #error(message) {
        return new ToolkitError(message, {
            code: 'ERR_SIMULATION_REQUEST',
            category: 'validation',
            format: 'circuitjson'
        })
    }
}
