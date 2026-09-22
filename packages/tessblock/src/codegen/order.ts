/**
 * @fileoverview Operator precedence, smallest binds tightest.
 *
 * A value block reports the order of its own outermost operator; a socket says
 * the loosest order it accepts unparenthesized. Anything looser is wrapped.
 */
export const Order = {
  ATOMIC: 0,
  UNARY: 1,
  POW: 2,
  MUL: 3,
  ADD: 4,
  COMPARE: 5,
  NOT: 6,
  AND: 7,
  OR: 8,
  NONE: 99,
} as const;

export type OrderValue = (typeof Order)[keyof typeof Order] | number;
