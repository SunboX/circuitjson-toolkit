import { BinaryDataSnapshot } from './BinaryDataSnapshot.mjs'

const PROTECTED_BINARY_GETTERS = new WeakSet()

/**
 * Protects byte-backed values embedded in canonical extension containers.
 */
export class ProtectedExtensionBinaryBoundary {
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
