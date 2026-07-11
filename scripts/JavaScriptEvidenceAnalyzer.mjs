import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { parsers as babelParsers } from 'prettier/plugins/babel'

/**
 * Finds semantically bound public-package references in JavaScript tests.
 */
export class JavaScriptEvidenceAnalyzer {
    /**
     * Parses one test and returns imported symbols used as values or executables.
     * @param {string} source JavaScript module source.
     * @param {{ path: string, repositoryRoot: string, allowedTargets?: Set<string> }} options Analysis paths.
     * @returns {Promise<{ references: Set<string>, executable: Set<string> }>} Evidence token sets.
     */
    static async analyze(source, options) {
        const ast = await babelParsers.babel.parse(source, {
            filepath: options.path
        })
        const program = ast.program || ast
        const allowedTargets = options.allowedTargets || new Set()
        const imports = await JavaScriptEvidenceAnalyzer.#imports(
            program,
            options.path,
            options.repositoryRoot,
            allowedTargets
        )
        const references = new Set()
        const executable = new Set()
        JavaScriptEvidenceAnalyzer.#walk(
            program,
            [],
            null,
            '',
            (node, ancestors, parent, key) => {
                const evidence = JavaScriptEvidenceAnalyzer.#evidenceUse(
                    node,
                    ancestors,
                    parent,
                    key,
                    imports
                )
                if (!evidence) return
                references.add(evidence)
                if (JavaScriptEvidenceAnalyzer.#isExecutable(ancestors)) {
                    executable.add(evidence)
                }
            }
        )
        return { references, executable }
    }

    /**
     * Collects named and namespace imports from real source/package modules.
     * @param {Record<string, any>} program Parsed program.
     * @param {string} evidencePath Absolute evidence path.
     * @param {string} repositoryRoot Canonical repository root.
     * @param {Set<string>} allowedTargets Canonical package entrypoint targets.
     * @returns {Promise<{ named: Map<string, string>, namespaces: Set<string> }>} Trusted imports.
     */
    static async #imports(
        program,
        evidencePath,
        repositoryRoot,
        allowedTargets
    ) {
        const named = new Map()
        const namespaces = new Set()
        for (const declaration of program.body || []) {
            if (declaration.type !== 'ImportDeclaration') continue
            if (
                !(await JavaScriptEvidenceAnalyzer.#isActualModule(
                    declaration.source?.value,
                    evidencePath,
                    repositoryRoot,
                    allowedTargets
                ))
            ) {
                continue
            }
            for (const specifier of declaration.specifiers || []) {
                if (specifier.type === 'ImportSpecifier') {
                    named.set(
                        specifier.local.name,
                        specifier.imported.name || specifier.imported.value
                    )
                } else if (specifier.type === 'ImportNamespaceSpecifier') {
                    namespaces.add(specifier.local.name)
                }
            }
        }
        return { named, namespaces }
    }

    /**
     * Tests whether an import resolves to current source, a packed target, or the package name.
     * @param {unknown} source Import source value.
     * @param {string} evidencePath Absolute evidence path.
     * @param {string} repositoryRoot Canonical repository root.
     * @param {Set<string>} allowedTargets Canonical package entrypoint targets.
     * @returns {Promise<boolean>} Whether the import has trusted provenance.
     */
    static async #isActualModule(
        source,
        evidencePath,
        repositoryRoot,
        allowedTargets
    ) {
        if (typeof source !== 'string') return false
        if (/^circuitjson-toolkit(?:\/|$)/u.test(source)) return true
        if (!source.startsWith('.')) return false
        let target
        try {
            target = await realpath(resolve(dirname(evidencePath), source))
        } catch {
            return false
        }
        if (allowedTargets.has(target)) return true
        let sourceRoot
        try {
            sourceRoot = await realpath(resolve(repositoryRoot, 'src'))
        } catch {
            return false
        }
        return JavaScriptEvidenceAnalyzer.#inside(sourceRoot, target)
    }

    /**
     * Resolves one AST node to a semantically bound public evidence token.
     * @param {Record<string, any>} node Current AST node.
     * @param {Record<string, any>[]} ancestors Parent nodes from root to leaf.
     * @param {Record<string, any> | null} parent Immediate parent.
     * @param {string} key Parent property containing this node.
     * @param {{ named: Map<string, string>, namespaces: Set<string> }} imports Trusted imports.
     * @returns {string | null} Evidence token or null.
     */
    static #evidenceUse(node, ancestors, parent, key, imports) {
        if (
            node.type === 'MemberExpression' &&
            node.computed === false &&
            node.object?.type === 'Identifier' &&
            node.property?.type === 'Identifier' &&
            imports.namespaces.has(node.object.name) &&
            !JavaScriptEvidenceAnalyzer.#isShadowed(
                node.object.name,
                ancestors
            ) &&
            JavaScriptEvidenceAnalyzer.#isValueNode(node, parent, key)
        ) {
            return node.property.name
        }
        if (node.type !== 'Identifier') return null
        const importedName = imports.named.get(node.name)
        if (
            !importedName ||
            JavaScriptEvidenceAnalyzer.#isShadowed(node.name, ancestors) ||
            !JavaScriptEvidenceAnalyzer.#isReferenceIdentifier(
                node,
                parent,
                key
            )
        ) {
            return null
        }
        return importedName
    }

    /**
     * Tests whether a reference is nested in executable test code.
     * @param {Record<string, any>[]} ancestors Parent nodes.
     * @returns {boolean} Whether a call, construction, or tagged template uses it.
     */
    static #isExecutable(ancestors) {
        return ancestors.some((ancestor) =>
            [
                'CallExpression',
                'NewExpression',
                'TaggedTemplateExpression'
            ].includes(ancestor.type)
        )
    }

    /**
     * Excludes declarations, labels, and non-computed property keys.
     * @param {Record<string, any>} node Identifier node.
     * @param {Record<string, any> | null} parent Immediate parent.
     * @param {string} key Parent property containing this identifier.
     * @returns {boolean} Whether the identifier is a value reference.
     */
    static #isReferenceIdentifier(node, parent, key) {
        if (!parent) return false
        if (
            [
                'ImportSpecifier',
                'ImportDefaultSpecifier',
                'ImportNamespaceSpecifier',
                'ExportSpecifier',
                'LabeledStatement',
                'BreakStatement',
                'ContinueStatement'
            ].includes(parent.type)
        ) {
            return false
        }
        if (
            [
                'VariableDeclarator',
                'FunctionDeclaration',
                'FunctionExpression',
                'ClassDeclaration',
                'ClassExpression',
                'CatchClause'
            ].includes(parent.type) &&
            ['id', 'param'].includes(key)
        ) {
            return false
        }
        if (
            [
                'FunctionDeclaration',
                'FunctionExpression',
                'ArrowFunctionExpression'
            ].includes(parent.type) &&
            key === 'params'
        ) {
            return false
        }
        if (
            parent.type === 'MemberExpression' &&
            key === 'property' &&
            parent.computed === false
        ) {
            return false
        }
        if (
            [
                'ObjectProperty',
                'ObjectMethod',
                'ClassMethod',
                'ClassProperty'
            ].includes(parent.type) &&
            key === 'key' &&
            parent.computed === false &&
            parent.shorthand !== true
        ) {
            return false
        }
        return JavaScriptEvidenceAnalyzer.#isValueNode(node, parent, key)
    }

    /**
     * Excludes assignment-only target positions.
     * @param {Record<string, any>} _node Candidate expression node.
     * @param {Record<string, any> | null} parent Immediate parent.
     * @param {string} key Parent property containing this node.
     * @returns {boolean} Whether the node contributes a value.
     */
    static #isValueNode(_node, parent, key) {
        return !(
            parent &&
            ['AssignmentExpression', 'AssignmentPattern'].includes(
                parent.type
            ) &&
            key === 'left'
        )
    }

    /**
     * Tests whether a nested lexical scope shadows an imported local name.
     * @param {string} name Imported local name.
     * @param {Record<string, any>[]} ancestors Parent nodes.
     * @returns {boolean} Whether a nearer binding owns the reference.
     */
    static #isShadowed(name, ancestors) {
        for (let index = ancestors.length - 1; index >= 0; index -= 1) {
            const scope = ancestors[index]
            if (scope.type === 'Program') continue
            if (
                JavaScriptEvidenceAnalyzer.#isScope(scope) &&
                JavaScriptEvidenceAnalyzer.#scopeBindings(scope).has(name)
            ) {
                return true
            }
        }
        return false
    }

    /**
     * Returns whether one AST node establishes a lexical scope.
     * @param {Record<string, any>} node AST node.
     * @returns {boolean} Whether bindings should be inspected.
     */
    static #isScope(node) {
        return [
            'BlockStatement',
            'CatchClause',
            'FunctionDeclaration',
            'FunctionExpression',
            'ArrowFunctionExpression'
        ].includes(node.type)
    }

    /**
     * Collects bindings declared directly by one lexical scope.
     * @param {Record<string, any>} scope Scope node.
     * @returns {Set<string>} Bound names.
     */
    static #scopeBindings(scope) {
        const names = new Set()
        if (
            [
                'FunctionDeclaration',
                'FunctionExpression',
                'ArrowFunctionExpression'
            ].includes(scope.type)
        ) {
            for (const parameter of scope.params || []) {
                JavaScriptEvidenceAnalyzer.#addPatternNames(parameter, names)
            }
            if (scope.type === 'FunctionExpression') {
                JavaScriptEvidenceAnalyzer.#addPatternNames(scope.id, names)
            }
            return names
        }
        if (scope.type === 'CatchClause') {
            JavaScriptEvidenceAnalyzer.#addPatternNames(scope.param, names)
            return names
        }
        for (const statement of scope.body || []) {
            if (statement.type === 'VariableDeclaration') {
                for (const declaration of statement.declarations || []) {
                    JavaScriptEvidenceAnalyzer.#addPatternNames(
                        declaration.id,
                        names
                    )
                }
            } else if (
                ['FunctionDeclaration', 'ClassDeclaration'].includes(
                    statement.type
                )
            ) {
                JavaScriptEvidenceAnalyzer.#addPatternNames(statement.id, names)
            }
        }
        return names
    }

    /**
     * Adds all names from one binding pattern.
     * @param {Record<string, any> | null} pattern Binding pattern.
     * @param {Set<string>} names Name sink.
     * @returns {void}
     */
    static #addPatternNames(pattern, names) {
        if (!pattern || typeof pattern !== 'object') return
        if (pattern.type === 'Identifier') {
            names.add(pattern.name)
            return
        }
        if (pattern.type === 'RestElement') {
            JavaScriptEvidenceAnalyzer.#addPatternNames(pattern.argument, names)
            return
        }
        if (pattern.type === 'AssignmentPattern') {
            JavaScriptEvidenceAnalyzer.#addPatternNames(pattern.left, names)
            return
        }
        if (pattern.type === 'ObjectPattern') {
            for (const property of pattern.properties || []) {
                JavaScriptEvidenceAnalyzer.#addPatternNames(
                    property.value || property.argument,
                    names
                )
            }
            return
        }
        if (pattern.type === 'ArrayPattern') {
            for (const element of pattern.elements || []) {
                JavaScriptEvidenceAnalyzer.#addPatternNames(element, names)
            }
        }
    }

    /**
     * Walks AST nodes without traversing parser metadata objects.
     * @param {unknown} value Current node or node array.
     * @param {Record<string, any>[]} ancestors Parent nodes.
     * @param {Record<string, any> | null} parent Immediate parent.
     * @param {string} key Parent property name.
     * @param {(node: Record<string, any>, ancestors: Record<string, any>[], parent: Record<string, any> | null, key: string) => void} visit Visitor callback.
     * @returns {void}
     */
    static #walk(value, ancestors, parent, key, visit) {
        if (Array.isArray(value)) {
            for (const item of value) {
                JavaScriptEvidenceAnalyzer.#walk(
                    item,
                    ancestors,
                    parent,
                    key,
                    visit
                )
            }
            return
        }
        if (
            !value ||
            typeof value !== 'object' ||
            typeof value.type !== 'string'
        ) {
            return
        }
        visit(value, ancestors, parent, key)
        const nextAncestors = [...ancestors, value]
        for (const [childKey, child] of Object.entries(value)) {
            if (
                [
                    'loc',
                    'start',
                    'end',
                    'extra',
                    'comments',
                    'errors',
                    'tokens'
                ].includes(childKey)
            ) {
                continue
            }
            JavaScriptEvidenceAnalyzer.#walk(
                child,
                nextAncestors,
                value,
                childKey,
                visit
            )
        }
    }

    /**
     * Tests canonical path containment.
     * @param {string} root Canonical root.
     * @param {string} candidate Canonical candidate.
     * @returns {boolean} Whether the candidate stays inside the root.
     */
    static #inside(root, candidate) {
        const relationship = relative(root, candidate)
        return !(
            relationship === '..' ||
            relationship.startsWith(`..${sep}`) ||
            isAbsolute(relationship)
        )
    }
}

Object.freeze(JavaScriptEvidenceAnalyzer.prototype)
Object.freeze(JavaScriptEvidenceAnalyzer)
