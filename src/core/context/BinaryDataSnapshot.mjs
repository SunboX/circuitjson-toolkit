const ARRAY_BUFFER_LENGTH = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    'byteLength'
)?.get
const SHARED_ARRAY_BUFFER_LENGTH =
    typeof SharedArrayBuffer === 'function'
        ? Object.getOwnPropertyDescriptor(
              SharedArrayBuffer.prototype,
              'byteLength'
          )?.get
        : null
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype)
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'buffer'
)?.get
const TYPED_ARRAY_OFFSET = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'byteOffset'
)?.get
const TYPED_ARRAY_LENGTH = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'byteLength'
)?.get
const TYPED_ARRAY_TAG = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    Symbol.toStringTag
)?.get
const DATA_VIEW_BUFFER = Object.getOwnPropertyDescriptor(
    DataView.prototype,
    'buffer'
)?.get
const DATA_VIEW_OFFSET = Object.getOwnPropertyDescriptor(
    DataView.prototype,
    'byteOffset'
)?.get
const DATA_VIEW_LENGTH = Object.getOwnPropertyDescriptor(
    DataView.prototype,
    'byteLength'
)?.get
const ARRAY_BUFFER_IS_VIEW = ArrayBuffer.isView
const ARRAY_IS_ARRAY = Array.isArray
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf
const REFLECT_APPLY = Reflect.apply
const ARRAY_BUFFER_PROTOTYPE = ArrayBuffer.prototype
const SHARED_ARRAY_BUFFER_PROTOTYPE =
    typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer.prototype : null
const ARRAY_PROTOTYPE = Array.prototype
const OBJECT_PROTOTYPE = Object.prototype
const DATE_PROTOTYPE = Date.prototype
const REGEXP_PROTOTYPE = RegExp.prototype
const MAP_PROTOTYPE = Map.prototype
const SET_PROTOTYPE = Set.prototype
const UINT8_ARRAY_SET = Uint8Array.prototype.set
const TYPED_ARRAY_CONSTRUCTORS = new Map([
    ['Int8Array', Int8Array],
    ['Uint8Array', Uint8Array],
    ['Uint8ClampedArray', Uint8ClampedArray],
    ['Int16Array', Int16Array],
    ['Uint16Array', Uint16Array],
    ['Int32Array', Int32Array],
    ['Uint32Array', Uint32Array],
    ...(typeof globalThis.Float16Array === 'function'
        ? [['Float16Array', globalThis.Float16Array]]
        : []),
    ['Float32Array', Float32Array],
    ['Float64Array', Float64Array],
    ...(typeof BigInt64Array === 'function'
        ? [
              ['BigInt64Array', BigInt64Array],
              ['BigUint64Array', BigUint64Array]
          ]
        : [])
])

/**
 * Reads and copies binary platform objects through captured intrinsic slots.
 */
export class BinaryDataSnapshot {
    /**
     * Describes one ArrayBuffer, SharedArrayBuffer, typed array, or DataView.
     * @param {unknown} value Binary candidate.
     * @returns {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number, kind: 'buffer' | 'typed-array' | 'data-view' } | null} Intrinsic binary range.
     */
    static describe(value) {
        return BinaryDataSnapshot.#describe(value, false)
    }

    /**
     * Describes binary data in a graph whose platform built-ins are proven to
     * have their standard local prototypes.
     * @param {unknown} value Binary candidate from a normalized graph.
     * @returns {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number, kind: 'buffer' | 'typed-array' | 'data-view' } | null} Intrinsic binary range.
     */
    static describeStandard(value) {
        return BinaryDataSnapshot.#describe(value, true)
    }

    /**
     * Classifies one binary candidate with either exact or proven-standard
     * raw-buffer handling.
     * @param {unknown} value Binary candidate.
     * @param {boolean} standardBuiltins Whether local prototype identity is proven.
     * @returns {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number, kind: 'buffer' | 'typed-array' | 'data-view' } | null} Intrinsic binary range.
     */
    static #describe(value, standardBuiltins) {
        if (value === null || typeof value !== 'object') return null

        if (BinaryDataSnapshot.#isView(value)) {
            const typed = BinaryDataSnapshot.#view(
                value,
                TYPED_ARRAY_BUFFER,
                TYPED_ARRAY_OFFSET,
                TYPED_ARRAY_LENGTH,
                'typed-array'
            )
            if (typed) return typed
            return BinaryDataSnapshot.#view(
                value,
                DATA_VIEW_BUFFER,
                DATA_VIEW_OFFSET,
                DATA_VIEW_LENGTH,
                'data-view'
            )
        }

        if (!standardBuiltins) {
            return BinaryDataSnapshot.#rawBuffer(value)
        }

        let prototype
        try {
            prototype = OBJECT_GET_PROTOTYPE_OF(value)
        } catch {
            return null
        }

        if (prototype === ARRAY_BUFFER_PROTOTYPE) {
            const byteLength = BinaryDataSnapshot.#callLength(
                ARRAY_BUFFER_LENGTH,
                value
            )
            return byteLength === null
                ? null
                : {
                      buffer: value,
                      byteOffset: 0,
                      byteLength,
                      kind: 'buffer'
                  }
        }
        if (
            SHARED_ARRAY_BUFFER_PROTOTYPE &&
            prototype === SHARED_ARRAY_BUFFER_PROTOTYPE
        ) {
            const byteLength = BinaryDataSnapshot.#callLength(
                SHARED_ARRAY_BUFFER_LENGTH,
                value
            )
            return byteLength === null
                ? null
                : {
                      buffer: value,
                      byteOffset: 0,
                      byteLength,
                      kind: 'buffer'
                  }
        }
        if (BinaryDataSnapshot.#isKnownNonBinary(value, prototype)) {
            return null
        }

        // Unknown prototypes can represent genuine buffers from another realm.
        // Keep intrinsic brand checks as the authority for that uncommon path.
        return BinaryDataSnapshot.#rawBuffer(value)
    }

    /**
     * Applies exact raw ArrayBuffer and SharedArrayBuffer brand getters.
     * @param {object} value Raw-buffer candidate.
     * @returns {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: 0, byteLength: number, kind: 'buffer' } | null} Raw buffer range.
     */
    static #rawBuffer(value) {
        const arrayBufferLength = BinaryDataSnapshot.#callLength(
            ARRAY_BUFFER_LENGTH,
            value
        )
        if (arrayBufferLength !== null) {
            return {
                buffer: value,
                byteOffset: 0,
                byteLength: arrayBufferLength,
                kind: 'buffer'
            }
        }
        const sharedLength = BinaryDataSnapshot.#callLength(
            SHARED_ARRAY_BUFFER_LENGTH,
            value
        )
        if (sharedLength !== null) {
            return {
                buffer: value,
                byteOffset: 0,
                byteLength: sharedLength,
                kind: 'buffer'
            }
        }

        return null
    }

    /**
     * Returns the exact intrinsic binary byte length.
     * @param {unknown} value Binary candidate.
     * @returns {number | null} Byte length or null for non-binary input.
     */
    static byteLength(value) {
        return BinaryDataSnapshot.describe(value)?.byteLength ?? null
    }

    /**
     * Copies the exact visible byte range into isolated non-shared memory.
     * @param {unknown} value Binary candidate.
     * @param {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number } | null} [capturedRange] Previously captured intrinsic range.
     * @returns {Uint8Array} Isolated bytes.
     */
    static copyBytes(value, capturedRange = null) {
        const range = capturedRange || BinaryDataSnapshot.describe(value)
        if (!range) throw new TypeError('Expected binary data.')
        try {
            const source = new Uint8Array(
                range.buffer,
                range.byteOffset,
                range.byteLength
            )
            const result = new Uint8Array(range.byteLength)
            UINT8_ARRAY_SET.call(result, source)
            return result
        } catch {
            throw new TypeError('Binary data changed during capture.')
        }
    }

    /**
     * Copies one bounded byte range into an existing isolated byte array.
     * @param {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number }} range Captured intrinsic range.
     * @param {Uint8Array} target Isolated destination bytes.
     * @param {number} offset Visible-range byte offset.
     * @param {number} count Number of bytes to copy.
     * @returns {void}
     * @internal
     */
    static copyBytesInto(range, target, offset, count) {
        if (
            !(target instanceof Uint8Array) ||
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(count) ||
            offset < 0 ||
            count < 0 ||
            offset + count > range?.byteLength ||
            target.byteLength !== range?.byteLength
        ) {
            throw new TypeError('Invalid binary copy range.')
        }
        try {
            const source = new Uint8Array(
                range.buffer,
                range.byteOffset + offset,
                count
            )
            const destination = new Uint8Array(
                target.buffer,
                target.byteOffset + offset,
                count
            )
            UINT8_ARRAY_SET.call(destination, source)
        } catch {
            throw new TypeError('Binary data changed during capture.')
        }
    }

    /**
     * Copies one binary metadata value while retaining its common view type.
     * @param {unknown} value Binary metadata.
     * @param {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number, kind: 'buffer' | 'typed-array' | 'data-view' } | null} [capturedRange] Previously captured intrinsic range.
     * @returns {ArrayBuffer | Uint8Array | DataView} Isolated binary value.
     */
    static clone(value, capturedRange = null) {
        const range = capturedRange || BinaryDataSnapshot.describe(value)
        if (!range) throw new TypeError('Expected binary data.')
        const bytes = BinaryDataSnapshot.copyBytes(value, range)
        if (range.kind === 'buffer') return bytes.buffer
        if (range.kind === 'data-view') return new DataView(bytes.buffer)

        const Constructor = BinaryDataSnapshot.#typedArrayConstructor(value)
        if (!Constructor || Constructor === Uint8Array) return bytes
        const bytesPerElement = Constructor.BYTES_PER_ELEMENT
        if (bytes.byteLength % bytesPerElement !== 0) return bytes
        return new Constructor(bytes.buffer)
    }

    /**
     * Restores one common binary view type from completely isolated bytes.
     * @param {unknown} value Original binary value used only for view type.
     * @param {{ kind: 'buffer' | 'typed-array' | 'data-view' }} range Captured intrinsic kind.
     * @param {Uint8Array} bytes Completely copied isolated bytes.
     * @returns {ArrayBuffer | Uint8Array | DataView} Isolated binary clone.
     * @internal
     */
    static cloneFromBytes(value, range, bytes) {
        if (!(bytes instanceof Uint8Array)) {
            throw new TypeError('Expected isolated binary bytes.')
        }
        if (range.kind === 'buffer') return bytes.buffer
        if (range.kind === 'data-view') return new DataView(bytes.buffer)
        const Constructor = BinaryDataSnapshot.#typedArrayConstructor(value)
        if (!Constructor || Constructor === Uint8Array) return bytes
        const bytesPerElement = Constructor.BYTES_PER_ELEMENT
        if (bytes.byteLength % bytesPerElement !== 0) return bytes
        return new Constructor(bytes.buffer)
    }

    /**
     * Calls a captured buffer length getter as a brand check.
     * @param {Function | null | undefined} getter Intrinsic getter.
     * @param {unknown} value Candidate value.
     * @returns {number | null} Intrinsic length or null.
     */
    static #callLength(getter, value) {
        if (typeof getter !== 'function') return null
        try {
            return REFLECT_APPLY(getter, value, [])
        } catch {
            return null
        }
    }

    /**
     * Uses the platform's side-effect-free view brand classifier.
     * @param {unknown} value Candidate value.
     * @returns {boolean} Whether the value has ArrayBuffer view slots.
     */
    static #isView(value) {
        try {
            return REFLECT_APPLY(ARRAY_BUFFER_IS_VIEW, ArrayBuffer, [value])
        } catch {
            return false
        }
    }

    /**
     * Returns true for common local containers that cannot be binary objects.
     * @param {object} value Candidate object.
     * @param {object | null} prototype Captured prototype.
     * @returns {boolean} Whether intrinsic buffer probing can be skipped.
     */
    static #isKnownNonBinary(value, prototype) {
        return (
            ARRAY_IS_ARRAY(value) ||
            prototype === ARRAY_PROTOTYPE ||
            prototype === OBJECT_PROTOTYPE ||
            prototype === null ||
            prototype === DATE_PROTOTYPE ||
            prototype === REGEXP_PROTOTYPE ||
            prototype === MAP_PROTOTYPE ||
            prototype === SET_PROTOTYPE
        )
    }

    /**
     * Reads captured intrinsic view slots without ordinary property access.
     * @param {unknown} value View candidate.
     * @param {Function | undefined} bufferGetter Buffer getter.
     * @param {Function | undefined} offsetGetter Offset getter.
     * @param {Function | undefined} lengthGetter Length getter.
     * @param {'typed-array' | 'data-view'} kind View kind.
     * @returns {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number, kind: 'typed-array' | 'data-view' } | null} Intrinsic view range.
     */
    static #view(value, bufferGetter, offsetGetter, lengthGetter, kind) {
        if (
            typeof bufferGetter !== 'function' ||
            typeof offsetGetter !== 'function' ||
            typeof lengthGetter !== 'function'
        ) {
            return null
        }
        try {
            return {
                buffer: REFLECT_APPLY(bufferGetter, value, []),
                byteOffset: REFLECT_APPLY(offsetGetter, value, []),
                byteLength: REFLECT_APPLY(lengthGetter, value, []),
                kind
            }
        } catch {
            return null
        }
    }

    /**
     * Maps a genuine typed array's intrinsic tag to a local constructor.
     * @param {unknown} value Genuine typed-array value.
     * @returns {Function | null} Matching typed-array constructor.
     */
    static #typedArrayConstructor(value) {
        if (typeof TYPED_ARRAY_TAG !== 'function') return null
        try {
            const tag = REFLECT_APPLY(TYPED_ARRAY_TAG, value, [])
            return TYPED_ARRAY_CONSTRUCTORS.get(tag) || null
        } catch {
            return null
        }
    }
}

Object.freeze(BinaryDataSnapshot.prototype)
Object.freeze(BinaryDataSnapshot)
