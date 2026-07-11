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
const UINT8_ARRAY_SET = Uint8Array.prototype.set

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

        const prototype = Object.getPrototypeOf(value)
        const Constructor = BinaryDataSnapshot.#typedArrayConstructor(prototype)
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
            return getter.call(value)
        } catch {
            return null
        }
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
                buffer: bufferGetter.call(value),
                byteOffset: offsetGetter.call(value),
                byteLength: lengthGetter.call(value),
                kind
            }
        } catch {
            return null
        }
    }

    /**
     * Maps a genuine typed-array prototype to its platform constructor.
     * @param {object | null} prototype Candidate prototype.
     * @returns {Function | null} Matching typed-array constructor.
     */
    static #typedArrayConstructor(prototype) {
        const constructors = [
            Int8Array,
            Uint8Array,
            Uint8ClampedArray,
            Int16Array,
            Uint16Array,
            Int32Array,
            Uint32Array,
            Float32Array,
            Float64Array,
            ...(typeof BigInt64Array === 'function'
                ? [BigInt64Array, BigUint64Array]
                : [])
        ]
        return (
            constructors.find(
                (Constructor) => Constructor.prototype === prototype
            ) || null
        )
    }
}

Object.freeze(BinaryDataSnapshot.prototype)
Object.freeze(BinaryDataSnapshot)
