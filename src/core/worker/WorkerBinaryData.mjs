const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    'byteLength'
)?.get
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    'resizable'
)?.get
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
    typeof SharedArrayBuffer === 'function'
        ? Object.getOwnPropertyDescriptor(
              SharedArrayBuffer.prototype,
              'byteLength'
          )?.get
        : null
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
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    Symbol.toStringTag
)?.get
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
const DATA_VIEW_CONSTRUCTOR = DataView
const UINT8_ARRAY_CONSTRUCTOR = Uint8Array
const UINT8_ARRAY_SET = Uint8Array.prototype.set
const ARRAY_BUFFER_IS_VIEW = ArrayBuffer.isView
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf
const OBJECT_PROTOTYPE = Object.prototype
const TYPED_ARRAYS = new Map(
    [
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        typeof BigInt64Array === 'function' ? BigInt64Array : null,
        typeof BigUint64Array === 'function' ? BigUint64Array : null
    ]
        .filter(Boolean)
        .map((Constructor) => [Constructor.name, Constructor])
)

/**
 * Inspects and isolates worker binary data through captured intrinsic slots.
 */
export class WorkerBinaryData {
    /**
     * Classifies records only in a privately received native clone graph.
     * Generic inputs must still use exact brands, even with these prototypes.
     * @param {object} value Proven native-clone value.
     * @returns {boolean} Whether it has a normalized plain-record prototype.
     */
    static isStandardRecord(value) {
        const prototype = OBJECT_GET_PROTOTYPE_OF(value)
        return prototype === OBJECT_PROTOTYPE || prototype === null
    }

    /**
     * Recreates one intrinsic view on an exact isolated backing buffer.
     * @param {{ byteLength: number, tag: string }} view View fields.
     * @param {ArrayBuffer} buffer Exact copied buffer.
     * @returns {ArrayBufferView} Recreated view.
     */
    static recreateView(view, buffer) {
        if (view.tag === 'DataView') return new DATA_VIEW_CONSTRUCTOR(buffer)
        const Constructor = TYPED_ARRAYS.get(view.tag)
        if (!Constructor || view.byteLength % Constructor.BYTES_PER_ELEMENT) {
            throw new TypeError('Worker request binary view is unsupported.')
        }
        return new Constructor(
            buffer,
            0,
            view.byteLength / Constructor.BYTES_PER_ELEMENT
        )
    }

    /**
     * Reads genuine typed-array or DataView internal slots.
     * @param {unknown} value View candidate.
     * @returns {{ buffer: ArrayBufferLike, byteOffset: number, byteLength: number, tag: string } | null} Intrinsic view fields.
     */
    static view(value) {
        if (!ARRAY_BUFFER_IS_VIEW(value)) return null
        try {
            const tag = TYPED_ARRAY_TAG_GETTER?.call(value)
            if (TYPED_ARRAYS.has(tag)) {
                return {
                    buffer: TYPED_ARRAY_BUFFER_GETTER.call(value),
                    byteOffset: TYPED_ARRAY_BYTE_OFFSET_GETTER.call(value),
                    byteLength: TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value),
                    tag
                }
            }
            if (
                DATA_VIEW_BUFFER_GETTER &&
                DATA_VIEW_BYTE_OFFSET_GETTER &&
                DATA_VIEW_BYTE_LENGTH_GETTER
            ) {
                const buffer = DATA_VIEW_BUFFER_GETTER.call(value)
                return {
                    buffer,
                    byteOffset: DATA_VIEW_BYTE_OFFSET_GETTER.call(value),
                    byteLength: DATA_VIEW_BYTE_LENGTH_GETTER.call(value),
                    tag: 'DataView'
                }
            }
        } catch {
            return null
        }
        return null
    }

    /** @param {unknown} value Candidate. @returns {number | null} Byte length. */
    static bufferLength(value) {
        if (!ARRAY_BUFFER_BYTE_LENGTH_GETTER) return null
        try {
            return ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value)
        } catch {
            return null
        }
    }

    /** @param {unknown} value Candidate. @returns {number | null} Byte length. */
    static sharedBufferLength(value) {
        if (!SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER) return null
        try {
            return SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value)
        } catch {
            return null
        }
    }

    /**
     * Returns whether a genuine ArrayBuffer can change size after accounting.
     * @param {unknown} value Buffer candidate.
     * @returns {boolean} Whether the buffer is resizable.
     */
    static isResizableBuffer(value) {
        if (!ARRAY_BUFFER_RESIZABLE_GETTER) return false
        try {
            return ARRAY_BUFFER_RESIZABLE_GETTER.call(value) === true
        } catch {
            return false
        }
    }

    /**
     * Copies one already-accounted intrinsic byte range into a fixed buffer.
     * The explicit range prevents a growable backing store from widening the
     * copy between its limit check and snapshot.
     * @param {ArrayBufferLike} buffer Source buffer.
     * @param {number} byteOffset Captured byte offset.
     * @param {number} byteLength Captured byte length.
     * @returns {ArrayBuffer} Fixed owned snapshot.
     */
    static copyBuffer(buffer, byteOffset, byteLength) {
        try {
            const source = new UINT8_ARRAY_CONSTRUCTOR(
                buffer,
                byteOffset,
                byteLength
            )
            const copy = new UINT8_ARRAY_CONSTRUCTOR(byteLength)
            UINT8_ARRAY_SET.call(copy, source)
            return TYPED_ARRAY_BUFFER_GETTER.call(copy)
        } catch {
            throw new TypeError(
                'Worker request binary data changed while it was copied.'
            )
        }
    }
}

Object.freeze(WorkerBinaryData.prototype)
Object.freeze(WorkerBinaryData)
