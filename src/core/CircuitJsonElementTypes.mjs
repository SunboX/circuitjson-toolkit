import { CIRCUIT_JSON_UPSTREAM_ELEMENT_TYPES } from './CircuitJsonUpstreamSchema.mjs'
import { CircuitJsonToolkitElementSchema } from './CircuitJsonToolkitElementSchema.mjs'

/**
 * Frozen inventory of exact pinned upstream CircuitJSON element type names.
 */
export const CIRCUIT_JSON_ELEMENT_TYPES = new Set([
    ...CIRCUIT_JSON_UPSTREAM_ELEMENT_TYPES,
    ...CircuitJsonToolkitElementSchema.elementTypes()
])
