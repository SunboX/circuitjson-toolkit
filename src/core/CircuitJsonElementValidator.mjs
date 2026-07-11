import { CIRCUIT_JSON_ELEMENT_TYPES } from './CircuitJsonElementTypes.mjs'
import {
    CIRCUIT_JSON_UPSTREAM_ELEMENT_TYPES,
    CIRCUIT_JSON_UPSTREAM_ID_FIELD_EXCEPTIONS,
    CIRCUIT_JSON_UPSTREAM_VARIANT_SETS
} from './CircuitJsonUpstreamSchema.mjs'
import { CircuitJsonToolkitElementSchema } from './CircuitJsonToolkitElementSchema.mjs'
import { CircuitJsonUpstreamValidator } from './CircuitJsonUpstreamValidator.mjs'
import { CircuitJsonModelFreezeTraversal } from './context/CircuitJsonModelFreezeTraversal.mjs'

const KNOWN_ELEMENT_TYPES = CIRCUIT_JSON_ELEMENT_TYPES
const UPSTREAM_ELEMENT_TYPES = new Set(CIRCUIT_JSON_UPSTREAM_ELEMENT_TYPES)
const ID_FIELD_EXCEPTIONS = new Set(CIRCUIT_JSON_UPSTREAM_ID_FIELD_EXCEPTIONS)
const VARIANT_SETS = Object.fromEntries(
    Object.entries(CIRCUIT_JSON_UPSTREAM_VARIANT_SETS).map(([name, values]) => [
        name,
        new Set(values)
    ])
)
const SORTED_VARIANT_SET_NAMES = Object.keys(VARIANT_SETS).sort()

/** @typedef {{ set: string, value: string }} CircuitJsonVariantDiff */
/** @typedef {{ elementTypes: string[], idFieldExceptions: string[], variantSets: Record<string, string[]> }} CircuitJsonSchemaSnapshot */
/** @typedef {{ matches: boolean, missingElementTypes: string[], unexpectedElementTypes: string[], missingIdFieldExceptions: string[], unexpectedIdFieldExceptions: string[], missingVariants: CircuitJsonVariantDiff[], unexpectedVariants: CircuitJsonVariantDiff[] }} CircuitJsonSchemaSnapshotComparison */

/**
 * Validates serialized CircuitJSON against the generated pinned upstream union.
 */
export class CircuitJsonElementValidator {
    /**
     * Returns validation errors for a candidate model.
     * @param {unknown} value Candidate model.
     * @param {{ freeze?: boolean }} [options] Validation options.
     * @returns {string[]}
     */
    static validateModel(value, options = {}) {
        if (!Array.isArray(value)) {
            return ['Expected a CircuitJSON element array.']
        }
        const traversal = new CircuitJsonModelFreezeTraversal(
            value,
            options.freeze === true
        )
        const errors = traversal.errors()
        if (errors.length === 0) {
            const length = Object.getOwnPropertyDescriptor(
                value,
                'length'
            ).value
            for (let index = 0; index < length; index += 1) {
                const element = Object.getOwnPropertyDescriptor(
                    value,
                    String(index)
                ).value
                errors.push(
                    ...CircuitJsonElementValidator.#validateElementData(
                        element,
                        index
                    )
                )
            }
        }
        traversal.commit(errors.length === 0)
        return errors
    }

    /**
     * Returns validation errors for one candidate element.
     * @param {unknown} value Candidate element.
     * @param {number} [index] Element index.
     * @returns {string[]}
     */
    static validateElement(value, index = -1) {
        const traversal = new CircuitJsonModelFreezeTraversal([value], false)
        const shapeErrors = traversal.errors()
        return shapeErrors.length
            ? shapeErrors
            : CircuitJsonElementValidator.#validateElementData(value, index)
    }

    /**
     * Returns all exact pinned upstream element type names.
     * @returns {string[]}
     */
    static knownElementTypes() {
        return [...UPSTREAM_ELEMENT_TYPES]
    }

    /**
     * Returns every accepted canonical type, including toolkit-owned additions.
     * @returns {string[]}
     */
    static canonicalElementTypes() {
        return [...KNOWN_ELEMENT_TYPES]
    }

    /**
     * Returns canonical toolkit types newer than the pinned upstream union.
     * @returns {string[]}
     */
    static extensionElementTypes() {
        return CircuitJsonToolkitElementSchema.elementTypes()
    }

    /**
     * Returns types without an unconditionally required conventional id field.
     * @returns {string[]}
     */
    static idFieldExceptions() {
        return [...ID_FIELD_EXCEPTIONS]
    }

    /**
     * Returns upstream-derived schema metadata suitable for drift snapshots.
     * @returns {CircuitJsonSchemaSnapshot}
     */
    static schemaSnapshot() {
        return {
            elementTypes: CircuitJsonElementValidator.knownElementTypes(),
            idFieldExceptions: CircuitJsonElementValidator.idFieldExceptions(),
            variantSets: CircuitJsonElementValidator.variantSets()
        }
    }

    /**
     * Returns upstream-derived discriminant sets.
     * @returns {Record<string, string[]>}
     */
    static variantSets() {
        return Object.fromEntries(
            SORTED_VARIANT_SET_NAMES.map((name) => [
                name,
                [...VARIANT_SETS[name]].sort()
            ])
        )
    }

    /**
     * Compares current schema metadata against a saved snapshot.
     * @param {{ elementTypes?: string[], idFieldExceptions?: string[], variantSets?: Record<string, string[]> }} snapshot Schema snapshot.
     * @returns {CircuitJsonSchemaSnapshotComparison}
     */
    static compareSchemaSnapshot(snapshot = {}) {
        const elementComparison = CircuitJsonElementValidator.#compareSets(
            new Set(snapshot.elementTypes || []),
            KNOWN_ELEMENT_TYPES
        )
        const exceptionComparison = CircuitJsonElementValidator.#compareSets(
            new Set(snapshot.idFieldExceptions || []),
            ID_FIELD_EXCEPTIONS
        )
        const variantComparison =
            CircuitJsonElementValidator.#compareVariantSets(
                snapshot.variantSets || {}
            )
        return {
            matches:
                elementComparison.missing.length === 0 &&
                elementComparison.unexpected.length === 0 &&
                exceptionComparison.missing.length === 0 &&
                exceptionComparison.unexpected.length === 0 &&
                variantComparison.missing.length === 0 &&
                variantComparison.unexpected.length === 0,
            missingElementTypes: elementComparison.missing,
            unexpectedElementTypes: elementComparison.unexpected,
            missingIdFieldExceptions: exceptionComparison.missing,
            unexpectedIdFieldExceptions: exceptionComparison.unexpected,
            missingVariants: variantComparison.missing,
            unexpectedVariants: variantComparison.unexpected
        }
    }

    /**
     * Validates one element after descriptor-safety traversal.
     * @param {unknown} value Candidate element.
     * @param {number} index Element index.
     * @returns {string[]} Validation errors.
     */
    static #validateElementData(value, index) {
        const location = index >= 0 ? ` at index ${index}` : ''
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return [`Expected a CircuitJSON element object${location}.`]
        }
        const typeValue = value.type
        const type = typeof typeValue === 'string' ? typeValue.trim() : ''
        if (!type) {
            return [`CircuitJSON element type is required${location}.`]
        }
        return CircuitJsonUpstreamValidator.validate(value, type, location)
    }

    /**
     * Compares expected and actual string sets.
     * @param {Set<string>} expected Expected values.
     * @param {Set<string>} actual Actual values.
     * @returns {{ missing: string[], unexpected: string[] }}
     */
    static #compareSets(expected, actual) {
        return {
            missing: [...expected]
                .filter((value) => !actual.has(value))
                .sort((left, right) => left.localeCompare(right)),
            unexpected: [...actual]
                .filter((value) => !expected.has(value))
                .sort((left, right) => left.localeCompare(right))
        }
    }

    /**
     * Compares expected and actual upstream variant sets.
     * @param {Record<string, string[]>} snapshotSets Snapshot variant sets.
     * @returns {{ missing: CircuitJsonVariantDiff[], unexpected: CircuitJsonVariantDiff[] }}
     */
    static #compareVariantSets(snapshotSets) {
        const missing = []
        const unexpected = []
        const names = new Set([
            ...SORTED_VARIANT_SET_NAMES,
            ...Object.keys(snapshotSets)
        ])
        for (const name of [...names].sort()) {
            const comparison = CircuitJsonElementValidator.#compareSets(
                new Set((snapshotSets[name] || []).map(String)),
                new Set(VARIANT_SETS[name] || [])
            )
            missing.push(
                ...comparison.missing.map((value) => ({ set: name, value }))
            )
            unexpected.push(
                ...comparison.unexpected.map((value) => ({
                    set: name,
                    value
                }))
            )
        }
        return { missing, unexpected }
    }
}

Object.freeze(CircuitJsonElementValidator.prototype)
Object.freeze(CircuitJsonElementValidator)
