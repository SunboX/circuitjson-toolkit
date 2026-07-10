import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'

/** Immutable length parser used by proof-producing validation. */
export const optionalLength =
    CircuitJsonUnits.optionalLength.bind(CircuitJsonUnits)

/** Immutable angle parser used by proof-producing validation. */
export const optionalAngle =
    CircuitJsonUnits.optionalAngle.bind(CircuitJsonUnits)

/** Immutable point parser used by proof-producing validation. */
export const optionalPoint =
    CircuitJsonUnits.optionalPoint.bind(CircuitJsonUnits)

/** Immutable size parser used by proof-producing validation. */
export const optionalSize = CircuitJsonUnits.optionalSize.bind(CircuitJsonUnits)
