import { ToolkitError } from '../contracts/ToolkitError.mjs'

const NODE_SIZE = 16

/**
 * Builds a deterministic packed spatial index over millimeter bounds.
 */
export class PcbSpatialIndex {
    #nodeCount
    #recordCount
    #root

    /**
     * Creates an immutable packed index from source-toolkit records.
     * @param {unknown} records Records with stable ids and bounds.
     * @returns {PcbSpatialIndex} Spatial index.
     */
    static create(records) {
        if (!Array.isArray(records)) {
            throw PcbSpatialIndex.#recordError(
                'Spatial index records must be an array.'
            )
        }
        const entries = PcbSpatialIndex.#entries(records)
        const packed = PcbSpatialIndex.#pack(entries)
        return new PcbSpatialIndex(packed.root, entries.length, packed.nodes)
    }

    /**
     * Creates one prepared spatial index instance.
     * @param {object | null} root Packed root node.
     * @param {number} recordCount Record count.
     * @param {number} nodeCount Node count.
     */
    constructor(root, recordCount, nodeCount) {
        this.#root = root
        this.#recordCount = recordCount
        this.#nodeCount = nodeCount
    }

    /**
     * Returns records whose bounds overlap a point tolerance square.
     * @param {unknown} point Millimeter point.
     * @param {unknown} [tolerance] Nonnegative tolerance.
     * @returns {object[]} Candidate source records in stable source order.
     */
    candidates(point, tolerance = 0) {
        const normalizedPoint = PcbSpatialIndex.#point(point)
        if (
            typeof tolerance !== 'number' ||
            !Number.isFinite(tolerance) ||
            tolerance < 0
        ) {
            throw PcbSpatialIndex.#queryError(
                'Spatial query tolerance must be a nonnegative finite number.'
            )
        }
        return this.search({
            minX: normalizedPoint.x - tolerance,
            minY: normalizedPoint.y - tolerance,
            maxX: normalizedPoint.x + tolerance,
            maxY: normalizedPoint.y + tolerance
        })
    }

    /**
     * Returns records whose bounds intersect one search rectangle.
     * @param {unknown} bounds Millimeter search bounds.
     * @returns {object[]} Candidate source records in stable source order.
     */
    search(bounds) {
        const query = PcbSpatialIndex.#bounds(bounds, 'query')
        if (!this.#root) return []
        const matches = []
        const stack = [this.#root]
        while (stack.length) {
            const node = stack.pop()
            if (!PcbSpatialIndex.#intersects(node.bounds, query)) continue
            if (node.entries) {
                for (const entry of node.entries) {
                    if (PcbSpatialIndex.#intersects(entry.bounds, query)) {
                        matches.push(entry)
                    }
                }
                continue
            }
            for (let index = node.children.length - 1; index >= 0; index -= 1) {
                stack.push(node.children[index])
            }
        }
        return matches
            .sort((left, right) => left.order - right.order)
            .map((entry) => entry.record)
    }

    /**
     * Returns clone-safe index construction statistics.
     * @returns {{ records: number, nodes: number }} Index statistics.
     */
    get statistics() {
        return { records: this.#recordCount, nodes: this.#nodeCount }
    }

    /**
     * Normalizes source records and rejects duplicate ids.
     * @param {object[]} records Record candidates.
     * @returns {object[]} Packed entries.
     */
    static #entries(records) {
        const ids = new Set()
        return records.map((record, order) => {
            const fields = PcbSpatialIndex.#recordFields(record)
            const id = fields.id
            if (typeof id !== 'string' || !id.trim() || ids.has(id)) {
                throw PcbSpatialIndex.#recordError(
                    'Spatial index record ids must be non-empty and unique.'
                )
            }
            ids.add(id)
            return {
                id,
                order,
                record,
                bounds: PcbSpatialIndex.#bounds(fields.bounds, 'record')
            }
        })
    }

    /**
     * Reads required own record fields without invoking accessors.
     * @param {unknown} record Record candidate.
     * @returns {{ id: unknown, bounds: unknown }} Record fields.
     */
    static #recordFields(record) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw PcbSpatialIndex.#recordError(
                'Spatial index records must be plain objects.'
            )
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(record)
            descriptors = Object.getOwnPropertyDescriptors(record)
        } catch {
            throw PcbSpatialIndex.#recordError(
                'Spatial index record could not be inspected safely.'
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw PcbSpatialIndex.#recordError(
                'Spatial index records must be plain objects.'
            )
        }
        const id = PcbSpatialIndex.#dataValue(descriptors.id)
        const bounds = PcbSpatialIndex.#dataValue(descriptors.bounds)
        if (id === undefined || bounds === undefined) {
            throw PcbSpatialIndex.#recordError(
                'Spatial index records require own id and bounds fields.'
            )
        }
        return { id, bounds }
    }

    /**
     * Returns a safe own data value or undefined.
     * @param {PropertyDescriptor | undefined} descriptor Field descriptor.
     * @returns {unknown} Data value.
     */
    static #dataValue(descriptor) {
        return descriptor && !descriptor.get && !descriptor.set
            ? descriptor.value
            : undefined
    }

    /**
     * Normalizes a point through own data descriptors.
     * @param {unknown} point Point candidate.
     * @returns {{ x: number, y: number }} Normalized point.
     */
    static #point(point) {
        const fields = PcbSpatialIndex.#plainFields(point, ['x', 'y'], 'query')
        if (![fields.x, fields.y].every(PcbSpatialIndex.#finite)) {
            throw PcbSpatialIndex.#queryError(
                'Spatial query point requires finite x and y numbers.'
            )
        }
        return { x: fields.x, y: fields.y }
    }

    /**
     * Normalizes rectangle bounds through own data descriptors.
     * @param {unknown} bounds Bounds candidate.
     * @param {'query' | 'record'} kind Error category.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static #bounds(bounds, kind) {
        const names = ['minX', 'minY', 'maxX', 'maxY']
        const fields = PcbSpatialIndex.#plainFields(bounds, names, kind)
        if (
            !names.every((name) => PcbSpatialIndex.#finite(fields[name])) ||
            fields.minX > fields.maxX ||
            fields.minY > fields.maxY
        ) {
            const error =
                kind === 'record'
                    ? PcbSpatialIndex.#recordError
                    : PcbSpatialIndex.#queryError
            throw error('Spatial bounds must contain ordered finite numbers.')
        }
        return Object.fromEntries(names.map((name) => [name, fields[name]]))
    }

    /**
     * Reads named own fields from a plain object without accessors.
     * @param {unknown} value Object candidate.
     * @param {string[]} names Required names.
     * @param {'query' | 'record'} kind Error category.
     * @returns {Record<string, any>} Safe field values.
     */
    static #plainFields(value, names, kind) {
        const error =
            kind === 'record'
                ? PcbSpatialIndex.#recordError
                : PcbSpatialIndex.#queryError
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw error('Spatial values must be plain objects.')
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw error('Spatial value could not be inspected safely.')
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw error('Spatial values must be plain objects.')
        }
        const result = {}
        for (const name of names) {
            const entry = PcbSpatialIndex.#dataValue(descriptors[name])
            if (entry === undefined) {
                throw error('Spatial value is missing a required data field.')
            }
            result[name] = entry
        }
        return result
    }

    /**
     * Packs entries into Morton-ordered fixed-fanout nodes.
     * @param {object[]} entries Normalized entries.
     * @returns {{ root: object | null, nodes: number }} Packed tree.
     */
    static #pack(entries) {
        if (!entries.length) return { root: null, nodes: 0 }
        const bounds = PcbSpatialIndex.#mergeBounds(entries)
        let level = [...entries]
            .map((entry) => ({
                ...entry,
                morton: PcbSpatialIndex.#morton(entry.bounds, bounds)
            }))
            .sort(
                (left, right) =>
                    left.morton - right.morton ||
                    PcbSpatialIndex.#compare(left.id, right.id) ||
                    left.order - right.order
            )
        let nodes = 0
        level = PcbSpatialIndex.#chunks(level, NODE_SIZE).map((chunk) => {
            nodes += 1
            return {
                bounds: PcbSpatialIndex.#mergeBounds(chunk),
                entries: chunk
            }
        })
        while (level.length > 1) {
            level = PcbSpatialIndex.#chunks(level, NODE_SIZE).map((chunk) => {
                nodes += 1
                return {
                    bounds: PcbSpatialIndex.#mergeBounds(chunk),
                    children: chunk
                }
            })
        }
        return { root: level[0], nodes }
    }

    /**
     * Computes a stable 32-bit Morton key for one bounds center.
     * @param {object} bounds Entry bounds.
     * @param {object} extent Global extent.
     * @returns {number} Unsigned Morton key.
     */
    static #morton(bounds, extent) {
        const width = extent.maxX - extent.minX || 1
        const height = extent.maxY - extent.minY || 1
        const x = Math.round(
            Math.max(
                0,
                Math.min(
                    65535,
                    (((bounds.minX + bounds.maxX) / 2 - extent.minX) / width) *
                        65535
                )
            )
        )
        const y = Math.round(
            Math.max(
                0,
                Math.min(
                    65535,
                    (((bounds.minY + bounds.maxY) / 2 - extent.minY) / height) *
                        65535
                )
            )
        )
        return (
            (PcbSpatialIndex.#spreadBits(x) |
                (PcbSpatialIndex.#spreadBits(y) << 1)) >>>
            0
        )
    }

    /**
     * Spreads 16 input bits across even positions of a 32-bit word.
     * @param {number} value Unsigned 16-bit value.
     * @returns {number} Spread unsigned word.
     */
    static #spreadBits(value) {
        let result = value & 0xffff
        result = (result | (result << 8)) & 0x00ff00ff
        result = (result | (result << 4)) & 0x0f0f0f0f
        result = (result | (result << 2)) & 0x33333333
        return (result | (result << 1)) & 0x55555555
    }

    /**
     * Merges entry or node bounds.
     * @param {object[]} values Entries or nodes.
     * @returns {object} Merged bounds.
     */
    static #mergeBounds(values) {
        return values.reduce(
            (result, value) => ({
                minX: Math.min(result.minX, value.bounds.minX),
                minY: Math.min(result.minY, value.bounds.minY),
                maxX: Math.max(result.maxX, value.bounds.maxX),
                maxY: Math.max(result.maxY, value.bounds.maxY)
            }),
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        )
    }

    /**
     * Splits a list into fixed-size chunks.
     * @param {object[]} values Values.
     * @param {number} size Chunk size.
     * @returns {object[][]} Chunks.
     */
    static #chunks(values, size) {
        const result = []
        for (let index = 0; index < values.length; index += size) {
            result.push(values.slice(index, index + size))
        }
        return result
    }

    /**
     * Returns whether two inclusive bounds overlap.
     * @param {object} left First bounds.
     * @param {object} right Second bounds.
     * @returns {boolean} Whether bounds intersect.
     */
    static #intersects(left, right) {
        return !(
            left.maxX < right.minX ||
            left.minX > right.maxX ||
            left.maxY < right.minY ||
            left.minY > right.maxY
        )
    }

    /**
     * Returns true only for finite primitive numbers.
     * @param {unknown} value Numeric candidate.
     * @returns {boolean} Whether value is finite.
     */
    static #finite(value) {
        return typeof value === 'number' && Number.isFinite(value)
    }

    /**
     * Compares stable ids by code point.
     * @param {string} left Left id.
     * @param {string} right Right id.
     * @returns {number} Ordering value.
     */
    static #compare(left, right) {
        return left < right ? -1 : left > right ? 1 : 0
    }

    /**
     * Creates a typed spatial-record error.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed error.
     */
    static #recordError(message) {
        return new ToolkitError(message, {
            code: 'ERR_SPATIAL_INDEX_RECORD',
            category: 'validation',
            format: 'circuitjson'
        })
    }

    /**
     * Creates a typed spatial-query error.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed error.
     */
    static #queryError(message) {
        return new ToolkitError(message, {
            code: 'ERR_SPATIAL_INDEX_QUERY',
            category: 'validation',
            format: 'circuitjson'
        })
    }
}
