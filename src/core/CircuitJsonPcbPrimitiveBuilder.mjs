import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'
import { CircuitJsonPcbPrimitiveGeometry } from './CircuitJsonPcbPrimitiveGeometry.mjs'
import { CircuitJsonPcbPrimitiveOverlays } from './CircuitJsonPcbPrimitiveOverlays.mjs'
import { CircuitJsonPcbPrimitiveArtwork } from './CircuitJsonPcbPrimitiveArtwork.mjs'
import { CircuitJsonPcbPrimitiveGroups } from './CircuitJsonPcbPrimitiveGroups.mjs'
import { CircuitJsonPcbZonePrimitiveBuilder } from './CircuitJsonPcbZonePrimitiveBuilder.mjs'
import { CircuitJsonPcbHolePrimitiveModel } from './CircuitJsonPcbHolePrimitiveModel.mjs'
import { CircuitJsonPcbPadPrimitiveModel } from './CircuitJsonPcbPadPrimitiveModel.mjs'
import { CircuitJsonPcbPrimitiveFields } from './CircuitJsonPcbPrimitiveFields.mjs'
import { CircuitJsonPcbPrimitiveIndex } from './CircuitJsonPcbPrimitiveIndex.mjs'
import { CircuitJsonPcbNetMetadata } from './CircuitJsonPcbNetMetadata.mjs'
import { CircuitJsonPcbDrawingStyle } from './CircuitJsonPcbDrawingStyle.mjs'

/**
 * Builds renderer-neutral PCB primitives from standards-native element arrays.
 */
export class CircuitJsonPcbPrimitiveBuilder {
    /**
     * Builds a normalized PCB primitive model.
     * @param {object | object[]} documentModel Parsed document model.
     * @returns {{ bounds: object, layers: object[], virtualLayers: object[], components: object[], nets: object[], primitives: object[], anchors: object[], diagnostics: object[], airwires: object[], traceLengths: object[], groups: object[], anchorOffsets: object[] }}
     */
    static build(documentModel) {
        return CircuitJsonPcbPrimitiveBuilder.buildComplete(
            documentModel,
            CircuitJsonPcbPrimitiveBuilder.buildInteraction(documentModel)
        )
    }

    /**
     * Builds only geometry and selection data required for interaction. It
     * intentionally omits clearance diagnostics, airwires, and report layers.
     * @param {object | object[]} documentModel Parsed document model.
     * @returns {{ bounds: object, layers: object[], virtualLayers: object[], components: object[], nets: object[], primitives: object[], anchors: object[], diagnostics: object[], airwires: object[], traceLengths: object[], groups: object[], anchorOffsets: object[] }} Interaction primitive model.
     */
    static buildInteraction(documentModel) {
        const elements = CircuitJsonPcbPrimitiveBuilder.elements(documentModel)
        const index = CircuitJsonPcbPrimitiveIndex.build(elements)
        const boards = CircuitJsonPcbPrimitiveBuilder.#all(index, 'pcb_board')
        const components =
            CircuitJsonPcbPrimitiveBuilder.#componentLookups(index)
        const areaModel = CircuitJsonPcbZonePrimitiveBuilder.build(
            index,
            components.byPcbId
        )
        const primitiveRows = [
            ...CircuitJsonPcbPrimitiveBuilder.#boardPrimitives(boards),
            ...CircuitJsonPcbPrimitiveBuilder.#padPrimitives(
                index,
                components.byPcbId
            ),
            ...CircuitJsonPcbPrimitiveBuilder.#tracePrimitives(
                index,
                components.byPcbId
            ),
            ...CircuitJsonPcbPrimitiveBuilder.#viaPrimitives(
                index,
                components.byPcbId
            ),
            ...areaModel.primitives,
            ...CircuitJsonPcbPrimitiveBuilder.#silkscreenPrimitives(
                index,
                components.byPcbId
            ),
            ...CircuitJsonPcbPrimitiveArtwork.cutoutPrimitives(index),
            ...CircuitJsonPcbPrimitiveArtwork.build(index, components.byPcbId)
        ].filter(Boolean)
        const groupModel = CircuitJsonPcbPrimitiveGroups.build(
            index,
            primitiveRows,
            components.rows
        )
        const primitives = CircuitJsonPcbNetMetadata.decoratePrimitives(
            groupModel.primitives,
            index
        )
        const bounds =
            CircuitJsonPcbPrimitiveFields.mergedBoardBounds(boards) ||
            CircuitJsonPcbPrimitiveGeometry.mergedPrimitiveBounds(primitives) ||
            CircuitJsonPcbPrimitiveGeometry.bounds(0, 0, 1, 1)

        return {
            bounds,
            layers: CircuitJsonPcbPrimitiveFields.layers(boards, primitives),
            virtualLayers: [],
            components: components.rows,
            nets: CircuitJsonPcbNetMetadata.nets(primitives, index),
            primitives,
            anchors: primitives.flatMap((primitive) =>
                primitive.anchors.map((anchor) => ({ ...anchor, primitive }))
            ),
            diagnostics: [],
            airwires: [],
            traceLengths: [],
            groups: groupModel.groups,
            anchorOffsets: groupModel.anchorOffsets
        }
    }

    /**
     * Adds legacy report and overlay data to an interaction primitive model
     * without rebuilding its renderer-neutral geometry.
     * @param {object | object[]} documentModel Parsed document model.
     * @param {Record<string, any>} interactionModel Prepared interaction model.
     * @returns {{ bounds: object, layers: object[], virtualLayers: object[], components: object[], nets: object[], primitives: object[], anchors: object[], diagnostics: object[], airwires: object[], traceLengths: object[], groups: object[], anchorOffsets: object[] }} Complete primitive model.
     */
    static buildComplete(documentModel, interactionModel) {
        const elements = CircuitJsonPcbPrimitiveBuilder.elements(documentModel)
        const index = CircuitJsonPcbPrimitiveIndex.build(elements)
        const components =
            CircuitJsonPcbPrimitiveBuilder.#componentLookups(index)
        const areaDiagnostics = CircuitJsonPcbZonePrimitiveBuilder.build(
            index,
            components.byPcbId
        ).diagnostics
        const overlays = CircuitJsonPcbPrimitiveOverlays.build(
            index,
            components.byPcbId,
            interactionModel.primitives,
            interactionModel.bounds,
            {
                groups: interactionModel.groups,
                anchorOffsets: interactionModel.anchorOffsets
            },
            [
                ...CircuitJsonPcbPrimitiveBuilder.#generatedDiagnostics(index),
                ...areaDiagnostics
            ]
        )

        return {
            ...interactionModel,
            virtualLayers: overlays.virtualLayers,
            diagnostics: overlays.diagnostics,
            airwires: overlays.airwires,
            traceLengths: CircuitJsonPcbPrimitiveArtwork.traceLengths(
                interactionModel.primitives,
                index
            )
        }
    }

    /**
     * Returns element rows from an array or wrapper object.
     * @param {object | object[]} documentModel Parsed document model.
     * @returns {object[]}
     */
    static elements(documentModel) {
        if (Array.isArray(documentModel)) {
            return CircuitJsonPcbPrimitiveBuilder.#elementSlots(documentModel)
        }
        if (!documentModel || typeof documentModel !== 'object') return []
        let descriptors
        try {
            descriptors = Object.getOwnPropertyDescriptors(documentModel)
        } catch {
            return []
        }
        for (const field of ['elements', 'circuitJson']) {
            const descriptor = descriptors[field]
            if (
                descriptor &&
                Object.hasOwn(descriptor, 'value') &&
                Array.isArray(descriptor.value)
            ) {
                return CircuitJsonPcbPrimitiveBuilder.#elementSlots(
                    descriptor.value
                )
            }
        }
        return []
    }

    /**
     * Returns an exact dense element array, dropping only legacy root metadata.
     * @param {object[]} model Element-array or legacy hybrid-array candidate.
     * @returns {object[]} Original exact array or intrinsic dense slot copy.
     */
    static #elementSlots(model) {
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(model)
            descriptors = Object.getOwnPropertyDescriptors(model)
        } catch {
            return model
        }
        const lengthDescriptor = descriptors.length
        const length =
            lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
                ? lengthDescriptor.value
                : null
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0
        ) {
            return model
        }
        const slots = new Array(length)
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                return model
            }
            slots[index] = descriptor.value
        }
        return Reflect.ownKeys(descriptors).length === length + 1
            ? model
            : slots
    }

    /**
     * Returns indexed element rows by type.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {string} type Element type.
     * @returns {object[]}
     */
    static #all(index, type) {
        return index.elementsByType.get(type) || []
    }

    /**
     * Returns generated diagnostics from the shared element index.
     * @param {{ diagnostics?: object[] }} index Element index.
     * @returns {object[]}
     */
    static #generatedDiagnostics(index) {
        return (
            Array.isArray(index?.diagnostics) ? index.diagnostics : []
        ).filter((diagnostic) => diagnostic?.isGenerated === true)
    }

    /**
     * Builds component rows and PCB component lookup maps.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {{ rows: object[], byPcbId: Map<string, object> }}
     */
    static #componentLookups(index) {
        const sourceRows = CircuitJsonPcbPrimitiveBuilder.#all(
            index,
            'source_component'
        )
        const sourceNames = new Map(
            sourceRows.map((element) => [
                String(element.source_component_id || '').trim(),
                String(
                    element.name ||
                        element.reference ||
                        element.designator ||
                        element.source_component_id ||
                        ''
                ).trim()
            ])
        )
        const sourceMetadata = new Map(
            sourceRows.map((element) => [
                String(element.source_component_id || '').trim(),
                {
                    groupId: String(element.source_group_id || '').trim(),
                    subcircuitIds: CircuitJsonPcbPrimitiveFields.uniqueStrings([
                        element.subcircuit_id,
                        element.subcircuitId
                    ])
                }
            ])
        )
        const rows = []
        const byPcbId = new Map()

        for (const element of CircuitJsonPcbPrimitiveBuilder.#all(
            index,
            'pcb_component'
        )) {
            const sourceId = String(element.source_component_id || '').trim()
            const pcbId = String(element.pcb_component_id || '').trim()
            const center = CircuitJsonPcbPrimitiveFields.center(element) || {
                x: 0,
                y: 0
            }
            const componentKey = String(
                sourceNames.get(sourceId) ||
                    element.name ||
                    element.reference ||
                    element.designator ||
                    pcbId ||
                    'Component ' + (rows.length + 1)
            ).trim()
            const source = sourceMetadata.get(sourceId) || {}
            const component = {
                ...element,
                componentKey,
                designator: componentKey,
                key: componentKey,
                pcbComponentId: pcbId,
                sourceComponentId: sourceId,
                sourceGroupId: String(
                    element.source_group_id || source.groupId || ''
                ).trim(),
                x: center.x,
                y: center.y,
                layer: CircuitJsonPcbPrimitiveFields.layer(element.layer),
                rotation: CircuitJsonUnits.angle(element.rotation, 0),
                groupIds: CircuitJsonPcbPrimitiveFields.uniqueStrings([
                    element.pcb_group_id,
                    element.positioned_relative_to_pcb_group_id,
                    element.source_group_id,
                    source.groupId
                ]),
                subcircuitIds: CircuitJsonPcbPrimitiveFields.uniqueStrings([
                    element.subcircuit_id,
                    element.subcircuitId,
                    ...(source.subcircuitIds || [])
                ])
            }
            rows.push(component)
            if (pcbId) byPcbId.set(pcbId, component)
        }

        return { rows, byPcbId }
    }

    /**
     * Builds board primitives.
     * @param {object[]} boards Board elements.
     * @returns {object[]}
     */
    static #boardPrimitives(boards) {
        return boards
            .map((board) =>
                CircuitJsonPcbPrimitiveBuilder.#boardPrimitive(board)
            )
            .filter(Boolean)
    }

    /**
     * Builds a board primitive.
     * @param {object | null} board Board element.
     * @returns {object | null}
     */
    static #boardPrimitive(board) {
        const bounds = CircuitJsonPcbPrimitiveFields.boardBounds(board)
        if (!bounds) return null

        return {
            id: String(board?.pcb_board_id || 'board'),
            kind: 'board',
            layer: 'board',
            side: '',
            points: CircuitJsonPcbPrimitiveFields.points(board),
            bounds,
            anchors: CircuitJsonPcbPrimitiveGeometry.cornerAnchors(bounds),
            source: board || {}
        }
    }

    /**
     * Builds SMT pad primitives.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #padPrimitives(index, componentsByPcbId) {
        return CircuitJsonPcbPrimitiveBuilder.#all(index, 'pcb_smtpad')
            .map((element) =>
                CircuitJsonPcbPrimitiveBuilder.#padPrimitive(
                    element,
                    componentsByPcbId
                )
            )
            .filter(Boolean)
    }

    /**
     * Builds one SMT pad primitive.
     * @param {object} element Pad element.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object | null}
     */
    static #padPrimitive(element, componentsByPcbId) {
        const shape = CircuitJsonPcbPadPrimitiveModel.shape(element)
        const points =
            shape === 'polygon'
                ? CircuitJsonPcbPrimitiveFields.points(element)
                : []
        const center =
            CircuitJsonPcbPrimitiveFields.center(element) ||
            CircuitJsonPcbPrimitiveFields.pointsCenter(points)
        if (!center) return null

        const explicitRadius =
            CircuitJsonPcbPadPrimitiveModel.explicitRadius(element)
        const diameter =
            CircuitJsonUnits.optionalLength(element.diameter) ??
            (explicitRadius === null ? null : explicitRadius * 2)
        const width = CircuitJsonUnits.optionalLength(element.width) ?? diameter
        const height =
            CircuitJsonUnits.optionalLength(element.height) ?? diameter ?? width
        if (!points.length && (width === null || height === null)) return null
        const radius = CircuitJsonPcbPadPrimitiveModel.radius(
            element,
            shape,
            width ?? 0,
            height ?? 0
        )

        const component = componentsByPcbId.get(
            String(element.pcb_component_id || '').trim()
        )
        const layer = CircuitJsonPcbPrimitiveFields.layer(element.layer)
        const bounds = points.length
            ? CircuitJsonPcbPrimitiveGeometry.pointsBounds(points)
            : CircuitJsonPcbPrimitiveGeometry.centerBounds(
                  center,
                  width,
                  height
              )

        return CircuitJsonPcbPrimitiveBuilder.#primitive({
            id: String(element.pcb_smtpad_id || ''),
            kind: 'pad',
            shape,
            x: center.x,
            y: center.y,
            width: width ?? bounds.width,
            height: height ?? bounds.height,
            radius,
            rotation: CircuitJsonUnits.angle(
                element.ccw_rotation ?? element.rotation,
                0
            ),
            points,
            bounds,
            layer,
            component,
            netName: CircuitJsonPcbPrimitiveFields.netName(element, null),
            anchors: [
                { point: center },
                ...(points.length
                    ? points.map((point) => ({ point }))
                    : CircuitJsonPcbPrimitiveGeometry.cornerAnchors(bounds))
            ],
            source: element
        })
    }

    /**
     * Builds trace segment and route-via primitives.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #tracePrimitives(index, componentsByPcbId) {
        return CircuitJsonPcbPrimitiveBuilder.#all(index, 'pcb_trace').flatMap(
            (trace) =>
                CircuitJsonPcbPrimitiveBuilder.#tracePrimitiveRows(
                    trace,
                    componentsByPcbId
                )
        )
    }

    /**
     * Builds rows for one routed trace.
     * @param {object} trace Trace element.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #tracePrimitiveRows(trace, componentsByPcbId) {
        const route = Array.isArray(trace.route) ? trace.route : []
        const component = componentsByPcbId.get(
            String(trace.pcb_component_id || '').trim()
        )
        const rows = []
        let previous = null

        for (const entry of route) {
            if (entry?.route_type === 'through_pad') {
                rows.push(
                    CircuitJsonPcbPrimitiveBuilder.#throughPadSegment(
                        trace,
                        entry,
                        component,
                        rows.length
                    )
                )
                previous = null
                continue
            }

            const current = CircuitJsonPcbPrimitiveFields.center(entry)
            if (!current) continue
            if (entry?.route_type === 'via') {
                rows.push(
                    CircuitJsonPcbPrimitiveBuilder.#routeViaPrimitive(
                        trace,
                        entry,
                        current,
                        rows.length
                    )
                )
            }
            if (
                previous &&
                CircuitJsonPcbPrimitiveBuilder.#sameSegmentLayer(
                    previous,
                    entry
                )
            ) {
                rows.push(
                    CircuitJsonPcbPrimitiveBuilder.#segmentPrimitive(
                        trace,
                        previous,
                        current,
                        entry,
                        component,
                        rows.length
                    )
                )
            }
            previous = { ...entry, x: current.x, y: current.y }
        }

        return rows.filter(Boolean)
    }

    /**
     * Returns true when two route points can form a visible planar segment.
     * @param {object} previous Previous route entry.
     * @param {object} current Current route entry.
     * @returns {boolean}
     */
    static #sameSegmentLayer(previous, current) {
        if (previous?.route_type === 'via' || current?.route_type === 'via') {
            return true
        }

        const previousLayer = CircuitJsonPcbPrimitiveFields.layer(
            previous?.layer
        )
        const currentLayer = CircuitJsonPcbPrimitiveFields.layer(current?.layer)
        return !previousLayer || !currentLayer || previousLayer === currentLayer
    }

    /**
     * Builds one routed wire segment.
     * @param {object} trace Trace element.
     * @param {object} previous Previous route point.
     * @param {{ x: number, y: number }} current Current point.
     * @param {object} entry Current route entry.
     * @param {object | undefined} component Component row.
     * @param {number} index Segment index.
     * @returns {object}
     */
    static #segmentPrimitive(
        trace,
        previous,
        current,
        entry,
        component,
        index
    ) {
        const width = CircuitJsonUnits.length(
            entry.width ?? previous.width ?? trace.width,
            0.15
        )
        const layer = CircuitJsonPcbPrimitiveFields.layer(
            entry.layer || previous.layer || trace.layer
        )

        return CircuitJsonPcbPrimitiveBuilder.#primitive({
            id: String(trace.pcb_trace_id || '') + ':segment:' + index,
            kind: 'track',
            x1: previous.x,
            y1: previous.y,
            x2: current.x,
            y2: current.y,
            width,
            bounds: CircuitJsonPcbPrimitiveGeometry.segmentBounds(
                previous,
                current,
                width
            ),
            layer,
            component,
            netName: CircuitJsonPcbPrimitiveFields.netName(trace, null),
            anchors: [{ point: previous }, { point: current }],
            source: trace,
            sourceTraceId: String(trace.source_trace_id || '')
        })
    }

    /**
     * Builds one through-pad trace segment.
     * @param {object} trace Trace element.
     * @param {object} entry Route entry.
     * @param {object | undefined} component Component row.
     * @param {number} index Segment index.
     * @returns {object | null}
     */
    static #throughPadSegment(trace, entry, component, index) {
        const start = CircuitJsonPcbPrimitiveFields.point(entry.start)
        const end = CircuitJsonPcbPrimitiveFields.point(entry.end)
        if (!start || !end) return null
        return CircuitJsonPcbPrimitiveBuilder.#segmentPrimitive(
            trace,
            start,
            end,
            {
                width: entry.width,
                layer: entry.start_layer || entry.end_layer
            },
            component,
            index
        )
    }

    /**
     * Builds one route via primitive.
     * @param {object} trace Trace element.
     * @param {object} entry Route via entry.
     * @param {{ x: number, y: number }} center Via center.
     * @param {number} index Via index.
     * @returns {object}
     */
    static #routeViaPrimitive(trace, entry, center, index) {
        const geometry = CircuitJsonPcbHolePrimitiveModel.build(entry, center)
        return {
            ...CircuitJsonPcbPrimitiveBuilder.#viaRow(
                {
                    ...entry,
                    pcb_via_id:
                        String(trace.pcb_trace_id || '') + ':via:' + index
                },
                center,
                geometry,
                CircuitJsonPcbPrimitiveFields.netName(trace, null)
            ),
            source: trace,
            sourceRoute: entry
        }
    }

    /**
     * Builds standalone via, plated-hole, and hole primitives.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #viaPrimitives(index, componentsByPcbId) {
        return ['pcb_via', 'pcb_plated_hole', 'pcb_hole']
            .flatMap((type) => CircuitJsonPcbPrimitiveBuilder.#all(index, type))
            .map((element) => {
                const center = CircuitJsonPcbPrimitiveFields.center(element)
                if (!center) return null
                const geometry = CircuitJsonPcbHolePrimitiveModel.build(
                    element,
                    center
                )
                const component = componentsByPcbId.get(
                    String(element.pcb_component_id || '').trim()
                )
                return CircuitJsonPcbPrimitiveBuilder.#primitive({
                    ...CircuitJsonPcbPrimitiveBuilder.#viaRow(
                        element,
                        center,
                        geometry,
                        CircuitJsonPcbPrimitiveFields.netName(element, null)
                    ),
                    component
                })
            })
            .filter(Boolean)
    }

    /**
     * Builds one via-like primitive row.
     * @param {object} element Via-like element.
     * @param {{ x: number, y: number }} center Center point.
     * @param {object} geometry Normalized drilled geometry.
     * @param {string} netName Net name.
     * @returns {object}
     */
    static #viaRow(element, center, geometry, netName) {
        const layer = CircuitJsonPcbPrimitiveFields.layer(
            element.layer || element.from_layer || element.to_layer
        )
        return {
            id: String(
                element.pcb_via_id ||
                    element.pcb_plated_hole_id ||
                    element.pcb_hole_id ||
                    ''
            ),
            kind: 'via',
            x: center.x,
            y: center.y,
            ...geometry,
            layer,
            side: '',
            netName,
            anchors: [{ point: center }],
            source: element
        }
    }

    /**
     * Builds silkscreen and text primitives.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #silkscreenPrimitives(index, componentsByPcbId) {
        return [
            ...CircuitJsonPcbPrimitiveBuilder.#textPrimitives(
                index,
                componentsByPcbId
            ),
            ...CircuitJsonPcbPrimitiveBuilder.#linePrimitives(
                index,
                componentsByPcbId
            )
        ]
    }

    /**
     * Builds text primitives.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #textPrimitives(index, componentsByPcbId) {
        return [
            'pcb_silkscreen_text',
            'pcb_text',
            'pcb_copper_text',
            'pcb_fabrication_note_text'
        ]
            .flatMap((type) => CircuitJsonPcbPrimitiveBuilder.#all(index, type))
            .flatMap((element) => {
                const center =
                    CircuitJsonPcbPrimitiveFields.center(element) ||
                    CircuitJsonPcbPrimitiveFields.point(element.anchor_position)
                if (!center) return []
                const size = CircuitJsonUnits.length(
                    element.font_size ?? element.fontSize ?? element.height,
                    1
                )
                const component = componentsByPcbId.get(
                    String(element.pcb_component_id || '').trim()
                )
                const bounds = CircuitJsonPcbPrimitiveGeometry.centerBounds(
                    center,
                    Math.max(
                        String(element.text || '').length * size * 0.6,
                        size
                    ),
                    size
                )
                const primitive = CircuitJsonPcbPrimitiveBuilder.#primitive({
                    id: CircuitJsonIndexer.getElementId(element),
                    kind: CircuitJsonPcbPrimitiveBuilder.#textKind(element),
                    text: String(element.text || ''),
                    x: center.x,
                    y: center.y,
                    fontSize: size,
                    anchorAlignment: String(
                        element.anchor_alignment ||
                            element.anchorAlignment ||
                            ''
                    ).trim(),
                    isKnockout:
                        element.is_knockout === true ||
                        element.isKnockout === true,
                    rotation: CircuitJsonUnits.angle(element.ccw_rotation, 0),
                    bounds,
                    layer: CircuitJsonPcbPrimitiveBuilder.#detailLayer(
                        element,
                        CircuitJsonPcbPrimitiveBuilder.#textKind(element)
                    ),
                    component,
                    netName: CircuitJsonPcbPrimitiveFields.netName(
                        element,
                        null
                    ),
                    anchors: [{ point: center }],
                    ...CircuitJsonPcbDrawingStyle.fromElement(element),
                    source: element
                })
                if (element.type !== 'pcb_silkscreen_text') return [primitive]

                return [
                    primitive,
                    {
                        ...primitive,
                        id: primitive.id + ':silkscreen',
                        kind: 'silkscreen',
                        footprintId: primitive.componentKey
                            ? 'footprint:' +
                              primitive.componentKey +
                              ':silkscreen'
                            : ''
                    }
                ]
            })
            .filter(Boolean)
    }

    /**
     * Builds line primitives.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #linePrimitives(index, componentsByPcbId) {
        return [
            'pcb_silkscreen_line',
            'pcb_silkscreen_path',
            'pcb_fabrication_note_line',
            'pcb_fabrication_note_path'
        ]
            .flatMap((type) => CircuitJsonPcbPrimitiveBuilder.#all(index, type))
            .flatMap((element) =>
                CircuitJsonPcbPrimitiveBuilder.#linePrimitiveRows(
                    element,
                    componentsByPcbId
                )
            )
            .filter(Boolean)
    }

    /**
     * Builds renderable segment rows for one documentation path or line.
     * @param {object} element Path or line element.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object[]}
     */
    static #linePrimitiveRows(element, componentsByPcbId) {
        const points = CircuitJsonPcbPrimitiveFields.linePoints(element)
        const rows = []

        for (let index = 1; index < points.length; index += 1) {
            rows.push(
                CircuitJsonPcbPrimitiveBuilder.#linePrimitive(
                    element,
                    points[index - 1],
                    points[index],
                    index - 1,
                    componentsByPcbId
                )
            )
        }

        return rows.filter(Boolean)
    }

    /**
     * Builds one silkscreen or fabrication segment primitive.
     * @param {object} element Source element.
     * @param {{ x: number, y: number }} start Segment start.
     * @param {{ x: number, y: number }} end Segment end.
     * @param {number} index Segment index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object | null}
     */
    static #linePrimitive(element, start, end, index, componentsByPcbId) {
        const width = CircuitJsonUnits.length(
            element.width ??
                element.stroke_width ??
                element.strokeWidth ??
                element.line_width,
            0.12
        )
        const component = componentsByPcbId.get(
            String(element.pcb_component_id || '').trim()
        )
        const baseId = CircuitJsonIndexer.getElementId(element)

        return CircuitJsonPcbPrimitiveBuilder.#primitive({
            id: baseId + ':' + index,
            kind: CircuitJsonPcbPrimitiveBuilder.#lineKind(element),
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            width,
            bounds: CircuitJsonPcbPrimitiveGeometry.segmentBounds(
                start,
                end,
                width
            ),
            layer: CircuitJsonPcbPrimitiveBuilder.#lineLayer(element),
            component,
            anchors: [{ point: start }, { point: end }],
            ...CircuitJsonPcbDrawingStyle.fromElement(element),
            source: element
        })
    }

    /**
     * Resolves the primitive kind for a documentation line.
     * @param {object} element Source element.
     * @returns {'fabrication' | 'silkscreen'}
     */
    static #lineKind(element) {
        return String(element.type || '').includes('fabrication')
            ? 'fabrication'
            : 'silkscreen'
    }

    /**
     * Resolves the display layer for a documentation line.
     * @param {object} element Source element.
     * @returns {string}
     */
    static #lineLayer(element) {
        return CircuitJsonPcbPrimitiveBuilder.#detailLayer(
            element,
            CircuitJsonPcbPrimitiveBuilder.#lineKind(element)
        )
    }

    /**
     * Resolves a standards-side layer into its drawing-specific virtual layer.
     * @param {object} element Source drawing element.
     * @param {string} kind Primitive kind.
     * @returns {string}
     */
    static #detailLayer(element, kind) {
        if (kind === 'copper-text') {
            return CircuitJsonPcbPrimitiveFields.layer(element.layer)
        }
        const side =
            CircuitJsonPcbPrimitiveFields.side(
                CircuitJsonPcbPrimitiveFields.layer(element.layer)
            ) || 'top'
        return side + (kind === 'fabrication' ? '_fabrication' : '_silkscreen')
    }

    /**
     * Resolves a normalized text primitive kind.
     * @param {object} element Text element.
     * @returns {string}
     */
    static #textKind(element) {
        if (element.type === 'pcb_copper_text') return 'copper-text'
        if (element.type === 'pcb_fabrication_note_text') return 'fabrication'
        return 'silkscreen_text'
    }

    /**
     * Adds common primitive metadata.
     * @param {object} primitive Primitive data.
     * @returns {object}
     */
    static #primitive(primitive) {
        const component = primitive.component || {}
        const layer = CircuitJsonPcbPrimitiveFields.layer(primitive.layer)
        const source = primitive.source || {}
        return {
            ...primitive,
            layer,
            side: primitive.side ?? CircuitJsonPcbPrimitiveFields.side(layer),
            componentKey: String(component.componentKey || ''),
            componentId: String(component.pcbComponentId || ''),
            footprintId: component.componentKey
                ? 'footprint:' + component.componentKey + ':' + primitive.kind
                : '',
            netName: String(primitive.netName || '').trim(),
            groupIds: CircuitJsonPcbPrimitiveFields.uniqueStrings([
                source.pcb_group_id,
                source.source_group_id,
                component.pcb_group_id,
                component.positioned_relative_to_pcb_group_id,
                component.sourceGroupId
            ]),
            subcircuitIds: CircuitJsonPcbPrimitiveFields.uniqueStrings([
                source.subcircuit_id,
                source.subcircuitId,
                ...(component.subcircuitIds || [])
            ]),
            sourceComponentId: String(component.sourceComponentId || '')
        }
    }
}
