import { CircuitJsonDocumentContext } from '../context/CircuitJsonDocumentContext.mjs'
import { PcbPrimitivePreparation } from '../context/PcbPrimitivePreparation.mjs'
import { ToolkitDiagnostic } from '../contracts/ToolkitDiagnostic.mjs'
import { CircuitJsonPcbPrimitiveFields } from '../CircuitJsonPcbPrimitiveFields.mjs'
import { CanonicalRenderOptions } from './CanonicalRenderOptions.mjs'

const COPPER_KINDS = new Set([
    'breakout-point',
    'copper-text',
    'pad',
    'route-hint',
    'thermal-spoke',
    'track',
    'via',
    'zone'
])
const VIRTUAL_LAYER_ORDER = [
    'top_silkscreen',
    'bottom_silkscreen',
    'top_fabrication',
    'bottom_fabrication',
    'top_courtyard',
    'bottom_courtyard',
    'top_soldermask',
    'bottom_soldermask',
    'top_paste',
    'bottom_paste',
    'keepouts',
    'cutouts',
    'panel',
    'breakout_points',
    'diagnostics',
    'groups',
    'anchor_offsets',
    'trace_lengths',
    'ratsnest'
]
const VIRTUAL_LAYER_IDS = new Set(VIRTUAL_LAYER_ORDER)
const PREPARED_PLANS = new WeakSet()

/**
 * Prepares one reusable CircuitJSON PCB primitive model and layer selection.
 */
export class PcbRenderPlan {
    /**
     * Prepares a render plan from any canonical DocumentInput.
     * @param {unknown} document DocumentResult, CircuitJSON model, or context.
     * @param {Record<string, any>} [options] Canonical PCB render options.
     * @returns {Record<string, any>} Prepared PCB render plan.
     */
    static prepare(document, options = {}) {
        const normalized = CanonicalRenderOptions.normalize(options, {
            layers: true,
            side: true,
            svg: true
        })
        CanonicalRenderOptions.requireCanonicalFidelity(normalized.fidelity)
        const context = CircuitJsonDocumentContext.prepare(document)
        const model = PcbPrimitivePreparation.prepareComplete(context)
        const availableLayers = PcbRenderPlan.#layers(model)
        const byId = new Map(availableLayers.map((layer) => [layer.id, layer]))
        const selectedIds = normalized.layers
        if (selectedIds) {
            const missing = selectedIds.filter((id) => !byId.has(id))
            if (missing.length) {
                throw CanonicalRenderOptions.error(
                    `Unknown render layers: ${missing.join(', ')}.`
                )
            }
            const wrongSide = selectedIds.filter((id) => {
                const side = byId.get(id).side
                return side === 'top' || side === 'bottom'
                    ? side !== normalized.side
                    : false
            })
            if (wrongSide.length) {
                throw CanonicalRenderOptions.error(
                    `Render layers do not belong to side ${normalized.side}: ${wrongSide.join(', ')}.`
                )
            }
        }
        const layers = (
            selectedIds ||
            PcbRenderPlan.#defaultLayerIds(availableLayers, normalized.side)
        ).map((id) => byId.get(id))
        const statistics = context.statistics
        const diagnostics = (model.diagnostics || []).map((row) =>
            ToolkitDiagnostic.create({
                code: row.code || row.type || row.id || 'PCB_RENDER_DIAGNOSTIC',
                severity: row.severity || 'warning',
                message: row.message || '',
                source: context.source.fileName || '',
                details: row
            })
        )
        const plan = {
            schema: 'ecad-toolkit.pcb-render-plan.v1',
            model,
            side: normalized.side,
            fidelity: normalized.fidelity,
            svg: normalized.svg,
            layers,
            selectedLayerIds: selectedIds ? [...selectedIds] : null,
            diagnostics,
            statistics: {
                validationPasses: statistics.validationPasses,
                primitiveBuilds:
                    statistics.derivedBuilds['render:pcb-primitives-v1'] || 0
            }
        }
        PcbRenderPlan.#freeze(plan)
        PREPARED_PLANS.add(plan)
        return plan
    }

    /**
     * Requires a genuine immutable plan created by this module.
     * @param {unknown} plan Prepared-plan candidate.
     * @returns {Record<string, any>} Branded render plan.
     * @internal
     */
    static requirePrepared(plan) {
        if (!plan || typeof plan !== 'object' || !PREPARED_PLANS.has(plan)) {
            throw CanonicalRenderOptions.error(
                'Prepared PCB rendering requires an immutable render plan.'
            )
        }
        return plan
    }

    /**
     * Returns a filtered primitive-model view for selected canonical layers.
     * @param {Record<string, any>} plan Prepared render plan.
     * @param {string[] | null} [layerIds] Canonical layer ids.
     * @returns {Record<string, any>} Full or layer-filtered primitive model.
     */
    static modelForLayers(plan, layerIds = plan.selectedLayerIds) {
        PcbRenderPlan.requirePrepared(plan)
        if (!layerIds) return plan.model
        const ids = new Set(layerIds)
        const descriptors = new Map(
            plan.layers.map((layer) => [layer.id, layer])
        )
        const selected = layerIds
            .map((id) => descriptors.get(id))
            .filter(Boolean)
        const copperLayers = new Set(
            selected
                .filter((layer) => layer.type === 'copper')
                .map((layer) => layer.sourceLayerId)
        )
        const virtualLayers = new Set(
            selected
                .filter((layer) => layer.type !== 'copper')
                .map((layer) => layer.id)
        )
        const primitives = (plan.model.primitives || []).filter(
            (primitive) =>
                primitive.kind === 'board' ||
                (COPPER_KINDS.has(primitive.kind) &&
                    (copperLayers.has(primitive.layer) ||
                        (primitive.kind === 'via' &&
                            !primitive.side &&
                            PcbRenderPlan.#viaTouchesLayers(
                                primitive,
                                copperLayers,
                                plan.model.layers || []
                            )))) ||
                virtualLayers.has(
                    PcbRenderPlan.#primitiveVirtualLayerId(primitive)
                )
        )
        return {
            ...plan.model,
            layers: (plan.model.layers || []).filter((layer) =>
                selected.some(
                    (candidate) =>
                        candidate.type === 'copper' &&
                        candidate.sourceLayerId === layer.id
                )
            ),
            virtualLayers: selected.filter((layer) => layer.type !== 'copper'),
            components: [],
            primitives,
            anchors: [],
            diagnostics: ids.has('diagnostics')
                ? plan.model.diagnostics || []
                : [],
            airwires: ids.has('ratsnest') ? plan.model.airwires || [] : [],
            traceLengths: ids.has('trace_lengths')
                ? plan.model.traceLengths || []
                : [],
            groups: ids.has('groups') ? plan.model.groups || [] : [],
            anchorOffsets: ids.has('anchor_offsets')
                ? plan.model.anchorOffsets || []
                : []
        }
    }

    /**
     * Builds canonical physical and virtual layer descriptors.
     * @param {Record<string, any>} model Primitive model.
     * @returns {object[]} Canonical layer descriptors.
     */
    static #layers(model) {
        const physical = (model.layers || []).map((layer) => ({
            ...layer,
            id: `${layer.id}_copper`,
            key: `${layer.id}_copper`,
            sourceLayerId: layer.id,
            type: 'copper'
        }))
        const reservedIds = new Set(physical.map((layer) => layer.id))
        const byId = new Map()
        for (const layer of model.virtualLayers || []) {
            const id = String(layer.id || layer.key || '')
            if (
                !VIRTUAL_LAYER_IDS.has(id) ||
                reservedIds.has(id) ||
                byId.has(id)
            ) {
                continue
            }
            byId.set(id, {
                ...layer,
                id,
                key: id,
                side: PcbRenderPlan.#layerSide(id) || layer.side,
                sourceLayerId: id
            })
        }
        for (const primitive of model.primitives || []) {
            const id = PcbRenderPlan.#primitiveVirtualLayerId(primitive)
            if (
                !VIRTUAL_LAYER_IDS.has(id) ||
                reservedIds.has(id) ||
                byId.has(id)
            ) {
                continue
            }
            byId.set(id, {
                id,
                key: id,
                layer: id,
                name: id,
                side: PcbRenderPlan.#layerSide(id),
                type: 'drawing',
                sourceFormat: 'circuitjson',
                sourceLayerId: id
            })
        }
        const virtual = [
            ...VIRTUAL_LAYER_ORDER.filter((id) => byId.has(id)).map((id) =>
                byId.get(id)
            ),
            ...[...byId]
                .filter(([id]) => !VIRTUAL_LAYER_ORDER.includes(id))
                .sort(([left], [right]) =>
                    left < right ? -1 : left > right ? 1 : 0
                )
                .map(([_id, layer]) => layer)
        ]
        return [...physical, ...virtual]
    }

    /**
     * Resolves a canonical virtual layer id from primitive kind and side.
     * @param {object} primitive PCB primitive.
     * @returns {string} Canonical virtual layer id or an empty string.
     */
    static #primitiveVirtualLayerId(primitive) {
        const kind = String(primitive.kind || '')
        if (
            ['silkscreen', 'silkscreen_line', 'silkscreen_text'].includes(kind)
        ) {
            return `${PcbRenderPlan.#primitiveSide(primitive)}_silkscreen`
        }
        if (['fabrication', 'note', 'dimension'].includes(kind)) {
            return `${PcbRenderPlan.#primitiveSide(primitive)}_fabrication`
        }
        if (kind === 'courtyard') {
            return `${PcbRenderPlan.#primitiveSide(primitive)}_courtyard`
        }
        if (kind === 'solder-mask') {
            return `${PcbRenderPlan.#primitiveSide(primitive)}_soldermask`
        }
        if (kind === 'solder-paste') {
            return `${PcbRenderPlan.#primitiveSide(primitive)}_paste`
        }
        if (kind === 'keepout') return 'keepouts'
        if (kind === 'cutout') return 'cutouts'
        if (kind === 'panel') return 'panel'
        if (kind === 'breakout-point') return 'breakout_points'
        if (kind === 'board') return ''
        const layer = String(primitive.layer || '')
        return /^(?:top|bottom|inner\d+)$/u.test(layer) ? '' : layer
    }

    /**
     * Resolves a primitive surface without changing the legacy primitive model.
     * @param {object} primitive PCB primitive.
     * @returns {'top' | 'bottom'} Canonical surface.
     */
    static #primitiveSide(primitive) {
        if (primitive.side === 'bottom' || primitive.side === 'top') {
            return primitive.side
        }
        return PcbRenderPlan.#layerSide(primitive.layer) || 'top'
    }

    /**
     * Resolves a side from physical or canonical virtual layer ids.
     * @param {unknown} layer Layer candidate.
     * @returns {'top' | 'bottom' | ''} Surface or empty string.
     */
    static #layerSide(layer) {
        const value = String(layer || '').toLowerCase()
        if (value === 'top' || value.startsWith('top_')) return 'top'
        if (value === 'bottom' || value.startsWith('bottom_')) return 'bottom'
        return ''
    }

    /**
     * Resolves default layers compatible with one side.
     * @param {object[]} layers Available layers.
     * @param {'top' | 'bottom'} side Requested side.
     * @returns {string[]} Default layer ids.
     */
    static #defaultLayerIds(layers, side) {
        return layers
            .filter(
                (layer) =>
                    !['top', 'bottom'].includes(layer.side) ||
                    layer.side === side
            )
            .map((layer) => layer.id)
    }

    /**
     * Returns whether a drilled primitive spans any selected copper layer.
     * @param {object} primitive Via-like primitive.
     * @param {Set<string>} selectedLayers Selected physical layer ids.
     * @param {object[]} physicalLayers Ordered board copper layers.
     * @returns {boolean} Whether the via belongs in the layer view.
     */
    static #viaTouchesLayers(primitive, selectedLayers, physicalLayers) {
        if (!selectedLayers.size) return false
        const source = primitive.sourceRoute || primitive.source || {}
        const declared = Array.isArray(source.layers)
            ? source.layers
                  .map(CircuitJsonPcbPrimitiveFields.layer)
                  .filter(Boolean)
            : []
        const from = CircuitJsonPcbPrimitiveFields.layer(
            declared.length
                ? declared[0]
                : (source.from_layer ?? source.fromLayer)
        )
        const to = CircuitJsonPcbPrimitiveFields.layer(
            declared.length
                ? declared.at(-1)
                : (source.to_layer ?? source.toLayer)
        )
        if (!from && !to) return true
        const ordered = physicalLayers.map((layer) => String(layer.id || ''))
        const start = ordered.indexOf(from || to)
        const end = ordered.indexOf(to || from)
        if (start < 0 || end < 0) {
            return [from, to, ...declared].some((layer) =>
                selectedLayers.has(layer)
            )
        }
        const minimum = Math.min(start, end)
        const maximum = Math.max(start, end)
        for (let index = minimum; index <= maximum; index += 1) {
            if (selectedLayers.has(ordered[index])) return true
        }
        return false
    }

    /**
     * Deep-freezes one cyclic primitive graph before it enters context cache.
     * @param {any} value Value to freeze.
     * @returns {any} Frozen value.
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
            if (current.value instanceof Map) {
                for (const [key, entry] of current.value) {
                    if (key && typeof key === 'object') {
                        pending.push({ value: key, expanded: false })
                    }
                    if (entry && typeof entry === 'object') {
                        pending.push({ value: entry, expanded: false })
                    }
                }
                continue
            }
            for (const descriptor of Object.values(
                Object.getOwnPropertyDescriptors(current.value)
            )) {
                if (
                    'value' in descriptor &&
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
}
