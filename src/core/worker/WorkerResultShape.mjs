import { RuntimeProxyBoundary } from '../contracts/RuntimeProxyBoundary.mjs'

const DOCUMENT_FIELDS = Object.freeze([
    'schema',
    'id',
    'modelSchema',
    'model',
    'source',
    'extensions',
    'assets',
    'diagnostics',
    'statistics'
])
const PROJECT_FIELDS = Object.freeze([
    'schema',
    'id',
    'source',
    'documents',
    'project',
    'extensions',
    'assets',
    'diagnostics',
    'statistics'
])

/**
 * Classifies canonical result envelopes through data descriptors only.
 */
export class WorkerResultShape {
    /**
     * Selects the exact property set traversed for one result container.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @param {boolean} output Whether result-output rules apply.
     * @param {boolean} strictDescriptors Whether hidden properties are traversed.
     * @returns {PropertyKey[]} Traversed keys.
     */
    static keys(descriptors, output, strictDescriptors) {
        return output && !strictDescriptors
            ? Reflect.ownKeys(descriptors).filter(
                  (key) =>
                      typeof key === 'string' && descriptors[key].enumerable
              )
            : Reflect.ownKeys(descriptors)
    }

    /**
     * Validates a dense plain array and returns its captured length.
     * @param {object | null} prototype Array prototype.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @param {boolean} output Whether result-output rules apply.
     * @param {boolean} strictDescriptors Whether hidden properties are traversed.
     * @returns {number} Dense array length.
     */
    static arrayLength(prototype, descriptors, output, strictDescriptors) {
        const keys = Reflect.ownKeys(descriptors)
        const length = WorkerResultShape.#value(descriptors.length)
        const visibleKeys =
            output && !strictDescriptors
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
            (output && !strictDescriptors
                ? visibleKeys.length !== length
                : keys.length !== length + 1)
        ) {
            throw new TypeError(
                'Worker request arrays must be bounded, dense, and plain.'
            )
        }
        return length
    }

    /**
     * Tests one already-inspected canonical document envelope.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @param {PropertyKey[]} keys Traversed keys.
     * @returns {boolean} Whether the exact structural document shape matches.
     */
    static document(descriptors, keys) {
        if (
            !WorkerResultShape.#exactDataFields(
                descriptors,
                keys,
                DOCUMENT_FIELDS
            )
        ) {
            return false
        }
        return (
            WorkerResultShape.#value(descriptors.schema) ===
                'ecad-toolkit.document.v1' &&
            typeof WorkerResultShape.#value(descriptors.id) === 'string' &&
            WorkerResultShape.#record(
                WorkerResultShape.#value(descriptors.modelSchema)
            ) &&
            Array.isArray(WorkerResultShape.#value(descriptors.model)) &&
            WorkerResultShape.#record(
                WorkerResultShape.#value(descriptors.source)
            ) &&
            WorkerResultShape.#record(
                WorkerResultShape.#value(descriptors.extensions)
            ) &&
            Array.isArray(WorkerResultShape.#value(descriptors.assets)) &&
            Array.isArray(WorkerResultShape.#value(descriptors.diagnostics)) &&
            WorkerResultShape.#record(
                WorkerResultShape.#value(descriptors.statistics)
            )
        )
    }

    /**
     * Tests one already-inspected canonical project envelope.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @param {PropertyKey[]} keys Traversed keys.
     * @returns {boolean} Whether the exact structural project shape matches.
     */
    static project(descriptors, keys) {
        if (
            !WorkerResultShape.#exactDataFields(
                descriptors,
                keys,
                PROJECT_FIELDS
            )
        ) {
            return false
        }
        const project = WorkerResultShape.#value(descriptors.project)
        return (
            WorkerResultShape.#value(descriptors.schema) ===
                'ecad-toolkit.project.v1' &&
            typeof WorkerResultShape.#value(descriptors.id) === 'string' &&
            WorkerResultShape.#record(
                WorkerResultShape.#value(descriptors.source)
            ) &&
            Array.isArray(WorkerResultShape.#value(descriptors.documents)) &&
            (project === null || WorkerResultShape.#record(project)) &&
            WorkerResultShape.#record(
                WorkerResultShape.#value(descriptors.extensions)
            ) &&
            Array.isArray(WorkerResultShape.#value(descriptors.assets)) &&
            Array.isArray(WorkerResultShape.#value(descriptors.diagnostics)) &&
            WorkerResultShape.#record(
                WorkerResultShape.#value(descriptors.statistics)
            )
        )
    }

    /**
     * Inspects a nested project document without reading accessor values.
     * @param {unknown} value Candidate document.
     * @param {boolean} strictDescriptors Whether hidden properties are traversed.
     * @returns {boolean} Whether the exact structural document shape matches.
     */
    static documentCandidate(value, strictDescriptors) {
        if (!WorkerResultShape.#record(value)) return false
        RuntimeProxyBoundary.assert(value, 'Worker request data')
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            return false
        }
        if (prototype !== Object.prototype && prototype !== null) return false
        const keys = WorkerResultShape.keys(
            descriptors,
            true,
            strictDescriptors
        )
        return WorkerResultShape.document(descriptors, keys)
    }

    /**
     * Requires the exact enumerable own data field set.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @param {PropertyKey[]} keys Traversed keys.
     * @param {string[]} fields Expected fields.
     * @returns {boolean} Whether the field set matches.
     */
    static #exactDataFields(descriptors, keys, fields) {
        if (
            keys.length !== fields.length ||
            keys.some((key) => typeof key !== 'string' || !fields.includes(key))
        ) {
            return false
        }
        return fields.every((field) => {
            const descriptor = descriptors[field]
            return Boolean(
                descriptor &&
                descriptor.enumerable === true &&
                Object.hasOwn(descriptor, 'value')
            )
        })
    }

    /** @param {unknown} value Candidate. @returns {boolean} Whether value is record-shaped. */
    static #record(value) {
        return (
            value !== null && typeof value === 'object' && !Array.isArray(value)
        )
    }

    /** @param {PropertyDescriptor | undefined} descriptor Descriptor. @returns {unknown} Data value. */
    static #value(descriptor) {
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined
    }
}

Object.freeze(WorkerResultShape.prototype)
Object.freeze(WorkerResultShape)
