import { CircuitJsonDocumentContext } from '../core/context/CircuitJsonDocumentContext.mjs'
import { CanonicalBomRows } from '../core/rendering/CanonicalBomRows.mjs'
import { CanonicalBomOrder } from '../core/rendering/CanonicalBomOrder.mjs'
import { CanonicalRenderOptions } from '../core/rendering/CanonicalRenderOptions.mjs'
import { SafeXmlText } from './SafeXmlText.mjs'

const PREPARED_BOM_ROWS = new WeakMap()
const PREPARED_BOM_TABLES = new WeakMap()

/**
 * Renders canonical grouped BOM data as deterministic HTML.
 */
export class BomTableRenderer {
    /**
     * Renders a DocumentInput or existing grouped BOM rows.
     * @param {unknown} document DocumentInput or grouped BOM rows.
     * @param {Record<string, any>} [options] Canonical render options.
     * @returns {string} Deterministic BOM HTML.
     */
    static render(document, options = {}) {
        const normalized = CanonicalRenderOptions.normalize(options)
        CanonicalRenderOptions.requireCanonicalFidelity(normalized.fidelity)
        const legacyRows = BomTableRenderer.#legacyRows(document)
        if (legacyRows) {
            return BomTableRenderer.#renderRows(legacyRows)
        }
        const context = CircuitJsonDocumentContext.prepare(document)
        const rows = context.getOrCreateDerived('render', 'bom-rows-v1', () => {
            const built = CanonicalBomRows.build(context.model)
            BomTableRenderer.#freeze(built)
            PREPARED_BOM_ROWS.set(built, context)
            return built
        })
        if (!Array.isArray(rows) || PREPARED_BOM_ROWS.get(rows) !== context) {
            throw CanonicalRenderOptions.error(
                'BOM rendering encountered a derived-row cache collision.'
            )
        }
        const table = context.getOrCreateDerived(
            'render',
            'bom-table-v1',
            () => {
                const entry = Object.freeze({
                    html: BomTableRenderer.#renderRows(rows)
                })
                PREPARED_BOM_TABLES.set(entry, context)
                return entry
            }
        )
        if (
            !table ||
            typeof table !== 'object' ||
            PREPARED_BOM_TABLES.get(table) !== context
        ) {
            throw CanonicalRenderOptions.error(
                'BOM rendering encountered a derived-table cache collision.'
            )
        }
        return table.html
    }

    /**
     * Copies a legacy grouped-row input through safe own data descriptors.
     * @param {unknown} value Input candidate.
     * @returns {object[] | null} Safe grouped rows or null for DocumentInput.
     */
    static #legacyRows(value) {
        const entries = BomTableRenderer.#arrayEntries(value)
        if (!entries?.length) return null
        const descriptors = entries.map((row) =>
            BomTableRenderer.#rowDescriptors(row)
        )
        if (descriptors.some((row) => row?.type)) return null
        if (descriptors.some((row) => !row)) return null
        return descriptors
            .map((row) => BomTableRenderer.#copyRow(row))
            .sort(CanonicalBomOrder.compareRows)
    }

    /**
     * Copies top-level array entries through own data descriptors.
     * @param {unknown} value Array candidate.
     * @returns {unknown[] | null} Safe entries or null.
     */
    static #arrayEntries(value) {
        let isArray
        let descriptors
        try {
            isArray = Array.isArray(value)
            if (!isArray || Object.getPrototypeOf(value) !== Array.prototype) {
                return null
            }
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            return null
        }
        const length = descriptors.length?.value
        if (!Number.isSafeInteger(length) || length < 0 || length > 1000000) {
            return null
        }
        const result = []
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (!descriptor || descriptor.get || descriptor.set) {
                throw CanonicalRenderOptions.error(
                    'BOM input arrays must contain only plain data entries.'
                )
            }
            result.push(descriptor.value)
        }
        return result
    }

    /**
     * Inspects one possible legacy row without reading its fields.
     * @param {unknown} row Row candidate.
     * @returns {Record<string, PropertyDescriptor> | null} Descriptors or null.
     */
    static #rowDescriptors(row) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return null
        try {
            const prototype = Object.getPrototypeOf(row)
            if (prototype !== Object.prototype && prototype !== null)
                return null
            return Object.getOwnPropertyDescriptors(row)
        } catch {
            return null
        }
    }

    /**
     * Copies and validates one legacy grouped BOM row.
     * @param {Record<string, PropertyDescriptor>} descriptors Row descriptors.
     * @returns {object} Safe grouped row.
     */
    static #copyRow(descriptors) {
        for (const descriptor of Object.values(descriptors)) {
            if (descriptor.get || descriptor.set) {
                throw CanonicalRenderOptions.error(
                    'BOM rows must contain only plain data fields.'
                )
            }
        }
        const designators = BomTableRenderer.#stringArray(
            descriptors.designators?.value
        )
        if (!designators?.length) {
            throw CanonicalRenderOptions.error(
                'BOM rows require a non-empty designators array.'
            )
        }
        const quantity = descriptors.quantity?.value
        if (
            quantity !== undefined &&
            (!Number.isSafeInteger(quantity) || quantity < 0)
        ) {
            throw CanonicalRenderOptions.error(
                'BOM row quantity must be a nonnegative integer.'
            )
        }
        return {
            designators: [...new Set(designators)].sort(
                CanonicalBomOrder.compareDesignators
            ),
            quantity: quantity ?? designators.length,
            value: BomTableRenderer.#scalar(descriptors.value?.value),
            pattern: BomTableRenderer.#scalar(descriptors.pattern?.value),
            source: BomTableRenderer.#scalar(descriptors.source?.value)
        }
    }

    /**
     * Copies a dense plain string array without indexed property reads.
     * @param {unknown} value Array candidate.
     * @returns {string[] | null} Safe string array.
     */
    static #stringArray(value) {
        let descriptors
        try {
            if (!Array.isArray(value)) return null
            if (Object.getPrototypeOf(value) !== Array.prototype) return null
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            return null
        }
        const length = descriptors.length?.value
        if (!Number.isSafeInteger(length) || length < 1 || length > 4096) {
            return null
        }
        const result = []
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                descriptor.get ||
                descriptor.set ||
                typeof descriptor.value !== 'string' ||
                !descriptor.value.trim()
            ) {
                return null
            }
            result.push(descriptor.value.trim())
        }
        return result
    }

    /**
     * Normalizes an optional primitive BOM display value.
     * @param {unknown} value Value candidate.
     * @returns {string | number | boolean} Safe scalar.
     */
    static #scalar(value) {
        if (value === undefined || value === null) return ''
        if (!['string', 'number', 'boolean'].includes(typeof value)) {
            throw CanonicalRenderOptions.error(
                'BOM row display fields must be scalar values.'
            )
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw CanonicalRenderOptions.error(
                'BOM row display fields must be finite.'
            )
        }
        return value
    }

    /**
     * Iteratively freezes renderer-owned BOM rows without recursion limits.
     * @param {unknown} value Renderer-owned value.
     * @returns {unknown} Frozen value.
     */
    static #freeze(value) {
        const pending = [value]
        const visited = new WeakSet()
        while (pending.length) {
            const current = pending.pop()
            if (
                !current ||
                typeof current !== 'object' ||
                visited.has(current)
            ) {
                continue
            }
            visited.add(current)
            for (const descriptor of Object.values(
                Object.getOwnPropertyDescriptors(current)
            )) {
                if ('value' in descriptor) pending.push(descriptor.value)
            }
            Object.freeze(current)
        }
        return value
    }

    /**
     * Renders normalized grouped rows.
     * @param {object[]} rows Grouped BOM rows.
     * @returns {string} Deterministic BOM HTML.
     */
    static #renderRows(rows) {
        if (!rows.length) {
            return '<section class="bom-empty">No BOM rows recovered.</section>'
        }
        return (
            '<table class="bom-table"><thead><tr>' +
            '<th>Designators</th><th>Qty</th><th>Value</th><th>Pattern</th><th>Source</th>' +
            '</tr></thead><tbody>' +
            rows.map((row) => BomTableRenderer.#renderRow(row)).join('') +
            '</tbody></table>'
        )
    }

    /**
     * Renders one escaped BOM row.
     * @param {object} row Grouped BOM row.
     * @returns {string} Table row HTML.
     */
    static #renderRow(row) {
        return (
            '<tr><td>' +
            BomTableRenderer.#escape((row.designators || []).join(', ')) +
            '</td><td>' +
            BomTableRenderer.#escape(
                row.quantity ?? row.designators?.length ?? 0
            ) +
            '</td><td>' +
            BomTableRenderer.#escape(row.value ?? '') +
            '</td><td>' +
            BomTableRenderer.#escape(row.pattern ?? '') +
            '</td><td>' +
            BomTableRenderer.#escape(row.source ?? '') +
            '</td></tr>'
        )
    }

    /**
     * Escapes HTML text.
     * @param {unknown} value Raw value.
     * @returns {string} Escaped text.
     */
    static #escape(value) {
        return SafeXmlText.escape(value)
    }
}
