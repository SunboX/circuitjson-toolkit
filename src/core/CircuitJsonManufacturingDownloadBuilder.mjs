/**
 * Builds downloadable manufacturing metadata artifacts from parsed documents.
 */
export class CircuitJsonManufacturingDownloadBuilder {
    /**
     * Returns true when a format is handled by this builder.
     * @param {string} format Export format.
     * @returns {boolean}
     */
    static supportsFormat(format) {
        return [
            'pick-place-csv',
            'routing-dsn',
            'fabrication-notes-json'
        ].includes(String(format || ''))
    }

    /**
     * Builds a manufacturing metadata download.
     * @param {object} documentModel Parsed document model.
     * @param {string} format Export format.
     * @returns {{ fileName: string, bytes: Uint8Array, contentType: string }}
     */
    static build(documentModel, format) {
        if (format === 'pick-place-csv') {
            return CircuitJsonManufacturingDownloadBuilder.#pickPlaceCsv(
                documentModel
            )
        }
        if (format === 'routing-dsn') {
            return CircuitJsonManufacturingDownloadBuilder.#routingDsn(
                documentModel
            )
        }
        if (format === 'fabrication-notes-json') {
            return CircuitJsonManufacturingDownloadBuilder.#fabricationNotesJson(
                documentModel
            )
        }
        throw new Error('Unsupported manufacturing export format')
    }

    /**
     * Builds a pick-and-place CSV download.
     * @param {object} documentModel Parsed document model.
     * @returns {{ fileName: string, bytes: Uint8Array, contentType: string }}
     */
    static #pickPlaceCsv(documentModel) {
        const rows = Array.isArray(
            documentModel?.manufacturing?.pickAndPlaceRows
        )
            ? documentModel.manufacturing.pickAndPlaceRows
            : []
        if (!rows.length) {
            throw new Error('No placement metadata is available')
        }

        const headers = [
            'Designator',
            'Component ID',
            'Source Component ID',
            'X',
            'Y',
            'Rotation',
            'Layer',
            'Side',
            'Value',
            'Package',
            'Manufacturer Part Number'
        ]
        const body = rows.map((row) => [
            row.designator,
            row.componentId,
            row.sourceComponentId,
            row.x,
            row.y,
            row.rotation,
            row.layer,
            row.side,
            row.value,
            row.package,
            row.manufacturerPartNumber
        ])
        const csv = CircuitJsonManufacturingDownloadBuilder.#csv([
            headers,
            ...body
        ])

        return {
            fileName:
                CircuitJsonManufacturingDownloadBuilder.#fileBase(
                    documentModel
                ) + '-pick-place.csv',
            bytes: new TextEncoder().encode(csv),
            contentType: 'text/csv;charset=utf-8'
        }
    }

    /**
     * Builds a routing DSN download.
     * @param {object} documentModel Parsed document model.
     * @returns {{ fileName: string, bytes: Uint8Array, contentType: string }}
     */
    static #routingDsn(documentModel) {
        const dsn = String(documentModel?.manufacturing?.routingDsn || '')
        if (!dsn.trim()) {
            throw new Error('No routing metadata is available')
        }

        return {
            fileName:
                CircuitJsonManufacturingDownloadBuilder.#fileBase(
                    documentModel
                ) + '-routing.dsn',
            bytes: new TextEncoder().encode(dsn),
            contentType: 'application/specctra-dsn'
        }
    }

    /**
     * Builds a fabrication notes JSON download.
     * @param {object} documentModel Parsed document model.
     * @returns {{ fileName: string, bytes: Uint8Array, contentType: string }}
     */
    static #fabricationNotesJson(documentModel) {
        const notes = Array.isArray(
            documentModel?.manufacturing?.fabricationNotes
        )
            ? documentModel.manufacturing.fabricationNotes
            : []
        if (!notes.length) {
            throw new Error('No fabrication note metadata is available')
        }

        const payload = {
            fileName: String(documentModel?.fileName || ''),
            notes
        }

        return {
            fileName:
                CircuitJsonManufacturingDownloadBuilder.#fileBase(
                    documentModel
                ) + '-fabrication-notes.json',
            bytes: new TextEncoder().encode(
                JSON.stringify(payload, null, 2) + '\n'
            ),
            contentType: 'application/json;charset=utf-8'
        }
    }

    /**
     * Serializes CSV rows.
     * @param {unknown[][]} rows CSV row values.
     * @returns {string}
     */
    static #csv(rows) {
        return (
            rows
                .map((row) =>
                    row
                        .map((value) =>
                            CircuitJsonManufacturingDownloadBuilder.#csvCell(
                                value
                            )
                        )
                        .join(',')
                )
                .join('\n') + '\n'
        )
    }

    /**
     * Serializes one CSV cell.
     * @param {unknown} value Cell value.
     * @returns {string}
     */
    static #csvCell(value) {
        const text = String(value ?? '')
        if (!/[",\n\r]/u.test(text)) return text
        return '"' + text.replaceAll('"', '""') + '"'
    }

    /**
     * Builds a filesystem-safe base file name.
     * @param {object} documentModel Parsed document model.
     * @returns {string}
     */
    static #fileBase(documentModel) {
        const raw = String(documentModel?.fileName || 'manufacturing')
            .replace(/\.[^.]+$/u, '')
            .trim()
        const safe = raw.replace(/[^a-z0-9._-]+/giu, '-').replace(/^-|-$/gu, '')
        return safe || 'manufacturing'
    }
}
