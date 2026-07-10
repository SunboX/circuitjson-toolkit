import { CircuitJsonDocumentContext } from '../context/CircuitJsonDocumentContext.mjs'
import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { CircuitTraversal } from './CircuitTraversal.mjs'
import { QueryNetlistBuilder } from './QueryNetlistBuilder.mjs'
import { RegexPattern } from './RegexPattern.mjs'

const COMPONENT_FIELDS = new Set([
    'id',
    'name',
    'designator',
    'type',
    'value',
    'footprint',
    'mpn',
    'description'
])
const NET_FIELDS = new Set(['id', 'name'])
const CRITERIA_KEYS = new Set([
    'field',
    'pattern',
    'match',
    'flags',
    'caseSensitive'
])

/**
 * Provides repeated clone-safe queries over one prepared CircuitJSON context.
 */
export class QueryService {
    #context
    #netlist

    /**
     * Creates one service around an already prepared context.
     * @param {CircuitJsonDocumentContext} context Prepared document context.
     */
    constructor(context) {
        this.#context = context
        this.#netlist = context.getOrCreateDerived('query', 'netlist-v1', () =>
            QueryNetlistBuilder.build(context)
        )
    }

    /**
     * Creates a bound query service and prepares its shared indexes once.
     * @param {unknown} document Document result, CircuitJSON model, or context.
     * @param {Record<string, any>} [options] Context options.
     * @returns {QueryService} Bound service.
     */
    static create(document, options = {}) {
        try {
            QueryService.#record(options, new Set(['indexes']))
            const context = CircuitJsonDocumentContext.prepare(document, {
                indexes: ['elements', 'relations', 'connectivity']
            })
            return new QueryService(context)
        } catch (error) {
            throw QueryService.#from(error)
        }
    }

    /**
     * Returns shared context work counters in stable query terminology.
     * @returns {Record<string, number>} Query statistics.
     */
    get statistics() {
        const statistics = this.#context.statistics
        return {
            validationPasses: statistics.validationPasses,
            elementIndexBuilds: statistics.indexBuilds.elements || 0,
            relationIndexBuilds: statistics.indexBuilds.relations || 0,
            connectivityIndexBuilds: statistics.indexBuilds.connectivity || 0,
            netlistBuilds: statistics.derivedBuilds['query:netlist-v1'] || 0
        }
    }

    /**
     * Executes one canonical component or net query.
     * @param {Record<string, any>} request Query request.
     * @param {Record<string, any>} [options] Paging options.
     * @returns {{ schema: string, items: object[], diagnostics: object[], statistics: object }} Query result.
     */
    query(request, options = {}) {
        const normalized = QueryService.#record(
            request,
            new Set(['select', 'where'])
        )
        const select = normalized.select
        if (select !== 'components' && select !== 'nets') {
            throw QueryService.#error(
                'Query select must be components or nets.'
            )
        }
        const items = this.#find(select, normalized.where || {}, options)
        return {
            schema: 'ecad-toolkit.query.v1',
            items,
            diagnostics: structuredClone(this.#netlist.diagnostics),
            statistics: this.statistics
        }
    }

    /**
     * Finds components using exact, contains, or regex matching.
     * @param {Record<string, any>} [criteria] Component criteria.
     * @param {Record<string, any>} [options] Paging options.
     * @returns {object[]} Matching component records.
     */
    findComponents(criteria = {}, options = {}) {
        return this.#find('components', criteria, options)
    }

    /**
     * Finds nets using exact, contains, or regex matching.
     * @param {Record<string, any>} [criteria] Net criteria.
     * @param {Record<string, any>} [options] Paging options.
     * @returns {object[]} Matching net records.
     */
    findNets(criteria = {}, options = {}) {
        return this.#find('nets', criteria, options)
    }

    /**
     * Traverses stable source connectivity from canonical source ids.
     * @param {Record<string, any>} request Starting source ids.
     * @param {Record<string, any>} [options] Traversal bounds.
     * @returns {object[]} Ordered connectivity records.
     */
    traceConnectivity(request, options = {}) {
        const start = QueryService.#startRequest(request)
        const bounds = QueryService.#traversalOptions(options)
        const graph = this.#context.getOrCreateDerived(
            'query',
            'traversal-v1',
            () => CircuitTraversal.prepare(this.#netlist)
        )
        return CircuitTraversal.trace(graph, start, bounds)
    }

    /**
     * Returns a detached canonical query netlist.
     * @param {Record<string, any>} [options] Reserved build options.
     * @returns {Record<string, any>} Clone-safe netlist.
     */
    buildNetlist(options = {}) {
        QueryService.#record(options, new Set())
        return structuredClone(this.#netlist)
    }

    /**
     * Filters one stable record family.
     * @param {'components' | 'nets'} select Record family.
     * @param {Record<string, any>} criteria Match criteria.
     * @param {Record<string, any>} options Paging options.
     * @returns {object[]} Detached matching rows.
     */
    #find(select, criteria, options) {
        const fields = select === 'components' ? COMPONENT_FIELDS : NET_FIELDS
        const matcher = QueryService.#matcher(criteria, fields)
        const paging = QueryService.#paging(options)
        const source =
            select === 'components'
                ? this.#netlist.components
                : this.#netlist.nets
        return structuredClone(
            source
                .filter((row) => QueryService.#matches(row, matcher, fields))
                .slice(paging.offset, paging.offset + paging.limit)
        )
    }

    /**
     * Normalizes safe matching criteria.
     * @param {unknown} criteria Criteria candidate.
     * @param {Set<string>} fields Allowed row fields.
     * @returns {Record<string, any>} Matcher state.
     */
    static #matcher(criteria, fields) {
        const normalized = QueryService.#record(criteria, CRITERIA_KEYS)
        const pattern =
            normalized.pattern === undefined ? '' : normalized.pattern
        if (typeof pattern !== 'string' || pattern.length > 4096) {
            throw QueryService.#error('Query pattern must be a bounded string.')
        }
        const match =
            normalized.match === undefined ? 'contains' : normalized.match
        if (!['exact', 'contains', 'regex'].includes(match)) {
            throw QueryService.#error(
                'Query match must be exact, contains, or regex.'
            )
        }
        const field = normalized.field
        if (
            field !== undefined &&
            (typeof field !== 'string' || !fields.has(field))
        ) {
            throw QueryService.#error(
                'Query field is unavailable for this selection.'
            )
        }
        if (
            normalized.caseSensitive !== undefined &&
            typeof normalized.caseSensitive !== 'boolean'
        ) {
            throw QueryService.#error('Query caseSensitive must be boolean.')
        }
        const flags = normalized.flags === undefined ? '' : normalized.flags
        if (typeof flags !== 'string') {
            throw QueryService.#error('Query regex flags must be a string.')
        }
        return {
            pattern,
            match,
            field,
            caseSensitive: normalized.caseSensitive === true,
            regex:
                match === 'regex'
                    ? RegexPattern.compile(pattern, flags, {
                          caseSensitive: normalized.caseSensitive === true
                      })
                    : null
        }
    }

    /**
     * Tests one row against normalized criteria.
     * @param {Record<string, any>} row Query row.
     * @param {Record<string, any>} matcher Matcher state.
     * @param {Set<string>} fields Searchable fields.
     * @returns {boolean} Whether the row matches.
     */
    static #matches(row, matcher, fields) {
        if (!matcher.pattern) return true
        const values = matcher.field
            ? [row[matcher.field]]
            : [...fields].map((field) => row[field])
        return values
            .filter(
                (value) =>
                    typeof value === 'string' || typeof value === 'number'
            )
            .some((value) => {
                if (matcher.regex)
                    return RegexPattern.test(matcher.regex, value)
                const candidate = String(value)
                const pattern = matcher.pattern
                const normalizedCandidate = matcher.caseSensitive
                    ? candidate
                    : candidate.toLocaleLowerCase('en-US')
                const normalizedPattern = matcher.caseSensitive
                    ? pattern
                    : pattern.toLocaleLowerCase('en-US')
                return matcher.match === 'exact'
                    ? normalizedCandidate === normalizedPattern
                    : normalizedCandidate.includes(normalizedPattern)
            })
    }

    /**
     * Normalizes bounded result paging.
     * @param {unknown} options Paging options.
     * @returns {{ limit: number, offset: number }} Paging bounds.
     */
    static #paging(options) {
        const normalized = QueryService.#record(
            options,
            new Set(['limit', 'offset'])
        )
        const limit = normalized.limit === undefined ? 10000 : normalized.limit
        const offset = normalized.offset === undefined ? 0 : normalized.offset
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) {
            throw QueryService.#error(
                'Query limit must be an integer from 1 through 10000.'
            )
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw QueryService.#error(
                'Query offset must be a non-negative safe integer.'
            )
        }
        return { limit, offset }
    }

    /**
     * Normalizes one connectivity start request.
     * @param {unknown} request Request candidate.
     * @returns {Record<string, string>} Starting ids.
     */
    static #startRequest(request) {
        const keys = new Set([
            'sourceTraceId',
            'sourceComponentId',
            'sourcePortId',
            'sourceNetId'
        ])
        const normalized = QueryService.#record(request, keys)
        const result = {}
        for (const key of keys) {
            if (normalized[key] === undefined) continue
            if (
                typeof normalized[key] !== 'string' ||
                !normalized[key].trim()
            ) {
                throw QueryService.#error(
                    'Connectivity source ids must be non-empty strings.'
                )
            }
            result[key] = normalized[key].trim()
        }
        if (!Object.keys(result).length) {
            throw QueryService.#error(
                'Connectivity traversal requires a canonical source id.'
            )
        }
        return result
    }

    /**
     * Normalizes traversal work limits.
     * @param {unknown} options Traversal options.
     * @returns {{ maxDepth: number, maxResults: number }} Work bounds.
     */
    static #traversalOptions(options) {
        const normalized = QueryService.#record(
            options,
            new Set(['maxDepth', 'maxResults'])
        )
        const maxDepth =
            normalized.maxDepth === undefined ? 64 : normalized.maxDepth
        const maxResults =
            normalized.maxResults === undefined ? 10000 : normalized.maxResults
        if (
            !Number.isSafeInteger(maxDepth) ||
            maxDepth < 0 ||
            maxDepth > 1024
        ) {
            throw QueryService.#error(
                'Connectivity maxDepth must be an integer from 0 through 1024.'
            )
        }
        if (
            !Number.isSafeInteger(maxResults) ||
            maxResults < 1 ||
            maxResults > 10000
        ) {
            throw QueryService.#error(
                'Connectivity maxResults must be an integer from 1 through 10000.'
            )
        }
        return { maxDepth, maxResults }
    }

    /**
     * Reads a plain record through own data properties only.
     * @param {unknown} value Record candidate.
     * @param {Set<string>} allowedKeys Allowed own keys.
     * @returns {Record<string, any>} Safe shallow record.
     */
    static #record(value, allowedKeys) {
        try {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                throw QueryService.#error(
                    'Query arguments must be plain objects.'
                )
            }
            const prototype = Object.getPrototypeOf(value)
            if (prototype !== Object.prototype && prototype !== null) {
                throw QueryService.#error(
                    'Query arguments must be plain objects.'
                )
            }
            const descriptors = Object.getOwnPropertyDescriptors(value)
            const result = {}
            for (const key of Reflect.ownKeys(descriptors)) {
                const descriptor = descriptors[key]
                if (
                    typeof key !== 'string' ||
                    !allowedKeys.has(key) ||
                    descriptor.get ||
                    descriptor.set ||
                    descriptor.enumerable !== true
                ) {
                    throw QueryService.#error(
                        'Query arguments contain an unsupported field.'
                    )
                }
                result[key] = descriptor.value
            }
            return result
        } catch (error) {
            if (error instanceof ToolkitError) throw error
            throw QueryService.#error(
                'Query arguments could not be inspected safely.',
                error
            )
        }
    }

    /**
     * Normalizes construction failures into the public query boundary.
     * @param {unknown} error Failure candidate.
     * @returns {ToolkitError} Typed query error.
     */
    static #from(error) {
        return error instanceof ToolkitError
            ? error
            : QueryService.#error(
                  error?.message || 'Query service preparation failed.',
                  error
              )
    }

    /**
     * Creates one stable query request error.
     * @param {string} message Failure message.
     * @param {unknown} [cause] Native cause.
     * @returns {ToolkitError} Typed query error.
     */
    static #error(message, cause) {
        return new ToolkitError(message, {
            code: 'ERR_QUERY_REQUEST',
            category: 'validation',
            format: 'circuitjson',
            cause
        })
    }
}
