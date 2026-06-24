/**
 * Normalizes simulator time-series rows to transient directive timing.
 */
export class SpiceTimeSeriesNormalizer {
    static #EPSILON = 1e-12

    /**
     * Resamples graph models onto the transient analysis time grid.
     * @param {object[]} graphs Graph models with time and values arrays.
     * @param {{ tstep?: number, tstop?: number, tstart?: number } | null} tran Transient timing parameters.
     * @returns {object[]}
     */
    static resampleGraphs(graphs, tran) {
        const targetTime = SpiceTimeSeriesNormalizer.#targetTimeValues(tran)
        if (!targetTime) return graphs

        return graphs.map((graph) => ({
            ...graph,
            time: targetTime,
            values: SpiceTimeSeriesNormalizer.#interpolateValues(
                graph.time,
                graph.values,
                targetTime
            )
        }))
    }

    /**
     * Builds the target transient time grid in seconds.
     * @param {{ tstep?: number, tstop?: number, tstart?: number } | null} tran Transient timing parameters.
     * @returns {number[] | null}
     */
    static #targetTimeValues(tran) {
        const tstep = Number(tran?.tstep)
        const tstop = Number(tran?.tstop)
        const tstart =
            tran?.tstart === undefined || tran?.tstart === null
                ? 0
                : Number(tran.tstart)

        if (
            !Number.isFinite(tstep) ||
            !Number.isFinite(tstop) ||
            !Number.isFinite(tstart) ||
            tstep <= 0 ||
            tstop < tstart
        ) {
            return null
        }

        const times = []
        for (
            let time = tstart;
            time <= tstop + SpiceTimeSeriesNormalizer.#EPSILON;
            time += tstep
        ) {
            times.push(SpiceTimeSeriesNormalizer.#round(time))
        }

        const lastTime = times.at(-1)
        if (
            lastTime !== undefined &&
            Math.abs(lastTime - tstop) > SpiceTimeSeriesNormalizer.#EPSILON
        ) {
            times.push(SpiceTimeSeriesNormalizer.#round(tstop))
        }

        return times
    }

    /**
     * Interpolates source values onto a target time grid.
     * @param {number[]} sourceTime Source timestamps in seconds.
     * @param {number[]} sourceValues Source sample values.
     * @param {number[]} targetTime Target timestamps in seconds.
     * @returns {number[]}
     */
    static #interpolateValues(sourceTime, sourceValues, targetTime) {
        if (!sourceTime.length || !sourceValues.length) return []

        return targetTime.map((time) =>
            SpiceTimeSeriesNormalizer.#interpolateAt(
                sourceTime,
                sourceValues,
                time
            )
        )
    }

    /**
     * Interpolates one value at a target timestamp.
     * @param {number[]} sourceTime Source timestamps in seconds.
     * @param {number[]} sourceValues Source sample values.
     * @param {number} targetTime Target timestamp in seconds.
     * @returns {number}
     */
    static #interpolateAt(sourceTime, sourceValues, targetTime) {
        if (targetTime <= sourceTime[0]) return sourceValues[0]

        const lastIndex = Math.min(sourceTime.length, sourceValues.length) - 1
        if (targetTime >= sourceTime[lastIndex]) {
            return sourceValues[lastIndex]
        }

        for (let index = 1; index <= lastIndex; index += 1) {
            const currentTime = sourceTime[index]
            if (targetTime > currentTime) continue

            const previousTime = sourceTime[index - 1]
            const previousValue = sourceValues[index - 1]
            const currentValue = sourceValues[index]
            if (currentTime === previousTime) return currentValue

            const ratio =
                (targetTime - previousTime) / (currentTime - previousTime)
            return SpiceTimeSeriesNormalizer.#round(
                previousValue + ratio * (currentValue - previousValue)
            )
        }

        return sourceValues[lastIndex]
    }

    /**
     * Rounds numeric output to a stable precision.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value).toPrecision(12))
    }
}
