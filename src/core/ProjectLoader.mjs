import { ArchiveEntryPath } from './ArchiveEntryPath.mjs'
import { ArchiveLimits } from './ArchiveLimits.mjs'
import { AsyncInputOwnership } from './AsyncInputOwnership.mjs'
import { AttachedValueLimits } from './AttachedValueLimits.mjs'
import { Parser } from './Parser.mjs'
import { ParserOptions } from './ParserOptions.mjs'
import { ProjectAsyncInputOwner } from './ProjectAsyncInputOwner.mjs'
import { ProjectResult } from './contracts/ProjectResult.mjs'
import { ToolkitDiagnostic } from './contracts/ToolkitDiagnostic.mjs'
import { ToolkitError } from './contracts/ToolkitError.mjs'
import { ToolkitProgress } from './contracts/ToolkitProgress.mjs'
import { ToolkitAsset } from './contracts/ToolkitAsset.mjs'
import { ParserWorkerClient } from './worker/ParserWorkerClient.mjs'

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    'aborted'
)?.get
const PARSER_OPTION_KEYS = [
    'preserveRaw',
    'decodeAssets',
    'extensions',
    'reports',
    'retainSource',
    'worker',
    'transferInput',
    'signal',
    'onProgress'
]

/**
 * Loads one or more named CircuitJSON entries into a canonical project result.
 */
export class ProjectLoader {
    /**
     * Loads supported entries synchronously with deterministic partial success.
     * @param {Array<{ name: string, data: string | ArrayBuffer | Uint8Array }>} entries Named entries.
     * @param {Record<string, any>} [options] Common project/parser options.
     * @returns {Record<string, any>} Canonical project result.
     */
    static load(entries, options = {}) {
        try {
            const normalizedOptions = ProjectLoader.#normalizeOptions(options)
            if (normalizedOptions.worker === true) {
                throw ProjectLoader.#workerSyncError()
            }
            const snapshot = ProjectLoader.#snapshotEntries(
                entries,
                normalizedOptions.archiveLimits.maxEntries
            )
            const classified = ProjectLoader.#classify(
                snapshot,
                normalizedOptions.archiveLimits,
                normalizedOptions.decodeAssets
            )
            ProjectLoader.#assertCandidates(classified)

            const documents = []
            const diagnostics = []
            for (const entry of classified.candidates) {
                ProjectLoader.#parseEntry(
                    entry,
                    normalizedOptions,
                    documents,
                    diagnostics
                )
            }
            return ProjectLoader.#result(
                classified,
                documents,
                diagnostics,
                normalizedOptions
            )
        } catch (error) {
            throw ProjectLoader.#errorFrom(error)
        }
    }

    /**
     * Loads entries without throwing public project-loading failures.
     * @param {Array<{ name: string, data: string | ArrayBuffer | Uint8Array }>} entries Named entries.
     * @param {Record<string, any>} [options] Common project/parser options.
     * @returns {{ ok: true, value: Record<string, any> } | { ok: false, error: ToolkitError, diagnostics: object[] }} Discriminated load result.
     */
    static tryLoad(entries, options = {}) {
        try {
            return { ok: true, value: ProjectLoader.load(entries, options) }
        } catch (error) {
            const normalized = ProjectLoader.#errorFrom(error)
            const diagnostics = Array.isArray(normalized.details?.diagnostics)
                ? normalized.details.diagnostics.map((diagnostic) =>
                      ToolkitDiagnostic.create(diagnostic)
                  )
                : []
            if (!diagnostics.length) {
                diagnostics.push(
                    ToolkitDiagnostic.create({
                        code: normalized.code,
                        severity: 'error',
                        message: normalized.message,
                        source: normalized.source
                    })
                )
            }
            return { ok: false, error: normalized, diagnostics }
        }
    }

    /**
     * Loads entries incrementally while yielding and checking cancellation.
     * @param {Array<{ name: string, data: string | ArrayBuffer | Uint8Array }>} entries Named entries.
     * @param {Record<string, any>} [options] Common project/parser options.
     * @returns {Promise<Record<string, any>>} Canonical project result.
     */
    static async loadAsync(entries, options = {}) {
        let normalizedOptions
        let snapshot
        let classified
        const entriesOwned = AsyncInputOwnership.ownsProject(entries)
        try {
            normalizedOptions = ProjectLoader.#normalizeOptions(options)
            ProjectLoader.#assertNotCancelled(normalizedOptions.signal)
            snapshot = ProjectLoader.#snapshotEntries(
                entries,
                normalizedOptions.archiveLimits.maxEntries
            )
            classified = ProjectLoader.#classify(
                snapshot,
                normalizedOptions.archiveLimits,
                normalizedOptions.decodeAssets
            )
            ProjectLoader.#assertCandidates(classified)
        } catch (error) {
            throw ProjectLoader.#errorFrom(error)
        }
        const useWorker =
            normalizedOptions.worker === true ||
            (normalizedOptions.worker === 'auto' &&
                normalizedOptions.retainSource !== 'reference' &&
                ParserWorkerClient.isDefaultAvailable())
        if (useWorker) {
            const attempt = await ParserWorkerClient.loadProjectDefault(
                snapshot,
                normalizedOptions
            )
            if (attempt.ok) return attempt.value
            if (normalizedOptions.worker !== 'auto' || !attempt.unavailable) {
                throw attempt.error
            }
            ParserWorkerClient.disposeDefault()
        }

        try {
            if (!entriesOwned) {
                ProjectAsyncInputOwner.own(
                    classified,
                    normalizedOptions.decodeAssets
                )
            }
        } catch (error) {
            throw ProjectLoader.#errorFrom(error)
        }

        let progress = ProjectLoader.#progress(
            normalizedOptions,
            { stage: 'detect', message: 'Classifying project entries.' },
            null
        )
        await ProjectLoader.#yieldToHost(Boolean(normalizedOptions.signal))
        ProjectLoader.#assertNotCancelled(normalizedOptions.signal)

        progress = ProjectLoader.#progress(
            normalizedOptions,
            {
                stage: 'project',
                completed: 0,
                total: classified.candidates.length,
                message: 'Loading CircuitJSON project entries.'
            },
            progress
        )

        const documents = []
        const diagnostics = []
        for (let index = 0; index < classified.candidates.length; index += 1) {
            await ProjectLoader.#yieldToHost(Boolean(normalizedOptions.signal))
            ProjectLoader.#assertNotCancelled(normalizedOptions.signal)
            ProjectLoader.#parseEntry(
                classified.candidates[index],
                normalizedOptions,
                documents,
                diagnostics
            )
            progress = ProjectLoader.#progress(
                normalizedOptions,
                {
                    stage: 'project',
                    completed: index + 1,
                    total: classified.candidates.length,
                    detail: classified.candidates[index].name,
                    message: 'Loaded CircuitJSON project entry.'
                },
                progress
            )
            ProjectLoader.#assertNotCancelled(normalizedOptions.signal)
        }

        const result = ProjectLoader.#result(
            classified,
            documents,
            diagnostics,
            normalizedOptions
        )
        ProjectLoader.#progress(
            normalizedOptions,
            {
                stage: 'complete',
                completed: classified.candidates.length,
                total: classified.candidates.length,
                message: 'CircuitJSON project loading complete.'
            },
            progress
        )
        ProjectLoader.#assertNotCancelled(normalizedOptions.signal)
        return result
    }

    /**
     * Performs bounded name/prefix classification without parsing every entry.
     * @param {unknown} entries Named entry candidates.
     * @returns {boolean} Whether a canonical CircuitJSON candidate is present.
     */
    static supports(entries) {
        try {
            const entryDescriptors = ProjectLoader.#entryArray(entries)
            const length = entryDescriptors.length.value
            if (!length || length > ArchiveLimits.defaults.maxEntries) {
                return false
            }

            const names = []
            let supported = false
            for (let index = 0; index < length; index += 1) {
                const entry = entryDescriptors[String(index)].value
                const fields = ProjectLoader.#entryFields(entry)
                const name = ArchiveEntryPath.normalize(fields.name)
                names.push(name)
                if (
                    name.toLowerCase().endsWith('.json') &&
                    Parser.supports({ fileName: name, data: fields.data })
                ) {
                    supported = true
                }
            }
            ArchiveEntryPath.unique(names)
            return supported
        } catch {
            return false
        }
    }

    /**
     * Normalizes project and parser options without decoding an entry.
     * @param {unknown} options Caller options.
     * @returns {Record<string, any>} Normalized options.
     */
    static #normalizeOptions(options) {
        try {
            const descriptors = ProjectLoader.#plainDescriptors(
                options,
                'Project loader options must be a plain object.'
            )
            const parserOptions = {}
            for (const key of PARSER_OPTION_KEYS) {
                if (descriptors[key]) {
                    parserOptions[key] = descriptors[key].value
                }
            }
            const normalized = ParserOptions.normalize(
                { fileName: '', data: '[]' },
                parserOptions
            ).options
            if (normalized.signal !== undefined && normalized.signal !== null) {
                ProjectLoader.#signalState(normalized.signal)
            }
            const archiveLimits = ArchiveLimits.normalize(
                descriptors.archiveLimits
                    ? descriptors.archiveLimits.value
                    : undefined
            )
            return { ...normalized, archiveLimits }
        } catch (error) {
            throw ProjectLoader.#inputError(error)
        }
    }

    /**
     * Validates, measures, and classifies all entries before parsing.
     * @param {unknown} entries Named entry candidates.
     * @param {Record<string, number>} limits Normalized safety limits.
     * @param {'none' | 'metadata' | 'full'} assetMode Asset decode mode.
     * @returns {{ entries: object[], candidates: object[], entryNames: string[], totalBytes: number }} Classified entries.
     */
    static #classify(entries, limits, assetMode) {
        const entryDescriptors = ProjectLoader.#entryArray(entries)
        const entryCount = entryDescriptors.length.value
        if (!entryCount) {
            throw ProjectLoader.#inputError(
                new TypeError('Project entries must be a non-empty array.')
            )
        }
        ProjectLoader.#assertLimit('maxEntries', limits.maxEntries, entryCount)

        const prepared = []
        let totalBytes = 0
        for (let index = 0; index < entryCount; index += 1) {
            const entry = entryDescriptors[String(index)].value
            const fields = ProjectLoader.#entryFields(entry)
            const name = ArchiveEntryPath.normalize(fields.name)
            const byteLength = ProjectLoader.#byteLength(fields.data)
            let entryBytes = byteLength
            ProjectLoader.#assertLimit(
                'maxEntryBytes',
                limits.maxEntryBytes,
                entryBytes,
                name
            )
            totalBytes += byteLength
            ProjectLoader.#assertLimit(
                'maxTotalBytes',
                limits.maxTotalBytes,
                totalBytes
            )

            const archiveDepth = ProjectLoader.#metadataInteger(
                fields.archiveDepth,
                'archiveDepth',
                0
            )
            ProjectLoader.#assertLimit(
                'maxArchiveDepth',
                limits.maxArchiveDepth,
                archiveDepth,
                name
            )
            ProjectLoader.#assertCompressionRatio(
                byteLength,
                fields.compressedByteLength,
                limits.maxCompressionRatio,
                name
            )

            const input = { fileName: name, data: fields.data }
            if (fields.assets !== undefined) {
                try {
                    input.assets = ToolkitAsset.prepareAll(fields.assets, {
                        mode: assetMode,
                        acceptPayload: (assetBytes) => {
                            entryBytes += assetBytes
                            ProjectLoader.#assertLimit(
                                'maxEntryBytes',
                                limits.maxEntryBytes,
                                entryBytes,
                                name
                            )
                            totalBytes += assetBytes
                            ProjectLoader.#assertLimit(
                                'maxTotalBytes',
                                limits.maxTotalBytes,
                                totalBytes,
                                name
                            )
                        }
                    })
                } catch (error) {
                    if (error instanceof ToolkitError) throw error
                    throw ProjectLoader.#inputError(error)
                }
            }
            prepared.push({ name, byteLength, input })
        }

        const entryNames = ArchiveEntryPath.unique(
            prepared.map((entry) => entry.name)
        )
        const candidates = prepared
            .filter((entry) => entry.name.toLowerCase().endsWith('.json'))
            .sort((left, right) =>
                left.name < right.name ? -1 : left.name > right.name ? 1 : 0
            )
        return { entries: prepared, candidates, entryNames, totalBytes }
    }

    /**
     * Captures only public project fields before any callback, yield, or worker
     * boundary. This isolates classification from later caller mutation and
     * gives direct and worker paths the same descriptor policy.
     * @param {unknown} entries Named entry candidates.
     * @param {number} maximumEntries Configured project-entry ceiling.
     * @returns {object[]} Dense stable request snapshot.
     */
    static #snapshotEntries(entries, maximumEntries) {
        const descriptors = ProjectLoader.#entryArray(entries, maximumEntries)
        const length = descriptors.length.value
        let attachedValues = 0
        const snapshot = new Array(length)
        for (let index = 0; index < length; index += 1) {
            const fields = ProjectLoader.#entryFields(
                descriptors[String(index)].value
            )
            const captured = { name: fields.name, data: fields.data }
            if (fields.assets !== undefined) {
                attachedValues = AttachedValueLimits.add(
                    fields.assets,
                    attachedValues
                )
                captured.assets = ProjectLoader.#attachedValueSnapshot(
                    fields.assets
                )
            }
            if (fields.compressedByteLength !== undefined) {
                captured.compressedByteLength = fields.compressedByteLength
            }
            if (fields.archiveDepth !== undefined) {
                captured.archiveDepth = fields.archiveDepth
            }
            snapshot[index] = captured
        }
        return snapshot
    }

    /**
     * Captures one dense attached-value array without reading item properties.
     * @param {unknown} values Attached-value array candidate.
     * @returns {unknown[]} Stable array of attached value identities.
     */
    static #attachedValueSnapshot(values) {
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(values)
            descriptors = Object.getOwnPropertyDescriptors(values)
        } catch {
            throw ProjectLoader.#inputError(
                new TypeError(
                    'Project entry assets must be a dense plain array.'
                )
            )
        }
        const length = descriptors.length?.value
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            Reflect.ownKeys(descriptors).length !== length + 1
        ) {
            throw ProjectLoader.#inputError(
                new TypeError(
                    'Project entry assets must be a dense plain array.'
                )
            )
        }
        const snapshot = new Array(length)
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                throw ProjectLoader.#inputError(
                    new TypeError(
                        'Project entry assets must contain enumerable data properties.'
                    )
                )
            }
            snapshot[index] = descriptor.value
        }
        return snapshot
    }

    /**
     * Reads one entry through own data properties only.
     * @param {unknown} entry Entry candidate.
     * @returns {{ name: unknown, data: unknown, assets?: unknown, compressedByteLength?: unknown, archiveDepth?: unknown }} Entry fields.
     */
    static #entryFields(entry) {
        const descriptors = ProjectLoader.#plainDescriptors(
            entry,
            'Each project entry must be a plain object.'
        )
        if (!descriptors.name || !descriptors.data) {
            throw ProjectLoader.#inputError(
                new TypeError('Each project entry requires name and data.')
            )
        }
        if (descriptors.assets && !Array.isArray(descriptors.assets.value)) {
            throw ProjectLoader.#inputError(
                new TypeError('Project entry assets must be an array.')
            )
        }
        return {
            name: descriptors.name.value,
            data: descriptors.data.value,
            assets: descriptors.assets?.value,
            compressedByteLength: descriptors.compressedByteLength?.value,
            archiveDepth: descriptors.archiveDepth?.value
        }
    }

    /**
     * Reads an exact dense project-entry array without caller iteration.
     * @param {unknown} entries Entry array candidate.
     * @param {number} [maximum] Maximum permitted entries.
     * @returns {Record<string, PropertyDescriptor>} Array descriptors.
     */
    static #entryArray(entries, maximum = ArchiveLimits.defaults.maxEntries) {
        if (!Array.isArray(entries)) {
            throw ProjectLoader.#inputError(
                new TypeError('Project entries must be a non-empty array.')
            )
        }
        let prototype
        let lengthDescriptor
        let descriptors
        try {
            prototype = Object.getPrototypeOf(entries)
            lengthDescriptor = Object.getOwnPropertyDescriptor(
                entries,
                'length'
            )
        } catch {
            throw ProjectLoader.#inputError(
                new TypeError('Project entries must be a dense plain array.')
            )
        }
        const length = lengthDescriptor?.value
        if (
            prototype !== Array.prototype ||
            !lengthDescriptor ||
            !Object.hasOwn(lengthDescriptor, 'value') ||
            !Number.isSafeInteger(length) ||
            length < 0
        ) {
            throw ProjectLoader.#inputError(
                new TypeError('Project entries must be a dense plain array.')
            )
        }
        ProjectLoader.#assertLimit('maxEntries', maximum, length)
        try {
            descriptors = Object.getOwnPropertyDescriptors(entries)
        } catch {
            throw ProjectLoader.#inputError(
                new TypeError('Project entries must be a dense plain array.')
            )
        }
        if (Reflect.ownKeys(descriptors).length !== length + 1) {
            throw ProjectLoader.#inputError(
                new TypeError('Project entries must be a dense plain array.')
            )
        }
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                throw ProjectLoader.#inputError(
                    new TypeError(
                        'Project entries must contain enumerable data properties.'
                    )
                )
            }
        }
        return descriptors
    }

    /**
     * Returns own data-property descriptors for one plain record.
     * @param {unknown} value Record candidate.
     * @param {string} message Error message.
     * @returns {Record<string, PropertyDescriptor>} Own descriptors.
     */
    static #plainDescriptors(value, message) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw ProjectLoader.#inputError(new TypeError(message))
        }
        const prototype = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) {
            throw ProjectLoader.#inputError(new TypeError(message))
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const descriptor of Object.values(descriptors)) {
            if (descriptor.get || descriptor.set) {
                throw ProjectLoader.#inputError(
                    new TypeError('Accessor-backed project fields are invalid.')
                )
            }
        }
        return descriptors
    }

    /**
     * Measures a canonical parser payload without copying it.
     * @param {unknown} data Entry payload.
     * @returns {number} Payload byte length.
     */
    static #byteLength(data) {
        if (typeof data === 'string') {
            return ProjectLoader.#stringByteLength(data)
        }
        if (data instanceof ArrayBuffer) return data.byteLength
        if (data instanceof Uint8Array) return data.byteLength
        throw ProjectLoader.#inputError(
            new TypeError(
                'Project entry data must be a string, ArrayBuffer, or Uint8Array.'
            )
        )
    }

    /**
     * Measures UTF-8 text without allocating a duplicate encoded payload.
     * @param {string} value Text payload.
     * @returns {number} UTF-8 byte length.
     */
    static #stringByteLength(value) {
        let byteLength = 0
        for (let index = 0; index < value.length; index += 1) {
            const codeUnit = value.charCodeAt(index)
            if (codeUnit <= 0x7f) {
                byteLength += 1
            } else if (codeUnit <= 0x7ff) {
                byteLength += 2
            } else if (
                codeUnit >= 0xd800 &&
                codeUnit <= 0xdbff &&
                index + 1 < value.length &&
                value.charCodeAt(index + 1) >= 0xdc00 &&
                value.charCodeAt(index + 1) <= 0xdfff
            ) {
                byteLength += 4
                index += 1
            } else {
                byteLength += 3
            }
        }
        return byteLength
    }

    /**
     * Normalizes optional non-negative archive metadata.
     * @param {unknown} value Metadata value.
     * @param {string} key Metadata key.
     * @param {number} fallback Missing-value fallback.
     * @returns {number} Normalized integer.
     */
    static #metadataInteger(value, key, fallback) {
        if (value === undefined) return fallback
        if (!Number.isSafeInteger(value) || value < 0) {
            throw ProjectLoader.#inputError(
                new TypeError(`${key} must be a non-negative safe integer.`)
            )
        }
        return value
    }

    /**
     * Enforces optional compressed-size metadata before parsing.
     * @param {number} byteLength Uncompressed payload bytes.
     * @param {unknown} compressedValue Optional compressed byte length.
     * @param {number} maximum Maximum allowed ratio.
     * @param {string} entryName Entry name.
     * @returns {void}
     */
    static #assertCompressionRatio(
        byteLength,
        compressedValue,
        maximum,
        entryName
    ) {
        if (compressedValue === undefined) return
        const compressed = ProjectLoader.#metadataInteger(
            compressedValue,
            'compressedByteLength',
            0
        )
        const ratio =
            compressed === 0
                ? byteLength === 0
                    ? 1
                    : Number.POSITIVE_INFINITY
                : byteLength / compressed
        ProjectLoader.#assertLimit(
            'maxCompressionRatio',
            maximum,
            ratio,
            entryName
        )
    }

    /**
     * Throws when one measured value exceeds its normalized limit.
     * @param {string} limit Limit name.
     * @param {number} maximum Maximum value.
     * @param {number} actual Measured value.
     * @param {string} [entryName] Associated entry name.
     * @returns {void}
     */
    static #assertLimit(limit, maximum, actual, entryName = '') {
        if (actual <= maximum) return
        throw new ToolkitError(`Archive limit exceeded: ${limit}.`, {
            code: 'ERR_ARCHIVE_LIMIT_EXCEEDED',
            category: 'validation',
            format: 'archive',
            source: entryName,
            details: { limit, maximum, actual, entryName }
        })
    }

    /**
     * Rejects projects without any source-format candidate.
     * @param {{ candidates: object[] }} classified Classified entries.
     * @returns {void}
     */
    static #assertCandidates(classified) {
        if (classified.candidates.length) return
        throw new ToolkitError(
            'No supported CircuitJSON project entry was found.',
            {
                code: 'ERR_PROJECT_UNSUPPORTED',
                category: 'unsupported',
                format: 'circuitjson'
            }
        )
    }

    /**
     * Parses one candidate and records a project-level failure diagnostic.
     * @param {{ name: string, input: object }} entry Prepared entry.
     * @param {Record<string, any>} options Normalized options.
     * @param {object[]} documents Successful documents.
     * @param {object[]} diagnostics Project diagnostics.
     * @returns {void}
     */
    static #parseEntry(entry, options, documents, diagnostics) {
        try {
            documents.push(
                Parser.parse(entry.input, ProjectLoader.#parserOptions(options))
            )
        } catch (error) {
            const normalized = ProjectLoader.#errorFrom(error)
            if (normalized.code === 'ERR_CAPABILITY_UNAVAILABLE') {
                throw normalized
            }
            diagnostics.push(
                ToolkitDiagnostic.create({
                    code: normalized.code,
                    severity: 'error',
                    message: normalized.message,
                    source: entry.name,
                    location: normalized.location,
                    details: {
                        category: normalized.category,
                        format: normalized.format,
                        cause: normalized.cause
                    }
                })
            )
        }
    }

    /**
     * Selects normalized options owned by the standalone parser.
     * @param {Record<string, any>} options Normalized project options.
     * @returns {Record<string, any>} Parser options.
     */
    static #parserOptions(options) {
        const selected = {}
        for (const key of PARSER_OPTION_KEYS) {
            if (key === 'onProgress' || key === 'signal') continue
            selected[key] = options[key]
        }
        return selected
    }

    /**
     * Builds the canonical result or throws the typed zero-success failure.
     * @param {{ entries: object[], candidates: object[], entryNames: string[], totalBytes: number }} classified Classified entries.
     * @param {object[]} documents Successful documents.
     * @param {object[]} diagnostics Project diagnostics.
     * @param {Record<string, any>} options Normalized options.
     * @returns {Record<string, any>} Canonical project result.
     */
    static #result(classified, documents, diagnostics, options) {
        if (!documents.length) {
            throw new ToolkitError(
                'No requested CircuitJSON project document could be loaded.',
                {
                    code: 'ERR_PROJECT_NO_DOCUMENTS',
                    category: 'parse',
                    format: 'circuitjson',
                    details: { diagnostics }
                }
            )
        }
        return ProjectResult.create({
            source: {
                format: 'circuitjson',
                entryNames: classified.entryNames
            },
            documents,
            project: null,
            extensions: {},
            assets: ProjectLoader.#companionAssets(
                classified.entries,
                options.decodeAssets
            ),
            diagnostics,
            statistics: {
                entryCount: classified.entries.length,
                candidateCount: classified.candidates.length,
                documentCount: documents.length,
                failureCount: diagnostics.length,
                totalBytes: classified.totalBytes
            }
        })
    }

    /**
     * Selects non-document entries through the common asset decode modes.
     * @param {Array<{ name: string, byteLength: number, input: { data: unknown } }>} entries Prepared entries.
     * @param {'none' | 'metadata' | 'full'} mode Asset selection mode.
     * @returns {object[]} Project companion assets.
     */
    static #companionAssets(entries, mode) {
        if (mode === 'none') return []
        return entries
            .filter((entry) => !entry.name.toLowerCase().endsWith('.json'))
            .map(
                (entry) =>
                    entry.companionAsset ||
                    ToolkitAsset.prepare(
                        {
                            kind: 'companion',
                            name: entry.name,
                            mediaType: 'application/octet-stream',
                            byteLength: entry.byteLength,
                            data: entry.input.data,
                            source: { entryName: entry.name }
                        },
                        { mode }
                    )
            )
    }

    /**
     * Emits one clone-safe progress row without swallowing host callback errors.
     * @param {Record<string, any>} options Normalized options.
     * @param {Record<string, any>} fields Progress fields.
     * @param {Record<string, any> | null} previous Previous row.
     * @returns {Record<string, any> | null} Current or previous row.
     */
    static #progress(options, fields, previous) {
        if (!options.onProgress) return previous
        const row = ToolkitProgress.create(fields, previous)
        options.onProgress(row)
        return row
    }

    /**
     * Yields to a real host task so timer, I/O, and UI cancellation can run.
     * @param {boolean} cancellationResponsive Whether timer-backed aborts must run before the next entry.
     * @returns {Promise<void>} Yield completion.
     */
    static async #yieldToHost(cancellationResponsive) {
        if (cancellationResponsive) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            return
        }
        if (typeof globalThis.scheduler?.yield === 'function') {
            await globalThis.scheduler.yield()
            return
        }
        if (typeof setImmediate === 'function') {
            await new Promise((resolve) => setImmediate(resolve))
            return
        }
        if (typeof globalThis.MessageChannel === 'function') {
            await new Promise((resolve) => {
                const channel = new globalThis.MessageChannel()
                channel.port1.onmessage = () => {
                    channel.port1.close()
                    channel.port2.close()
                    resolve()
                }
                channel.port2.postMessage(null)
            })
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
    }

    /**
     * Throws the shared cancellation error for an aborted signal.
     * @param {unknown} signal Abort signal candidate.
     * @returns {void}
     */
    static #assertNotCancelled(signal) {
        if (signal === undefined || signal === null) return
        if (!ProjectLoader.#signalState(signal)) return
        throw new ToolkitError('CircuitJSON project loading was cancelled.', {
            code: 'ERR_CANCELLED',
            category: 'cancelled',
            format: 'circuitjson'
        })
    }

    /**
     * Reads only a genuine AbortSignal through the captured platform getter.
     * @param {unknown} signal Signal candidate.
     * @returns {boolean} Aborted state.
     */
    static #signalState(signal) {
        if (!ABORTED_GETTER) {
            throw new TypeError('AbortSignal state is unavailable.')
        }
        try {
            return Boolean(Reflect.apply(ABORTED_GETTER, signal, []))
        } catch {
            throw new TypeError('Project signal must be an AbortSignal.')
        }
    }

    /**
     * Converts option/input failures into the project validation boundary.
     * @param {unknown} error Failure candidate.
     * @returns {ToolkitError} Typed input error.
     */
    static #inputError(error) {
        return ToolkitError.from(error, {
            code: 'ERR_PROJECT_INPUT',
            category: 'validation',
            format: 'circuitjson'
        })
    }

    /**
     * Converts unexpected public failures into clone-safe toolkit errors.
     * @param {unknown} error Failure candidate.
     * @returns {ToolkitError} Typed project error.
     */
    static #errorFrom(error) {
        return ToolkitError.from(error, {
            code: 'ERR_PROJECT_LOAD',
            category: 'runtime',
            format: 'circuitjson'
        })
    }

    /**
     * Creates the synchronous worker-mode boundary error.
     * @returns {ToolkitError} Typed unsupported error.
     */
    static #workerSyncError() {
        return new ToolkitError(
            'Synchronous CircuitJSON project loading cannot use a worker.',
            {
                code: 'ERR_WORKER_SYNC_UNAVAILABLE',
                category: 'unsupported',
                format: 'circuitjson'
            }
        )
    }
}
