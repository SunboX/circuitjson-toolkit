import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'
import { CircuitJsonSchematicSvgArcPath } from './CircuitJsonSchematicSvgArcPath.mjs'
import { CircuitJsonSchematicSvgPortMetadata } from './CircuitJsonSchematicSvgPortMetadata.mjs'
import { SchematicTableGeometry } from './SchematicTableGeometry.mjs'
import { SchematicTextBounds } from './SchematicTextBounds.mjs'

/**
 * Derives finite schematic canvas bounds from selected CircuitJSON geometry.
 */
export class SchematicGeometryBounds {
    /**
     * Preserves the direct legacy renderer's explicit-or-fixed canvas contract.
     * @param {{ elementsByType: Map<string, object[]> }} index Legacy element index.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }} Legacy bounds.
     */
    static legacy(index) {
        const sheet = (index.elementsByType.get('schematic_sheet') || [])[0]
        const width = CircuitJsonUnits.optionalLength(sheet?.width)
        const height = CircuitJsonUnits.optionalLength(sheet?.height)
        return width !== null && height !== null
            ? { minX: 0, minY: 0, maxX: width, maxY: height, width, height }
            : {
                  minX: -10,
                  minY: -10,
                  maxX: 10,
                  maxY: 10,
                  width: 20,
                  height: 20
              }
    }

    /**
     * Resolves explicit sheet dimensions or selected content extents.
     * @param {{ elements?: object[], elementsByType: Map<string, object[]> }} index Selected schematic index.
     * @param {Map<string, object> | null} [preparedSourcePorts] Shared source-port lookup.
     * @param {WeakMap<object, string> | null} [portHintCache] Render-scoped hint cache.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }} Bounds.
     */
    static resolve(index, preparedSourcePorts = null, portHintCache = null) {
        const sheet = (index.elementsByType.get('schematic_sheet') || [])[0]
        const width = CircuitJsonUnits.optionalLength(sheet?.width)
        const height = CircuitJsonUnits.optionalLength(sheet?.height)
        if (width !== null && height !== null) {
            return {
                minX: 0,
                minY: 0,
                maxX: width,
                maxY: height,
                width,
                height
            }
        }

        const bounds = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
        const sourcePorts =
            preparedSourcePorts ||
            CircuitJsonSchematicSvgPortMetadata.sourcePorts(
                index.elementsByType.get('source_port') || []
            )
        const sourceNames = new Map(
            (index.elementsByType.get('source_component') || []).map(
                (element) => [
                    String(element.source_component_id || '').trim(),
                    String(element.name || element.source_component_id || '')
                ]
            )
        )
        const generatedLabels = SchematicGeometryBounds.#generatedLabels(
            index,
            sourceNames
        )
        const tables = SchematicTableGeometry.models(index)
        for (const element of index.elements || []) {
            if (!String(element.type || '').startsWith('schematic_')) continue
            SchematicGeometryBounds.#includeElement(
                bounds,
                element,
                sourcePorts,
                generatedLabels,
                tables,
                portHintCache
            )
        }
        if (!Number.isFinite(bounds.minX)) {
            return {
                minX: -10,
                minY: -10,
                maxX: 10,
                maxY: 10,
                width: 20,
                height: 20
            }
        }
        return SchematicGeometryBounds.#minimumExtent(bounds)
    }

    /**
     * Adds every standard geometry field from one schematic element.
     * @param {Record<string, number>} bounds Mutable bounds.
     * @param {object} element CircuitJSON element.
     * @param {Map<string, object>} sourcePorts Source-port lookup.
     * @param {WeakMap<object, string>} generatedLabels Generated label lookup.
     * @param {Map<string, object>} tables Table-model lookup.
     * @param {WeakMap<object, string> | null} portHintCache Render-scoped hint cache.
     * @returns {void}
     */
    static #includeElement(
        bounds,
        element,
        sourcePorts,
        generatedLabels,
        tables,
        portHintCache
    ) {
        const geometry = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
        const table = tables.get(
            String(element.schematic_table_id || '').trim()
        )
        if (element.type === 'schematic_table') {
            const rect = table || SchematicTableGeometry.tableRect(element)
            if (rect) {
                SchematicGeometryBounds.#include(geometry, {
                    x: rect.x,
                    y: rect.y
                })
                SchematicGeometryBounds.#include(geometry, {
                    x: rect.x + rect.width,
                    y: rect.y + rect.height
                })
            }
        } else if (element.type === 'schematic_table_cell') {
            const rect = SchematicTableGeometry.cellRect(element, table)
            if (rect) {
                SchematicGeometryBounds.#include(geometry, {
                    x: rect.x,
                    y: rect.y
                })
                SchematicGeometryBounds.#include(geometry, {
                    x: rect.x + rect.width,
                    y: rect.y + rect.height
                })
            }
        }
        let center = SchematicGeometryBounds.#point(
            element.center ||
                element.position ||
                element.anchor_position ||
                element
        )
        if (!center && SchematicGeometryBounds.#isDiagnostic(element)) {
            center = { x: 0, y: 0 }
        }
        const size =
            CircuitJsonUnits.optionalSize(element.size || element) ||
            (element.type === 'schematic_component'
                ? { width: 4, height: 3 }
                : null)
        if (center && size && element.type === 'schematic_image') {
            SchematicGeometryBounds.#includeRotatedImage(
                geometry,
                center,
                size,
                element.rotation
            )
        } else if (center && size) {
            SchematicGeometryBounds.#include(geometry, {
                x: center.x - size.width / 2,
                y: center.y - size.height / 2
            })
            SchematicGeometryBounds.#include(geometry, {
                x: center.x + size.width / 2,
                y: center.y + size.height / 2
            })
        } else if (center) {
            SchematicGeometryBounds.#include(geometry, center)
        }

        const radius = CircuitJsonUnits.optionalLength(element.radius)
        if (center && radius !== null) {
            const visibleRadius = Math.max(0, radius)
            SchematicGeometryBounds.#include(geometry, {
                x: center.x - visibleRadius,
                y: center.y - visibleRadius
            })
            SchematicGeometryBounds.#include(geometry, {
                x: center.x + visibleRadius,
                y: center.y + visibleRadius
            })
        }
        const visibleRadius = SchematicGeometryBounds.#visibleRadius(element)
        if (center && visibleRadius !== null) {
            SchematicGeometryBounds.#include(geometry, {
                x: center.x - visibleRadius,
                y: center.y - visibleRadius
            })
            SchematicGeometryBounds.#include(geometry, {
                x: center.x + visibleRadius,
                y: center.y + visibleRadius
            })
        }

        if (element.type === 'schematic_arc') {
            const arcBounds =
                CircuitJsonSchematicSvgArcPath.boundsFromThreePoints(
                    SchematicGeometryBounds.#point(element.start),
                    SchematicGeometryBounds.#point(element.mid),
                    SchematicGeometryBounds.#point(element.end)
                )
            if (arcBounds) {
                SchematicGeometryBounds.#include(geometry, {
                    x: arcBounds.minX,
                    y: arcBounds.minY
                })
                SchematicGeometryBounds.#include(geometry, {
                    x: arcBounds.maxX,
                    y: arcBounds.maxY
                })
            }
        }

        for (const field of ['start', 'mid', 'end', 'from', 'to']) {
            SchematicGeometryBounds.#include(
                geometry,
                SchematicGeometryBounds.#point(element[field])
            )
        }
        for (const field of ['points', 'path', 'junctions']) {
            for (const point of Array.isArray(element[field])
                ? element[field]
                : []) {
                SchematicGeometryBounds.#include(
                    geometry,
                    SchematicGeometryBounds.#point(point)
                )
            }
        }
        for (const edge of Array.isArray(element.edges) ? element.edges : []) {
            SchematicGeometryBounds.#include(
                geometry,
                SchematicGeometryBounds.#point(edge?.from)
            )
            SchematicGeometryBounds.#include(
                geometry,
                SchematicGeometryBounds.#point(edge?.to)
            )
        }
        for (const point of [
            { x: element.x1, y: element.y1 },
            { x: element.x2, y: element.y2 }
        ]) {
            SchematicGeometryBounds.#include(
                geometry,
                SchematicGeometryBounds.#point(point)
            )
        }
        if (Number.isFinite(geometry.minX)) {
            const margin = SchematicGeometryBounds.#strokeMargin(element, table)
            SchematicGeometryBounds.#include(bounds, {
                x: geometry.minX - margin,
                y: geometry.minY - margin
            })
            SchematicGeometryBounds.#include(bounds, {
                x: geometry.maxX + margin,
                y: geometry.maxY + margin
            })
        }
        SchematicGeometryBounds.#includeVisibleText(
            bounds,
            element,
            sourcePorts,
            generatedLabels,
            tables,
            portHintCache
        )
    }

    /**
     * Includes the exact axis-aligned extents of a center-rotated image.
     * @param {Record<string, number>} bounds Mutable bounds.
     * @param {{ x: number, y: number }} center Image center.
     * @param {{ width: number, height: number }} size Image size.
     * @param {unknown} rotation Rotation in canonical degrees.
     * @returns {void}
     */
    static #includeRotatedImage(bounds, center, size, rotation) {
        const radians = (CircuitJsonUnits.angle(rotation, 0) * Math.PI) / 180
        const cosine = Math.abs(Math.cos(radians))
        const sine = Math.abs(Math.sin(radians))
        const halfWidth = (cosine * size.width + sine * size.height) / 2
        const halfHeight = (sine * size.width + cosine * size.height) / 2
        SchematicGeometryBounds.#include(bounds, {
            x: center.x - halfWidth,
            y: center.y - halfHeight
        })
        SchematicGeometryBounds.#include(bounds, {
            x: center.x + halfWidth,
            y: center.y + halfHeight
        })
    }

    /**
     * Returns the visible radius for one fixed-size schematic marker.
     * @param {object} element CircuitJSON element.
     * @returns {number | null} Marker radius.
     */
    static #visibleRadius(element) {
        if (element.type === 'schematic_port') return 0.35
        if (element.type === 'schematic_voltage_probe') return 0.45
        if (
            element.type === 'schematic_debug_object' &&
            element.shape === 'point'
        ) {
            return 0.25
        }
        return SchematicGeometryBounds.#isDiagnostic(element) ? 0.45 : null
    }

    /**
     * Resolves half of the effective explicit SVG stroke or table border.
     * @param {object} element CircuitJSON element.
     * @param {object | undefined} table Related table model.
     * @returns {number} Nonnegative stroke margin.
     */
    static #strokeMargin(element, table) {
        const width =
            element.type === 'schematic_table' ||
            element.type === 'schematic_table_cell'
                ? table?.borderWidth
                : CircuitJsonUnits.optionalLength(
                      element.stroke_width ?? element.strokeWidth
                  )
        return Math.max(0, Number(width) || 0) / 2
    }

    /**
     * Returns whether an element is rendered as a diagnostic marker.
     * @param {object} element CircuitJSON element.
     * @returns {boolean} Whether the element is a schematic diagnostic.
     */
    static #isDiagnostic(element) {
        const type = String(element.type || '')
        return type.startsWith('schematic_') && /(?:error|warning)/iu.test(type)
    }

    /**
     * Includes visible standard text, port, probe, and debug labels.
     * @param {Record<string, number>} bounds Mutable bounds.
     * @param {object} element CircuitJSON element.
     * @param {Map<string, object>} sourcePorts Source-port lookup.
     * @param {WeakMap<object, string>} generatedLabels Generated label lookup.
     * @param {Map<string, object>} tables Table-model lookup.
     * @param {WeakMap<object, string> | null} portHintCache Render-scoped hint cache.
     * @returns {void}
     */
    static #includeVisibleText(
        bounds,
        element,
        sourcePorts,
        generatedLabels,
        tables,
        portHintCache
    ) {
        const type = String(element.type || '')
        let point = null
        let text = ''
        let fontSize = CircuitJsonUnits.optionalLength(element.font_size) ?? 1
        let anchor = element.anchor || element.anchor_side || ''
        let rotation = CircuitJsonUnits.angle(
            element.ccw_rotation ?? element.rotation,
            0
        )
        if (type === 'schematic_text' || type === 'schematic_net_label') {
            point = SchematicGeometryBounds.#point(
                element.anchor_position || element.position || element.center
            )
            text = String(element.text || element.name || '')
        } else if (
            type === 'schematic_component' ||
            type === 'schematic_symbol'
        ) {
            point = SchematicGeometryBounds.#point(element.center || element)
            text = generatedLabels.get(element) || ''
            anchor = 'center'
            rotation = 0
        } else if (type === 'schematic_group') {
            point = SchematicGeometryBounds.#point(element.center || element)
            text = String(element.name || element.schematic_group_id || '')
            anchor = 'center'
            rotation = 0
        } else if (type === 'schematic_table_cell') {
            const table = tables.get(
                String(element.schematic_table_id || '').trim()
            )
            const rect = SchematicTableGeometry.cellRect(element, table)
            if (rect) {
                const position = SchematicTableGeometry.textPosition(
                    element,
                    table,
                    rect
                )
                point = { x: position.x, y: position.y }
                anchor = position.namedAnchor
            }
            text = String(element.text || '')
            rotation = 0
        } else if (type === 'schematic_port') {
            const center = SchematicGeometryBounds.#point(element.center)
            if (center) point = { x: center.x + 0.7, y: center.y }
            const source = sourcePorts.get(String(element.source_port_id || ''))
            text = CircuitJsonSchematicSvgPortMetadata.label(
                element,
                source,
                portHintCache
            )
            anchor = 'center_left'
            rotation = 0
        } else if (type === 'schematic_voltage_probe') {
            const center = SchematicGeometryBounds.#point(
                element.position || element.center
            )
            if (center) point = { x: center.x + 0.65, y: center.y }
            text = String(element.name || element.label || '')
            anchor = 'center_left'
            rotation = 0
        } else if (type === 'schematic_debug_object') {
            point = SchematicGeometryBounds.#point(element.center)
            if (!point) {
                const start = SchematicGeometryBounds.#point(element.start)
                const end = SchematicGeometryBounds.#point(element.end)
                if (start && end) {
                    point = {
                        x: (start.x + end.x) / 2,
                        y: (start.y + end.y) / 2
                    }
                }
            }
            text = String(element.label ?? element.message ?? '')
            anchor = 'center'
            rotation = 0
        }
        if (!point || !text) return
        const textBounds = SchematicTextBounds.resolve(point, text, {
            fontSize,
            anchor,
            rotation
        })
        SchematicGeometryBounds.#include(bounds, {
            x: textBounds.minX,
            y: textBounds.minY
        })
        SchematicGeometryBounds.#include(bounds, {
            x: textBounds.maxX,
            y: textBounds.maxY
        })
    }

    /**
     * Reproduces generated component and symbol labels in renderer order.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, string>} sourceNames Source-component names.
     * @returns {WeakMap<object, string>} Element-label lookup.
     */
    static #generatedLabels(index, sourceNames) {
        const labels = new WeakMap()
        for (const [type, prefix] of [
            ['schematic_component', 'U'],
            ['schematic_symbol', 'SYM']
        ]) {
            const elements = index.elementsByType.get(type) || []
            for (
                let elementIndex = 0;
                elementIndex < elements.length;
                elementIndex += 1
            ) {
                const element = elements[elementIndex]
                if (element.show_label === false) continue
                labels.set(
                    element,
                    sourceNames.get(
                        String(element.source_component_id || '')
                    ) || String(element.name || prefix + (elementIndex + 1))
                )
            }
        }
        return labels
    }

    /**
     * Resolves one optional finite point.
     * @param {unknown} value Point candidate.
     * @returns {{ x: number, y: number } | null} Point.
     */
    static #point(value) {
        return CircuitJsonUnits.optionalPoint(value)
    }

    /**
     * Extends mutable bounds with one optional point.
     * @param {Record<string, number>} bounds Mutable bounds.
     * @param {{ x: number, y: number } | null} point Point.
     * @returns {void}
     */
    static #include(bounds, point) {
        if (!point) return
        bounds.minX = Math.min(bounds.minX, point.x)
        bounds.minY = Math.min(bounds.minY, point.y)
        bounds.maxX = Math.max(bounds.maxX, point.x)
        bounds.maxY = Math.max(bounds.maxY, point.y)
    }

    /**
     * Gives point-only and label-bearing geometry a stable visible canvas.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Recovered bounds.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }} Expanded bounds.
     */
    static #minimumExtent(bounds) {
        const centerX = (bounds.minX + bounds.maxX) / 2
        const centerY = (bounds.minY + bounds.maxY) / 2
        const width = Math.max(bounds.maxX - bounds.minX, 4)
        const height = Math.max(bounds.maxY - bounds.minY, 4)
        return {
            minX: centerX - width / 2,
            minY: centerY - height / 2,
            maxX: centerX + width / 2,
            maxY: centerY + height / 2,
            width,
            height
        }
    }
}
