import assert from 'node:assert/strict'
import test from 'node:test'

import { Parser, ParserWorkerClient } from '../src/parser.mjs'
import { ProjectLoader } from '../src/project.mjs'
import { TOOLKIT_WORKER_PROTOCOL } from '../src/core/worker/ToolkitWorkerProtocol.mjs'

/** Browser-compatible worker double with a programmable post action. */
class AttemptWorker {
    #listeners = new Map()
    #onPost

    /** @param {Function} onPost Post action. */
    constructor(onPost) {
        this.#onPost = onPost
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    addEventListener(type, listener) {
        if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
        this.#listeners.get(type).add(listener)
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    removeEventListener(type, listener) {
        this.#listeners.get(type)?.delete(listener)
    }

    /** @param {object} message Worker request. @param {Transferable[]} transfer Transfer list. */
    postMessage(message, transfer = []) {
        const cloned = structuredClone(message, { transfer })
        Reflect.apply(this.#onPost, undefined, [this, cloned])
    }

    /** @param {string} type Event type. @param {object} event Event record. */
    emit(type, event) {
        for (const listener of this.#listeners.get(type) || []) listener(event)
    }

    /** Clears all worker listeners. */
    terminate() {
        this.#listeners.clear()
    }
}

/** @param {string} requestId Request id. @param {unknown} value Result. @returns {object} Response. */
function resultResponse(requestId, value) {
    return {
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'result',
        requestId,
        value
    }
}

/** @param {string} requestId Request id. @returns {object} Remote parser error response. */
function parserErrorResponse(requestId) {
    return {
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'error',
        requestId,
        error: {
            name: 'ToolkitError',
            message: 'Remote parser rejected the input.',
            code: 'ERR_REMOTE_PARSE',
            category: 'parse',
            format: 'circuitjson',
            source: 'remote.json',
            location: null,
            details: {},
            cause: null
        },
        diagnostics: []
    }
}

/** @returns {ParserWorkerClient} Client returning real canonical results. */
function successfulClient() {
    return new ParserWorkerClient({
        createWorker: () =>
            new AttemptWorker((worker, message) => {
                const value =
                    message.type === 'parse'
                        ? Parser.parse(message.input, message.options)
                        : ProjectLoader.load(message.entries, message.options)
                queueMicrotask(() =>
                    worker.emit('message', {
                        data: structuredClone(
                            resultResponse(message.requestId, value)
                        )
                    })
                )
            })
    })
}

test('instance attempts return exact success envelopes for parse and project work', async () => {
    const client = successfulClient()
    try {
        const parsed = await client.parseAttempt({
            fileName: 'attempt.json',
            data: '[]'
        })
        assert.deepEqual(Object.keys(parsed).sort(), ['ok', 'value'])
        assert.equal(parsed.ok, true)
        assert.equal(parsed.value.schema, 'ecad-toolkit.document.v1')

        const project = await client.loadProjectAttempt([
            { name: 'attempt.json', data: '[]' }
        ])
        assert.deepEqual(Object.keys(project).sort(), ['ok', 'value'])
        assert.equal(project.ok, true)
        assert.equal(project.value.schema, 'ecad-toolkit.project.v1')
    } finally {
        client.dispose()
    }
})

test('instance attempts authorize only their own local construction failure', async () => {
    const client = new ParserWorkerClient({
        createWorker() {
            throw new Error('worker construction blocked')
        }
    })
    try {
        const [parsed, project] = await Promise.all([
            client.parseAttempt({ fileName: 'parse.json', data: '[]' }),
            client.loadProjectAttempt([{ name: 'project.json', data: '[]' }])
        ])
        for (const attempt of [parsed, project]) {
            assert.deepEqual(Object.keys(attempt).sort(), [
                'error',
                'ok',
                'unavailable'
            ])
            assert.equal(attempt.ok, false)
            assert.equal(attempt.unavailable, true)
            assert.equal(attempt.error.code, 'ERR_WORKER_REQUEST')
            assert.equal(attempt.error.details.phase, 'construct')
        }
        assert.notEqual(parsed.error, project.error)
    } finally {
        client.dispose()
    }
})

test('instance attempt construction authorization is consumed once', async () => {
    let constructions = 0
    let firstError
    const client = new ParserWorkerClient({
        createWorker() {
            constructions += 1
            if (constructions === 1) {
                throw new Error('worker construction blocked')
            }
            return new AttemptWorker((worker, message) => {
                queueMicrotask(() =>
                    worker.emit('message', {
                        data: {
                            protocol: TOOLKIT_WORKER_PROTOCOL,
                            type: 'progress',
                            requestId: message.requestId,
                            progress: {
                                stage: 'detect',
                                message: 'Detecting CircuitJSON input.'
                            }
                        }
                    })
                )
            })
        }
    })
    try {
        const first = await client.parseAttempt({
            fileName: 'first.json',
            data: '[]'
        })
        firstError = first.error
        assert.equal(first.unavailable, true)

        const replay = await client.parseAttempt(
            { fileName: 'replay.json', data: '[]' },
            {
                onProgress() {
                    throw firstError
                }
            }
        )
        assert.equal(replay.ok, false)
        assert.equal(replay.error, firstError)
        assert.equal(replay.unavailable, false)
    } finally {
        client.dispose()
    }
})

test('instance attempts never authorize local validation or post failures', async (t) => {
    await t.test('input validation', async () => {
        const client = successfulClient()
        try {
            const attempt = await client.parseAttempt({
                fileName: 'empty.json'
            })
            assert.equal(attempt.ok, false)
            assert.equal(attempt.unavailable, false)
            assert.equal(attempt.error.name, 'TypeError')
        } finally {
            client.dispose()
        }
    })

    await t.test('post failure', async () => {
        const client = new ParserWorkerClient({
            createWorker: () =>
                new AttemptWorker(() => {
                    throw new Error('post blocked')
                })
        })
        try {
            const attempt = await client.parseAttempt({
                fileName: 'post.json',
                data: '[]'
            })
            assert.equal(attempt.ok, false)
            assert.equal(attempt.unavailable, false)
            assert.equal(attempt.error.code, 'ERR_WORKER_REQUEST')
            assert.equal(attempt.error.details.phase, 'post')
        } finally {
            client.dispose()
        }
    })
})

test('instance attempts keep remote parser, protocol, and runtime failures visible', async (t) => {
    const cases = [
        {
            name: 'remote parser',
            expectedCode: 'ERR_REMOTE_PARSE',
            respond(worker, message) {
                worker.emit('message', {
                    data: parserErrorResponse(message.requestId)
                })
            }
        },
        {
            name: 'protocol',
            expectedCode: 'ERR_WORKER_MESSAGE',
            respond(worker, message) {
                worker.emit('message', {
                    data: {
                        protocol: TOOLKIT_WORKER_PROTOCOL,
                        type: 'result',
                        requestId: message.requestId
                    }
                })
            }
        },
        {
            name: 'runtime',
            expectedCode: 'ERR_WORKER_RUNTIME',
            respond(worker) {
                worker.emit('error', { error: new Error('worker crashed') })
            }
        }
    ]

    for (const entry of cases) {
        await t.test(entry.name, async () => {
            const client = new ParserWorkerClient({
                createWorker: () =>
                    new AttemptWorker((worker, message) =>
                        queueMicrotask(() => entry.respond(worker, message))
                    )
            })
            try {
                const attempt = await client.parseAttempt({
                    fileName: `${entry.name}.json`,
                    data: '[]'
                })
                assert.equal(attempt.ok, false)
                assert.equal(attempt.unavailable, false)
                assert.equal(attempt.error.code, entry.expectedCode)
            } finally {
                client.dispose()
            }
        })
    }
})
