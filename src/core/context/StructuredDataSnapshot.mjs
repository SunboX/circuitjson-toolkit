import { BinaryDataSnapshot } from './BinaryDataSnapshot.mjs'

const METADATA_MAX_DEPTH = 64
const METADATA_MAX_ITEMS = 100_000
const UNBOUNDED_METADATA_BYTES = Number.MAX_SAFE_INTEGER
const DATE_GET_TIME = Date.prototype.getTime
const DATE_TO_ISO = Date.prototype.toISOString
const MAP_ENTRIES = Map.prototype.entries
const MAP_ITERATOR_NEXT = Object.getPrototypeOf(new Map().entries()).next
const MAP_SIZE = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get
const REGEXP_FLAGS = Object.getOwnPropertyDescriptor(
    RegExp.prototype,
    'flags'
)?.get
const REGEXP_SOURCE = Object.getOwnPropertyDescriptor(
    RegExp.prototype,
    'source'
)?.get
const SET_ITERATOR_NEXT = Object.getPrototypeOf(new Set().values()).next
const SET_SIZE = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get
const SET_VALUES = Set.prototype.values

/**
 * Atomically validates and owns bounded clone-safe metadata graphs.
 */
export class StructuredDataSnapshot {
    /**
     * Creates state shared by multiple metadata roots in one request.
     * @param {{ label?: string, maxBytes?: number, maxItems?: number, preserveBinary?: boolean }} [limits] Capture limits.
     * @returns {{ seen: Map<object, unknown>, accounted: Set<object>, bytes: number, items: number, label: string, maxBytes: number, maxItems: number, preserveBinary: boolean }} Capture state.
     */
    static createState(limits = {}) {
        const maxBytes =
            limits.maxBytes === undefined
                ? UNBOUNDED_METADATA_BYTES
                : limits.maxBytes
        const maxItems =
            limits.maxItems === undefined ? METADATA_MAX_ITEMS : limits.maxItems
        if (
            !Number.isSafeInteger(maxBytes) ||
            maxBytes < 0 ||
            !Number.isSafeInteger(maxItems) ||
            maxItems < 0
        ) {
            throw new TypeError('Invalid source-metadata capture limits.')
        }
        return {
            seen: new Map(),
            accounted: new Set(),
            bytes: 0,
            items: 0,
            label: String(limits.label || 'Canonical asset source'),
            maxBytes,
            maxItems,
            preserveBinary: limits.preserveBinary === true
        }
    }

    /**
     * Captures a bounded graph in the same descriptor traversal that validates it.
     * @param {unknown} value Metadata candidate.
     * @param {{ seen: Map<object, unknown>, items: number }} [state] Shared capture state.
     * @returns {unknown} Isolated normalized snapshot.
     */
    static capture(value, state = StructuredDataSnapshot.createState()) {
        if (
            !(state?.seen instanceof Map) ||
            !(state?.accounted instanceof Set) ||
            !Number.isSafeInteger(state.bytes) ||
            !Number.isSafeInteger(state.items) ||
            !Number.isSafeInteger(state.maxBytes) ||
            !Number.isSafeInteger(state.maxItems) ||
            typeof state.label !== 'string' ||
            typeof state.preserveBinary !== 'boolean'
        ) {
            throw new TypeError('Invalid source-metadata capture state.')
        }
        return StructuredDataSnapshot.#capture(value, state, 0)
    }

    /**
     * Accounts an already normalized metadata snapshot without cloning it.
     * @param {unknown} value Owned metadata snapshot.
     * @param {{ seen: Map<object, unknown>, accounted: Set<object>, bytes: number, items: number, label: string, maxBytes: number, maxItems: number }} state Shared capture state.
     * @returns {void}
     */
    static account(value, state) {
        if (
            !(state?.seen instanceof Map) ||
            !(state?.accounted instanceof Set) ||
            !Number.isSafeInteger(state.bytes) ||
            !Number.isSafeInteger(state.items) ||
            !Number.isSafeInteger(state.maxBytes) ||
            !Number.isSafeInteger(state.maxItems) ||
            typeof state.label !== 'string' ||
            typeof state.preserveBinary !== 'boolean'
        ) {
            throw new TypeError('Invalid source-metadata capture state.')
        }
        const stack = [{ depth: 0, value }]
        while (stack.length) {
            const frame = stack.pop()
            const current = frame.value
            const type = typeof current
            if (type === 'string') {
                StructuredDataSnapshot.#reserveText(state, current)
                continue
            }
            if (
                current === null ||
                ['undefined', 'boolean', 'number', 'bigint'].includes(type)
            ) {
                continue
            }
            if (type !== 'object') {
                throw new TypeError(
                    'Canonical asset source must contain clone-safe data.'
                )
            }
            if (frame.depth > METADATA_MAX_DEPTH) {
                throw new TypeError(
                    'Canonical asset source is nested too deeply.'
                )
            }
            if (state.accounted.has(current)) continue
            let prototype
            let keys
            try {
                prototype = Object.getPrototypeOf(current)
                keys = Reflect.ownKeys(current)
            } catch {
                throw new TypeError(
                    'Canonical asset source could not be inspected safely.'
                )
            }
            if (
                prototype !== Object.prototype &&
                prototype !== null &&
                !(Array.isArray(current) && prototype === Array.prototype)
            ) {
                throw new TypeError(
                    'Canonical asset source must contain plain data objects.'
                )
            }
            state.accounted.add(current)
            StructuredDataSnapshot.#reserve(state, 1)
            const children = []
            if (Array.isArray(current)) {
                const lengthDescriptor = StructuredDataSnapshot.#descriptor(
                    current,
                    'length',
                    'Canonical asset source array could not be inspected.'
                )
                const length = lengthDescriptor.value
                if (
                    !Object.hasOwn(lengthDescriptor, 'value') ||
                    !Number.isSafeInteger(length) ||
                    length < 0 ||
                    keys.length !== length + 1
                ) {
                    throw new TypeError(
                        'Canonical asset source arrays must be dense and plain.'
                    )
                }
                StructuredDataSnapshot.#reserve(state, length)
                for (let index = 0; index < length; index += 1) {
                    children.push(
                        StructuredDataSnapshot.#dataDescriptor(
                            current,
                            String(index)
                        ).value
                    )
                }
            } else {
                StructuredDataSnapshot.#reserve(state, keys.length)
                for (const key of keys) {
                    if (typeof key !== 'string') {
                        throw new TypeError(
                            'Canonical asset source keys must be strings.'
                        )
                    }
                    children.push(
                        StructuredDataSnapshot.#dataDescriptor(current, key)
                            .value
                    )
                }
            }
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push({
                    depth: frame.depth + 1,
                    value: children[index]
                })
            }
        }
    }

    /**
     * Captures one graph node without revisiting caller-owned containers.
     * @param {unknown} value Metadata candidate.
     * @param {{ seen: Map<object, unknown>, bytes: number, items: number, label: string, maxBytes: number, maxItems: number }} state Capture state.
     * @param {number} depth Current container depth.
     * @returns {unknown} Isolated normalized value.
     */
    static #capture(value, state, depth) {
        const type = typeof value
        if (type === 'string') {
            StructuredDataSnapshot.#reserveText(state, value)
            return value
        }
        if (
            value === null ||
            ['undefined', 'boolean', 'number', 'bigint'].includes(type)
        ) {
            return value
        }
        if (type !== 'object') {
            throw new TypeError(
                'Canonical asset source must contain clone-safe data.'
            )
        }
        if (depth > METADATA_MAX_DEPTH) {
            throw new TypeError('Canonical asset source is nested too deeply.')
        }
        if (state.seen.has(value)) return state.seen.get(value)
        StructuredDataSnapshot.#reserve(state, 1)

        const binary = BinaryDataSnapshot.describe(value)
        if (binary) {
            return StructuredDataSnapshot.#binary(value, binary, state)
        }

        let prototype
        let keys
        try {
            prototype = Object.getPrototypeOf(value)
            keys = Reflect.ownKeys(value)
        } catch {
            throw new TypeError(
                'Canonical asset source could not be inspected safely.'
            )
        }
        if (prototype === Date.prototype) {
            return StructuredDataSnapshot.#date(value, keys, state)
        }
        if (prototype === RegExp.prototype) {
            return StructuredDataSnapshot.#regexp(value, keys, state)
        }
        if (prototype === Map.prototype) {
            return StructuredDataSnapshot.#map(value, keys, state, depth)
        }
        if (prototype === Set.prototype) {
            return StructuredDataSnapshot.#set(value, keys, state, depth)
        }
        if (Array.isArray(value)) {
            return StructuredDataSnapshot.#array(
                value,
                prototype,
                keys,
                state,
                depth
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                'Canonical asset source must contain plain data objects.'
            )
        }
        return StructuredDataSnapshot.#record(
            value,
            prototype,
            keys,
            state,
            depth
        )
    }

    /**
     * Copies genuine binary data after validating its single captured key set.
     * @param {ArrayBuffer | SharedArrayBuffer | ArrayBufferView} value Binary value.
     * @param {{ byteLength: number }} range Captured intrinsic binary range.
     * @param {{ seen: Map<object, unknown>, items: number, preserveBinary: boolean }} state Capture state.
     * @returns {number[] | ArrayBuffer | ArrayBufferView} Plain isolated bytes or preserved byte-backed data.
     */
    static #binary(value, range, state) {
        StructuredDataSnapshot.#reserveBytes(state, range.byteLength)
        if (state.preserveBinary) {
            const result = BinaryDataSnapshot.clone(value, range)
            state.seen.set(value, result)
            return result
        }
        // The normalized result contains one numeric item per byte. Reserve that
        // output before enumerating keys or allocating/copying the payload.
        StructuredDataSnapshot.#reserve(state, range.byteLength)
        let keys
        try {
            keys = Reflect.ownKeys(value)
        } catch {
            throw new TypeError(
                'Canonical asset source binary data could not be inspected.'
            )
        }
        StructuredDataSnapshot.#reserve(
            state,
            Math.max(0, keys.length - range.byteLength)
        )
        for (const key of keys) {
            if (typeof key !== 'string' || !/^\d+$/u.test(key)) {
                throw new TypeError(
                    'Canonical asset source binary data has custom properties.'
                )
            }
            const descriptor = StructuredDataSnapshot.#descriptor(
                value,
                key,
                'Canonical asset source binary data could not be inspected.'
            )
            if (!Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    'Canonical asset source binary data has accessors.'
                )
            }
        }
        const bytes = BinaryDataSnapshot.copyBytes(value, range)
        const result = new Array(bytes.byteLength)
        state.seen.set(value, result)
        for (let index = 0; index < bytes.byteLength; index += 1) {
            result[index] = bytes[index]
        }
        return result
    }

    /**
     * Converts one genuine property-free Date to ISO text.
     * @param {Date} value Date candidate.
     * @param {PropertyKey[]} keys Captured own keys.
     * @param {{ seen: Map<object, unknown>, items: number }} state Capture state.
     * @returns {string} ISO timestamp.
     */
    static #date(value, keys, state) {
        if (keys.length) {
            throw new TypeError(
                'Canonical asset source built-ins may not have custom properties.'
            )
        }
        let result
        try {
            result = DATE_TO_ISO.call(new Date(DATE_GET_TIME.call(value)))
        } catch {
            throw new TypeError(
                'Canonical asset source contains an invalid built-in value.'
            )
        }
        StructuredDataSnapshot.#reserveText(state, result)
        state.seen.set(value, result)
        return result
    }

    /**
     * Converts one genuine RegExp after reading its standard slot once.
     * @param {RegExp} value Regular expression candidate.
     * @param {PropertyKey[]} keys Captured own keys.
     * @param {{ seen: Map<object, unknown>, items: number }} state Capture state.
     * @returns {{ source: string, flags: string, lastIndex: number }} Plain regexp data.
     */
    static #regexp(value, keys, state) {
        const descriptor = StructuredDataSnapshot.#descriptor(
            value,
            'lastIndex',
            'Canonical asset source regular expression could not be inspected.'
        )
        if (
            keys.length !== 1 ||
            keys[0] !== 'lastIndex' ||
            !Object.hasOwn(descriptor, 'value') ||
            typeof descriptor.value !== 'number' ||
            typeof REGEXP_SOURCE !== 'function' ||
            typeof REGEXP_FLAGS !== 'function'
        ) {
            throw new TypeError(
                'Canonical asset source regular expressions may not have custom properties.'
            )
        }
        let result
        try {
            result = {
                source: REGEXP_SOURCE.call(value),
                flags: REGEXP_FLAGS.call(value),
                lastIndex: descriptor.value
            }
        } catch {
            throw new TypeError(
                'Canonical asset source contains an invalid regular expression.'
            )
        }
        StructuredDataSnapshot.#reserveText(state, result.source)
        StructuredDataSnapshot.#reserveText(state, result.flags)
        state.seen.set(value, result)
        return result
    }

    /**
     * Converts one genuine Map through captured platform iteration.
     * @param {Map<any, any>} value Map candidate.
     * @param {PropertyKey[]} keys Captured own keys.
     * @param {{ seen: Map<object, unknown>, items: number }} state Capture state.
     * @param {number} depth Current depth.
     * @returns {any[][]} Plain entry pairs.
     */
    static #map(value, keys, state, depth) {
        if (keys.length || typeof MAP_SIZE !== 'function') {
            throw new TypeError(
                'Canonical asset source maps may not have custom properties.'
            )
        }
        let size
        let iterator
        try {
            size = MAP_SIZE.call(value)
            iterator = MAP_ENTRIES.call(value)
        } catch {
            throw new TypeError(
                'Canonical asset source contains an invalid map.'
            )
        }
        StructuredDataSnapshot.#reserve(state, size * 2)
        const result = []
        state.seen.set(value, result)
        for (let index = 0; index < size; index += 1) {
            const row = MAP_ITERATOR_NEXT.call(iterator)
            if (row.done || !Array.isArray(row.value)) {
                throw new TypeError(
                    'Canonical asset source map changed during inspection.'
                )
            }
            result[index] = [
                StructuredDataSnapshot.#capture(row.value[0], state, depth + 1),
                StructuredDataSnapshot.#capture(row.value[1], state, depth + 1)
            ]
        }
        if (!MAP_ITERATOR_NEXT.call(iterator).done) {
            throw new TypeError(
                'Canonical asset source map changed during inspection.'
            )
        }
        return result
    }

    /**
     * Converts one genuine Set through captured platform iteration.
     * @param {Set<any>} value Set candidate.
     * @param {PropertyKey[]} keys Captured own keys.
     * @param {{ seen: Map<object, unknown>, items: number }} state Capture state.
     * @param {number} depth Current depth.
     * @returns {any[]} Plain values.
     */
    static #set(value, keys, state, depth) {
        if (keys.length || typeof SET_SIZE !== 'function') {
            throw new TypeError(
                'Canonical asset source sets may not have custom properties.'
            )
        }
        let size
        let iterator
        try {
            size = SET_SIZE.call(value)
            iterator = SET_VALUES.call(value)
        } catch {
            throw new TypeError(
                'Canonical asset source contains an invalid set.'
            )
        }
        StructuredDataSnapshot.#reserve(state, size)
        const result = []
        state.seen.set(value, result)
        for (let index = 0; index < size; index += 1) {
            const row = SET_ITERATOR_NEXT.call(iterator)
            if (row.done) {
                throw new TypeError(
                    'Canonical asset source set changed during inspection.'
                )
            }
            result[index] = StructuredDataSnapshot.#capture(
                row.value,
                state,
                depth + 1
            )
        }
        if (!SET_ITERATOR_NEXT.call(iterator).done) {
            throw new TypeError(
                'Canonical asset source set changed during inspection.'
            )
        }
        return result
    }

    /**
     * Captures one dense plain array from its first key and descriptor view.
     * @param {any[]} value Array candidate.
     * @param {object | null} prototype Captured prototype.
     * @param {PropertyKey[]} keys Captured own keys.
     * @param {{ seen: Map<object, unknown>, items: number }} state Capture state.
     * @param {number} depth Current depth.
     * @returns {any[]} Owned array.
     */
    static #array(value, prototype, keys, state, depth) {
        const lengthDescriptor = StructuredDataSnapshot.#descriptor(
            value,
            'length',
            'Canonical asset source array could not be inspected.'
        )
        const length = lengthDescriptor.value
        if (
            prototype !== Array.prototype ||
            !Object.hasOwn(lengthDescriptor, 'value') ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            keys.length !== length + 1
        ) {
            throw new TypeError(
                'Canonical asset source arrays must be dense and plain.'
            )
        }
        StructuredDataSnapshot.#reserve(state, length)
        const result = new Array(length)
        state.seen.set(value, result)
        for (let index = 0; index < length; index += 1) {
            const key = String(index)
            const descriptor = StructuredDataSnapshot.#dataDescriptor(
                value,
                key
            )
            Object.defineProperty(result, key, {
                ...descriptor,
                value: StructuredDataSnapshot.#capture(
                    descriptor.value,
                    state,
                    depth + 1
                )
            })
        }
        return result
    }

    /**
     * Captures one plain record from its first key and descriptor view.
     * @param {object} value Record candidate.
     * @param {object | null} prototype Captured prototype.
     * @param {PropertyKey[]} keys Captured own keys.
     * @param {{ seen: Map<object, unknown>, items: number }} state Capture state.
     * @param {number} depth Current depth.
     * @returns {object} Owned record.
     */
    static #record(value, prototype, keys, state, depth) {
        StructuredDataSnapshot.#reserve(state, keys.length)
        const result = Object.create(prototype)
        state.seen.set(value, result)
        for (const key of keys) {
            if (typeof key !== 'string') {
                throw new TypeError(
                    'Canonical asset source keys must be strings.'
                )
            }
            const descriptor = StructuredDataSnapshot.#dataDescriptor(
                value,
                key
            )
            Object.defineProperty(result, key, {
                ...descriptor,
                value: StructuredDataSnapshot.#capture(
                    descriptor.value,
                    state,
                    depth + 1
                )
            })
        }
        return result
    }

    /**
     * Reads one enumerable own data descriptor with normalized failures.
     * @param {object} owner Property owner.
     * @param {string} key Property name.
     * @returns {PropertyDescriptor} Validated descriptor.
     */
    static #dataDescriptor(owner, key) {
        const descriptor = StructuredDataSnapshot.#descriptor(
            owner,
            key,
            'Canonical asset source properties could not be inspected.'
        )
        if (
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true
        ) {
            throw new TypeError(
                'Canonical asset source may contain only enumerable data properties.'
            )
        }
        return descriptor
    }

    /**
     * Reads one own property descriptor and normalizes proxy failures.
     * @param {object} owner Property owner.
     * @param {PropertyKey} key Property key.
     * @param {string} message Failure message.
     * @returns {PropertyDescriptor} Existing own descriptor.
     */
    static #descriptor(owner, key, message) {
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(owner, key)
        } catch {
            throw new TypeError(message)
        }
        if (!descriptor) throw new TypeError(message)
        return descriptor
    }

    /**
     * Reserves bounded graph work before child traversal begins.
     * @param {{ items: number, label: string, maxItems: number }} state Capture state.
     * @param {number} count Additional items.
     * @returns {void}
     */
    static #reserve(state, count) {
        if (
            !Number.isSafeInteger(count) ||
            count < 0 ||
            state.items + count > state.maxItems
        ) {
            throw new TypeError(`${state.label} is too large.`)
        }
        state.items += count
    }

    /**
     * Reserves bounded payload bytes before a metadata copy is allocated.
     * @param {{ bytes: number, label: string, maxBytes: number }} state Capture state.
     * @param {number} count Additional bytes.
     * @returns {void}
     */
    static #reserveBytes(state, count) {
        if (state.maxBytes === UNBOUNDED_METADATA_BYTES) return
        if (
            !Number.isSafeInteger(count) ||
            count < 0 ||
            state.bytes + count > state.maxBytes
        ) {
            throw new TypeError(`${state.label} is too large.`)
        }
        state.bytes += count
    }

    /**
     * Measures and reserves UTF-8 text without allocating encoded bytes.
     * @param {{ bytes: number, label: string, maxBytes: number }} state Capture state.
     * @param {string} value Text value.
     * @returns {void}
     */
    static #reserveText(state, value) {
        if (state.maxBytes === UNBOUNDED_METADATA_BYTES) return
        let length = 0
        for (const character of value) {
            const codePoint = character.codePointAt(0)
            length +=
                codePoint <= 0x7f
                    ? 1
                    : codePoint <= 0x7ff
                      ? 2
                      : codePoint <= 0xffff
                        ? 3
                        : 4
            if (state.bytes + length > state.maxBytes) {
                throw new TypeError(`${state.label} is too large.`)
            }
        }
        StructuredDataSnapshot.#reserveBytes(state, length)
    }
}

Object.freeze(StructuredDataSnapshot.prototype)
Object.freeze(StructuredDataSnapshot)
