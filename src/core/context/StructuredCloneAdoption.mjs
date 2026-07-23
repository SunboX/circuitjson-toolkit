import { BinaryDataSnapshot } from './BinaryDataSnapshot.mjs'
import { ProtectedExtensionBinaryBoundary } from './ProtectedExtensionBinaryBoundary.mjs'
import { StructuredCloneCollectionNormalizer } from './StructuredCloneCollectionNormalizer.mjs'
import { StructuredCloneTextAccounting } from './StructuredCloneTextAccounting.mjs'

const MAX_DEPTH = 256
const MAX_SLICE_WORK = 1_024
const MAX_COOPERATIVE_RECORD_KEYS = 16_384
const ADOPTION_PLANS = new WeakMap()
const TRUSTED_PLANS = new WeakSet()

/**
 * Traverses one standard structured-clone graph and records safe sealing work.
 */
class StructuredCloneAdoptionTraversal {
    #adopted
    #capture
    #cooperative
    #plan
    #replacements
    #root
    #state
    #work

    /**
     * Creates one isolated traversal over candidate accounting state.
     * @param {unknown} root Structured-clone graph root.
     * @param {Record<string, any>} state Candidate accounting state.
     * @param {(value: unknown, state: Record<string, any>, depth: number) => unknown} capture Built-in fallback capture.
     * @param {boolean} cooperative Whether traversal may lock and yield within containers.
     */
    constructor(root, state, capture, cooperative) {
        this.#root = root
        this.#state = state
        this.#capture = capture
        this.#cooperative = cooperative
        this.#adopted = undefined
        this.#replacements = []
        this.#plan = {
            binaryCaptures: [],
            seals: [],
            seen: new Set()
        }
        this.#work = 0
    }

    /**
     * Returns the adopted graph after traversal has completed.
     * @returns {unknown} Adopted graph root.
     */
    get adopted() {
        return this.#adopted
    }

    /**
     * Returns the reusable descriptor-checked sealing plan.
     * @returns {object} Structured-clone sealing plan.
     */
    get plan() {
        return this.#plan
    }

    /**
     * Traverses the graph and captures all descriptors and binary payloads.
     * @returns {Generator<void, unknown, void>} Bounded-work traversal.
     */
    *traverse() {
        this.#adopted = yield* this.#adoptValue(this.#root, 0)
        return this.#adopted
    }

    /**
     * Applies normalized built-in replacements after the full graph validates.
     * @returns {Generator<void, void, void>} Bounded-work replacement pass.
     */
    *applyReplacements() {
        for (const replacement of this.#replacements) {
            const descriptor = StructuredCloneAdoptionTraversal.#descriptor(
                replacement.owner,
                replacement.key,
                'Canonical asset source could not be adopted safely.'
            )
            if (
                !StructuredCloneAdoptionTraversal.#sameDataDescriptor(
                    descriptor,
                    replacement.originalDescriptor
                )
            ) {
                throw new TypeError(
                    'Canonical asset source changed during adoption.'
                )
            }
            try {
                Object.defineProperty(replacement.owner, replacement.key, {
                    ...replacement.finalDescriptor
                })
            } catch {
                throw new TypeError(
                    'Canonical asset source could not be adopted safely.'
                )
            }
            yield* this.#checkpoint()
        }
    }

    /**
     * Installs isolated binary getters and freezes validated targets in chunks.
     * @returns {Generator<void, void, void>} Bounded-work sealing pass.
     */
    *seal() {
        for (const captured of this.#plan.binaryCaptures) {
            ProtectedExtensionBinaryBoundary.protectCapturedProperty(captured)
            yield* this.#checkpoint()
        }
        for (const seal of this.#plan.seals) {
            yield* this.#sealTargetCooperatively(seal)
        }
    }

    /**
     * Adopts one structured-clone value and records its final descriptors.
     * @param {unknown} value Candidate value.
     * @param {number} depth Current container depth.
     * @returns {Generator<void, unknown, void>} Bounded-work value traversal.
     */
    *#adoptValue(value, depth) {
        yield* this.#checkpoint()
        const type = typeof value
        if (type === 'string') {
            yield* StructuredCloneTextAccounting.reserve(value, this.#state, {
                checkpoint: () => this.#checkpoint(MAX_SLICE_WORK),
                reserve: (count) =>
                    StructuredCloneAdoptionTraversal.#reserveBytes(
                        this.#state,
                        count
                    )
            })
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
        if (depth > MAX_DEPTH) {
            throw new TypeError('Canonical asset source is nested too deeply.')
        }
        if (this.#state.seen.has(value)) return this.#state.seen.get(value)

        const binary = BinaryDataSnapshot.describeStandard(value)
        if (binary) {
            StructuredCloneAdoptionTraversal.#reserve(this.#state, 1)
            StructuredCloneAdoptionTraversal.#reserveBytes(
                this.#state,
                binary.byteLength
            )
            this.#state.seen.set(value, value)
            return value
        }

        let prototype
        let keys
        let extensible
        try {
            prototype = Object.getPrototypeOf(value)
            extensible = Object.isExtensible(value)
            keys =
                this.#cooperative && Array.isArray(value)
                    ? null
                    : Reflect.ownKeys(value)
        } catch {
            throw new TypeError(
                'Canonical asset source could not be inspected safely.'
            )
        }
        const array = Array.isArray(value)
        const plain = array
            ? prototype === Array.prototype
            : prototype === Object.prototype || prototype === null
        const collection = yield* StructuredCloneCollectionNormalizer.normalize(
            value,
            prototype,
            keys || [],
            depth,
            {
                adopt: (child, childDepth) =>
                    this.#adoptValue(child, childDepth),
                checkpoint: () => this.#checkpoint(),
                collect: (child) => this.#collectCapturedValue(child),
                remember: (source, result) =>
                    this.#state.seen.set(source, result),
                reserve: (count) =>
                    StructuredCloneAdoptionTraversal.#reserve(
                        this.#state,
                        count
                    )
            }
        )
        if (collection !== StructuredCloneCollectionNormalizer.notHandled) {
            return collection
        }
        if (!plain || !extensible) {
            const captured = this.#capture(value, this.#state, depth)
            yield* this.#collectCapturedValue(captured)
            return captured
        }

        const lengthDescriptor = array
            ? StructuredCloneAdoptionTraversal.#arrayLengthDescriptor(value)
            : null
        const target =
            this.#cooperative && array
                ? new Array(lengthDescriptor.value)
                : value
        StructuredCloneAdoptionTraversal.#reserve(this.#state, 1)
        this.#state.seen.set(value, target)
        this.#plan.seen.add(target)
        if (this.#cooperative) {
            try {
                Object.preventExtensions(value)
            } catch {
                throw new TypeError(
                    'Canonical asset source could not be adopted safely.'
                )
            }
        }
        const seal = {
            array,
            keys: keys ? [...keys] : null,
            properties: [],
            prototype,
            shapeLocked: this.#cooperative,
            target
        }
        if (array) {
            const length = lengthDescriptor.value
            if (!this.#cooperative && keys.length !== length + 1) {
                throw new TypeError(
                    'Canonical asset source arrays must be dense and plain.'
                )
            }
            StructuredCloneAdoptionTraversal.#reserve(this.#state, length)
            if (this.#cooperative) {
                let index = 0
                for (const key in value) {
                    if (!Object.hasOwn(value, key)) continue
                    if (key !== String(index) || index >= length) {
                        throw new TypeError(
                            'Canonical asset source arrays must be dense and plain.'
                        )
                    }
                    seal.properties.push(
                        yield* this.#adoptProperty(value, key, depth, target)
                    )
                    index += 1
                }
                if (index !== length) {
                    throw new TypeError(
                        'Canonical asset source arrays must be dense and plain.'
                    )
                }
                try {
                    Object.preventExtensions(target)
                } catch {
                    throw new TypeError(
                        'Canonical asset source could not be adopted safely.'
                    )
                }
            } else {
                for (let index = 0; index < length; index += 1) {
                    seal.properties.push(
                        yield* this.#adoptProperty(value, String(index), depth)
                    )
                }
            }
            seal.properties.push({
                binary: false,
                descriptor: {
                    ...StructuredCloneAdoptionTraversal.#arrayLengthDescriptor(
                        target
                    )
                },
                key: 'length'
            })
            this.#plan.seals.push(seal)
            return target
        }

        if (this.#cooperative && keys.length > MAX_COOPERATIVE_RECORD_KEYS) {
            throw new TypeError(
                'Canonical extension records have too many properties for cooperative preparation.'
            )
        }
        StructuredCloneAdoptionTraversal.#reserve(this.#state, keys.length)
        for (const key of keys) {
            if (typeof key !== 'string') {
                throw new TypeError(
                    'Canonical asset source keys must be strings.'
                )
            }
            seal.properties.push(yield* this.#adoptProperty(value, key, depth))
        }
        this.#plan.seals.push(seal)
        return value
    }

    /**
     * Validates and adopts one ordinary parent property.
     * @param {object} owner Structured-clone parent.
     * @param {string} key Property name.
     * @param {number} depth Parent depth.
     * @param {object} [target] Optional clean property owner.
     * @returns {Generator<void, object, void>} Final property snapshot.
     */
    *#adoptProperty(owner, key, depth, target = owner) {
        const descriptor = StructuredCloneAdoptionTraversal.#dataDescriptor(
            owner,
            key
        )
        if (descriptor.configurable !== true || descriptor.writable !== true) {
            throw new TypeError(
                'Structured-cloned metadata must expose ordinary data properties.'
            )
        }
        const adopted = yield* this.#adoptValue(descriptor.value, depth + 1)
        const finalDescriptor = { ...descriptor, value: adopted }
        if (target !== owner) {
            try {
                Object.defineProperty(target, key, finalDescriptor)
            } catch {
                throw new TypeError(
                    'Canonical asset source could not be adopted safely.'
                )
            }
        } else if (adopted !== descriptor.value) {
            this.#replacements.push({
                finalDescriptor,
                key,
                originalDescriptor: { ...descriptor },
                owner
            })
        }
        const binary = Boolean(
            adopted &&
            typeof adopted === 'object' &&
            BinaryDataSnapshot.describeStandard(adopted)
        )
        if (binary) {
            this.#plan.binaryCaptures.push(
                yield* this.#captureBinaryProperty(target, key, finalDescriptor)
            )
        }
        return {
            binary,
            descriptor: finalDescriptor,
            key
        }
    }

    /**
     * Collects sealing snapshots for one normalized built-in subtree.
     * @param {unknown} value Owned normalized value.
     * @returns {Generator<void, void, void>} Bounded-work collection pass.
     */
    *#collectCapturedValue(value) {
        yield* this.#checkpoint()
        if (!value || typeof value !== 'object') return
        if (BinaryDataSnapshot.describeStandard(value)) return
        if (this.#plan.seen.has(value)) return
        this.#plan.seen.add(value)

        let prototype
        let keys
        const array = Array.isArray(value)
        try {
            prototype = Object.getPrototypeOf(value)
            keys = this.#cooperative && array ? null : Reflect.ownKeys(value)
        } catch {
            throw new TypeError(
                'Canonical asset source could not be inspected safely.'
            )
        }
        const plain = array
            ? prototype === Array.prototype
            : prototype === Object.prototype || prototype === null
        if (!plain) {
            throw new TypeError(
                'Canonical asset source must contain plain data objects.'
            )
        }
        if (
            this.#cooperative &&
            !array &&
            keys.length > MAX_COOPERATIVE_RECORD_KEYS
        ) {
            throw new TypeError(
                'Canonical extension records have too many properties for cooperative preparation.'
            )
        }
        if (this.#cooperative) {
            try {
                Object.preventExtensions(value)
            } catch {
                throw new TypeError(
                    'Canonical asset source could not be adopted safely.'
                )
            }
        }
        const seal = {
            array,
            keys: keys ? [...keys] : null,
            properties: [],
            prototype,
            shapeLocked: this.#cooperative,
            target: value
        }
        let lengthDescriptor = null
        if (array && this.#cooperative) {
            lengthDescriptor =
                StructuredCloneAdoptionTraversal.#arrayLengthDescriptor(value)
            for (let index = 0; index < lengthDescriptor.value; index += 1) {
                yield* this.#collectCapturedProperty(value, String(index), seal)
            }
        } else {
            for (const key of keys) {
                if (array && key === 'length') continue
                yield* this.#collectCapturedProperty(value, key, seal)
            }
        }
        if (array) {
            lengthDescriptor ||=
                StructuredCloneAdoptionTraversal.#arrayLengthDescriptor(value)
            seal.properties.push({
                binary: false,
                descriptor: { ...lengthDescriptor },
                key: 'length'
            })
        }
        this.#plan.seals.push(seal)
    }

    /**
     * Collects one property from an internally normalized container.
     * @param {object} owner Normalized property owner.
     * @param {PropertyKey} key Property key.
     * @param {object} seal Mutable sealing plan.
     * @returns {Generator<void, void, void>} Bounded child collection pass.
     */
    *#collectCapturedProperty(owner, key, seal) {
        if (typeof key !== 'string') {
            throw new TypeError('Canonical asset source keys must be strings.')
        }
        const descriptor = StructuredCloneAdoptionTraversal.#dataDescriptor(
            owner,
            key
        )
        const child = descriptor.value
        const binary = Boolean(
            child &&
            typeof child === 'object' &&
            BinaryDataSnapshot.describeStandard(child)
        )
        if (binary) {
            this.#plan.binaryCaptures.push(
                yield* this.#captureBinaryProperty(owner, key, descriptor)
            )
        } else {
            yield* this.#collectCapturedValue(child)
        }
        seal.properties.push({
            binary,
            descriptor: { ...descriptor },
            key
        })
    }

    /**
     * Copies one binary property through an opaque branded capture in bounded
     * byte ranges under the exclusive-ownership contract.
     * @param {object} owner Binary property owner.
     * @param {PropertyKey} key Binary property key.
     * @param {PropertyDescriptor} descriptor Validated data descriptor.
     * @returns {Generator<void, object, void>} Completed binary capture.
     */
    *#captureBinaryProperty(owner, key, descriptor) {
        const capture = ProtectedExtensionBinaryBoundary.beginPropertyCapture(
            owner,
            key,
            descriptor
        )
        let complete = false
        while (!complete) {
            complete =
                ProtectedExtensionBinaryBoundary.copyPropertyCaptureChunk(
                    capture
                )
            yield* this.#checkpoint(MAX_SLICE_WORK)
        }
        return ProtectedExtensionBinaryBoundary.finishPropertyCapture(capture)
    }

    /**
     * Validates and atomically freezes one acquired target.
     * @param {object} seal Target sealing snapshot.
     * @returns {Generator<void, void, void>} Cooperative locking pass.
     */
    *#sealTargetCooperatively(seal) {
        StructuredCloneAdoptionTraversal.#requireTargetShape(seal)
        for (const property of seal.properties) {
            const descriptor = StructuredCloneAdoptionTraversal.#descriptor(
                seal.target,
                property.key,
                'Canonical asset source changed during adoption.'
            )
            const matches = property.binary
                ? ProtectedExtensionBinaryBoundary.isProtected(descriptor)
                : StructuredCloneAdoptionTraversal.#sameDataDescriptor(
                      descriptor,
                      property.descriptor
                  )
            if (!matches) {
                throw new TypeError(
                    'Canonical asset source changed during adoption.'
                )
            }
        }
        StructuredCloneAdoptionTraversal.#requireTargetShape(seal)
        try {
            Object.freeze(seal.target)
        } catch {
            throw new TypeError(
                'Canonical document values could not be frozen safely.'
            )
        }
        yield* this.#checkpoint(seal.properties.length || 1)
    }

    /**
     * Creates a scheduling boundary after a bounded amount of traversal work.
     * @param {number} [units] Additional work units.
     * @returns {Generator<void, void, void>} Optional scheduling boundary.
     */
    *#checkpoint(units = 1) {
        this.#work += units
        if (this.#work < MAX_SLICE_WORK) return
        this.#work = 0
        yield undefined
    }

    /**
     * Reads and validates one standard dense-array length descriptor.
     * @param {unknown[]} owner Array candidate.
     * @returns {PropertyDescriptor} Validated length descriptor.
     */
    static #arrayLengthDescriptor(owner) {
        const descriptor = StructuredCloneAdoptionTraversal.#descriptor(
            owner,
            'length',
            'Canonical asset source array could not be inspected.'
        )
        if (
            !Object.hasOwn(descriptor, 'value') ||
            !Number.isSafeInteger(descriptor.value) ||
            descriptor.value < 0
        ) {
            throw new TypeError(
                'Canonical asset source arrays must be dense and plain.'
            )
        }
        return descriptor
    }

    /**
     * Reads one enumerable own data descriptor.
     * @param {object} owner Property owner.
     * @param {string} key Property name.
     * @returns {PropertyDescriptor} Validated descriptor.
     */
    static #dataDescriptor(owner, key) {
        const descriptor = StructuredCloneAdoptionTraversal.#descriptor(
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
     * Reads one exact own descriptor with normalized failures.
     * @param {object} owner Property owner.
     * @param {PropertyKey} key Property key.
     * @param {string} message Failure message.
     * @returns {PropertyDescriptor} Existing descriptor.
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
     * Freezes one target only when its complete validated shape still matches.
     * @param {object} seal Target sealing snapshot.
     * @returns {void}
     */
    static sealTarget(seal) {
        let prototype
        let keys
        let extensible
        try {
            prototype = Object.getPrototypeOf(seal.target)
            keys = Reflect.ownKeys(seal.target)
            extensible = Object.isExtensible(seal.target)
        } catch {
            throw new TypeError(
                'Canonical asset source changed during adoption.'
            )
        }
        if (
            prototype !== seal.prototype ||
            extensible !== true ||
            !StructuredCloneAdoptionTraversal.#sameKeys(keys, seal.keys)
        ) {
            throw new TypeError(
                'Canonical asset source changed during adoption.'
            )
        }
        for (const property of seal.properties) {
            const descriptor = StructuredCloneAdoptionTraversal.#descriptor(
                seal.target,
                property.key,
                'Canonical asset source changed during adoption.'
            )
            const matches = property.binary
                ? ProtectedExtensionBinaryBoundary.isProtected(descriptor)
                : StructuredCloneAdoptionTraversal.#sameDataDescriptor(
                      descriptor,
                      property.descriptor
                  )
            if (!matches) {
                throw new TypeError(
                    'Canonical asset source changed during adoption.'
                )
            }
        }
        try {
            Object.freeze(seal.target)
        } catch {
            throw new TypeError(
                'Canonical document values could not be frozen safely.'
            )
        }
    }

    /**
     * Requires an unchanged prototype, extensibility state, and own-key set.
     * @param {object} seal Target sealing snapshot.
     * @returns {void}
     */
    static #requireTargetShape(seal) {
        let prototype
        let keys = null
        let extensible
        try {
            prototype = Object.getPrototypeOf(seal.target)
            extensible = Object.isExtensible(seal.target)
            if (!seal.shapeLocked) keys = Reflect.ownKeys(seal.target)
        } catch {
            throw new TypeError(
                'Canonical asset source changed during adoption.'
            )
        }
        if (
            prototype !== seal.prototype ||
            extensible !== !seal.shapeLocked ||
            (!seal.shapeLocked &&
                !StructuredCloneAdoptionTraversal.#sameKeys(keys, seal.keys))
        ) {
            throw new TypeError(
                'Canonical asset source changed during adoption.'
            )
        }
    }

    /**
     * Compares exact data descriptor semantics without coercion.
     * @param {PropertyDescriptor | undefined} current Current descriptor.
     * @param {PropertyDescriptor} expected Captured descriptor.
     * @returns {boolean} Whether both descriptors match.
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
     * Compares an exact own-key snapshot without string coercion.
     * @param {PropertyKey[]} current Current keys.
     * @param {PropertyKey[]} expected Captured keys.
     * @returns {boolean} Whether both key sequences match.
     */
    static #sameKeys(current, expected) {
        if (current.length !== expected.length) return false
        return current.every((key, index) => key === expected[index])
    }

    /**
     * Reserves bounded traversal work.
     * @param {Record<string, any>} state Capture state.
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
     * Reserves bounded binary or text bytes.
     * @param {Record<string, any>} state Capture state.
     * @param {number} count Additional bytes.
     * @returns {void}
     */
    static #reserveBytes(state, count) {
        if (state.maxBytes === Number.MAX_SAFE_INTEGER) return
        if (
            !Number.isSafeInteger(count) ||
            count < 0 ||
            state.bytes + count > state.maxBytes
        ) {
            throw new TypeError(`${state.label} is too large.`)
        }
        state.bytes += count
    }
}

/**
 * Adopts structured-clone graphs synchronously or in bounded async slices.
 */
export class StructuredCloneAdoption {
    /**
     * Adopts a graph synchronously while preserving the existing API contract.
     * @param {unknown} value Structured-clone graph root.
     * @param {Record<string, any>} state Shared capture state.
     * @param {(value: unknown, state: Record<string, any>, depth: number) => unknown} capture Built-in fallback capture.
     * @returns {unknown} Adopted graph.
     */
    static adopt(value, state, capture) {
        StructuredCloneAdoption.#requireInputs(state, capture)
        const candidate = StructuredCloneAdoption.#candidateState(state)
        const traversal = new StructuredCloneAdoptionTraversal(
            value,
            candidate,
            capture,
            false
        )
        StructuredCloneAdoption.#drain(traversal.traverse())
        StructuredCloneAdoption.#drain(traversal.applyReplacements())
        StructuredCloneAdoption.#commitState(state, candidate)
        const adopted = traversal.adopted
        if (adopted && typeof adopted === 'object') {
            TRUSTED_PLANS.add(traversal.plan)
            ADOPTION_PLANS.set(adopted, traversal.plan)
        }
        return adopted
    }

    /**
     * Adopts and seals a graph while yielding between bounded work slices.
     * @param {unknown} value Structured-clone graph root.
     * @param {Record<string, any>} state Shared capture state.
     * @param {(value: unknown, state: Record<string, any>, depth: number) => unknown} capture Built-in fallback capture.
     * @param {() => Promise<void> | void} yieldControl Host scheduler.
     * @returns {Promise<unknown>} Adopted and sealed graph.
     */
    static async adoptAndSealAsync(value, state, capture, yieldControl) {
        StructuredCloneAdoption.#requireInputs(state, capture)
        if (typeof yieldControl !== 'function') {
            throw new TypeError(
                'Structured-clone yield control must be a function.'
            )
        }
        const candidate = StructuredCloneAdoption.#candidateState(state)
        const traversal = new StructuredCloneAdoptionTraversal(
            value,
            candidate,
            capture,
            true
        )
        const traversalPass = await StructuredCloneAdoption.#drainAsync(
            traversal.traverse(),
            yieldControl
        )
        const replacementPass = await StructuredCloneAdoption.#drainAsync(
            traversal.applyReplacements(),
            yieldControl
        )
        const sealingPass = await StructuredCloneAdoption.#drainAsync(
            traversal.seal(),
            yieldControl
        )
        if (
            traversalPass.yields + replacementPass.yields + sealingPass.yields >
            0
        ) {
            await yieldControl()
        }
        StructuredCloneAdoption.#commitState(state, candidate)
        return traversal.adopted
    }

    /**
     * Consumes one sync adoption plan for immediate sealing.
     * @param {unknown} value Adopted graph root.
     * @returns {object | null} Trusted one-use sealing plan.
     */
    static consume(value) {
        if (!value || typeof value !== 'object') return null
        const plan = ADOPTION_PLANS.get(value) || null
        ADOPTION_PLANS.delete(value)
        return plan
    }

    /**
     * Seals one synchronously adopted graph from its trusted plan.
     * @param {object} plan Sealing plan returned by consume.
     * @returns {void}
     */
    static seal(plan) {
        if (!TRUSTED_PLANS.has(plan)) {
            throw new TypeError(
                'Structured-clone sealing requires a trusted adoption plan.'
            )
        }
        TRUSTED_PLANS.delete(plan)
        for (const captured of plan.binaryCaptures) {
            ProtectedExtensionBinaryBoundary.protectCapturedProperty(captured)
        }
        for (const seal of plan.seals) {
            StructuredCloneAdoptionTraversal.sealTarget(seal)
        }
    }

    /**
     * Validates shared state and the private fallback capture callback.
     * @param {Record<string, any>} state Shared capture state.
     * @param {unknown} capture Capture callback.
     * @returns {void}
     */
    static #requireInputs(state, capture) {
        if (
            !(state?.seen instanceof Map) ||
            !(state?.accounted instanceof Set) ||
            !Number.isSafeInteger(state.bytes) ||
            !Number.isSafeInteger(state.items) ||
            !Number.isSafeInteger(state.maxBytes) ||
            !Number.isSafeInteger(state.maxItems) ||
            typeof state.label !== 'string' ||
            typeof state.preserveBinary !== 'boolean' ||
            state.standardBuiltins !== true ||
            typeof capture !== 'function'
        ) {
            throw new TypeError(
                'Structured-clone adoption requires a proven capture state.'
            )
        }
    }

    /**
     * Copies mutable accounting collections for atomic state publication.
     * @param {Record<string, any>} state Shared capture state.
     * @returns {Record<string, any>} Candidate state.
     */
    static #candidateState(state) {
        return {
            ...state,
            accounted: new Set(state.accounted),
            seen: new Map(state.seen)
        }
    }

    /**
     * Publishes successful candidate accounting into the shared state.
     * @param {Record<string, any>} state Shared state.
     * @param {Record<string, any>} candidate Candidate state.
     * @returns {void}
     */
    static #commitState(state, candidate) {
        state.accounted = candidate.accounted
        state.bytes = candidate.bytes
        state.items = candidate.items
        state.seen = candidate.seen
    }

    /**
     * Exhausts a bounded-work generator without scheduling boundaries.
     * @param {Generator<void, unknown, void>} iterator Work iterator.
     * @returns {unknown} Generator return value.
     */
    static #drain(iterator) {
        let step = iterator.next()
        while (!step.done) step = iterator.next()
        return step.value
    }

    /**
     * Steps a bounded-work generator across host scheduling boundaries.
     * @param {Generator<void, unknown, void>} iterator Work iterator.
     * @param {() => Promise<void> | void} yieldControl Host scheduler.
     * @returns {Promise<{ value: unknown, yields: number }>} Generator result and boundary count.
     */
    static async #drainAsync(iterator, yieldControl) {
        let yields = 0
        let step = iterator.next()
        while (!step.done) {
            await yieldControl()
            yields += 1
            step = iterator.next()
        }
        return { value: step.value, yields }
    }
}

Object.freeze(StructuredCloneAdoptionTraversal.prototype)
Object.freeze(StructuredCloneAdoptionTraversal)
Object.freeze(StructuredCloneAdoption.prototype)
Object.freeze(StructuredCloneAdoption)
