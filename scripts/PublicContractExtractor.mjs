import { readFile } from 'node:fs/promises'

const IGNORED_STATIC_MEMBERS = new Set(['name', 'prototype'])

/**
 * Derives the public JavaScript contract directly from package entrypoints.
 */
export class PublicContractExtractor {
    /**
     * Extracts exports, method signatures, arguments, properties, and result fields.
     * @param {URL | string} repositoryRoot Repository root.
     * @returns {Promise<Record<string, any>[]>} Sorted source contract features.
     */
    static async extract(repositoryRoot) {
        const root = PublicContractExtractor.#rootUrl(repositoryRoot)
        const pkg = JSON.parse(
            await readFile(new URL('package.json', root), 'utf8')
        )
        const contracts = []

        for (const [entrypoint, definition] of Object.entries(pkg.exports).sort(
            ([left], [right]) => left.localeCompare(right)
        )) {
            const target = PublicContractExtractor.#exportTarget(definition)
            if (!PublicContractExtractor.#isJavaScriptTarget(target)) continue
            const api = await import(new URL(target, root))
            for (const exportName of Object.keys(api).sort()) {
                contracts.push(
                    ...PublicContractExtractor.#exportContracts(
                        entrypoint,
                        exportName,
                        api[exportName]
                    )
                )
            }
        }

        return contracts.sort((left, right) =>
            left.feature.localeCompare(right.feature)
        )
    }

    /**
     * Normalizes a repository root as a trailing-slash URL.
     * @param {URL | string} repositoryRoot Repository root.
     * @returns {URL} Root URL.
     */
    static #rootUrl(repositoryRoot) {
        const root =
            repositoryRoot instanceof URL
                ? repositoryRoot
                : new URL(`file://${String(repositoryRoot)}/`)
        return new URL('./', root)
    }

    /**
     * Returns an import target from a package export definition.
     * @param {string | Record<string, string>} definition Export definition.
     * @returns {string} Module target.
     */
    static #exportTarget(definition) {
        if (typeof definition === 'string') return definition
        const target = definition?.import || definition?.default
        if (typeof target !== 'string') {
            throw new Error('Package export does not define an import target.')
        }
        return target
    }

    /**
     * Returns whether a package target is an importable JavaScript module.
     * @param {string} target Package export target.
     * @returns {boolean} Whether source contracts can be reflected from it.
     */
    static #isJavaScriptTarget(target) {
        return /\.(?:c|m)?js$/u.test(target)
    }

    /**
     * Extracts all contracts for one exported value.
     * @param {string} entrypoint Package entrypoint.
     * @param {string} exportName Exported symbol.
     * @param {unknown} value Exported value.
     * @returns {Record<string, any>[]} Source contract features.
     */
    static #exportContracts(entrypoint, exportName, value) {
        const contracts = [
            {
                feature: `${entrypoint}#${exportName}`,
                kind: 'export',
                entrypoint,
                exportName,
                sourceContract: {
                    type: 'export',
                    valueType: typeof value
                }
            }
        ]
        if (typeof value !== 'function') return contracts

        const classSource = Function.prototype.toString.call(value)
        const constructorSource =
            PublicContractExtractor.#constructorSource(classSource)
        if (constructorSource) {
            contracts.push(
                ...PublicContractExtractor.#methodContracts({
                    entrypoint,
                    exportName,
                    methodName: 'constructor',
                    methodType: 'constructor',
                    source: constructorSource,
                    jsdoc: PublicContractExtractor.#jsdocBefore(
                        classSource,
                        classSource.indexOf(constructorSource)
                    )
                })
            )
        }

        for (const methodName of PublicContractExtractor.#staticMethods(
            value
        )) {
            const source = Function.prototype.toString.call(value[methodName])
            contracts.push(
                ...PublicContractExtractor.#methodContracts({
                    entrypoint,
                    exportName,
                    methodName,
                    methodType: 'static',
                    source,
                    jsdoc: PublicContractExtractor.#jsdocBefore(
                        classSource,
                        classSource.indexOf(source)
                    )
                })
            )
        }

        for (const methodName of PublicContractExtractor.#instanceMethods(
            value
        )) {
            const source = Function.prototype.toString.call(
                value.prototype[methodName]
            )
            contracts.push(
                ...PublicContractExtractor.#methodContracts({
                    entrypoint,
                    exportName,
                    methodName,
                    methodType: 'instance',
                    source,
                    jsdoc: PublicContractExtractor.#jsdocBefore(
                        classSource,
                        classSource.indexOf(source)
                    )
                })
            )
        }
        return contracts
    }

    /**
     * Lists public static methods without invoking accessors.
     * @param {Function} value Exported callable.
     * @returns {string[]} Sorted method names.
     */
    static #staticMethods(value) {
        return Object.getOwnPropertyNames(value)
            .filter((name) => {
                const descriptor = Object.getOwnPropertyDescriptor(value, name)
                return (
                    !IGNORED_STATIC_MEMBERS.has(name) &&
                    typeof descriptor?.value === 'function'
                )
            })
            .sort()
    }

    /**
     * Lists public instance methods without invoking accessors.
     * @param {Function} value Exported callable.
     * @returns {string[]} Sorted method names.
     */
    static #instanceMethods(value) {
        if (!value.prototype) return []
        return Object.getOwnPropertyNames(value.prototype)
            .filter((name) => {
                const descriptor = Object.getOwnPropertyDescriptor(
                    value.prototype,
                    name
                )
                return (
                    name !== 'constructor' &&
                    typeof descriptor?.value === 'function'
                )
            })
            .sort()
    }

    /**
     * Extracts an explicitly declared class constructor.
     * @param {string} classSource Full class source.
     * @returns {string} Constructor source or an empty string.
     */
    static #constructorSource(classSource) {
        const match = /(?:^|\n)\s*constructor\s*\(/u.exec(classSource)
        if (!match) return ''
        const start = classSource.indexOf('constructor', match.index)
        const openParameters = classSource.indexOf('(', start)
        const closeParameters = PublicContractExtractor.#matchingDelimiter(
            classSource,
            openParameters,
            '(',
            ')'
        )
        const openBody = classSource.indexOf('{', closeParameters)
        const closeBody = PublicContractExtractor.#matchingDelimiter(
            classSource,
            openBody,
            '{',
            '}'
        )
        return classSource.slice(start, closeBody + 1)
    }

    /**
     * Extracts all records belonging to one public method.
     * @param {Record<string, any>} method Public method description.
     * @returns {Record<string, any>[]} Source contract features.
     */
    static #methodContracts(method) {
        const parameters = PublicContractExtractor.#parameters(method.source)
        const methodFeature = PublicContractExtractor.#methodFeature(method)
        const contracts = [
            {
                feature: methodFeature,
                kind: 'method',
                entrypoint: method.entrypoint,
                exportName: method.exportName,
                methodName: method.methodName,
                methodType: method.methodType,
                sourceContract: {
                    type: 'method',
                    signature: `(${parameters.map((entry) => entry.source).join(', ')})`,
                    parameters
                }
            }
        ]

        for (const parameter of parameters) {
            const base = PublicContractExtractor.#methodMetadata(method)
            contracts.push({
                ...base,
                feature: `${methodFeature}.argument.${parameter.name}`,
                kind: 'option',
                sourceContract: { type: 'argument', ...parameter }
            })
            const properties = PublicContractExtractor.#parameterProperties(
                method.source,
                method.jsdoc,
                parameter.name
            )
            for (const property of properties) {
                contracts.push({
                    ...base,
                    feature: `${methodFeature}.argument.${parameter.name}.property.${property.name}`,
                    kind: 'option',
                    sourceContract: {
                        type: 'property',
                        argument: parameter.name,
                        name: property.name,
                        evidence: property.evidence
                    }
                })
            }
        }

        for (const field of PublicContractExtractor.#resultFields(
            method.source,
            method.jsdoc
        )) {
            contracts.push({
                ...PublicContractExtractor.#methodMetadata(method),
                feature: `${methodFeature}.result.${field.name}`,
                kind: 'field',
                sourceContract: {
                    type: 'result-field',
                    name: field.name,
                    evidence: field.evidence
                }
            })
        }
        return contracts
    }

    /**
     * Returns the common method metadata stored on child contract records.
     * @param {Record<string, any>} method Public method description.
     * @returns {Record<string, string>} Method metadata.
     */
    static #methodMetadata(method) {
        return {
            entrypoint: method.entrypoint,
            exportName: method.exportName,
            methodName: method.methodName,
            methodType: method.methodType
        }
    }

    /**
     * Creates the stable public method feature id.
     * @param {Record<string, any>} method Public method description.
     * @returns {string} Method feature id.
     */
    static #methodFeature(method) {
        const owner =
            method.methodType === 'instance'
                ? `${method.exportName}.prototype`
                : method.exportName
        return `${method.entrypoint}#${owner}.${method.methodName}()`
    }

    /**
     * Parses accepted method arguments and their defaults.
     * @param {string} source Method source.
     * @returns {Record<string, any>[]} Parameter descriptions.
     */
    static #parameters(source) {
        const open = source.indexOf('(')
        if (open < 0) return []
        const close = PublicContractExtractor.#matchingDelimiter(
            source,
            open,
            '(',
            ')'
        )
        return PublicContractExtractor.#splitTopLevel(
            source.slice(open + 1, close)
        ).map((sourceParameter, index) => {
            const equals = PublicContractExtractor.#topLevelIndex(
                sourceParameter,
                '='
            )
            const binding = (
                equals < 0 ? sourceParameter : sourceParameter.slice(0, equals)
            )
                .trim()
                .replace(/^\.\.\./u, '')
            const simpleName = /^[A-Za-z_$][\w$]*$/u.test(binding)
                ? binding
                : `argument${index}`
            return {
                index,
                name: simpleName,
                source: sourceParameter.trim(),
                rest: sourceParameter.trim().startsWith('...'),
                hasDefault: equals >= 0,
                defaultSource:
                    equals >= 0
                        ? sourceParameter.slice(equals + 1).trim()
                        : null
            }
        })
    }

    /**
     * Finds source and documented properties accepted by one argument.
     * @param {string} source Method source.
     * @param {string} jsdoc Method JSDoc.
     * @param {string} argument Argument name.
     * @returns {{ name: string, evidence: string[] }[]} Property descriptions.
     */
    static #parameterProperties(source, jsdoc, argument) {
        const evidenceByName = new Map()
        const escaped = argument.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
        const direct = new RegExp(
            `\\b${escaped}\\s*(?:\\?\\.\\s*|\\.\\s*)([A-Za-z_$][\\w$]*)`,
            'gu'
        )
        for (const match of source.matchAll(direct)) {
            PublicContractExtractor.#addEvidence(
                evidenceByName,
                match[1],
                'source-read'
            )
        }
        const bracket = new RegExp(
            `\\b${escaped}\\s*(?:\\?\\.)?\\s*\\[\\s*['\"]([^'\"]+)['\"]\\s*\\]`,
            'gu'
        )
        for (const match of source.matchAll(bracket)) {
            PublicContractExtractor.#addEvidence(
                evidenceByName,
                match[1],
                'source-read'
            )
        }
        for (const field of PublicContractExtractor.#jsdocParameterFields(
            jsdoc,
            argument
        )) {
            PublicContractExtractor.#addEvidence(evidenceByName, field, 'jsdoc')
        }
        return [...evidenceByName]
            .map(([name, evidence]) => ({
                name,
                evidence: [...evidence].sort()
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
    }

    /**
     * Finds top-level fields returned by a public method.
     * @param {string} source Method source.
     * @param {string} jsdoc Method JSDoc.
     * @returns {{ name: string, evidence: string[] }[]} Result fields.
     */
    static #resultFields(source, jsdoc) {
        const evidenceByName = new Map()
        for (const name of PublicContractExtractor.#jsdocReturnFields(jsdoc)) {
            PublicContractExtractor.#addEvidence(evidenceByName, name, 'jsdoc')
        }
        for (const name of PublicContractExtractor.#returnedObjectFields(
            source
        )) {
            PublicContractExtractor.#addEvidence(evidenceByName, name, 'return')
        }
        for (const name of PublicContractExtractor.#definedPropertyFields(
            source
        )) {
            PublicContractExtractor.#addEvidence(
                evidenceByName,
                name,
                'define-properties'
            )
        }
        return [...evidenceByName]
            .map(([name, evidence]) => ({
                name,
                evidence: [...evidence].sort()
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
    }

    /**
     * Adds one evidence source to a named contract item.
     * @param {Map<string, Set<string>>} map Evidence map.
     * @param {string} name Contract item name.
     * @param {string} evidence Evidence source.
     * @returns {void}
     */
    static #addEvidence(map, name, evidence) {
        if (!/^[A-Za-z_$][\w$]*$/u.test(String(name))) return
        if (!map.has(name)) map.set(name, new Set())
        map.get(name).add(evidence)
    }

    /**
     * Extracts documented object properties for one parameter.
     * @param {string} jsdoc Method JSDoc.
     * @param {string} argument Argument name.
     * @returns {string[]} Property names.
     */
    static #jsdocParameterFields(jsdoc, argument) {
        const fields = []
        const pattern = /@param\s+\{/gu
        for (const match of jsdoc.matchAll(pattern)) {
            const open = match.index + match[0].lastIndexOf('{')
            const close = PublicContractExtractor.#matchingDelimiter(
                jsdoc,
                open,
                '{',
                '}'
            )
            const suffix = jsdoc
                .slice(close + 1)
                .match(/^\s+(\[[^\]]+\]|[^\s*]+)/u)
            const name = String(suffix?.[1] || '')
                .replace(/^\[/u, '')
                .replace(/\]$/u, '')
                .split('=')[0]
            if (name !== argument) continue
            fields.push(
                ...PublicContractExtractor.#objectTypeFields(
                    jsdoc.slice(open + 1, close)
                )
            )
        }
        return [...new Set(fields)].sort()
    }

    /**
     * Extracts documented top-level object return fields.
     * @param {string} jsdoc Method JSDoc.
     * @returns {string[]} Field names.
     */
    static #jsdocReturnFields(jsdoc) {
        const marker = /@returns?\s+\{/u.exec(jsdoc)
        if (!marker) return []
        const open = marker.index + marker[0].lastIndexOf('{')
        const close = PublicContractExtractor.#matchingDelimiter(
            jsdoc,
            open,
            '{',
            '}'
        )
        return PublicContractExtractor.#objectTypeFields(
            jsdoc.slice(open + 1, close)
        )
    }

    /**
     * Extracts top-level fields from a JSDoc object type.
     * @param {string} typeSource JSDoc type source without its outer braces.
     * @returns {string[]} Field names.
     */
    static #objectTypeFields(typeSource) {
        const trimmed = typeSource.trim()
        const objectStart = trimmed.indexOf('{')
        if (objectStart < 0) return []
        const objectEnd = PublicContractExtractor.#matchingDelimiter(
            trimmed,
            objectStart,
            '{',
            '}'
        )
        return PublicContractExtractor.#splitTopLevel(
            trimmed.slice(objectStart + 1, objectEnd)
        )
            .map(
                (part) => part.trim().match(/^([A-Za-z_$][\w$]*)\??\s*:/u)?.[1]
            )
            .filter(Boolean)
    }

    /**
     * Finds keys in object literals directly returned by a method.
     * @param {string} source Method source.
     * @returns {string[]} Field names.
     */
    static #returnedObjectFields(source) {
        const fields = new Set()
        for (const match of source.matchAll(/\breturn\b/gu)) {
            const end = PublicContractExtractor.#statementEnd(
                source,
                match.index + match[0].length
            )
            const expression = source.slice(match.index + match[0].length, end)
            for (let index = 0; index < expression.length; index += 1) {
                if (expression[index] !== '{') continue
                const close = PublicContractExtractor.#matchingDelimiter(
                    expression,
                    index,
                    '{',
                    '}'
                )
                for (const field of PublicContractExtractor.#objectLiteralFields(
                    expression.slice(index + 1, close)
                )) {
                    fields.add(field)
                }
                index = close
            }
        }
        return [...fields].sort()
    }

    /**
     * Finds fields installed through Object.defineProperties in a method.
     * @param {string} source Method source.
     * @returns {string[]} Field names.
     */
    static #definedPropertyFields(source) {
        const fields = new Set()
        for (const match of source.matchAll(
            /Object\.defineProperties\s*\(/gu
        )) {
            const comma = PublicContractExtractor.#nextTopLevelComma(
                source,
                match.index + match[0].length
            )
            const open = source.indexOf('{', comma)
            if (open < 0) continue
            const close = PublicContractExtractor.#matchingDelimiter(
                source,
                open,
                '{',
                '}'
            )
            for (const field of PublicContractExtractor.#objectLiteralFields(
                source.slice(open + 1, close)
            )) {
                fields.add(field)
            }
        }
        return [...fields].sort()
    }

    /**
     * Extracts top-level object literal keys.
     * @param {string} objectSource Object body source.
     * @returns {string[]} Field names.
     */
    static #objectLiteralFields(objectSource) {
        return PublicContractExtractor.#splitTopLevel(objectSource)
            .map((part) => {
                const candidate = part.trim()
                if (!candidate || candidate.startsWith('...')) return null
                return candidate
                    .match(
                        /^(?:get\s+|set\s+|async\s+)?(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))(?=\s*(?::|=|$))/u
                    )
                    ?.slice(1)
                    .find(Boolean)
            })
            .filter(Boolean)
    }

    /**
     * Finds the JSDoc block immediately preceding a method.
     * @param {string} classSource Full class source.
     * @param {number} methodIndex Method-name index.
     * @returns {string} JSDoc block or an empty string.
     */
    static #jsdocBefore(classSource, methodIndex) {
        if (methodIndex < 0) return ''
        const start = classSource.lastIndexOf('/**', methodIndex)
        const end = classSource.indexOf('*/', start)
        if (start < 0 || end < 0 || end > methodIndex) return ''
        const gap = classSource.slice(end + 2, methodIndex)
        return /^(?:\s|static|async)*$/u.test(gap)
            ? classSource.slice(start, end + 2)
            : ''
    }

    /**
     * Splits source on top-level commas.
     * @param {string} source Source fragment.
     * @returns {string[]} Non-empty fragments.
     */
    static #splitTopLevel(source) {
        const parts = []
        let start = 0
        let depths = { '(': 0, '[': 0, '{': 0, '<': 0 }
        let quote = ''
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === '\\') index += 1
                else if (character === quote) quote = ''
                continue
            }
            if (["'", '"', '`'].includes(character)) {
                quote = character
                continue
            }
            if ('([{<'.includes(character)) depths[character] += 1
            else if (character === ')') depths['('] -= 1
            else if (character === ']') depths['['] -= 1
            else if (character === '}') depths['{'] -= 1
            else if (character === '>') depths['<'] -= 1
            else if (
                character === ',' &&
                Object.values(depths).every((depth) => depth === 0)
            ) {
                parts.push(source.slice(start, index))
                start = index + 1
            }
        }
        parts.push(source.slice(start))
        return parts.map((part) => part.trim()).filter(Boolean)
    }

    /**
     * Finds one character at top-level nesting depth.
     * @param {string} source Source fragment.
     * @param {string} target Target character.
     * @returns {number} Character index or -1.
     */
    static #topLevelIndex(source, target) {
        const pairs = new Map([
            [')', '('],
            [']', '['],
            ['}', '{']
        ])
        const stack = []
        let quote = ''
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === '\\') index += 1
                else if (character === quote) quote = ''
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) stack.push(character)
            else if (pairs.has(character)) stack.pop()
            else if (character === target && stack.length === 0) return index
        }
        return -1
    }

    /**
     * Finds a matching delimiter while ignoring quoted content and comments.
     * @param {string} source Source text.
     * @param {number} openIndex Opening delimiter index.
     * @param {string} open Opening delimiter.
     * @param {string} close Closing delimiter.
     * @returns {number} Closing delimiter index.
     */
    static #matchingDelimiter(source, openIndex, open, close) {
        let depth = 0
        let quote = ''
        for (let index = openIndex; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === '\\') index += 1
                else if (character === quote) quote = ''
                continue
            }
            if (character === '/' && source[index + 1] === '/') {
                index = source.indexOf('\n', index)
                if (index < 0) return source.length - 1
                continue
            }
            if (character === '/' && source[index + 1] === '*') {
                index = source.indexOf('*/', index + 2) + 1
                continue
            }
            if (["'", '"', '`'].includes(character)) {
                quote = character
                continue
            }
            if (character === open) depth += 1
            if (character === close) depth -= 1
            if (depth === 0) return index
        }
        throw new Error(`Unmatched ${open} delimiter in public source.`)
    }

    /**
     * Finds the end of one return statement.
     * @param {string} source Method source.
     * @param {number} start Return-expression start.
     * @returns {number} Statement end index.
     */
    static #statementEnd(source, start) {
        const pairs = new Map([
            [')', '('],
            [']', '['],
            ['}', '{']
        ])
        const stack = []
        let quote = ''
        for (let index = start; index < source.length; index += 1) {
            const character = source[index]
            if (quote) {
                if (character === '\\') index += 1
                else if (character === quote) quote = ''
                continue
            }
            if (["'", '"', '`'].includes(character)) quote = character
            else if ('([{'.includes(character)) stack.push(character)
            else if (pairs.has(character)) stack.pop()
            else if (
                (character === ';' || character === '\n') &&
                stack.length === 0
            ) {
                return index
            }
        }
        return source.length
    }

    /**
     * Finds the next comma separating call arguments.
     * @param {string} source Source text.
     * @param {number} start First call-argument index.
     * @returns {number} Comma index.
     */
    static #nextTopLevelComma(source, start) {
        let depth = 0
        for (let index = start; index < source.length; index += 1) {
            if ('([{'.includes(source[index])) depth += 1
            else if (')]}'.includes(source[index])) depth -= 1
            else if (source[index] === ',' && depth === 0) return index
        }
        return -1
    }
}
