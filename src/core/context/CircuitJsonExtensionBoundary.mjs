import { BinaryDataSnapshot } from './BinaryDataSnapshot.mjs'
import { ProtectedExtensionBinaryBoundary } from './ProtectedExtensionBinaryBoundary.mjs'
import { StructuredDataSnapshot } from './StructuredDataSnapshot.mjs'

const OWNED_EXTENSION_ROOTS = new WeakSet()
const EXTENSION_METADATA_LIMITS = Object.freeze({
    label: 'Canonical extension data',
    maxBytes: 128 * 1024 * 1024,
    maxItems: 4_000_000,
    preserveBinary: true
})

/**
 * Owns and seals canonical extension graphs independently of document fields.
 */
export class CircuitJsonExtensionBoundary {
    /**
     * Returns whether an object is an already owned extension root.
     * @param {unknown} value Extension candidate.
     * @returns {boolean} Whether this boundary owns the root.
     */
    static owns(value) {
        return Boolean(
            value &&
            typeof value === 'object' &&
            OWNED_EXTENSION_ROOTS.has(value)
        )
    }

    /**
     * Creates one deeply frozen source-extension snapshot.
     * @param {unknown} value Extension candidate.
     * @param {((snapshot: unknown) => unknown) | null} [normalize] Optional normalizer.
     * @param {{ standardBuiltins?: boolean }} [options] Proven graph provenance.
     * @returns {unknown} Deeply immutable owned extension metadata.
     */
    static copyReadonly(value, normalize = null, options = {}) {
        if (
            CircuitJsonExtensionBoundary.owns(value) &&
            Object.isFrozen(value) &&
            normalize === null
        ) {
            return value
        }
        if (normalize !== null && typeof normalize !== 'function') {
            throw new TypeError('Extension normalizer must be a function.')
        }
        const standardBuiltins = options?.standardBuiltins === true
        const state = StructuredDataSnapshot.createState({
            ...EXTENSION_METADATA_LIMITS,
            standardBuiltins
        })
        const snapshot = standardBuiltins
            ? StructuredDataSnapshot.adoptStructuredClone(value, state)
            : StructuredDataSnapshot.capture(value, state)
        CircuitJsonExtensionBoundary.#rejectBinaryRoot(snapshot)
        const adoption = standardBuiltins
            ? StructuredDataSnapshot.consumeStructuredCloneAdoption(snapshot)
            : null
        if (adoption && normalize === null) {
            StructuredDataSnapshot.sealStructuredCloneAdoption(adoption)
        } else {
            ProtectedExtensionBinaryBoundary.protect(snapshot)
        }
        const normalized = normalize ? normalize(snapshot) : snapshot
        if (normalized !== snapshot) {
            ProtectedExtensionBinaryBoundary.protect(normalized)
        }
        if (!adoption || normalize !== null) {
            CircuitJsonExtensionBoundary.#freezeValue(normalized)
        }
        CircuitJsonExtensionBoundary.#markOwned(normalized)
        return normalized
    }

    /**
     * Cooperatively adopts one structured-clone extension graph.
     * @param {unknown} value Extension candidate.
     * @param {{ standardBuiltins?: boolean, yield: () => Promise<void> | void }} options Proven provenance and host scheduler.
     * @returns {Promise<unknown>} Deeply immutable owned extension metadata.
     */
    static async copyReadonlyAsync(value, options) {
        if (
            CircuitJsonExtensionBoundary.owns(value) &&
            Object.isFrozen(value)
        ) {
            return value
        }
        if (
            options?.standardBuiltins !== true ||
            typeof options?.yield !== 'function'
        ) {
            return CircuitJsonExtensionBoundary.copyReadonly(
                value,
                null,
                options
            )
        }
        const state = StructuredDataSnapshot.createState({
            ...EXTENSION_METADATA_LIMITS,
            standardBuiltins: true
        })
        const snapshot = await StructuredDataSnapshot.adoptStructuredCloneAsync(
            value,
            state,
            options.yield
        )
        CircuitJsonExtensionBoundary.#rejectBinaryRoot(snapshot)
        CircuitJsonExtensionBoundary.#markOwned(snapshot)
        return snapshot
    }

    /**
     * Captures one document extension field synchronously.
     * @param {Record<string, any>} document Canonical document envelope.
     * @param {boolean} standardBuiltins Whether built-ins have local prototypes.
     * @returns {unknown} Owned extension root or undefined.
     */
    static captureDocument(document, standardBuiltins) {
        const descriptor =
            CircuitJsonExtensionBoundary.#documentDescriptor(document)
        if (!descriptor) return undefined
        const captured = CircuitJsonExtensionBoundary.copyReadonly(
            descriptor.value,
            null,
            { standardBuiltins }
        )
        if (captured === descriptor.value) return captured
        Object.defineProperty(document, 'extensions', {
            ...descriptor,
            value: captured
        })
        return captured
    }

    /**
     * Cooperatively captures a document extension field and rejects replacement
     * races across scheduling boundaries.
     * @param {Record<string, any>} document Canonical document envelope.
     * @param {boolean} standardBuiltins Whether built-ins have local prototypes.
     * @param {() => Promise<void> | void} yieldControl Host scheduler.
     * @returns {Promise<unknown>} Owned extension root or undefined.
     */
    static async captureDocumentAsync(
        document,
        standardBuiltins,
        yieldControl
    ) {
        const descriptor =
            CircuitJsonExtensionBoundary.#documentDescriptor(document)
        if (!descriptor) return undefined
        const captured = await CircuitJsonExtensionBoundary.copyReadonlyAsync(
            descriptor.value,
            {
                standardBuiltins,
                yield: yieldControl
            }
        )
        const current =
            CircuitJsonExtensionBoundary.#documentDescriptor(document)
        if (
            !current ||
            !CircuitJsonExtensionBoundary.#sameDataDescriptor(
                current,
                descriptor
            )
        ) {
            throw new TypeError(
                'Canonical document extensions changed during adoption.'
            )
        }
        if (captured === descriptor.value) return captured
        Object.defineProperty(document, 'extensions', {
            ...descriptor,
            value: captured
        })
        return captured
    }

    /**
     * Reads and validates the optional document extension descriptor.
     * @param {Record<string, any>} document Canonical document envelope.
     * @returns {PropertyDescriptor | undefined} Extension descriptor.
     */
    static #documentDescriptor(document) {
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(document, 'extensions')
        } catch {
            throw new TypeError(
                'Canonical document extensions could not be inspected safely.'
            )
        }
        if (descriptor && !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(
                'Canonical document extensions must be an own data property.'
            )
        }
        return descriptor
    }

    /**
     * Rejects unsupported binary extension roots.
     * @param {unknown} value Extension root.
     * @returns {void}
     */
    static #rejectBinaryRoot(value) {
        if (BinaryDataSnapshot.describeStandard(value)) {
            throw new TypeError(
                'Canonical extension root must be a plain data container.'
            )
        }
    }

    /**
     * Marks one object root as owned by this boundary.
     * @param {unknown} value Extension root.
     * @returns {void}
     */
    static #markOwned(value) {
        if (value && typeof value === 'object') {
            OWNED_EXTENSION_ROOTS.add(value)
        }
    }

    /**
     * Deeply freezes one captured plain-data graph.
     * @param {unknown} value Captured graph.
     * @returns {void}
     */
    static #freezeValue(value) {
        const seen = new Set()
        const stack = [{ exit: false, value }]
        while (stack.length) {
            const frame = stack.pop()
            const current = frame.value
            if (frame.exit) {
                try {
                    Object.freeze(current)
                } catch {
                    throw new TypeError(
                        'Canonical document values could not be frozen safely.'
                    )
                }
                continue
            }
            if (!CircuitJsonExtensionBoundary.#container(current)) continue
            if (seen.has(current)) continue
            seen.add(current)
            let descriptors
            try {
                descriptors = Object.getOwnPropertyDescriptors(current)
            } catch {
                throw new TypeError(
                    'Canonical document values could not be inspected safely.'
                )
            }
            const children = []
            for (const descriptor of Object.values(descriptors)) {
                if (!Object.hasOwn(descriptor, 'value')) {
                    if (
                        ProtectedExtensionBinaryBoundary.isProtected(descriptor)
                    ) {
                        continue
                    }
                    throw new TypeError(
                        'Canonical document may contain only data properties.'
                    )
                }
                children.push(descriptor.value)
            }
            stack.push({ exit: true, value: current })
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push({ exit: false, value: children[index] })
            }
        }
    }

    /**
     * Returns true for plain extension containers.
     * @param {unknown} value Candidate value.
     * @returns {boolean} Whether the value is a plain container.
     */
    static #container(value) {
        if (!value || typeof value !== 'object') return false
        if (Array.isArray(value)) {
            return Object.getPrototypeOf(value) === Array.prototype
        }
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }

    /**
     * Compares exact ordinary data descriptor semantics.
     * @param {PropertyDescriptor} current Current descriptor.
     * @param {PropertyDescriptor} expected Captured descriptor.
     * @returns {boolean} Whether both descriptors match.
     */
    static #sameDataDescriptor(current, expected) {
        return Boolean(
            Object.hasOwn(current, 'value') &&
            Object.hasOwn(expected, 'value') &&
            Object.is(current.value, expected.value) &&
            current.configurable === expected.configurable &&
            current.enumerable === expected.enumerable &&
            current.writable === expected.writable
        )
    }
}

Object.freeze(CircuitJsonExtensionBoundary.prototype)
Object.freeze(CircuitJsonExtensionBoundary)
