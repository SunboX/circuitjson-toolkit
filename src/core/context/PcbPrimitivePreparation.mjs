import { CircuitJsonPcbPrimitiveBuilder } from '../CircuitJsonPcbPrimitiveBuilder.mjs'
import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { PcbSpatialIndex } from './PcbSpatialIndex.mjs'

const INTERACTION_CACHE = Object.freeze({
    namespace: 'pcb',
    key: 'interaction-primitives-v1'
})
const COMPLETE_CACHE = Object.freeze({
    namespace: 'render',
    key: 'pcb-primitives-v1'
})
const SPATIAL_CACHE = Object.freeze({
    namespace: 'interaction',
    key: 'pcb-spatial-v2'
})
const INTERACTION_OWNERS = new WeakMap()
const COMPLETE_OWNERS = new WeakMap()
const SPATIAL_OWNERS = new WeakMap()

/**
 * Owns immutable PCB primitive preparations shared by interaction and render
 * consumers without trusting namespace strings as type brands.
 */
export class PcbPrimitivePreparation {
    /**
     * Returns the immutable interaction-only primitive model for one context.
     * @param {import('./CircuitJsonDocumentContext.mjs').CircuitJsonDocumentContext} context Prepared context.
     * @returns {Record<string, any>} Context-owned primitive model.
     */
    static prepareInteraction(context) {
        const value = context.getOrCreateDerived(
            INTERACTION_CACHE.namespace,
            INTERACTION_CACHE.key,
            () => {
                const model = CircuitJsonPcbPrimitiveBuilder.buildInteraction(
                    context.model
                )
                PcbPrimitivePreparation.#freeze(model)
                INTERACTION_OWNERS.set(model, {
                    context,
                    key: INTERACTION_CACHE
                })
                return model
            }
        )
        return PcbPrimitivePreparation.#requireOwned(
            context,
            INTERACTION_CACHE,
            INTERACTION_OWNERS,
            value
        )
    }

    /**
     * Returns the immutable complete primitive model shared with render plans.
     * @param {import('./CircuitJsonDocumentContext.mjs').CircuitJsonDocumentContext} context Prepared context.
     * @returns {Record<string, any>} Context-owned complete primitive model.
     */
    static prepareComplete(context) {
        const value = context.getOrCreateDerived(
            COMPLETE_CACHE.namespace,
            COMPLETE_CACHE.key,
            () => {
                const model = CircuitJsonPcbPrimitiveBuilder.buildComplete(
                    context.model,
                    PcbPrimitivePreparation.prepareInteraction(context)
                )
                PcbPrimitivePreparation.#freeze(model)
                COMPLETE_OWNERS.set(model, {
                    context,
                    key: COMPLETE_CACHE
                })
                return model
            }
        )
        return PcbPrimitivePreparation.#requireOwned(
            context,
            COMPLETE_CACHE,
            COMPLETE_OWNERS,
            value
        )
    }

    /**
     * Returns the immutable spatial index bound to one exact primitive model.
     * @param {import('./CircuitJsonDocumentContext.mjs').CircuitJsonDocumentContext} context Prepared context.
     * @param {Record<string, any>} model Owned interaction primitive model.
     * @param {() => object[]} recordsFactory Stable spatial-record factory.
     * @returns {PcbSpatialIndex} Context-owned spatial index.
     */
    static prepareSpatial(context, model, recordsFactory) {
        PcbPrimitivePreparation.#requireOwned(
            context,
            INTERACTION_CACHE,
            INTERACTION_OWNERS,
            model
        )
        const value = context.getOrCreateDerived(
            SPATIAL_CACHE.namespace,
            SPATIAL_CACHE.key,
            () => {
                const spatial = PcbSpatialIndex.create(recordsFactory())
                SPATIAL_OWNERS.set(spatial, {
                    context,
                    key: SPATIAL_CACHE,
                    model
                })
                return spatial
            }
        )
        const spatial = PcbPrimitivePreparation.#requireOwned(
            context,
            SPATIAL_CACHE,
            SPATIAL_OWNERS,
            value
        )
        if (SPATIAL_OWNERS.get(spatial).model !== model) {
            throw PcbPrimitivePreparation.#collisionError()
        }
        return spatial
    }

    /**
     * Requires both the private type brand and exact context cache ownership.
     * @param {import('./CircuitJsonDocumentContext.mjs').CircuitJsonDocumentContext} context Prepared context.
     * @param {{ namespace: string, key: string }} key Expected cache key.
     * @param {WeakMap<object, object>} owners Type-specific ownership map.
     * @param {unknown} value Cache value candidate.
     * @returns {any} Verified value.
     */
    static #requireOwned(context, key, owners, value) {
        const owner =
            value && typeof value === 'object' ? owners.get(value) : null
        if (
            owner?.context !== context ||
            owner.key !== key ||
            !context.ownsDerived(key.namespace, key.key, value) ||
            !Object.isFrozen(value)
        ) {
            throw PcbPrimitivePreparation.#collisionError()
        }
        return value
    }

    /**
     * Deep-freezes a cyclic plain primitive graph before caching it.
     * @param {unknown} value Root cache value.
     * @returns {unknown} Frozen root value.
     */
    static #freeze(value) {
        if (!value || typeof value !== 'object') return value
        const pending = [{ value, expanded: false }]
        const visited = new WeakSet()
        while (pending.length) {
            const current = pending.pop()
            if (current.expanded) {
                Object.freeze(current.value)
                continue
            }
            if (visited.has(current.value) || Object.isFrozen(current.value)) {
                continue
            }
            visited.add(current.value)
            pending.push({ value: current.value, expanded: true })
            for (const descriptor of Object.values(
                Object.getOwnPropertyDescriptors(current.value)
            )) {
                if (
                    Object.hasOwn(descriptor, 'value') &&
                    descriptor.value &&
                    typeof descriptor.value === 'object'
                ) {
                    pending.push({
                        value: descriptor.value,
                        expanded: false
                    })
                }
            }
        }
        return value
    }

    /**
     * Creates a typed cache collision or transplant error.
     * @returns {ToolkitError} Typed interaction cache error.
     */
    static #collisionError() {
        return new ToolkitError(
            'Prepared PCB interaction encountered a cache collision or transplant.',
            {
                code: 'ERR_INTERACTION_CACHE_COLLISION',
                category: 'runtime',
                format: 'circuitjson'
            }
        )
    }
}
