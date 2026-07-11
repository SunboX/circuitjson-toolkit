import { freezeScene } from './Scene3dFreeze.mjs'
import { Scene3dOptions } from './Scene3dOptions.mjs'
import { PcbScene3dBuilder } from './PcbScene3dBuilder.mjs'
import { SceneAssetResolver } from './SceneAssetResolver.mjs'

/**
 * Asynchronously prepares canonical scenes and resolves requested model assets.
 */
export class PcbScene3dPreparator {
    /**
     * Builds one scene and resolves its assets only through injected options.
     * @param {unknown} input Document result, CircuitJSON model, or context.
     * @param {unknown} [options] Scene preparation options.
     * @returns {Promise<object>} Prepared canonical scene.
     */
    static async prepare(input, options = {}) {
        const normalized = Scene3dOptions.normalize(options)
        Scene3dOptions.assertNotAborted(normalized.signal)
        const scene = PcbScene3dBuilder.build(input, options)
        const hasUnresolvedAssets = scene.assets.some(
            (asset) => asset.data === null
        )
        if (
            hasUnresolvedAssets &&
            !normalized.resolveAsset &&
            normalized.fidelity !== 'native'
        ) {
            return scene
        }
        const assets = await SceneAssetResolver.resolveAll(
            scene.assets,
            options
        )
        Scene3dOptions.assertNotAborted(normalized.signal)
        if (!assets.length) return scene

        return freezeScene({
            ...scene,
            assets,
            statistics: {
                ...scene.statistics,
                assetCount: assets.length,
                resolvedAssetCount: assets.length
            }
        })
    }
}
