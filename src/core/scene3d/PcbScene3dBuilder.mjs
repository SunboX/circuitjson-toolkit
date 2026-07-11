import { CircuitJsonIndexer } from '../CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from '../CircuitJsonUnits.mjs'
import { ToolkitDiagnostic } from '../contracts/ToolkitDiagnostic.mjs'
import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { CircuitJsonDocumentContext } from '../context/CircuitJsonDocumentContext.mjs'
import { freezeScene } from './Scene3dFreeze.mjs'
import { Scene3dAssetIndex } from './Scene3dAssetIndex.mjs'
import { Scene3dBoardModel } from './Scene3dBoardModel.mjs'
import { Scene3dDocumentMetadata } from './Scene3dDocumentMetadata.mjs'
import { Scene3dInputPreflight } from './Scene3dInputPreflight.mjs'
import { Scene3dIdRegistry } from './Scene3dIdRegistry.mjs'
import { Scene3dMaterials } from './Scene3dMaterials.mjs'
import { Scene3dModelReference } from './Scene3dModelReference.mjs'
import { Scene3dOptions } from './Scene3dOptions.mjs'

const CANONICAL_SCENE_OWNERS = new WeakMap()
const ZONE_TYPES = new Set([
    'pcb_copper_pour',
    'pcb_ground_plane',
    'pcb_ground_plane_region'
])
const PAD_TYPES = new Set(['pcb_smtpad', 'pcb_plated_hole'])
const MAIN_TYPES = new Set([
    'pcb_board',
    'pcb_component',
    'pcb_trace',
    'pcb_via',
    ...PAD_TYPES,
    ...ZONE_TYPES
])
/**
 * Builds canonical, data-only PCB scene descriptions from CircuitJSON.
 */
export class PcbScene3dBuilder {
    /**
     * Builds one deterministic right-handed Z-up scene in millimeters.
     * @param {unknown} input Document result, CircuitJSON model, or context.
     * @param {unknown} [options] Scene options.
     * @returns {object} Canonical scene description.
     */
    static build(input, options = {}) {
        const normalized = Scene3dOptions.normalize(options)
        Scene3dOptions.assertNotAborted(normalized.signal)
        const assetsPreflighted = Scene3dInputPreflight.check(input, normalized)
        const context = CircuitJsonDocumentContext.prepare(input, {
            indexes: ['elements']
        })
        if (!assetsPreflighted) {
            Scene3dInputPreflight.checkAssets(context.assets, normalized)
        }
        const base = PcbScene3dBuilder.#canonical(context, normalized)
        if (normalized.fidelity === 'canonical') {
            return PcbScene3dBuilder.#sceneWithPlan(
                base,
                PcbScene3dBuilder.#cadPlan(context, false, normalized),
                false
            )
        }

        const native = PcbScene3dBuilder.#nativePlan(context, normalized)
        if (native) {
            return PcbScene3dBuilder.#sceneWithPlan(base, native, true)
        }
        return PcbScene3dBuilder.#sceneWithPlan(
            base,
            PcbScene3dBuilder.#cadPlan(context, false, normalized),
            false
        )
    }

    /**
     * Adds CAD assets and placements to one cached geometry foundation.
     * @param {object} base Cached canonical scene geometry.
     * @param {{ assets: object[], externalPlacements: object[] }} plan CAD plan.
     * @param {boolean} nativeFidelity Whether native fidelity was selected.
     * @returns {object} Materialized scene.
     */
    static #sceneWithPlan(base, plan, nativeFidelity) {
        if (
            !nativeFidelity &&
            !plan.assets.length &&
            !plan.externalPlacements.length
        ) {
            return base
        }
        return freezeScene({
            ...base,
            assets: plan.assets,
            externalPlacements: plan.externalPlacements,
            statistics: {
                ...base.statistics,
                assetCount: plan.assets.length,
                externalPlacementCount: plan.externalPlacements.length,
                nativeFidelity: nativeFidelity ? 1 : 0
            }
        })
    }

    /**
     * Returns one context-cached canonical scene foundation.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Normalized options.
     * @returns {object} Frozen canonical scene.
     */
    static #canonical(context, options) {
        const firstBoard = PcbScene3dBuilder.#all(
            context.getIndex('elements').elementsByType || new Map(),
            'pcb_board'
        )[0]
        const sourceThickness = CircuitJsonUnits.optionalLength(
            firstBoard?.thickness
        )
        const cacheThickness =
            !options.boardThicknessProvided &&
            sourceThickness !== null &&
            sourceThickness > 0 &&
            sourceThickness <= 1000
                ? sourceThickness
                : options.boardThickness
        const key = options.boardThicknessProvided
            ? `canonical:override:${options.boardThickness}`
            : `canonical:${cacheThickness}`
        const scene = context.getOrCreateDerived('scene3d', key, () => {
            const built = PcbScene3dBuilder.#buildCanonical(context, options)
            CANONICAL_SCENE_OWNERS.set(built, { context, key })
            return built
        })
        const owner = CANONICAL_SCENE_OWNERS.get(scene)
        if (owner?.context !== context || owner?.key !== key) {
            throw new ToolkitError(
                'CircuitJSON scene cache contains an unowned value.',
                {
                    code: 'ERR_CONTEXT_CACHE_COLLISION',
                    category: 'runtime',
                    details: { namespace: 'scene3d', key }
                }
            )
        }
        return scene
    }

    /**
     * Builds the canonical scene once for one context and thickness.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Normalized options.
     * @returns {object} Frozen scene.
     */
    static #buildCanonical(context, options) {
        const index = context.getIndex('elements')
        const byType = index.elementsByType || new Map()
        const boards = PcbScene3dBuilder.#all(byType, 'pcb_board')
        const cutouts = PcbScene3dBuilder.#all(byType, 'pcb_cutout')
        const boardModel = new Scene3dBoardModel(
            boards,
            cutouts,
            options.boardThickness,
            options.boardThicknessProvided
        )
        Scene3dIdRegistry.assertUnique(
            'board.outlines',
            boardModel.board.outlines
        )
        const components = PcbScene3dBuilder.#all(byType, 'pcb_component').map(
            (element) => PcbScene3dBuilder.#component(element, boardModel)
        )
        const pads = []
        for (const type of PAD_TYPES) {
            for (const element of PcbScene3dBuilder.#all(byType, type)) {
                pads.push(PcbScene3dBuilder.#pad(element, boardModel))
            }
        }
        const tracks = PcbScene3dBuilder.#all(byType, 'pcb_trace').map(
            (element) => PcbScene3dBuilder.#track(element, boardModel)
        )
        const vias = PcbScene3dBuilder.#all(byType, 'pcb_via').map((element) =>
            PcbScene3dBuilder.#via(element)
        )
        const zones = []
        for (const type of ZONE_TYPES) {
            for (const element of PcbScene3dBuilder.#all(byType, type)) {
                zones.push(PcbScene3dBuilder.#zone(element, boardModel))
            }
        }
        const texts = []
        const objects = []
        for (const element of context.model) {
            const type = String(element.type || '')
            if (PcbScene3dBuilder.#isTextType(type)) {
                texts.push(PcbScene3dBuilder.#text(element, boardModel))
                continue
            }
            if (PcbScene3dBuilder.#isObjectType(type)) {
                objects.push(PcbScene3dBuilder.#object(element, boardModel))
            }
        }
        const diagnostics = []
        const materials = Scene3dMaterials.build(boards)
        for (const [collection, rows] of Object.entries({
            components,
            pads,
            tracks,
            vias,
            zones,
            texts,
            objects
        })) {
            Scene3dIdRegistry.assertUnique(collection, rows)
        }
        if (!boards.length) {
            diagnostics.push(
                ToolkitDiagnostic.create({
                    code: 'SCENE_BOARD_MISSING',
                    severity: 'warning',
                    message: 'The CircuitJSON model contains no PCB board.',
                    source: Scene3dDocumentMetadata.sourceFileName(context),
                    details: {}
                })
            )
        }

        return freezeScene({
            schema: 'ecad-toolkit.scene3d.v1',
            units: 'mm',
            coordinateSystem: 'right-handed-z-up',
            board: boardModel.board,
            components,
            pads,
            tracks,
            vias,
            zones,
            texts,
            objects,
            materials,
            assets: [],
            externalPlacements: [],
            diagnostics,
            statistics: {
                elementCount: context.model.length,
                boardCount: boards.length,
                componentCount: components.length,
                padCount: pads.length,
                trackCount: tracks.length,
                viaCount: vias.length,
                zoneCount: zones.length,
                textCount: texts.length,
                objectCount: objects.length,
                materialCount: materials.length,
                assetCount: 0,
                externalPlacementCount: 0,
                nativeFidelity: 0
            }
        })
    }

    /**
     * Builds source-native CAD placement and asset records when fully usable.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Normalized options.
     * @returns {{ assets: object[], externalPlacements: object[] } | null} Native plan or canonical fallback.
     */
    static #nativePlan(context, options) {
        const format = Scene3dDocumentMetadata.sourceFormat(context)
        const extension = context.extensions?.[format]
        if (!Scene3dDocumentMetadata.hasNativeExtension(format, extension)) {
            if (options.fidelity === 'auto') return null
            throw new ToolkitError(
                `Native scene extension data is required for ${format}.`,
                {
                    code: 'ERR_EXTENSION_DATA_REQUIRED',
                    category: 'unsupported',
                    format,
                    source: Scene3dDocumentMetadata.sourceFileName(context),
                    details: { format, feature: 'scene3d' }
                }
            )
        }

        if (options.fidelity === 'auto') {
            const cadComponents = PcbScene3dBuilder.#all(
                context.getIndex('elements').elementsByType || new Map(),
                'cad_component'
            )
            for (const component of cadComponents) {
                const reference =
                    Scene3dModelReference.fromCadComponent(component)
                if (!reference?.requiresAsset) return null
            }
        }

        const plan = PcbScene3dBuilder.#cadPlan(context, true, options)
        if (!plan.externalPlacements.length) {
            if (options.fidelity === 'auto') return null
            throw new ToolkitError(
                `Native scene placement data is required for ${format}.`,
                {
                    code: 'ERR_EXTENSION_DATA_REQUIRED',
                    category: 'unsupported',
                    format,
                    source: Scene3dDocumentMetadata.sourceFileName(context),
                    details: { format, feature: 'scene3d-placements' }
                }
            )
        }
        const unresolved = plan.assets.find((asset) => asset.data === null)
        if (unresolved && !options.resolveAsset) {
            if (options.fidelity === 'auto') return null
            throw new ToolkitError(
                `Native scene asset data is required: ${unresolved.id}.`,
                {
                    code: 'ERR_ASSET_DATA_REQUIRED',
                    category: 'unsupported',
                    format,
                    source: Scene3dDocumentMetadata.sourceFileName(context),
                    details: { assetId: unresolved.id }
                }
            )
        }
        return plan
    }

    /**
     * Builds canonical CAD placement records and their asset requests.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @param {boolean} requireReferences Whether every CAD row needs a model.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Scene options.
     * @returns {{ assets: object[], externalPlacements: object[] }} CAD plan.
     */
    static #cadPlan(context, requireReferences, options) {
        const cadComponents = PcbScene3dBuilder.#all(
            context.getIndex('elements').elementsByType || new Map(),
            'cad_component'
        )
        if (cadComponents.length > Scene3dOptions.maxAssetCount) {
            throw new ToolkitError(
                'Scene asset count exceeds the safe limit.',
                {
                    code: 'ERR_ASSET_LIMIT',
                    category: 'unsupported',
                    details: {
                        count: cadComponents.length,
                        maximum: Scene3dOptions.maxAssetCount
                    }
                }
            )
        }
        if (!cadComponents.length) {
            return { assets: [], externalPlacements: [] }
        }
        const assetIndex = new Scene3dAssetIndex(context.assets, options)
        const externalPlacements = []
        const format = Scene3dDocumentMetadata.sourceFormat(context)

        for (const cadComponent of cadComponents) {
            const reference =
                Scene3dModelReference.fromCadComponent(cadComponent)
            if (!reference || (requireReferences && !reference.requiresAsset)) {
                if (requireReferences) {
                    throw new ToolkitError(
                        `CAD component has no model asset reference: ${PcbScene3dBuilder.#id(cadComponent)}.`,
                        {
                            code: 'ERR_ASSET_DATA_REQUIRED',
                            category: 'unsupported',
                            format,
                            source: Scene3dDocumentMetadata.sourceFileName(
                                context
                            ),
                            details: {
                                cadComponentId:
                                    PcbScene3dBuilder.#id(cadComponent)
                            }
                        }
                    )
                }
                continue
            }
            const asset = reference.requiresAsset
                ? assetIndex.resolve(reference)
                : null
            externalPlacements.push(
                PcbScene3dBuilder.#externalPlacement(
                    cadComponent,
                    reference,
                    asset,
                    format,
                    context
                )
            )
        }

        Scene3dIdRegistry.assertUnique('externalPlacements', externalPlacements)
        return { assets: assetIndex.assets, externalPlacements }
    }

    /**
     * Builds one canonical external placement.
     * @param {object} cadComponent CAD component.
     * @param {{ name: string, format: string, inlineModel?: unknown, generator?: string }} reference Model reference.
     * @param {object | null} asset Canonical asset.
     * @param {string} format Source format.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {object} External placement record.
     */
    static #externalPlacement(cadComponent, reference, asset, format, context) {
        const componentId = String(cadComponent.pcb_component_id || '')
        const linked = context
            .getIndex('elements')
            .pcbComponentById?.get(componentId)
        const side = PcbScene3dBuilder.#side(
            cadComponent.layer || linked?.layer
        )
        return {
            id: PcbScene3dBuilder.#id(cadComponent),
            componentId,
            sourceComponentId: String(cadComponent.source_component_id || ''),
            side,
            position: PcbScene3dBuilder.#point3(cadComponent.position),
            rotation: PcbScene3dBuilder.#point3(cadComponent.rotation),
            size: PcbScene3dBuilder.#point3(cadComponent.size),
            scale: PcbScene3dBuilder.#positiveNumber(
                cadComponent.model_unit_to_mm_scale_factor,
                1
            ),
            model: {
                assetId: asset?.id || null,
                format: reference.format,
                name: reference.name,
                inlineModel: reference.inlineModel ?? null,
                generator: reference.generator || '',
                boardNormalDirection: String(
                    cadComponent.model_board_normal_direction || 'z+'
                ),
                originPosition: PcbScene3dBuilder.#point3(
                    cadComponent.model_origin_position
                ),
                originAlignment: String(
                    cadComponent.model_origin_alignment || 'unknown'
                ),
                objectFit: String(
                    cadComponent.model_object_fit || 'contain_within_bounds'
                )
            },
            translucent: cadComponent.show_as_translucent_model === true,
            boundingBox: cadComponent.show_as_bounding_box === true,
            extensionRef: {
                format,
                cadComponentId: PcbScene3dBuilder.#id(cadComponent)
            }
        }
    }

    /**
     * Maps one PCB component to a canonical placement.
     * @param {object} element PCB component.
     * @param {Scene3dBoardModel} boardModel Board geometry model.
     * @returns {object} Scene component.
     */
    static #component(element, boardModel) {
        const side = PcbScene3dBuilder.#side(element.layer)
        const center = PcbScene3dBuilder.#point2(element.center)
        return {
            id: PcbScene3dBuilder.#id(element),
            sourceComponentId: String(element.source_component_id || ''),
            side,
            position: {
                ...center,
                z: boardModel.surfaceZ(side, center)
            },
            rotation: {
                x: 0,
                y: 0,
                z: CircuitJsonUnits.angle(element.rotation, 0)
            },
            size: {
                x: CircuitJsonUnits.length(element.width, 0),
                y: CircuitJsonUnits.length(element.height, 0),
                z: CircuitJsonUnits.length(
                    element.height_3d || element.depth,
                    0
                )
            },
            materialId: 'component-body'
        }
    }

    /**
     * Maps one SMT or plated pad.
     * @param {object} element Pad element.
     * @param {Scene3dBoardModel} boardModel Board geometry model.
     * @returns {object} Scene pad.
     */
    static #pad(element, boardModel) {
        const side = PcbScene3dBuilder.#side(element.layer)
        const position = PcbScene3dBuilder.#elementPoint(element)
        const diameter = CircuitJsonUnits.length(
            element.outer_diameter || element.diameter,
            0
        )
        return {
            id: PcbScene3dBuilder.#id(element),
            componentId: String(element.pcb_component_id || ''),
            side,
            layerId: String(element.layer || ''),
            position: {
                ...position,
                z: boardModel.surfaceZ(side, position)
            },
            rotation: {
                x: 0,
                y: 0,
                z: CircuitJsonUnits.angle(
                    element.ccw_rotation || element.rotation,
                    0
                )
            },
            shape: String(element.shape || element.hole_shape || 'circle'),
            size: {
                x: CircuitJsonUnits.length(element.width, diameter),
                y: CircuitJsonUnits.length(element.height, diameter)
            },
            holeDiameter: CircuitJsonUnits.length(element.hole_diameter, 0),
            points: PcbScene3dBuilder.#points(element.points),
            netId: String(element.net_id || element.net || ''),
            materialId: 'copper'
        }
    }

    /**
     * Maps one routed trace with per-route-point surface coordinates.
     * @param {object} element PCB trace.
     * @param {Scene3dBoardModel} boardModel Board geometry model.
     * @returns {object} Scene track.
     */
    static #track(element, boardModel) {
        const route = []
        for (const point of Array.isArray(element.route) ? element.route : []) {
            const side = PcbScene3dBuilder.#side(point.layer || element.layer)
            const position = PcbScene3dBuilder.#elementPoint(point)
            route.push({
                kind: String(point.route_type || point.type || 'wire'),
                position: {
                    ...position,
                    z: boardModel.surfaceZ(side, position)
                },
                width: CircuitJsonUnits.length(point.width || element.width, 0),
                layerId: String(point.layer || element.layer || ''),
                viaId: String(point.pcb_via_id || '')
            })
        }
        return {
            id: PcbScene3dBuilder.#id(element),
            netId: String(element.net_id || element.net || ''),
            route,
            materialId: 'copper'
        }
    }

    /**
     * Maps one PCB via.
     * @param {object} element Via element.
     * @returns {object} Scene via.
     */
    static #via(element) {
        const layers = Array.isArray(element.layers)
            ? element.layers.map(String)
            : [element.from_layer, element.to_layer].map(String).filter(Boolean)
        return {
            id: PcbScene3dBuilder.#id(element),
            position: { ...PcbScene3dBuilder.#elementPoint(element), z: 0 },
            diameter: CircuitJsonUnits.length(
                element.outer_diameter || element.diameter,
                0
            ),
            holeDiameter: CircuitJsonUnits.length(element.hole_diameter, 0),
            layerIds: layers,
            netId: String(element.net_id || element.net || ''),
            materialId: 'copper'
        }
    }

    /**
     * Maps one copper zone.
     * @param {object} element Zone element.
     * @param {Scene3dBoardModel} boardModel Board geometry model.
     * @returns {object} Scene zone.
     */
    static #zone(element, boardModel) {
        const side = PcbScene3dBuilder.#side(element.layer)
        const position = PcbScene3dBuilder.#elementPoint(element)
        return {
            id: PcbScene3dBuilder.#id(element),
            side,
            layerId: String(element.layer || ''),
            position: {
                ...position,
                z: boardModel.surfaceZ(side, position)
            },
            shape: String(element.shape || 'polygon'),
            points: PcbScene3dBuilder.#points(element.points),
            rings: PcbScene3dBuilder.#rings(element.rings),
            netId: String(element.net_id || element.net || ''),
            materialId: 'copper'
        }
    }

    /**
     * Maps one PCB text element.
     * @param {object} element Text element.
     * @param {Scene3dBoardModel} boardModel Board geometry model.
     * @returns {object} Scene text.
     */
    static #text(element, boardModel) {
        const side = PcbScene3dBuilder.#side(element.layer)
        const position = PcbScene3dBuilder.#elementPoint(element)
        return {
            id: PcbScene3dBuilder.#id(element),
            kind: String(element.type),
            side,
            layerId: String(element.layer || ''),
            position: {
                ...position,
                z: boardModel.surfaceZ(side, position)
            },
            rotation: {
                x: 0,
                y: 0,
                z: CircuitJsonUnits.angle(element.rotation, 0)
            },
            value: String(element.text || element.value || ''),
            size: CircuitJsonUnits.length(
                element.font_size || element.fontSize,
                0
            ),
            materialId: String(element.type).includes('silkscreen')
                ? 'silkscreen'
                : 'copper'
        }
    }

    /**
     * Maps an additional PCB geometry object.
     * @param {object} element PCB element.
     * @param {Scene3dBoardModel} boardModel Board geometry model.
     * @returns {object} Generic scene object.
     */
    static #object(element, boardModel) {
        const side = PcbScene3dBuilder.#side(element.layer)
        const position = PcbScene3dBuilder.#elementPoint(element)
        return {
            id: PcbScene3dBuilder.#id(element),
            kind: String(element.type),
            side,
            layerId: String(element.layer || ''),
            position: {
                ...position,
                z: String(element.layer || '').includes('board')
                    ? 0
                    : boardModel.surfaceZ(side, position)
            },
            rotation: {
                x: 0,
                y: 0,
                z: CircuitJsonUnits.angle(
                    element.rotation || element.ccw_rotation,
                    0
                )
            },
            size: {
                x: CircuitJsonUnits.length(
                    element.width || element.diameter,
                    0
                ),
                y: CircuitJsonUnits.length(
                    element.height || element.diameter,
                    0
                ),
                z: 0
            },
            points: PcbScene3dBuilder.#points(element.points || element.route),
            materialId: String(element.type).includes('silkscreen')
                ? 'silkscreen'
                : 'board-core'
        }
    }

    /**
     * Returns true for PCB text element types.
     * @param {string} type Element type.
     * @returns {boolean} Whether the type is text.
     */
    static #isTextType(type) {
        return (
            type === 'pcb_text' ||
            (type.startsWith('pcb_') && type.endsWith('_text'))
        )
    }

    /**
     * Returns true for additional non-diagnostic PCB geometry.
     * @param {string} type Element type.
     * @returns {boolean} Whether the element belongs in objects.
     */
    static #isObjectType(type) {
        return (
            type.startsWith('pcb_') &&
            !MAIN_TYPES.has(type) &&
            !PcbScene3dBuilder.#isTextType(type) &&
            !/(?:error|warning)$/u.test(type)
        )
    }

    /**
     * Returns an element list for one indexed type.
     * @param {Map<string, object[]>} byType Element type map.
     * @param {string} type Element type.
     * @returns {object[]} Elements.
     */
    static #all(byType, type) {
        const values = byType.get(type)
        return Array.isArray(values) ? values : []
    }

    /**
     * Resolves the standard element id.
     * @param {object} element CircuitJSON element.
     * @returns {string} Element id.
     */
    static #id(element) {
        return CircuitJsonIndexer.getElementId(element)
    }

    /**
     * Resolves a canonical element position.
     * @param {object} element CircuitJSON element or route point.
     * @returns {{ x: number, y: number }} Position.
     */
    static #elementPoint(element) {
        if (element.center && typeof element.center === 'object') {
            return PcbScene3dBuilder.#point2(element.center)
        }
        if (element.position && typeof element.position === 'object') {
            return PcbScene3dBuilder.#point2(element.position)
        }
        if (element.x !== undefined || element.y !== undefined) {
            return PcbScene3dBuilder.#point2({
                x: element.x,
                y: element.y
            })
        }
        const points = PcbScene3dBuilder.#points(element.points)
        if (points.length) return PcbScene3dBuilder.#representativePoint(points)
        const rings = PcbScene3dBuilder.#rings(element.rings)
        if (rings[0]?.length) {
            return PcbScene3dBuilder.#representativePoint(rings[0])
        }
        return { x: 0, y: 0 }
    }

    /**
     * Returns the arithmetic center of one non-empty geometry point set.
     * @param {{ x: number, y: number }[]} points Canonical points.
     * @returns {{ x: number, y: number }} Representative point.
     */
    static #representativePoint(points) {
        let x = 0
        let y = 0
        for (const point of points) {
            x += point.x
            y += point.y
        }
        const center = { x: x / points.length, y: y / points.length }
        if (PcbScene3dBuilder.#polygonContains(center, points)) return center
        for (let index = 0; index < points.length; index += 1) {
            const start = points[index]
            const end = points[(index + 1) % points.length]
            if (start.x === end.x && start.y === end.y) continue
            return {
                x: (start.x + end.x) / 2,
                y: (start.y + end.y) / 2
            }
        }
        return { ...points[0] }
    }

    /**
     * Tests whether a point lies inside or on one polygon.
     * @param {{ x: number, y: number }} point Candidate point.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @returns {boolean} Whether the polygon contains the point.
     */
    static #polygonContains(point, points) {
        let inside = false
        for (
            let current = 0, previous = points.length - 1;
            current < points.length;
            previous = current, current += 1
        ) {
            const a = points[current]
            const b = points[previous]
            if (PcbScene3dBuilder.#pointOnSegment(point, a, b)) return true
            const crosses =
                a.y > point.y !== b.y > point.y &&
                point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
            if (crosses) inside = !inside
        }
        return inside
    }

    /**
     * Tests whether a point lies on a closed line segment.
     * @param {{ x: number, y: number }} point Candidate point.
     * @param {{ x: number, y: number }} start Segment start.
     * @param {{ x: number, y: number }} end Segment end.
     * @returns {boolean} Whether the point lies on the segment.
     */
    static #pointOnSegment(point, start, end) {
        const cross =
            (point.y - start.y) * (end.x - start.x) -
            (point.x - start.x) * (end.y - start.y)
        if (Math.abs(cross) > 1e-9) return false
        return (
            point.x >= Math.min(start.x, end.x) &&
            point.x <= Math.max(start.x, end.x) &&
            point.y >= Math.min(start.y, end.y) &&
            point.y <= Math.max(start.y, end.y)
        )
    }

    /**
     * Normalizes a two-dimensional point.
     * @param {unknown} point Point candidate.
     * @returns {{ x: number, y: number }} Point.
     */
    static #point2(point) {
        return {
            x: CircuitJsonUnits.length(point?.x, 0),
            y: CircuitJsonUnits.length(point?.y, 0)
        }
    }

    /**
     * Normalizes a three-dimensional point.
     * @param {unknown} point Point candidate.
     * @returns {{ x: number, y: number, z: number }} Point.
     */
    static #point3(point) {
        return {
            x: CircuitJsonUnits.length(point?.x, 0),
            y: CircuitJsonUnits.length(point?.y, 0),
            z: CircuitJsonUnits.length(point?.z, 0)
        }
    }

    /**
     * Maps a bounded point array without variadic spreads.
     * @param {unknown} points Point candidates.
     * @returns {{ x: number, y: number }[]} Points.
     */
    static #points(points) {
        if (!Array.isArray(points)) return []
        const result = []
        for (const point of points) {
            if (!point || typeof point !== 'object') continue
            result.push(PcbScene3dBuilder.#point2(point))
        }
        return result
    }

    /**
     * Maps nested polygon rings.
     * @param {unknown} rings Ring candidates.
     * @returns {{ x: number, y: number }[][]} Rings.
     */
    static #rings(rings) {
        if (!Array.isArray(rings)) return []
        const result = []
        for (const ring of rings) {
            if (Array.isArray(ring)) {
                result.push(PcbScene3dBuilder.#points(ring))
            } else if (Array.isArray(ring?.points)) {
                result.push(PcbScene3dBuilder.#points(ring.points))
            }
        }
        return result
    }

    /**
     * Resolves top or bottom from a common layer value.
     * @param {unknown} layer Layer candidate.
     * @returns {'top' | 'bottom'} Canonical side.
     */
    static #side(layer) {
        const value = String(layer || '').toLowerCase()
        return /(?:bottom|back|b\.)/u.test(value) ? 'bottom' : 'top'
    }

    /**
     * Normalizes a positive number.
     * @param {unknown} value Candidate number.
     * @param {number} fallback Fallback number.
     * @returns {number} Positive number.
     */
    static #positiveNumber(value, fallback) {
        const number = Number(value)
        return Number.isFinite(number) && number > 0 ? number : fallback
    }
}
