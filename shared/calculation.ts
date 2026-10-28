import { z } from 'zod';

const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const decimalStringSchema = z.string().trim().min(1).max(64).refine(value => {
  if (!decimalPattern.test(value)) return false;
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  return whole.replace(/^0+/, '').length <= 30 && fraction.length <= 30;
}, 'Bitte eine Dezimalzahl mit höchstens 30 Stellen vor und nach dem Punkt angeben.');
const operandSchema = z.union([decimalStringSchema, z.number().finite().min(-1e15).max(1e15)]).describe('Dezimalzahl mit Punkt. Für genaue große Zahlen oder viele Nachkommastellen eine Zeichenfolge verwenden.');

export const calculationSchema = z.object({
  operation: z.enum(['sum', 'average', 'difference', 'product', 'divide', 'percentage', 'min', 'max']),
  values: z.array(operandSchema).min(1).max(100),
  decimalPlaces: z.number().int().min(0).max(18).optional().describe('Höchstens so viele Nachkommastellen, Standard 6. Nicht darstellbare Ergebnisse werden ausdrücklich als gerundet gekennzeichnet.')
}).strict().superRefine((input, context) => {
  if (['difference', 'divide', 'percentage'].includes(input.operation) && input.values.length !== 2) context.addIssue({ code: 'custom', path: ['values'], message: 'Diese Operation benötigt genau zwei Werte in ihrer Reihenfolge.' });
});
export type CalculationInput = z.infer<typeof calculationSchema>;

type Fraction = { numerator: bigint; denominator: bigint };
const absolute = (value: bigint) => value < 0n ? -value : value;
function gcd(a: bigint, b: bigint): bigint { a = absolute(a); b = absolute(b); while (b) { const remainder = a % b; a = b; b = remainder; } return a || 1n; }
function reduced(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === 0n) throw new Error('Eine Division durch null ist nicht möglich.');
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const common = gcd(numerator, denominator), result = { numerator: numerator / common, denominator: denominator / common };
  if (absolute(result.numerator).toString().length > 512 || result.denominator.toString().length > 512) throw new Error('Diese Berechnung überschreitet die unterstützte Zahlengröße. Bitte kleinere Werte oder weniger Faktoren verwenden.');
  return result;
}
function decimalOperand(value: number | string): Fraction {
  // Number.toString may produce scientific notation; expand its exponent exactly.
  const text = String(value), match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new Error('Bitte eine gültige Dezimalzahl angeben.');
  const sign = match[1] === '-' ? -1n : 1n, digits = (match[2] || '0') + (match[3] || ''), scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  const coefficient = sign * BigInt(digits);
  return scale >= 0 ? reduced(coefficient, 10n ** BigInt(scale)) : reduced(coefficient * 10n ** BigInt(-scale), 1n);
}
const add = (a: Fraction, b: Fraction) => reduced(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
const multiply = (a: Fraction, b: Fraction) => reduced(a.numerator * b.numerator, a.denominator * b.denominator);
const compare = (a: Fraction, b: Fraction) => { const delta = a.numerator * b.denominator - b.numerator * a.denominator; return delta < 0n ? -1 : delta > 0n ? 1 : 0; };

function decimalResult(value: Fraction, places: number) {
  const scale = 10n ** BigInt(places), magnitude = absolute(value.numerator) * scale;
  const quotient = magnitude / value.denominator, remainder = magnitude % value.denominator;
  const rounded = quotient + (remainder * 2n >= value.denominator ? 1n : 0n);
  const digits = rounded.toString().padStart(places + 1, '0');
  if (digits.length - places > 100) throw new Error('Das Ergebnis ist zu groß für eine übersichtliche Ausgabe.');
  const whole = places ? digits.slice(0, -places) : digits, fraction = places ? digits.slice(-places).replace(/0+$/, '') : '';
  const result = `${value.numerator < 0n && rounded !== 0n ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
  return { result, exact: remainder === 0n, rounded: remainder !== 0n, decimalPlaces: places, rounding: 'half_away_from_zero' as const };
}

/** Bounded arithmetic with rational BigInt intermediates; never evaluates source code. */
export function evaluateCalculation(raw: unknown) {
  const input = calculationSchema.parse(raw), values = input.values.map(decimalOperand);
  let result: Fraction;
  switch (input.operation) {
    case 'sum': result = values.reduce(add, { numerator: 0n, denominator: 1n }); break;
    case 'average': { const total = values.reduce(add, { numerator: 0n, denominator: 1n }); result = reduced(total.numerator, total.denominator * BigInt(values.length)); break; }
    case 'difference': result = add(values[0], { numerator: -values[1].numerator, denominator: values[1].denominator }); break;
    case 'product': result = values.reduce(multiply, { numerator: 1n, denominator: 1n }); break;
    case 'divide': result = reduced(values[0].numerator * values[1].denominator, values[0].denominator * values[1].numerator); break;
    case 'percentage': result = reduced(values[0].numerator * values[1].denominator * 100n, values[0].denominator * values[1].numerator); break;
    case 'min': result = values.reduce((a, b) => compare(a, b) <= 0 ? a : b); break;
    case 'max': result = values.reduce((a, b) => compare(a, b) >= 0 ? a : b); break;
  }
  return { operation: input.operation, operandCount: values.length, ...decimalResult(result, input.decimalPlaces ?? 6), ...(input.operation === 'percentage' ? { unit: 'percent', semantics: 'Erster Wert geteilt durch zweiten Wert, multipliziert mit 100.' } : {}), note: 'Das Ergebnis ist eine Dezimalzeichenfolge. exact bezieht sich auf die übergebenen Dezimalwerte; gerundete Eingaben werden nicht rekonstruiert.' };
}
