import { CircuitJsonManufacturingBuilder } from './CircuitJsonManufacturingBuilder.mjs'
import { CircuitJsonManufacturingDownloadBuilder } from './CircuitJsonManufacturingDownloadBuilder.mjs'
import { CircuitJsonDocumentContext } from './context/CircuitJsonDocumentContext.mjs'
import { ToolkitError } from './contracts/ToolkitError.mjs'

const EXPORTS = [
    {
        id: 'fabrication-notes-json',
        format: 'json',
        mediaType: 'application/json;charset=utf-8',
        fileExtension: '.json'
    },
    {
        id: 'pick-place-csv',
        format: 'csv',
        mediaType: 'text/csv;charset=utf-8',
        fileExtension: '.csv'
    },
    {
        id: 'routing-dsn',
        format: 'specctra-dsn',
        mediaType: 'application/specctra-dsn',
        fileExtension: '.dsn'
    }
]
const ROUTING_TYPES = [
    'pcb_board',
    'pcb_component',
    'pcb_smtpad',
    'pcb_trace',
    'pcb_via',
    'pcb_plated_hole',
    'pcb_trace_hint',
    'pcb_breakout_point',
    'source_net'
]

/**
 * Exposes lazy CircuitJSON manufacturing inspection and export services.
 */
export class ManufacturingService {
    /**
     * Inspects canonical placement and fabrication metadata.
     * @param {unknown} document DocumentInput or prepared context.
     * @param {Record<string, any>} [options] Reserved service options.
     * @returns {{ schema: string, placements: object[], fabricationNotes: object[], exports: object[], diagnostics: object[], statistics: object }} Manufacturing inspection.
     */
    static inspect(document, options = {}) {
        const context = ManufacturingService.#context(document, options)
        const manufacturing = ManufacturingService.#build(context)
        return {
            schema: 'ecad-toolkit.manufacturing.v1',
            placements: structuredClone(manufacturing.pickAndPlaceRows),
            fabricationNotes: structuredClone(manufacturing.fabricationNotes),
            exports: ManufacturingService.#exports(manufacturing, context),
            diagnostics: [],
            statistics: ManufacturingService.#statistics(context)
        }
    }

    /**
     * Lists every canonical manufacturing export and its availability.
     * @param {unknown} document DocumentInput or prepared context.
     * @param {Record<string, any>} [options] Reserved service options.
     * @returns {object[]} Detached export capability rows.
     */
    static listExports(document, options = {}) {
        const context = ManufacturingService.#context(document, options)
        const manufacturing = ManufacturingService.#build(context)
        return ManufacturingService.#exports(manufacturing, context)
    }

    /**
     * Builds one available canonical manufacturing file.
     * @param {unknown} document DocumentInput or prepared context.
     * @param {Record<string, any>} request Export request.
     * @param {Record<string, any>} [options] Reserved service options.
     * @returns {{ fileName: string, mediaType: string, data: Uint8Array, diagnostics: object[] }} File result.
     */
    static export(document, request, options = {}) {
        const normalized = ManufacturingService.#request(request)
        const context = ManufacturingService.#context(document, options)
        const manufacturing = ManufacturingService.#build(context)
        const capability = ManufacturingService.#exports(
            manufacturing,
            context
        ).find((entry) => entry.id === normalized.id)
        if (!capability || capability.status !== 'available') {
            throw ManufacturingService.#unavailable(capability?.reason)
        }
        try {
            const built = CircuitJsonManufacturingDownloadBuilder.build(
                {
                    fileName: context.source.fileName,
                    manufacturing
                },
                normalized.id,
                normalized.options
            )
            return {
                fileName: built.fileName,
                mediaType: built.contentType,
                data: new Uint8Array(built.bytes),
                diagnostics: []
            }
        } catch (error) {
            throw ToolkitError.from(error, {
                code: 'ERR_MANUFACTURING_EXPORT',
                category: 'runtime',
                format: 'circuitjson'
            })
        }
    }

    /**
     * Prepares one shared context and its element index.
     * @param {unknown} document Document input.
     * @param {unknown} options Service options.
     * @returns {CircuitJsonDocumentContext} Prepared context.
     */
    static #context(document, options) {
        ManufacturingService.#record(options, new Set())
        try {
            return CircuitJsonDocumentContext.prepare(document, {
                indexes: ['elements']
            })
        } catch (error) {
            throw ToolkitError.from(error, {
                code: 'ERR_MANUFACTURING_DOCUMENT',
                category: 'validation',
                format: 'circuitjson'
            })
        }
    }

    /**
     * Returns the one request-scoped manufacturing model.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {Record<string, any>} Internal manufacturing model.
     */
    static #build(context) {
        return context.getOrCreateDerived(
            'manufacturing',
            'inspection-v1',
            () =>
                CircuitJsonManufacturingBuilder.build(
                    context.model,
                    context.getIndex('elements')
                )
        )
    }

    /**
     * Computes stable format availability rows.
     * @param {Record<string, any>} manufacturing Internal manufacturing model.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {object[]} Detached export capability rows.
     */
    static #exports(manufacturing, context) {
        return EXPORTS.map((entry) => {
            const reason = ManufacturingService.#reason(
                entry.id,
                manufacturing,
                context
            )
            return {
                ...entry,
                status: reason ? 'unavailable' : 'available',
                reason
            }
        })
    }

    /**
     * Explains why one core export lacks source data.
     * @param {string} id Export id.
     * @param {Record<string, any>} manufacturing Internal manufacturing model.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {string} Empty string when available.
     */
    static #reason(id, manufacturing, context) {
        if (id === 'pick-place-csv' && !manufacturing.pickAndPlaceRows.length) {
            return 'No placement metadata is available.'
        }
        if (
            id === 'fabrication-notes-json' &&
            !manufacturing.fabricationNotes.length
        ) {
            return 'No fabrication note metadata is available.'
        }
        if (
            id === 'routing-dsn' &&
            (!manufacturing.routingDsn.trim() ||
                !ManufacturingService.#hasRoutingData(context))
        ) {
            return 'No routing metadata is available.'
        }
        return ''
    }

    /**
     * Returns whether the canonical model contains data represented by DSN.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {boolean} Whether a routing export is meaningful.
     */
    static #hasRoutingData(context) {
        const byType = context.getIndex('elements').elementsByType
        return ROUTING_TYPES.some((type) => (byType.get(type) || []).length)
    }

    /**
     * Normalizes one safe manufacturing export request.
     * @param {unknown} request Request candidate.
     * @returns {{ id: string, options: Record<string, any> }} Request.
     */
    static #request(request) {
        const normalized = ManufacturingService.#record(
            request,
            new Set(['id', 'options'])
        )
        const id = normalized.id
        if (typeof id !== 'string' || !id.trim() || id.length > 256) {
            throw ManufacturingService.#requestError(
                'Manufacturing export id must be a bounded string.'
            )
        }
        const options = ManufacturingService.#record(
            normalized.options ?? {},
            new Set()
        )
        return { id: id.trim(), options }
    }

    /**
     * Reads a plain accessor-free request record.
     * @param {unknown} value Record candidate.
     * @param {Set<string>} allowed Allowed own keys.
     * @returns {Record<string, any>} Safe shallow copy.
     */
    static #record(value, allowed) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw ManufacturingService.#requestError(
                'Manufacturing options must be a plain object.'
            )
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw ManufacturingService.#requestError(
                'Manufacturing options could not be inspected safely.'
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw ManufacturingService.#requestError(
                'Manufacturing options must be a plain object.'
            )
        }
        const result = {}
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                !allowed.has(key) ||
                descriptor.enumerable !== true ||
                descriptor.get ||
                descriptor.set
            ) {
                throw ManufacturingService.#requestError(
                    'Manufacturing options contain an unsupported field.'
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Returns stable context work statistics.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {Record<string, number>} Statistics.
     */
    static #statistics(context) {
        const statistics = context.statistics
        return {
            validationPasses: statistics.validationPasses,
            elementIndexBuilds: statistics.indexBuilds.elements || 0,
            manufacturingBuilds:
                statistics.derivedBuilds['manufacturing:inspection-v1'] || 0
        }
    }

    /**
     * Creates a typed request validation failure.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed error.
     */
    static #requestError(message) {
        return new ToolkitError(message, {
            code: 'ERR_MANUFACTURING_REQUEST',
            category: 'validation',
            format: 'circuitjson'
        })
    }

    /**
     * Creates a typed unavailable-capability failure.
     * @param {string} [reason] Capability reason.
     * @returns {ToolkitError} Typed error.
     */
    static #unavailable(reason = '') {
        return new ToolkitError(
            reason || 'Manufacturing export is unavailable.',
            {
                code: 'ERR_CAPABILITY_UNAVAILABLE',
                category: 'unsupported',
                format: 'circuitjson'
            }
        )
    }
}
