import { ToolkitError } from '../contracts/ToolkitError.mjs'

/**
 * Enforces unambiguous identifiers within canonical scene collections.
 */
export class Scene3dIdRegistry {
    /**
     * Rejects duplicate non-empty identifiers in one output collection.
     * @param {string} collection Canonical collection name.
     * @param {object[]} rows Canonical rows.
     * @returns {void}
     */
    static assertUnique(collection, rows) {
        const ids = new Set()
        for (const row of rows) {
            const id = row.id
            if (!id || !ids.has(id)) {
                if (id) ids.add(id)
                continue
            }
            throw new ToolkitError(
                `Scene ${collection} id is ambiguous: ${id}.`,
                {
                    code: 'ERR_SCENE_ID_AMBIGUOUS',
                    category: 'unsupported',
                    details: { collection, id }
                }
            )
        }
    }
}

Object.freeze(Scene3dIdRegistry.prototype)
Object.freeze(Scene3dIdRegistry)
