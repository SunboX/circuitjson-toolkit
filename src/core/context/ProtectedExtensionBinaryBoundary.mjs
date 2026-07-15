import { BinaryDataSnapshot } from './BinaryDataSnapshot.mjs'

const PROTECTED_BINARY_GETTERS = new WeakSet()
const CAPTURED_BINARY_PROPERTIES = new WeakSet()
const PENDING_BINARY_CAPTURES = new WeakMap()
const BINARY_COPY_CHUNK_BYTES = 64 * 1024

/**
 * Protects byte-backed values embedded in canonical extension containers.
 */
export class ProtectedExtensionBinaryBoundary {
    /**
     * Protects the exact binary properties collected by a proven clone
     * adoption traversal without rescanning every ordinary container.
     * @param {{ owner: object, key: PropertyKey }[]} properties Binary properties.
     * @returns {void}
     */
    static protectProperties(properties) {
        if (!Array.isArray(properties)) {
            throw new TypeError(
                'Canonical extension binary properties must be an array.'
            )
        }
        for (const property of properties) {
            const owner = property?.owner
            const key = property?.key
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(owner, key)
            } catch {
                throw new TypeError(
                    'Canonical extension data could not be inspected safely.'
                )
            }
            if (ProtectedExtensionBinaryBoundary.isProtected(descriptor)) {
                continue
            }
            const captured = ProtectedExtensionBinaryBoundary.captureProperty(
                owner,
                key,
                descriptor
            )
            ProtectedExtensionBinaryBoundary.protectCapturedProperty(captured)
        }
    }

    /**
     * Captures one binary property without changing its owner.
     * @param {object} owner Binary property owner.
     * @param {PropertyKey} key Binary property key.
     * @param {PropertyDescriptor | undefined} [knownDescriptor] Previously validated descriptor.
     * @returns {object} Opaque captured binary property.
     */
    static captureProperty(owner, key, knownDescriptor = undefined) {
        const capture = ProtectedExtensionBinaryBoundary.beginPropertyCapture(
            owner,
            key,
            knownDescriptor
        )
        while (
            !ProtectedExtensionBinaryBoundary.copyPropertyCaptureChunk(
                capture,
                Number.MAX_SAFE_INTEGER
            )
        ) {
            // The synchronous API deliberately owns the full payload atomically.
        }
        return ProtectedExtensionBinaryBoundary.finishPropertyCapture(capture)
    }

    /**
     * Starts one branded binary property capture without copying its payload.
     * @param {object} owner Binary property owner.
     * @param {PropertyKey} key Binary property key.
     * @param {PropertyDescriptor | undefined} [knownDescriptor] Previously validated descriptor.
     * @returns {object} Opaque pending capture token.
     * @internal
     */
    static beginPropertyCapture(owner, key, knownDescriptor = undefined) {
        let descriptor = knownDescriptor
        if (descriptor === undefined) {
            try {
                descriptor = Object.getOwnPropertyDescriptor(owner, key)
            } catch {
                throw new TypeError(
                    'Canonical extension data could not be inspected safely.'
                )
            }
        }
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(
                'Canonical extension data may contain only data properties.'
            )
        }
        const binary = BinaryDataSnapshot.describeStandard(descriptor.value)
        if (!binary) {
            throw new TypeError(
                'Canonical extension binary property changed during adoption.'
            )
        }
        const capture = Object.freeze({})
        PENDING_BINARY_CAPTURES.set(capture, {
            bytes: new Uint8Array(binary.byteLength),
            descriptor: Object.freeze({ ...descriptor }),
            key,
            offset: 0,
            owner,
            source: descriptor.value,
            sourceRange: Object.freeze({ ...binary })
        })
        return capture
    }

    /**
     * Copies the next bounded portion of one branded binary capture.
     * @param {object} capture Opaque pending capture token.
     * @param {number} [maxBytes] Maximum bytes copied in this call.
     * @returns {boolean} Whether the entire payload has been copied.
     * @internal
     */
    static copyPropertyCaptureChunk(
        capture,
        maxBytes = BINARY_COPY_CHUNK_BYTES
    ) {
        const state = PENDING_BINARY_CAPTURES.get(capture)
        if (!state || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
            throw new TypeError(
                'Canonical extension binary capture is not pending.'
            )
        }
        const remaining = state.sourceRange.byteLength - state.offset
        const count = Math.min(remaining, maxBytes)
        BinaryDataSnapshot.copyBytesInto(
            state.sourceRange,
            state.bytes,
            state.offset,
            count
        )
        state.offset += count
        return state.offset === state.sourceRange.byteLength
    }

    /**
     * Finalizes one completely copied binary property into a trusted record.
     * @param {object} capture Opaque pending capture token.
     * @returns {object} Opaque captured binary property.
     * @internal
     */
    static finishPropertyCapture(capture) {
        const state = PENDING_BINARY_CAPTURES.get(capture)
        if (!state || state.offset !== state.sourceRange.byteLength) {
            throw new TypeError(
                'Canonical extension binary capture is incomplete.'
            )
        }
        PENDING_BINARY_CAPTURES.delete(capture)
        const ownedBinary = BinaryDataSnapshot.cloneFromBytes(
            state.source,
            state.sourceRange,
            state.bytes
        )
        const ownedRange = BinaryDataSnapshot.describeStandard(ownedBinary)
        if (!ownedRange) {
            throw new TypeError(
                'Canonical extension binary could not be isolated.'
            )
        }
        const captured = Object.freeze({
            descriptor: state.descriptor,
            key: state.key,
            ownedBinary,
            ownedRange: Object.freeze({ ...ownedRange }),
            owner: state.owner
        })
        CAPTURED_BINARY_PROPERTIES.add(captured)
        return captured
    }

    /**
     * Installs one previously captured binary as a defensive-copy getter after
     * proving its property descriptor still matches the transferred source.
     * @param {object} captured Opaque captured binary property.
     * @returns {void}
     */
    static protectCapturedProperty(captured) {
        if (!CAPTURED_BINARY_PROPERTIES.has(captured)) {
            throw new TypeError(
                'Canonical extension binary capture is not trusted.'
            )
        }
        CAPTURED_BINARY_PROPERTIES.delete(captured)
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(
                captured.owner,
                captured.key
            )
        } catch {
            throw new TypeError(
                'Canonical extension data could not be inspected safely.'
            )
        }
        if (
            !ProtectedExtensionBinaryBoundary.#sameDataDescriptor(
                descriptor,
                captured.descriptor
            )
        ) {
            throw new TypeError(
                'Canonical extension binary property changed during adoption.'
            )
        }
        /** @returns {ArrayBuffer | Uint8Array | DataView} A defensive binary copy. */
        const readBinary = () =>
            BinaryDataSnapshot.clone(captured.ownedBinary, captured.ownedRange)
        PROTECTED_BINARY_GETTERS.add(readBinary)
        Object.defineProperty(captured.owner, captured.key, {
            configurable: false,
            enumerable: descriptor.enumerable,
            get: readBinary
        })
    }

    /**
     * Replaces owned binary data properties with defensive-copy getters.
     * @param {unknown} root Owned extension graph.
     * @returns {void}
     */
    static protect(root) {
        if (BinaryDataSnapshot.describeStandard(root)) {
            throw new TypeError(
                'Canonical extension root must be a plain data container.'
            )
        }
        const seen = new Set()
        const stack = [root]
        while (stack.length) {
            const current = stack.pop()
            if (!ProtectedExtensionBinaryBoundary.#container(current)) continue
            if (seen.has(current)) continue
            seen.add(current)

            let descriptors
            try {
                descriptors = Object.getOwnPropertyDescriptors(current)
            } catch {
                throw new TypeError(
                    'Canonical extension data could not be inspected safely.'
                )
            }
            for (const key of Reflect.ownKeys(descriptors)) {
                const descriptor = descriptors[key]
                if (!Object.hasOwn(descriptor, 'value')) {
                    if (
                        ProtectedExtensionBinaryBoundary.isProtected(descriptor)
                    ) {
                        continue
                    }
                    throw new TypeError(
                        'Canonical extension data may contain only data properties.'
                    )
                }
                const child = descriptor.value
                if (!child || typeof child !== 'object') continue
                if (ProtectedExtensionBinaryBoundary.#container(child)) {
                    stack.push(child)
                    continue
                }
                const binary = BinaryDataSnapshot.describeStandard(child)
                if (!binary) continue
                const ownedBinary = child
                /** @returns {ArrayBuffer | Uint8Array | DataView} A defensive binary copy. */
                const readBinary = () =>
                    BinaryDataSnapshot.clone(ownedBinary, binary)
                PROTECTED_BINARY_GETTERS.add(readBinary)
                Object.defineProperty(current, key, {
                    configurable: false,
                    enumerable: descriptor.enumerable,
                    get: readBinary
                })
            }
        }
    }

    /**
     * Reads only an internally-created defensive binary getter.
     * @param {PropertyDescriptor | undefined} descriptor Binary descriptor.
     * @returns {{ trusted: boolean, value: unknown }} Trusted read result.
     */
    static read(descriptor) {
        if (!ProtectedExtensionBinaryBoundary.isProtected(descriptor)) {
            return { trusted: false, value: null }
        }
        return {
            trusted: true,
            value: Reflect.apply(descriptor.get, undefined, [])
        }
    }

    /**
     * Returns whether a descriptor belongs to this binary boundary.
     * @param {PropertyDescriptor | undefined} descriptor Descriptor candidate.
     * @returns {boolean} Whether the descriptor is a protected binary getter.
     */
    static isProtected(descriptor) {
        return Boolean(
            descriptor &&
            typeof descriptor.get === 'function' &&
            descriptor.set === undefined &&
            descriptor.enumerable === true &&
            descriptor.configurable === false &&
            PROTECTED_BINARY_GETTERS.has(descriptor.get)
        )
    }

    /**
     * Compares exact ordinary data descriptor semantics without coercion.
     * @param {PropertyDescriptor | undefined} current Current descriptor.
     * @param {PropertyDescriptor} expected Previously captured descriptor.
     * @returns {boolean} Whether both descriptors still match.
     */
    static #sameDataDescriptor(current, expected) {
        return Boolean(
            current &&
            Object.hasOwn(current, 'value') &&
            Object.hasOwn(expected, 'value') &&
            Object.is(current.value, expected.value) &&
            current.configurable === expected.configurable &&
            current.enumerable === expected.enumerable &&
            current.writable === expected.writable
        )
    }

    /**
     * Returns true for plain extension containers.
     * @param {unknown} value Candidate value.
     * @returns {boolean} Whether the value is a supported container.
     */
    static #container(value) {
        if (!value || typeof value !== 'object') return false
        try {
            if (Array.isArray(value)) {
                if (Object.getPrototypeOf(value) !== Array.prototype) {
                    throw new TypeError(
                        'Canonical extension arrays must use Array.prototype.'
                    )
                }
                return true
            }
            const prototype = Object.getPrototypeOf(value)
            return prototype === Object.prototype || prototype === null
        } catch {
            throw new TypeError(
                'Canonical extension data could not be inspected safely.'
            )
        }
    }
}

Object.freeze(ProtectedExtensionBinaryBoundary.prototype)
Object.freeze(ProtectedExtensionBinaryBoundary)
