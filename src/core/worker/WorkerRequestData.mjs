import { CircuitJsonValidationProof } from '../context/CircuitJsonValidationProof.mjs'
import { CircuitJsonReadOnlyDocument } from '../context/CircuitJsonReadOnlyDocument.mjs'
import { ProtectedExtensionBinaryBoundary } from '../context/ProtectedExtensionBinaryBoundary.mjs'
import { RuntimeProxyBoundary } from '../contracts/RuntimeProxyBoundary.mjs'

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
const STRUCTURED_CLONE = globalThis.structuredClone
const MAX_REQUEST_BYTES = 100_000_000
const MAX_REQUEST_DEPTH = 256
const MAX_REQUEST_VALUES = 100_000
const MAX_RESULT_BYTES = 250_000_000
const MAX_RESULT_VALUES = 2_000_000
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
 * Validates and prepares bounded structured-clone worker request data.
 */
export class WorkerRequestData {
    /**
     * Creates an accessor-free payload and exact transfer list in one pass.
     * @param {unknown} value Request payload.
     * @param {{ transferInput?: boolean }} [options] Transfer options.
     * @returns {{ value: unknown, transfer: Transferable[] }} Prepared payload.
     */
    static prepare(value, options = {}) {
        return WorkerRequestData.#prepare(value, {
            bytes: MAX_REQUEST_BYTES,
            copyBinary: false,
            output: false,
            strictDescriptors: false,
            transferInput: options.transferInput === true,
            trustProof: false,
            values: MAX_REQUEST_VALUES
        })
    }

    /**
     * Owns one already-prepared queued request and rebuilds its post transfer list.
     * @param {{ payload: unknown, transfer: Transferable[] }} prepared Prepared request.
     * @returns {Record<string, any>} Owned queued request.
     */
    static ownForQueue(prepared) {
        const owned = Reflect.apply(STRUCTURED_CLONE, undefined, [
            prepared.payload,
            { transfer: prepared.transfer }
        ])
        const posted = WorkerRequestData.#prepare(owned, {
            bytes: MAX_REQUEST_BYTES,
            copyBinary: false,
            output: false,
            strictDescriptors: false,
            transferInput: true,
            trustProof: false,
            values: MAX_REQUEST_VALUES
        })
        return {
            ...prepared,
            payload: posted.value,
            transfer: posted.transfer
        }
    }

    /**
     * Prepares a bounded worker-owned result and transfers all safe buffers.
     * @param {unknown} value Worker result.
     * @returns {{ value: unknown, transfer: Transferable[] }} Prepared result.
     */
    static prepareResult(value) {
        return WorkerRequestData.#prepare(value, {
            bytes: MAX_RESULT_BYTES,
            copyBinary: false,
            output: true,
            strictDescriptors: false,
            transferInput: true,
            trustProof: true,
            values: MAX_RESULT_VALUES
        })
    }

    /**
     * Creates an owned accessor-free snapshot of one received worker result.
     * @param {unknown} value Received result candidate.
     * @returns {unknown} Owned clone-safe result data.
     */
    static prepareResponse(value) {
        return WorkerRequestData.#prepare(value, {
            bytes: MAX_RESULT_BYTES,
            copyBinary: true,
            output: true,
            strictDescriptors: true,
            transferInput: false,
            trustProof: false,
            values: MAX_RESULT_VALUES
        }).value
    }

    /**
     * Runs the shared bounded structured-data preparation pass.
     * @param {unknown} value Data candidate.
     * @param {{ bytes: number, copyBinary: boolean, output: boolean, strictDescriptors: boolean, transferInput: boolean, trustProof: boolean, values: number }} limits Preparation limits.
     * @returns {{ value: unknown, transfer: Transferable[] }} Prepared data.
     */
    static #prepare(value, limits) {
        const state = {
            bytes: 0,
            copyBinary: limits.copyBinary,
            maxBytes: limits.bytes,
            maxValues: limits.values,
            output: limits.output,
            prepared: new WeakMap(),
            strictDescriptors: limits.strictDescriptors,
            transfer: { items: [], seen: new Set() },
            transferInput: limits.transferInput,
            trustProof: limits.trustProof,
            values: 0,
            visiting: new WeakSet()
        }
        return {
            value: WorkerRequestData.#prepareValue(value, state, 0),
            transfer: state.transfer.items
        }
    }

    /**
     * Rejects accessor-backed, executable, or unbounded posted values.
     * @param {unknown} value Request payload.
     * @returns {void}
     */
    static assertCloneSafe(value) {
        WorkerRequestData.prepare(value)
    }

    /**
     * Prepares one bounded clone-safe value without invoking caller code.
     * @param {unknown} value Value candidate.
     * @param {Record<string, any>} state Traversal state.
     * @param {number} depth Container depth.
     * @returns {unknown} Prepared value.
     */
    static #prepareValue(value, state, depth) {
        const type = typeof value
        if (
            value === null ||
            ['undefined', 'boolean', 'number', 'bigint'].includes(type)
        ) {
            return value
        }
        if (type === 'string') {
            WorkerRequestData.#reserveBytes(state, value.length * 2)
            return value
        }
        if (type !== 'object') {
            throw new TypeError(
                'Worker requests may contain only clone-safe data.'
            )
        }
        RuntimeProxyBoundary.assert(value, 'Worker request data')
        if (depth > MAX_REQUEST_DEPTH) {
            throw new TypeError('Worker request data is nested too deeply.')
        }
        if (state.visiting.has(value)) {
            throw new TypeError('Worker request data must not be cyclic.')
        }
        if (state.prepared.has(value)) return state.prepared.get(value)
        WorkerRequestData.#reserveValues(state, 1)
        state.visiting.add(value)
        try {
            const bufferLength = WorkerRequestData.#bufferLength(value)
            if (bufferLength !== null) {
                WorkerRequestData.#reserveBytes(state, bufferLength)
                const isolate =
                    state.copyBinary ||
                    WorkerRequestData.#isResizableBuffer(value)
                const prepared = isolate
                    ? WorkerRequestData.#copyBuffer(value, 0, bufferLength)
                    : value
                state.prepared.set(value, prepared)
                if (state.transferInput) {
                    WorkerRequestData.#addTransfer(state.transfer, prepared)
                }
                return prepared
            }
            const sharedLength = WorkerRequestData.#sharedBufferLength(value)
            if (sharedLength !== null) {
                WorkerRequestData.#reserveBytes(state, sharedLength)
                const copied = WorkerRequestData.#copyBuffer(
                    value,
                    0,
                    sharedLength
                )
                state.prepared.set(value, copied)
                if (state.transferInput) {
                    WorkerRequestData.#addTransfer(state.transfer, copied)
                }
                return copied
            }
            const view = WorkerRequestData.#view(value)
            if (view) {
                WorkerRequestData.#reserveBytes(state, view.byteLength)
                const prepared = WorkerRequestData.#prepareView(
                    value,
                    view,
                    state
                )
                state.prepared.set(value, prepared)
                return prepared
            }
            return WorkerRequestData.#prepareContainer(value, state, depth)
        } finally {
            state.visiting.delete(value)
        }
    }

    /**
     * Prepares a dense array or plain object through data descriptors only.
     * @param {object} value Container candidate.
     * @param {Record<string, any>} state Traversal state.
     * @param {number} depth Container depth.
     * @returns {object | any[]} Prepared container.
     */
    static #prepareContainer(value, state, depth) {
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw new TypeError(
                'Worker request data could not be inspected safely.'
            )
        }
        if (Array.isArray(value)) {
            return WorkerRequestData.#prepareArray(
                value,
                prototype,
                descriptors,
                state,
                depth
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                'Worker requests may contain only plain data objects.'
            )
        }
        const keys =
            state.output && !state.strictDescriptors
                ? Reflect.ownKeys(descriptors).filter(
                      (key) =>
                          typeof key === 'string' && descriptors[key].enumerable
                  )
                : Reflect.ownKeys(descriptors)
        const documentResult =
            state.output &&
            state.trustProof &&
            WorkerRequestData.#dataValue(descriptors.schema) ===
                'ecad-toolkit.document.v1' &&
            CircuitJsonValidationProof.has(value)
        WorkerRequestData.#reserveValues(state, keys.length)
        const prepared = prototype === null ? Object.create(null) : {}
        state.prepared.set(value, prepared)
        for (const key of keys) {
            if (typeof key !== 'string') {
                throw new TypeError('Worker request keys must be strings.')
            }
            WorkerRequestData.#reserveBytes(state, key.length * 2)
            Object.defineProperty(prepared, key, {
                configurable: true,
                enumerable: true,
                value:
                    documentResult && key === 'model'
                        ? WorkerRequestData.#documentModel(descriptors[key])
                        : WorkerRequestData.#descriptorValue(
                              descriptors[key],
                              state,
                              depth
                          ),
                writable: true
            })
        }
        return prepared
    }

    /**
     * Prepares one bounded dense plain array before indexed allocation.
     * @param {any[]} value Array candidate.
     * @param {object | null} prototype Array prototype.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @param {Record<string, any>} state Traversal state.
     * @param {number} depth Container depth.
     * @returns {any[]} Prepared array.
     */
    static #prepareArray(value, prototype, descriptors, state, depth) {
        const keys = Reflect.ownKeys(descriptors)
        const length = WorkerRequestData.#dataValue(descriptors.length)
        const visibleKeys =
            state.output && !state.strictDescriptors
                ? keys.filter(
                      (key) =>
                          key !== 'length' &&
                          typeof key === 'string' &&
                          descriptors[key].enumerable
                  )
                : keys
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            (state.output && !state.strictDescriptors
                ? visibleKeys.length !== length
                : keys.length !== length + 1)
        ) {
            throw new TypeError(
                'Worker request arrays must be bounded, dense, and plain.'
            )
        }
        WorkerRequestData.#reserveValues(state, length)
        const prepared = new Array(length)
        state.prepared.set(value, prepared)
        for (let index = 0; index < length; index += 1) {
            prepared[index] = WorkerRequestData.#descriptorValue(
                descriptors[String(index)],
                state,
                depth
            )
        }
        return prepared
    }

    /**
     * Reads one enumerable data descriptor and prepares its value.
     * @param {PropertyDescriptor | undefined} descriptor Descriptor candidate.
     * @param {Record<string, any>} state Traversal state.
     * @param {number} depth Parent depth.
     * @returns {unknown} Prepared value.
     */
    static #descriptorValue(descriptor, state, depth) {
        if (state.trustProof) {
            const protectedData =
                CircuitJsonReadOnlyDocument.readProtectedAssetData(descriptor)
            if (protectedData.trusted) {
                return WorkerRequestData.#prepareValue(
                    protectedData.value,
                    state,
                    depth + 1
                )
            }
            const protectedExtensionBinary =
                ProtectedExtensionBinaryBoundary.read(descriptor)
            if (protectedExtensionBinary.trusted) {
                return WorkerRequestData.#prepareValue(
                    protectedExtensionBinary.value,
                    state,
                    depth + 1
                )
            }
        }
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true
        ) {
            throw new TypeError(
                'Worker requests may contain only enumerable data properties.'
            )
        }
        return WorkerRequestData.#prepareValue(
            descriptor.value,
            state,
            depth + 1
        )
    }

    /**
     * Preserves a genuine view type while isolating partial or shared bytes.
     * @param {object} original Original view.
     * @param {{ buffer: ArrayBufferLike, byteOffset: number, byteLength: number, tag: string }} view Intrinsic view fields.
     * @param {Record<string, any>} state Traversal state.
     * @returns {ArrayBufferView} Prepared exact view.
     */
    static #prepareView(original, view, state) {
        const backingLength = WorkerRequestData.#bufferLength(view.buffer)
        const sharedLength = WorkerRequestData.#sharedBufferLength(view.buffer)
        const exactArrayBuffer =
            backingLength !== null &&
            view.byteOffset === 0 &&
            view.byteLength === backingLength
        if (
            exactArrayBuffer &&
            !state.copyBinary &&
            !WorkerRequestData.#isResizableBuffer(view.buffer)
        ) {
            if (state.transferInput) {
                WorkerRequestData.#addTransfer(state.transfer, view.buffer)
            }
            return original
        }
        if (backingLength === null && sharedLength === null) {
            throw new TypeError('Worker request binary view is invalid.')
        }
        const copy = WorkerRequestData.#copyBuffer(
            view.buffer,
            view.byteOffset,
            view.byteLength
        )
        const prepared = WorkerRequestData.#recreateView(view, copy)
        if (state.transferInput) {
            WorkerRequestData.#addTransfer(state.transfer, copy)
        }
        return prepared
    }

    /**
     * Recreates one intrinsic view on an exact isolated backing buffer.
     * @param {{ byteLength: number, tag: string }} view View fields.
     * @param {ArrayBuffer} buffer Exact copied buffer.
     * @returns {ArrayBufferView} Recreated view.
     */
    static #recreateView(view, buffer) {
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
    static #view(value) {
        try {
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
            // The typed-array intrinsic check below is independent.
        }
        try {
            const tag = TYPED_ARRAY_TAG_GETTER?.call(value)
            if (!TYPED_ARRAYS.has(tag)) return null
            return {
                buffer: TYPED_ARRAY_BUFFER_GETTER.call(value),
                byteOffset: TYPED_ARRAY_BYTE_OFFSET_GETTER.call(value),
                byteLength: TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value),
                tag
            }
        } catch {
            return null
        }
    }

    /** @param {unknown} value Candidate. @returns {number | null} Byte length. */
    static #bufferLength(value) {
        if (!ARRAY_BUFFER_BYTE_LENGTH_GETTER) return null
        try {
            return ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value)
        } catch {
            return null
        }
    }

    /** @param {unknown} value Candidate. @returns {number | null} Byte length. */
    static #sharedBufferLength(value) {
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
    static #isResizableBuffer(value) {
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
    static #copyBuffer(buffer, byteOffset, byteLength) {
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

    /** @param {PropertyDescriptor | undefined} descriptor Descriptor. @returns {unknown} Data value. */
    static #dataValue(descriptor) {
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined
    }

    /**
     * Preserves the already validated JSON-only CircuitJSON model by reference.
     * @param {PropertyDescriptor | undefined} descriptor Model descriptor.
     * @returns {object[]} CircuitJSON model.
     */
    static #documentModel(descriptor) {
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true ||
            !Array.isArray(descriptor.value)
        ) {
            throw new TypeError('Worker result document model is invalid.')
        }
        return descriptor.value
    }

    /**
     * Adds one transferable exactly once while preserving encounter order.
     * @param {{ items: Transferable[], seen: Set<object> }} transfer Transfer accumulator.
     * @param {Transferable} value Transferable value.
     * @returns {void}
     */
    static #addTransfer(transfer, value) {
        if (transfer.seen.has(value)) return
        transfer.seen.add(value)
        transfer.items.push(value)
    }

    /** @param {{ bytes: number }} state State. @param {number} count Bytes. */
    static #reserveBytes(state, count) {
        if (
            !Number.isSafeInteger(count) ||
            count < 0 ||
            state.bytes + count > state.maxBytes
        ) {
            throw new TypeError('Worker request data exceeds its byte limit.')
        }
        state.bytes += count
    }

    /** @param {{ values: number }} state State. @param {number} count Values. */
    static #reserveValues(state, count) {
        if (
            !Number.isSafeInteger(count) ||
            count < 0 ||
            state.values + count > state.maxValues
        ) {
            throw new TypeError('Worker request data is too large.')
        }
        state.values += count
    }
}
