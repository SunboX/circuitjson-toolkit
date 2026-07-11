import { CircuitJsonDocument } from './CircuitJsonDocument.mjs'
import { CircuitJsonPcbPrimitiveBuilder } from './CircuitJsonPcbPrimitiveBuilder.mjs'
import { PcbInteractionBounds } from './interaction/PcbInteractionBounds.mjs'

/**
 * Builds renderer-neutral PCB primitives for element-array board documents.
 */
export class PcbInteractionPrimitiveModel {
    /**
     * Builds a normalized primitive model from a parsed PCB document.
     * @param {object | object[]} documentModel Parsed document model.
     * @returns {{ bounds: object, layers: object[], virtualLayers: object[], components: object[], nets: object[], primitives: object[], anchors: object[], diagnostics: object[], airwires: object[], traceLengths: object[], groups: object[], anchorOffsets: object[] }}
     */
    static build(documentModel) {
        if (
            !PcbInteractionPrimitiveModel.#isElementArrayDocument(documentModel)
        ) {
            return PcbInteractionPrimitiveModel.#emptyModel()
        }

        return CircuitJsonPcbPrimitiveBuilder.build(documentModel)
    }

    /**
     * Resolves physical and virtual PCB interaction layers.
     * @param {object | object[]} documentModel Parsed document model.
     * @returns {{ physicalLayers: object[], virtualLayers: object[] }}
     */
    static resolveLayerGroups(documentModel) {
        if (
            !PcbInteractionPrimitiveModel.#isElementArrayDocument(documentModel)
        ) {
            return { physicalLayers: [], virtualLayers: [] }
        }

        const model = CircuitJsonPcbPrimitiveBuilder.build(documentModel)
        return {
            physicalLayers: model.layers,
            virtualLayers: model.virtualLayers || []
        }
    }

    /**
     * Snaps a board point to the nearest primitive anchor within tolerance.
     * @param {object | object[]} documentModel Parsed document model.
     * @param {{ x?: unknown, y?: unknown }} point Board-space point.
     * @param {{ tolerance?: number }} [options] Snap options.
     * @returns {{ snapped: boolean, point: { x: number, y: number } }}
     */
    static resolveSnapPoint(documentModel, point, options = {}) {
        return PcbInteractionPrimitiveModel.resolveSnapPointFromModel(
            PcbInteractionPrimitiveModel.build(documentModel),
            point,
            options
        )
    }

    /**
     * Snaps against anchors from one already prepared primitive model.
     * @param {{ anchors?: object[] }} model Prepared primitive model.
     * @param {{ x?: unknown, y?: unknown }} point Board-space point.
     * @param {{ tolerance?: number }} [options] Snap options.
     * @returns {{ snapped: boolean, point: { x: number, y: number } }}
     */
    static resolveSnapPointFromModel(model, point, options = {}) {
        const normalizedPoint = PcbInteractionPrimitiveModel.#point(point)
        if (!normalizedPoint) return { snapped: false, point: { x: 0, y: 0 } }

        const tolerance = Math.max(
            PcbInteractionPrimitiveModel.#number(options.tolerance, 0),
            0
        )
        let bestPoint = null
        let bestDistanceSq = Infinity

        for (const anchor of model?.anchors || []) {
            const distanceSq = PcbInteractionPrimitiveModel.#distanceSquared(
                normalizedPoint,
                anchor.point
            )
            if (distanceSq < bestDistanceSq) {
                bestPoint = anchor.point
                bestDistanceSq = distanceSq
            }
        }

        if (!bestPoint || bestDistanceSq > tolerance * tolerance) {
            return { snapped: false, point: normalizedPoint }
        }

        return { snapped: true, point: { x: bestPoint.x, y: bestPoint.y } }
    }

    /**
     * Returns prioritized primitive hit candidates for one board point.
     * @param {object | object[]} documentModel Parsed document model.
     * @param {{ x?: unknown, y?: unknown }} point Board-space point.
     * @param {{ side?: 'top' | 'bottom', hiddenLayers?: string[], hiddenObjects?: string[], tolerance?: number }} [options] Hit-test options.
     * @returns {object[]}
     */
    static hitTest(documentModel, point, options = {}) {
        const model = PcbInteractionPrimitiveModel.build(documentModel)
        return PcbInteractionPrimitiveModel.hitTestPrimitives(
            model.primitives,
            point,
            options,
            model.groups
        )
    }

    /**
     * Applies the legacy exact narrow phase to prepared primitive candidates.
     * @param {object[]} primitives Prepared primitive candidates.
     * @param {{ x?: unknown, y?: unknown }} point Board-space point.
     * @param {{ side?: 'top' | 'bottom', hiddenLayers?: string[], hiddenObjects?: string[], tolerance?: number }} [options] Hit-test options.
     * @param {object[]} [groups] Prepared group rows.
     * @returns {object[]} Prioritized hit candidates.
     */
    static hitTestPrimitives(primitives, point, options = {}, groups = []) {
        return PcbInteractionPrimitiveModel.hitTestRecords(
            (primitives || []).map((primitive, index) => ({
                recordId: String(index),
                primitive
            })),
            point,
            options,
            groups
        ).map(({ recordId: _recordId, ...hit }) => hit)
    }

    /**
     * Applies the exact narrow phase while preserving a caller-owned stable
     * record identity independently from non-unique primitive ids.
     * @param {{ recordId: string, primitive: object }[]} records Prepared primitive records.
     * @param {{ x?: unknown, y?: unknown }} point Board-space point.
     * @param {{ side?: 'top' | 'bottom', hiddenLayers?: string[], hiddenObjects?: string[], tolerance?: number }} [options] Hit-test options.
     * @param {object[]} [groups] Prepared group rows.
     * @returns {object[]} Prioritized hits carrying their stable record ids.
     */
    static hitTestRecords(records, point, options = {}, groups = []) {
        const normalizedPoint = PcbInteractionPrimitiveModel.#point(point)
        if (!normalizedPoint) return []
        const preparedOptions =
            PcbInteractionPrimitiveModel.#visibilityOptions(options)
        const tolerance = PcbInteractionPrimitiveModel.#number(
            options.tolerance,
            0.2
        )
        const groupsById = new Map(
            (groups || []).map((group) => [String(group.id || ''), group])
        )
        const hits = []

        for (const record of records || []) {
            const primitive = record.primitive
            if (
                !PcbInteractionPrimitiveModel.#isVisible(
                    primitive,
                    preparedOptions
                )
            ) {
                continue
            }
            const distance = PcbInteractionPrimitiveModel.#hitDistance(
                primitive,
                normalizedPoint,
                tolerance
            )
            if (distance === null) continue

            hits.push({
                recordId: String(record.recordId),
                ...PcbInteractionPrimitiveModel.#candidate(
                    primitive,
                    groupsById
                ),
                distance
            })
        }

        return hits.sort(
            (left, right) =>
                PcbInteractionPrimitiveModel.#priority(left.kind) -
                    PcbInteractionPrimitiveModel.#priority(right.kind) ||
                left.distance - right.distance
        )
    }

    /**
     * Resolves conservative exact-geometry bounds for spatial indexing.
     * @param {object} primitive Prepared PCB primitive.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null} Interaction bounds.
     */
    static interactionBounds(primitive) {
        return PcbInteractionBounds.resolve(primitive)
    }

    /**
     * Returns true when the document uses the element-array source format.
     * @param {object | object[]} documentModel Parsed document model.
     * @returns {boolean}
     */
    static #isElementArrayDocument(documentModel) {
        return CircuitJsonDocument.isModel(
            CircuitJsonPcbPrimitiveBuilder.elements(documentModel)
        )
    }

    /**
     * Builds an empty primitive model.
     * @returns {{ bounds: object, layers: object[], virtualLayers: object[], components: object[], nets: object[], primitives: object[], anchors: object[], diagnostics: object[], airwires: object[], traceLengths: object[], groups: object[], anchorOffsets: object[] }}
     */
    static #emptyModel() {
        return {
            bounds: PcbInteractionPrimitiveModel.#bounds(0, 0, 1, 1),
            layers: [],
            virtualLayers: [],
            components: [],
            nets: [],
            primitives: [],
            anchors: [],
            diagnostics: [],
            airwires: [],
            traceLengths: [],
            groups: [],
            anchorOffsets: []
        }
    }

    /**
     * Returns true when a primitive should participate in hit testing.
     * @param {object} primitive Primitive row.
     * @param {object} options Hit-test options.
     * @returns {boolean}
     */
    static #isVisible(primitive, options) {
        if (
            primitive.layer &&
            options.hiddenLayers.has(String(primitive.layer))
        ) {
            return false
        }

        if (
            options.hiddenObjects.has(
                PcbInteractionPrimitiveModel.#componentSideObjectKey(primitive)
            )
        ) {
            return false
        }
        if (
            options.hiddenObjects.has(
                PcbInteractionPrimitiveModel.#objectKey(primitive)
            )
        ) {
            return false
        }

        const side = options.side
        return !side || !primitive.side || primitive.side === side
    }

    /**
     * Builds visibility lookup sets once per hit-test call.
     * @param {object} options Raw legacy hit options.
     * @returns {{ side: string, hiddenLayers: Set<string>, hiddenObjects: Set<string> }} Prepared options.
     */
    static #visibilityOptions(options) {
        return {
            side: String(options.side || ''),
            hiddenLayers: new Set(
                (Array.isArray(options.hiddenLayers)
                    ? options.hiddenLayers
                    : []
                )
                    .map(String)
                    .filter(Boolean)
            ),
            hiddenObjects: new Set(
                (Array.isArray(options.hiddenObjects)
                    ? options.hiddenObjects
                    : []
                )
                    .map(String)
                    .filter(Boolean)
            )
        }
    }

    /**
     * Resolves component-side object keys for component-backed primitives.
     * @param {object} primitive Primitive row.
     * @returns {string}
     */
    static #componentSideObjectKey(primitive) {
        if (!primitive.componentKey && !primitive.componentId) return ''
        if (primitive.side === 'top') return 'components-top'
        if (primitive.side === 'bottom') return 'components-bottom'
        return ''
    }

    /**
     * Resolves the sidebar object key for a primitive.
     * @param {object} primitive Primitive row.
     * @returns {string}
     */
    static #objectKey(primitive) {
        return (
            {
                board: 'page',
                cutout: 'page',
                pad: 'pads',
                track: 'tracks',
                via: 'vias',
                zone: 'zones',
                'copper-text': 'footprint-text',
                copper_text: 'footprint-text',
                silkscreen: 'silkscreen',
                silkscreen_text: 'silkscreen',
                silkscreen_line: 'silkscreen',
                fabrication: 'fabrication',
                note: 'fabrication',
                dimension: 'fabrication',
                courtyard: 'courtyards',
                'solder-mask': 'solder-mask',
                'solder-paste': 'solder-paste',
                ratsnest: 'rats-nest'
            }[primitive.kind] || primitive.kind
        )
    }

    /**
     * Resolves one primitive hit distance.
     * @param {object} primitive Primitive row.
     * @param {{ x: number, y: number }} point Board point.
     * @param {number} tolerance Hit tolerance.
     * @returns {number | null}
     */
    static #hitDistance(primitive, point, tolerance) {
        if (primitive.kind === 'track') {
            const distance = PcbInteractionPrimitiveModel.#distanceToSegment(
                point,
                { x: primitive.x1, y: primitive.y1 },
                { x: primitive.x2, y: primitive.y2 }
            )
            return distance <= primitive.width / 2 + tolerance ? distance : null
        }
        if (PcbInteractionPrimitiveModel.#isLineLikePrimitive(primitive)) {
            const distance = PcbInteractionPrimitiveModel.#distanceToSegment(
                point,
                { x: primitive.x1, y: primitive.y1 },
                { x: primitive.x2, y: primitive.y2 }
            )
            const width = PcbInteractionPrimitiveModel.#number(
                primitive.width,
                0
            )
            return distance <= width / 2 + tolerance ? distance : null
        }
        if (primitive.kind === 'via') {
            const hit = PcbInteractionPrimitiveModel.#shapeHit(
                primitive,
                point,
                tolerance
            )
            if (hit === null) return null
            return String(primitive.shape || 'circle') === 'circle'
                ? Math.sqrt(
                      PcbInteractionPrimitiveModel.#distanceSquared(
                          point,
                          primitive
                      )
                  )
                : hit
        }
        if (primitive.kind === 'pad') {
            return PcbInteractionPrimitiveModel.#shapeHit(
                primitive,
                point,
                tolerance
            )
        }
        if (
            ['zone', 'keepout', 'cutout', 'courtyard'].includes(primitive.kind)
        ) {
            const points =
                PcbInteractionPrimitiveModel.#primitivePoints(primitive)
            if (points.length >= 3) {
                return PcbInteractionPrimitiveModel.#polygonHit(
                    points,
                    point,
                    tolerance
                )
            }
            return PcbInteractionPrimitiveModel.#inside(
                point,
                primitive.bounds,
                tolerance
            )
                ? 0
                : null
        }
        if (primitive.kind === 'board') {
            const points =
                PcbInteractionPrimitiveModel.#primitivePoints(primitive)
            const inside =
                points.length >= 3
                    ? PcbInteractionPrimitiveModel.#polygonHit(
                          points,
                          point,
                          0
                      ) !== null
                    : PcbInteractionPrimitiveModel.#inside(
                          point,
                          primitive.bounds,
                          0
                      )
            return inside ? Number.MAX_SAFE_INTEGER : null
        }
        return null
    }

    /**
     * Applies exact common pad and via shape predicates.
     * @param {object} primitive Shape primitive.
     * @param {{ x: number, y: number }} point Board point.
     * @param {number} tolerance Hit tolerance.
     * @returns {number | null} Hit distance or null.
     */
    static #shapeHit(primitive, point, tolerance) {
        const points = PcbInteractionPrimitiveModel.#primitivePoints(primitive)
        if (points.length >= 3) {
            return PcbInteractionPrimitiveModel.#polygonHit(
                points,
                point,
                tolerance
            )
        }
        const center = PcbInteractionPrimitiveModel.#point(primitive)
        if (!center) return null
        const width = Math.max(
            PcbInteractionPrimitiveModel.#number(
                primitive.width ?? primitive.diameter,
                0
            ),
            0
        )
        const height = Math.max(
            PcbInteractionPrimitiveModel.#number(
                primitive.height ?? primitive.diameter ?? primitive.width,
                width
            ),
            0
        )
        if (!width || !height) return null
        const local = PcbInteractionPrimitiveModel.#rotatePoint(
            point,
            center,
            -PcbInteractionPrimitiveModel.#number(primitive.rotation, 0)
        )
        const shape = String(primitive.shape || 'circle').toLowerCase()
        if (['circle', 'oval_circle'].includes(shape)) {
            const x = (local.x - center.x) / (width / 2 + tolerance)
            const y = (local.y - center.y) / (height / 2 + tolerance)
            return x * x + y * y <= 1 ? 0 : null
        }
        if (['pill', 'oval', 'rotated_pill', 'capsule'].includes(shape)) {
            return PcbInteractionPrimitiveModel.#capsuleHit(
                local,
                center,
                width,
                height,
                tolerance
            )
        }
        if (['rounded_rect', 'roundrect'].includes(shape)) {
            return PcbInteractionPrimitiveModel.#roundedRectHit(
                local,
                center,
                width,
                height,
                PcbInteractionPrimitiveModel.#number(primitive.radius, 0),
                tolerance
            )
        }
        return Math.abs(local.x - center.x) <= width / 2 + tolerance &&
            Math.abs(local.y - center.y) <= height / 2 + tolerance
            ? 0
            : null
    }

    /**
     * Tests a point against a horizontal or vertical capsule.
     * @param {{ x: number, y: number }} point Local point.
     * @param {{ x: number, y: number }} center Shape center.
     * @param {number} width Shape width.
     * @param {number} height Shape height.
     * @param {number} tolerance Hit tolerance.
     * @returns {number | null} Hit distance or null.
     */
    static #capsuleHit(point, center, width, height, tolerance) {
        const radius = Math.min(width, height) / 2
        const horizontal = width >= height
        const halfSegment = Math.abs(width - height) / 2
        const start = horizontal
            ? { x: center.x - halfSegment, y: center.y }
            : { x: center.x, y: center.y - halfSegment }
        const end = horizontal
            ? { x: center.x + halfSegment, y: center.y }
            : { x: center.x, y: center.y + halfSegment }
        return PcbInteractionPrimitiveModel.#distanceToSegment(
            point,
            start,
            end
        ) <=
            radius + tolerance
            ? 0
            : null
    }

    /**
     * Tests one rounded rectangle in local coordinates.
     * @param {{ x: number, y: number }} point Local point.
     * @param {{ x: number, y: number }} center Shape center.
     * @param {number} width Shape width.
     * @param {number} height Shape height.
     * @param {number} radius Requested corner radius.
     * @param {number} tolerance Hit tolerance.
     * @returns {number | null} Hit distance or null.
     */
    static #roundedRectHit(point, center, width, height, radius, tolerance) {
        const corner = Math.max(0, Math.min(radius, width / 2, height / 2))
        const x = Math.max(
            Math.abs(point.x - center.x) - (width / 2 - corner),
            0
        )
        const y = Math.max(
            Math.abs(point.y - center.y) - (height / 2 - corner),
            0
        )
        return Math.hypot(x, y) <= corner + tolerance ? 0 : null
    }

    /**
     * Tests a point against a polygon with edge tolerance.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @param {{ x: number, y: number }} point Board point.
     * @param {number} tolerance Hit tolerance.
     * @returns {number | null} Hit distance or null.
     */
    static #polygonHit(points, point, tolerance) {
        let inside = false
        let distance = Infinity
        for (
            let index = 0, previous = points.length - 1;
            index < points.length;
            previous = index, index += 1
        ) {
            const start = points[previous]
            const end = points[index]
            distance = Math.min(
                distance,
                PcbInteractionPrimitiveModel.#distanceToSegment(
                    point,
                    start,
                    end
                )
            )
            if (
                start.y > point.y !== end.y > point.y &&
                point.x <
                    ((end.x - start.x) * (point.y - start.y)) /
                        (end.y - start.y) +
                        start.x
            ) {
                inside = !inside
            }
        }
        return inside || distance <= tolerance ? 0 : null
    }

    /**
     * Resolves valid polygon points from one primitive.
     * @param {object} primitive PCB primitive.
     * @returns {{ x: number, y: number }[]} Points.
     */
    static #primitivePoints(primitive) {
        return (Array.isArray(primitive?.points) ? primitive.points : [])
            .map(PcbInteractionPrimitiveModel.#point)
            .filter(Boolean)
    }

    /**
     * Rotates a point around one center.
     * @param {{ x: number, y: number }} point Point.
     * @param {{ x: number, y: number }} center Center.
     * @param {number} degrees Counter-clockwise degrees.
     * @returns {{ x: number, y: number }} Rotated point.
     */
    static #rotatePoint(point, center, degrees) {
        if (!degrees) return point
        const radians = (degrees * Math.PI) / 180
        const cos = Math.cos(radians)
        const sin = Math.sin(radians)
        const x = point.x - center.x
        const y = point.y - center.y
        return {
            x: center.x + x * cos - y * sin,
            y: center.y + x * sin + y * cos
        }
    }

    /**
     * Returns true when a primitive uses explicit segment geometry.
     * @param {object} primitive Primitive row.
     * @returns {boolean}
     */
    static #isLineLikePrimitive(primitive) {
        if (
            ![
                'silkscreen',
                'fabrication',
                'note',
                'dimension',
                'thermal-spoke',
                'route-hint',
                'courtyard'
            ].includes(primitive.kind)
        ) {
            return false
        }

        return [primitive.x1, primitive.y1, primitive.x2, primitive.y2].every(
            (value) => PcbInteractionPrimitiveModel.#finite(value) !== null
        )
    }

    /**
     * Builds a hit-test candidate from a primitive.
     * @param {object} primitive Primitive row.
     * @param {Map<string, object>} groupsById Group lookup.
     * @returns {object}
     */
    static #candidate(primitive, groupsById) {
        return {
            id: String(primitive.id || ''),
            role: primitive.kind,
            kind: primitive.kind,
            componentKey: String(primitive.componentKey || ''),
            componentId: String(
                primitive.componentId || primitive.componentKey || ''
            ),
            netName: String(primitive.netName || ''),
            net: String(primitive.netName || ''),
            layer: String(primitive.layer || ''),
            layerKey: String(primitive.layer || ''),
            groupIds: Array.isArray(primitive.groupIds)
                ? primitive.groupIds
                : [],
            groups: PcbInteractionPrimitiveModel.#candidateGroups(
                primitive,
                groupsById
            ),
            source: primitive.source || primitive
        }
    }

    /**
     * Builds group summaries for one candidate.
     * @param {object} primitive Primitive row.
     * @param {Map<string, object>} groupsById Group lookup.
     * @returns {object[]}
     */
    static #candidateGroups(primitive, groupsById) {
        return (Array.isArray(primitive.groupIds) ? primitive.groupIds : [])
            .map((id) => groupsById.get(String(id || '')))
            .filter(Boolean)
            .map((group) => PcbInteractionPrimitiveModel.#groupSummary(group))
    }

    /**
     * Builds a compact group summary for hit-test output.
     * @param {object} group Group row.
     * @returns {object}
     */
    static #groupSummary(group) {
        return {
            id: String(group.id || ''),
            name: String(group.name || group.id || ''),
            sourceGroupId: String(group.sourceGroupId || ''),
            componentCount: Array.isArray(group.componentIds)
                ? group.componentIds.length
                : 0,
            memberCount: Array.isArray(group.memberIds)
                ? group.memberIds.length
                : 0,
            anchor: group.anchor || null,
            ...PcbInteractionPrimitiveModel.#optionalCandidateField(
                'anchorAlignment',
                group.anchorAlignment
            ),
            ...PcbInteractionPrimitiveModel.#optionalCandidateField(
                'positionMode',
                group.positionMode
            ),
            ...PcbInteractionPrimitiveModel.#optionalCandidateField(
                'childLayoutMode',
                group.childLayoutMode
            ),
            ...PcbInteractionPrimitiveModel.#optionalCandidateField(
                'layoutMode',
                group.layoutMode
            ),
            ...PcbInteractionPrimitiveModel.#optionalCandidateNumber(
                'autorouterTraceClearance',
                group.autorouterTraceClearance
            ),
            bounds: group.bounds || null
        }
    }

    /**
     * Builds an optional string field for a candidate.
     * @param {string} key Output key.
     * @param {unknown} value Candidate value.
     * @returns {object}
     */
    static #optionalCandidateField(key, value) {
        const text = String(value || '').trim()
        return text ? { [key]: text } : {}
    }

    /**
     * Builds an optional number field for a candidate.
     * @param {string} key Output key.
     * @param {unknown} value Candidate value.
     * @returns {object}
     */
    static #optionalCandidateNumber(key, value) {
        const number = Number(value)
        return Number.isFinite(number) ? { [key]: number } : {}
    }

    /**
     * Returns sorting priority for one hit kind.
     * @param {string} kind Primitive kind.
     * @returns {number}
     */
    static #priority(kind) {
        return { pad: 10, via: 20, track: 30, zone: 40, board: 100 }[kind] || 90
    }

    /**
     * Returns true when a point is inside bounds.
     * @param {{ x: number, y: number }} point Point.
     * @param {object} bounds Bounds.
     * @param {number} padding Padding.
     * @returns {boolean}
     */
    static #inside(point, bounds, padding) {
        return (
            point.x >= bounds.minX - padding &&
            point.x <= bounds.maxX + padding &&
            point.y >= bounds.minY - padding &&
            point.y <= bounds.maxY + padding
        )
    }

    /**
     * Resolves a point from common x/y fields.
     * @param {object | null | undefined} value Point candidate.
     * @returns {{ x: number, y: number } | null}
     */
    static #point(value) {
        const x = PcbInteractionPrimitiveModel.#finite(value?.x)
        const y = PcbInteractionPrimitiveModel.#finite(value?.y)
        if (x === null || y === null) return null
        return { x, y }
    }

    /**
     * Builds a normalized bounds record.
     * @param {number} minX Minimum x.
     * @param {number} minY Minimum y.
     * @param {number} maxX Maximum x.
     * @param {number} maxY Maximum y.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }}
     */
    static #bounds(minX, minY, maxX, maxY) {
        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX,
            height: maxY - minY
        }
    }

    /**
     * Resolves squared point distance.
     * @param {{ x: number, y: number }} left First point.
     * @param {{ x: number, y: number }} right Second point.
     * @returns {number}
     */
    static #distanceSquared(left, right) {
        return (left.x - right.x) ** 2 + (left.y - right.y) ** 2
    }

    /**
     * Resolves point-to-segment distance.
     * @param {{ x: number, y: number }} point Point.
     * @param {{ x: number, y: number }} start Segment start.
     * @param {{ x: number, y: number }} end Segment end.
     * @returns {number}
     */
    static #distanceToSegment(point, start, end) {
        const dx = end.x - start.x
        const dy = end.y - start.y
        const lengthSq = dx * dx + dy * dy
        if (!lengthSq) {
            return Math.sqrt(
                PcbInteractionPrimitiveModel.#distanceSquared(point, start)
            )
        }
        const t = Math.max(
            0,
            Math.min(
                1,
                ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq
            )
        )
        return Math.sqrt(
            PcbInteractionPrimitiveModel.#distanceSquared(point, {
                x: start.x + t * dx,
                y: start.y + t * dy
            })
        )
    }

    /**
     * Converts a value to a finite number or null.
     * @param {unknown} value Numeric candidate.
     * @returns {number | null}
     */
    static #finite(value) {
        if (value === undefined || value === null || value === '') return null
        const number = Number(value)
        return Number.isFinite(number) ? number : null
    }

    /**
     * Converts a value to a finite number with fallback.
     * @param {unknown} value Numeric candidate.
     * @param {number} fallback Fallback number.
     * @returns {number}
     */
    static #number(value, fallback) {
        return PcbInteractionPrimitiveModel.#finite(value) ?? fallback
    }
}
