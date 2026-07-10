import { PcbRenderPlan } from '../core/rendering/PcbRenderPlan.mjs'
import { CircuitJsonPcbSvgRenderer } from './CircuitJsonPcbSvgRenderer.mjs'

/**
 * Renders canonical CircuitJSON PCB documents from one reusable plan.
 */
export class PcbSvgRenderer {
    /**
     * Renders one combined PCB SVG.
     * @param {unknown} document DocumentResult, CircuitJSON model, or context.
     * @param {Record<string, any>} [options] Canonical render options.
     * @returns {string} SVG markup.
     */
    static render(document, options = {}) {
        const plan = PcbRenderPlan.prepare(document, options)
        return CircuitJsonPcbSvgRenderer.renderPlan(plan)
    }

    /**
     * Renders every selected PCB layer from one primitive preparation.
     * @param {unknown} document DocumentResult, CircuitJSON model, or context.
     * @param {Record<string, any>} [options] Canonical render options.
     * @returns {{ schema: 'ecad-toolkit.render-set.v1', items: object[], diagnostics: object[], statistics: Record<string, number> }} Render set.
     */
    static renderLayers(document, options = {}) {
        const plan = PcbRenderPlan.prepare(document, options)
        return {
            schema: 'ecad-toolkit.render-set.v1',
            items: plan.layers.map((layer) => ({
                id: layer.id,
                side: plan.side,
                layerIds: [layer.id],
                svg: CircuitJsonPcbSvgRenderer.renderPlan(plan, {
                    layerIds: [layer.id]
                })
            })),
            diagnostics: structuredClone(plan.diagnostics),
            statistics: { ...plan.statistics }
        }
    }
}
