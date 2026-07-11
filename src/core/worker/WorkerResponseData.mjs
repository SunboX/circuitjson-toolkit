import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { ToolkitProgress } from '../contracts/ToolkitProgress.mjs'
import { RuntimeProxyBoundary } from '../contracts/RuntimeProxyBoundary.mjs'
import { CircuitJsonValidationProof } from '../context/CircuitJsonValidationProof.mjs'
import { TOOLKIT_WORKER_PROTOCOL } from './ToolkitWorkerProtocol.mjs'
import { WorkerRequestData } from './WorkerRequestData.mjs'

const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    'byteLength'
)?.get
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype)
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    'byteLength'
)?.get
const DATA_VIEW_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    DataView.prototype,
    'byteLength'
)?.get

const ERROR_CATEGORIES = new Set([
    'parse',
    'validation',
    'unsupported',
    'cancelled',
    'runtime'
])
const ERROR_FIELDS = [
    'name',
    'message',
    'code',
    'category',
    'format',
    'source',
    'location',
    'details',
    'cause'
]
const ERROR_CAUSE_FIELDS = ['name', 'message', 'code']
const ASSET_FIELDS = [
    'id',
    'kind',
    'name',
    'mediaType',
    'byteLength',
    'data',
    'source'
]
const DIAGNOSTIC_FIELDS = [
    'code',
    'severity',
    'message',
    'source',
    'location',
    'details'
]
const DIAGNOSTIC_SEVERITIES = new Set(['info', 'warning', 'error'])
const DOCUMENT_RESULT_FIELDS = [
    'schema',
    'id',
    'modelSchema',
    'model',
    'source',
    'extensions',
    'assets',
    'diagnostics',
    'statistics'
]
const PROJECT_RESULT_FIELDS = [
    'schema',
    'id',
    'source',
    'documents',
    'project',
    'extensions',
    'assets',
    'diagnostics',
    'statistics'
]
const PROJECT_DESCRIPTOR_FIELDS = [
    'id',
    'name',
    'format',
    'documentIds',
    'relationships'
]
const PROGRESS_FIELDS = new Set([
    'stage',
    'detail',
    'completed',
    'total',
    'message'
])
const PROGRESS_STAGES = new Set([
    'detect',
    'decode',
    'project',
    'validate',
    'complete'
])
const RESPONSE_FIELDS = {
    progress: ['protocol', 'type', 'requestId', 'progress'],
    result: ['protocol', 'type', 'requestId', 'value'],
    error: ['protocol', 'type', 'requestId', 'error', 'diagnostics']
}

/**
 * Validates the strict data-only responses accepted from parser workers.
 */
export class WorkerResponseData {
    /**
     * Validates one response header and its exact type-specific field set.
     * @param {unknown} value Response candidate.
     * @returns {Record<string, any>} Accessor-free response fields.
     */
    static message(value) {
        const fields = WorkerResponseData.#record(
            value,
            'Toolkit worker response'
        )
        if (fields.protocol !== TOOLKIT_WORKER_PROTOCOL) {
            throw WorkerResponseData.#error(
                'Toolkit worker response used an unknown protocol.'
            )
        }
        const expected = RESPONSE_FIELDS[fields.type]
        if (!expected) {
            throw WorkerResponseData.#error(
                'Toolkit worker response type is invalid.'
            )
        }
        WorkerResponseData.#exactKeys(
            fields,
            expected,
            'Toolkit worker response'
        )
        if (
            typeof fields.requestId !== 'string' ||
            !fields.requestId ||
            fields.requestId.length > 256
        ) {
            throw WorkerResponseData.#error(
                'Toolkit worker response request id is invalid.'
            )
        }
        return fields
    }

    /**
     * Validates an operation-specific canonical result envelope.
     * @param {'parse' | 'loadProject' | undefined} operation Pending operation.
     * @param {unknown} value Result candidate.
     * @returns {object} Original validated result.
     */
    static result(operation, value) {
        const prepared = WorkerRequestData.prepareResponse(value)
        const fields = WorkerResponseData.#record(
            prepared,
            'Toolkit worker result'
        )
        if (operation === 'parse') {
            WorkerResponseData.#documentResult(fields, prepared)
            return prepared
        }
        if (operation === 'loadProject') {
            WorkerResponseData.#projectResult(fields, prepared)
            return prepared
        }
        throw WorkerResponseData.#error(
            'Toolkit worker result has no active operation.'
        )
    }

    /**
     * Validates and normalizes one progress response without coercion.
     * @param {unknown} value Progress candidate.
     * @param {Record<string, any> | null} previous Previous progress row.
     * @returns {Record<string, any>} Canonical progress row.
     */
    static progress(value, previous) {
        const fields = WorkerResponseData.#record(
            value,
            'Toolkit worker progress'
        )
        WorkerResponseData.#allowedKeys(
            fields,
            PROGRESS_FIELDS,
            new Set(['stage']),
            'Toolkit worker progress'
        )
        if (
            typeof fields.stage !== 'string' ||
            !PROGRESS_STAGES.has(fields.stage)
        ) {
            throw WorkerResponseData.#error(
                'Toolkit worker progress stage is invalid.'
            )
        }
        for (const key of ['detail', 'message']) {
            if (
                fields[key] !== undefined &&
                (typeof fields[key] !== 'string' ||
                    !fields[key] ||
                    fields[key].length > 4096)
            ) {
                throw WorkerResponseData.#error(
                    `Toolkit worker progress ${key} is invalid.`
                )
            }
        }
        for (const key of ['completed', 'total']) {
            if (
                fields[key] !== undefined &&
                (typeof fields[key] !== 'number' ||
                    !Number.isFinite(fields[key]) ||
                    fields[key] < 0)
            ) {
                throw WorkerResponseData.#error(
                    `Toolkit worker progress ${key} is invalid.`
                )
            }
        }
        try {
            return ToolkitProgress.create(fields, previous)
        } catch (error) {
            throw WorkerResponseData.#error(
                'Toolkit worker progress ordering is invalid.',
                error
            )
        }
    }

    /**
     * Validates diagnostics and reconstructs one exact remote ToolkitError.
     * @param {unknown} errorValue Remote error candidate.
     * @param {unknown} diagnosticsValue Diagnostics candidate.
     * @returns {ToolkitError} Local typed error.
     */
    static remoteError(errorValue, diagnosticsValue) {
        WorkerResponseData.#diagnostics(diagnosticsValue)
        const fields = WorkerResponseData.#record(
            errorValue,
            'Toolkit worker error'
        )
        WorkerResponseData.#exactKeys(
            fields,
            ERROR_FIELDS,
            'Toolkit worker error'
        )
        if (
            fields.name !== 'ToolkitError' ||
            !ERROR_CATEGORIES.has(fields.category)
        ) {
            throw WorkerResponseData.#error(
                'Toolkit worker error fields are invalid.'
            )
        }
        WorkerResponseData.#boundedString(
            fields.message,
            4096,
            'message',
            false
        )
        WorkerResponseData.#boundedString(fields.format, 4096, 'format', false)
        WorkerResponseData.#boundedString(fields.source, 4096, 'source', true)
        WorkerResponseData.#boundedString(fields.code, 256, 'code', false)
        WorkerResponseData.#cause(fields.cause)
        WorkerRequestData.assertCloneSafe({
            location: fields.location,
            details: fields.details,
            cause: fields.cause
        })
        return new ToolkitError(fields.message, {
            code: fields.code,
            category: fields.category,
            format: fields.format,
            source: fields.source,
            location: fields.location,
            details: fields.details,
            cause: fields.cause
        })
    }

    /**
     * Validates and proves one locally owned received document.
     * @param {Record<string, any>} fields Document fields.
     * @param {Record<string, any>} document Owned document result.
     * @returns {void}
     */
    static #documentResult(fields, document) {
        WorkerResponseData.#exactKeys(
            fields,
            DOCUMENT_RESULT_FIELDS,
            'Toolkit worker document result'
        )
        if (fields.schema !== 'ecad-toolkit.document.v1') {
            throw WorkerResponseData.#error(
                'Toolkit worker document schema is invalid.'
            )
        }
        WorkerResponseData.#boundedString(fields.id, 4096, 'id', false)
        const modelSchema = WorkerResponseData.#record(
            fields.modelSchema,
            'Toolkit worker model schema'
        )
        WorkerResponseData.#exactKeys(
            modelSchema,
            ['name', 'version'],
            'Toolkit worker model schema'
        )
        if (
            modelSchema.name !== 'circuit-json' ||
            modelSchema.version !== '0.0.446'
        ) {
            throw WorkerResponseData.#error(
                'Toolkit worker model schema is invalid.'
            )
        }
        WorkerResponseData.#array(
            fields.model,
            'Toolkit worker document model',
            2_000_000
        )
        WorkerResponseData.#assets(fields.assets)
        WorkerResponseData.#diagnosticRows(fields.diagnostics, 100_000)
        WorkerResponseData.#documentSource(fields.source)
        WorkerResponseData.#plainResultRecords(fields, [
            'extensions',
            'statistics'
        ])
        try {
            CircuitJsonValidationProof.validateAndAttach(document)
        } catch (error) {
            throw WorkerResponseData.#error(
                'Toolkit worker document model is invalid.',
                error
            )
        }
    }

    /**
     * Validates one locally owned received project and all nested documents.
     * @param {Record<string, any>} fields Project fields.
     * @param {Record<string, any>} projectResult Owned project result.
     * @returns {void}
     */
    static #projectResult(fields, projectResult) {
        WorkerResponseData.#exactKeys(
            fields,
            PROJECT_RESULT_FIELDS,
            'Toolkit worker project result'
        )
        if (fields.schema !== 'ecad-toolkit.project.v1') {
            throw WorkerResponseData.#error(
                'Toolkit worker project schema is invalid.'
            )
        }
        WorkerResponseData.#boundedString(fields.id, 4096, 'id', false)
        WorkerResponseData.#resultCollections(fields, ['documents'])
        const documents = WorkerResponseData.#array(
            fields.documents,
            'Toolkit worker project documents',
            4096
        )
        for (let index = 0; index < documents.length; index += 1) {
            const document = documents[index]
            WorkerResponseData.#documentResult(
                WorkerResponseData.#record(
                    document,
                    'Toolkit worker project document'
                ),
                projectResult.documents[index]
            )
        }
        WorkerResponseData.#assets(fields.assets)
        WorkerResponseData.#diagnosticRows(fields.diagnostics, 100_000)
        WorkerResponseData.#projectSource(fields.source)
        WorkerResponseData.#plainResultRecords(fields, [
            'extensions',
            'statistics'
        ])
        if (fields.project !== null) {
            const project = WorkerResponseData.#record(
                fields.project,
                'Toolkit worker project descriptor'
            )
            WorkerResponseData.#exactKeys(
                project,
                PROJECT_DESCRIPTOR_FIELDS,
                'Toolkit worker project descriptor'
            )
            for (const key of ['id', 'name', 'format']) {
                WorkerResponseData.#boundedString(
                    project[key],
                    4096,
                    `project ${key}`,
                    key === 'name'
                )
            }
            const documentIds = WorkerResponseData.#array(
                project.documentIds,
                'Toolkit worker project document ids',
                4096
            )
            for (const documentId of documentIds) {
                WorkerResponseData.#boundedString(
                    documentId,
                    4096,
                    'project document id',
                    false
                )
            }
            if (
                documentIds.length !== documents.length ||
                documentIds.some(
                    (documentId, index) => documentId !== documents[index].id
                )
            ) {
                throw WorkerResponseData.#error(
                    'Toolkit worker project document ids are inconsistent.'
                )
            }
            const relationships = WorkerResponseData.#array(
                project.relationships,
                'Toolkit worker project relationships',
                100_000
            )
            for (const relationship of relationships) {
                WorkerResponseData.#record(
                    relationship,
                    'Toolkit worker project relationship'
                )
            }
        }
    }

    /**
     * Requires common result collections plus operation-specific collections.
     * @param {Record<string, any>} fields Result fields.
     * @param {string[]} specific Operation-specific collection names.
     * @returns {void}
     */
    static #resultCollections(fields, specific) {
        for (const key of [...specific, 'assets', 'diagnostics']) {
            if (!Array.isArray(fields[key])) {
                throw WorkerResponseData.#error(
                    `Toolkit worker result ${key} is invalid.`
                )
            }
        }
    }

    /**
     * Requires common result map fields to be plain accessor-free records.
     * @param {Record<string, any>} fields Result fields.
     * @param {string[]} names Field names.
     * @returns {void}
     */
    static #plainResultRecords(fields, names) {
        for (const name of names) {
            WorkerResponseData.#record(
                fields[name],
                `Toolkit worker result ${name}`
            )
        }
    }

    /** @param {unknown} value Diagnostics candidate. @returns {void} */
    static #diagnostics(value) {
        WorkerRequestData.assertCloneSafe(value)
        WorkerResponseData.#diagnosticRows(value, 1000)
    }

    /**
     * Validates canonical asset records without coercion.
     * @param {unknown} value Asset array.
     * @returns {void}
     */
    static #assets(value) {
        const assets = WorkerResponseData.#array(
            value,
            'Toolkit worker assets',
            100_000
        )
        for (const asset of assets) {
            const fields = WorkerResponseData.#record(
                asset,
                'Toolkit worker asset'
            )
            WorkerResponseData.#exactKeys(
                fields,
                ASSET_FIELDS,
                'Toolkit worker asset'
            )
            for (const key of ['id', 'kind', 'name', 'mediaType']) {
                WorkerResponseData.#boundedString(
                    fields[key],
                    4096,
                    `asset ${key}`,
                    key === 'name'
                )
            }
            if (
                !Number.isSafeInteger(fields.byteLength) ||
                fields.byteLength < 0
            ) {
                throw WorkerResponseData.#error(
                    'Toolkit worker asset byteLength is invalid.'
                )
            }
            if (fields.source !== null) {
                WorkerResponseData.#record(
                    fields.source,
                    'Toolkit worker asset source'
                )
            }
            if (
                fields.data !== null &&
                typeof fields.data !== 'string' &&
                WorkerResponseData.#binaryByteLength(fields.data) === null
            ) {
                throw WorkerResponseData.#error(
                    'Toolkit worker asset data is invalid.'
                )
            }
            const actualByteLength = WorkerResponseData.#assetByteLength(
                fields.data
            )
            if (
                actualByteLength !== null &&
                fields.byteLength !== actualByteLength
            ) {
                throw WorkerResponseData.#error(
                    'Toolkit worker asset byteLength is inconsistent.'
                )
            }
        }
    }

    /**
     * Validates the required canonical document-source primitives.
     * @param {unknown} value Source candidate.
     * @returns {void}
     */
    static #documentSource(value) {
        const fields = WorkerResponseData.#record(
            value,
            'Toolkit worker document source'
        )
        WorkerResponseData.#boundedString(
            fields.format,
            256,
            'document source format',
            false
        )
        WorkerResponseData.#boundedString(
            fields.fileName,
            4096,
            'document source fileName',
            true
        )
        WorkerResponseData.#boundedString(
            fields.fileType,
            256,
            'document source fileType',
            false
        )
    }

    /**
     * Validates the required canonical project-source primitives.
     * @param {unknown} value Source candidate.
     * @returns {void}
     */
    static #projectSource(value) {
        const fields = WorkerResponseData.#record(
            value,
            'Toolkit worker project source'
        )
        WorkerResponseData.#boundedString(
            fields.format,
            256,
            'project source format',
            false
        )
        const entryNames = WorkerResponseData.#array(
            fields.entryNames,
            'Toolkit worker project source entryNames',
            4096
        )
        for (const entryName of entryNames) {
            WorkerResponseData.#boundedString(
                entryName,
                4096,
                'project source entryName',
                false
            )
        }
    }

    /**
     * Measures present canonical asset data exactly as UTF-8 or binary bytes.
     * @param {unknown} value Asset data.
     * @returns {number | null} Actual bytes, or null for absent/invalid data.
     */
    static #assetByteLength(value) {
        if (value === null) return null
        if (typeof value === 'string') {
            return WorkerResponseData.#utf8ByteLength(value)
        }
        return WorkerResponseData.#binaryByteLength(value)
    }

    /**
     * Reads genuine binary internal slots without trusting surface properties.
     * @param {unknown} value Binary candidate.
     * @returns {number | null} Intrinsic byte length.
     */
    static #binaryByteLength(value) {
        for (const getter of [
            ARRAY_BUFFER_BYTE_LENGTH_GETTER,
            DATA_VIEW_BYTE_LENGTH_GETTER,
            TYPED_ARRAY_BYTE_LENGTH_GETTER
        ]) {
            if (!getter) continue
            try {
                return getter.call(value)
            } catch {
                // Each intrinsic independently proves its corresponding brand.
            }
        }
        return null
    }

    /**
     * Measures a string with the replacement behavior used by UTF-8 encoders.
     * @param {string} value Text value.
     * @returns {number} UTF-8 byte length.
     */
    static #utf8ByteLength(value) {
        let bytes = 0
        for (let index = 0; index < value.length; index += 1) {
            const first = value.charCodeAt(index)
            let codePoint = first
            if (first >= 0xd800 && first <= 0xdbff) {
                const second = value.charCodeAt(index + 1)
                if (second >= 0xdc00 && second <= 0xdfff) {
                    codePoint =
                        0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
                    index += 1
                } else {
                    codePoint = 0xfffd
                }
            } else if (first >= 0xdc00 && first <= 0xdfff) {
                codePoint = 0xfffd
            }
            if (codePoint <= 0x7f) bytes += 1
            else if (codePoint <= 0x7ff) bytes += 2
            else if (codePoint <= 0xffff) bytes += 3
            else bytes += 4
        }
        return bytes
    }

    /**
     * Validates canonical diagnostic rows.
     * @param {unknown} value Diagnostics candidate.
     * @param {number} maximum Maximum row count.
     * @returns {void}
     */
    static #diagnosticRows(value, maximum) {
        const diagnostics = WorkerResponseData.#array(
            value,
            'Toolkit worker diagnostics',
            maximum
        )
        for (const diagnostic of diagnostics) {
            const fields = WorkerResponseData.#record(
                diagnostic,
                'Toolkit worker diagnostic'
            )
            WorkerResponseData.#exactKeys(
                fields,
                DIAGNOSTIC_FIELDS,
                'Toolkit worker diagnostic'
            )
            WorkerResponseData.#boundedString(
                fields.code,
                256,
                'diagnostic code',
                false
            )
            WorkerResponseData.#boundedString(
                fields.message,
                4096,
                'diagnostic message',
                true
            )
            WorkerResponseData.#boundedString(
                fields.source,
                4096,
                'diagnostic source',
                true
            )
            if (!DIAGNOSTIC_SEVERITIES.has(fields.severity)) {
                throw WorkerResponseData.#error(
                    'Toolkit worker diagnostic severity is invalid.'
                )
            }
        }
    }

    /** @param {unknown} value Cause candidate. @returns {void} */
    static #cause(value) {
        if (value === null) return
        const fields = WorkerResponseData.#record(
            value,
            'Toolkit worker error cause'
        )
        WorkerResponseData.#exactKeys(
            fields,
            ERROR_CAUSE_FIELDS,
            'Toolkit worker error cause'
        )
        WorkerResponseData.#boundedString(
            fields.name,
            4096,
            'cause name',
            false
        )
        WorkerResponseData.#boundedString(
            fields.message,
            4096,
            'cause message',
            true
        )
        if (fields.code !== null) {
            WorkerResponseData.#boundedString(
                fields.code,
                256,
                'cause code',
                true
            )
        }
    }

    /**
     * Requires one bounded string without coercion.
     * @param {unknown} value String candidate.
     * @param {number} maximum Maximum length.
     * @param {string} label Field label.
     * @param {boolean} allowEmpty Whether an empty string is valid.
     * @returns {void}
     */
    static #boundedString(value, maximum, label, allowEmpty) {
        if (
            typeof value !== 'string' ||
            value.length > maximum ||
            (!allowEmpty && !value)
        ) {
            throw WorkerResponseData.#error(
                `Toolkit worker ${label} is invalid.`
            )
        }
    }

    /**
     * Requires an exact enumerable field set.
     * @param {Record<string, any>} fields Record fields.
     * @param {string[]} expected Expected keys.
     * @param {string} label Record label.
     * @returns {void}
     */
    static #exactKeys(fields, expected, label) {
        const keys = Object.keys(fields)
        if (
            keys.length !== expected.length ||
            expected.some((key) => !Object.hasOwn(fields, key))
        ) {
            throw WorkerResponseData.#error(`${label} fields are invalid.`)
        }
    }

    /**
     * Requires an allowed key set and all required keys.
     * @param {Record<string, any>} fields Record fields.
     * @param {Set<string>} allowed Allowed keys.
     * @param {Set<string>} required Required keys.
     * @param {string} label Record label.
     * @returns {void}
     */
    static #allowedKeys(fields, allowed, required, label) {
        const keys = Object.keys(fields)
        if (
            keys.some((key) => !allowed.has(key)) ||
            [...required].some((key) => !Object.hasOwn(fields, key))
        ) {
            throw WorkerResponseData.#error(`${label} fields are invalid.`)
        }
    }

    /**
     * Reads one accessor-free plain record.
     * @param {unknown} value Record candidate.
     * @param {string} label Record label.
     * @returns {Record<string, any>} Null-prototype data map.
     */
    static #record(value, label) {
        RuntimeProxyBoundary.assert(value, label)
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw WorkerResponseData.#error(`${label} must be a plain object.`)
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch (error) {
            throw WorkerResponseData.#error(
                `${label} could not be inspected safely.`,
                error
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw WorkerResponseData.#error(`${label} must be a plain object.`)
        }
        const result = Object.create(null)
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                descriptor.get ||
                descriptor.set ||
                descriptor.enumerable !== true
            ) {
                throw WorkerResponseData.#error(
                    `${label} may contain only enumerable data properties.`
                )
            }
            Object.defineProperty(result, key, {
                configurable: true,
                enumerable: true,
                value: descriptor.value,
                writable: true
            })
        }
        return result
    }

    /**
     * Reads one bounded dense plain array.
     * @param {unknown} value Array candidate.
     * @param {string} label Array label.
     * @param {number} maximum Maximum length.
     * @returns {any[]} Array values.
     */
    static #array(value, label, maximum) {
        RuntimeProxyBoundary.assert(value, label)
        if (!Array.isArray(value)) {
            throw WorkerResponseData.#error(`${label} must be an array.`)
        }
        const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
        const keys = Reflect.ownKeys(value)
        if (
            Object.getPrototypeOf(value) !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > maximum ||
            keys.length !== length + 1
        ) {
            throw WorkerResponseData.#error(
                `${label} must be a bounded dense plain array.`
            )
        }
        const result = new Array(length)
        for (let index = 0; index < length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(
                value,
                String(index)
            )
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw WorkerResponseData.#error(
                    `${label} must contain data properties.`
                )
            }
            result[index] = descriptor.value
        }
        return result
    }

    /**
     * Creates one typed protocol error.
     * @param {string} message Failure message.
     * @param {unknown} [cause] Failure cause.
     * @returns {ToolkitError} Protocol error.
     */
    static #error(message, cause = null) {
        return new ToolkitError(message, {
            code: 'ERR_WORKER_MESSAGE',
            category: 'runtime',
            cause
        })
    }
}
