import { ToolkitError } from '../contracts/ToolkitError.mjs'

const MODEL_FIELDS = [
    ['model_obj_url', 'obj'],
    ['model_stl_url', 'stl'],
    ['model_3mf_url', '3mf'],
    ['model_gltf_url', 'gltf'],
    ['model_glb_url', 'glb'],
    ['model_step_url', 'step'],
    ['model_wrl_url', 'wrl']
]

/**
 * Normalizes canonical CAD component model references.
 */
export class Scene3dModelReference {
    /**
     * Resolves the first canonical CAD model reference by field precedence.
     * @param {object} cadComponent CAD component element.
     * @returns {{ name: string, format: string, mediaType: string, requiresAsset: boolean, inlineModel?: unknown, generator?: string } | null} Model reference.
     */
    static fromCadComponent(cadComponent) {
        for (const [field, format] of MODEL_FIELDS) {
            const name = String(cadComponent[field] || '').trim()
            if (name) {
                return {
                    name: Scene3dModelReference.#boundedName(name),
                    format,
                    mediaType: Scene3dModelReference.#mediaType(format),
                    requiresAsset: true
                }
            }
        }
        const embedded = cadComponent.model_asset
        if (embedded && typeof embedded === 'object') {
            const name = String(
                embedded.project_relative_path || embedded.url || ''
            ).trim()
            if (name) {
                const format = Scene3dModelReference.#formatFromName(name)
                return {
                    name: Scene3dModelReference.#boundedName(name),
                    format,
                    mediaType: String(
                        embedded.mimetype ||
                            Scene3dModelReference.#mediaType(format)
                    ),
                    requiresAsset: true
                }
            }
        }
        if (
            Object.hasOwn(cadComponent, 'model_jscad') &&
            cadComponent.model_jscad !== undefined
        ) {
            return {
                name: '',
                format: 'jscad',
                mediaType: 'application/vnd.jscad+json',
                requiresAsset: false,
                inlineModel: cadComponent.model_jscad
            }
        }
        const footprinter = String(cadComponent.footprinter_string || '').trim()
        if (footprinter) {
            return {
                name: '',
                format: 'footprinter',
                mediaType: 'application/x-footprinter',
                requiresAsset: false,
                generator: Scene3dModelReference.#boundedName(footprinter)
            }
        }
        if (cadComponent.size || cadComponent.show_as_bounding_box === true) {
            return {
                name: '',
                format: 'bounding-box',
                mediaType: 'application/x-ecad-bounding-box',
                requiresAsset: false
            }
        }
        return null
    }

    /**
     * Normalizes a comparison-only asset path.
     * @param {unknown} value Path value.
     * @returns {string} Normalized path.
     */
    static normalizedPath(value) {
        return String(value || '')
            .replaceAll('\\', '/')
            .replace(/^\.\//u, '')
    }

    /**
     * Bounds one asset reference string.
     * @param {string} name Asset name.
     * @returns {string} Bounded name.
     */
    static #boundedName(name) {
        if (name.length > 4096) {
            throw new ToolkitError('Scene asset name exceeds the safe limit.', {
                code: 'ERR_ASSET_LIMIT',
                category: 'unsupported',
                details: { maximumCharacters: 4096 }
            })
        }
        return name
    }

    /**
     * Resolves a model format from a file suffix.
     * @param {string} name Asset name.
     * @returns {string} Lowercase model format.
     */
    static #formatFromName(name) {
        const suffix = name.split(/[?#]/u)[0].split('.').pop()
        return String(suffix || 'model').toLowerCase()
    }

    /**
     * Resolves a common model media type.
     * @param {string} format Model format.
     * @returns {string} Media type.
     */
    static #mediaType(format) {
        return format === 'gltf'
            ? 'model/gltf+json'
            : format === 'glb'
              ? 'model/gltf-binary'
              : `model/${format}`
    }
}
