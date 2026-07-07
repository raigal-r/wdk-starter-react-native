/**
 * Convert a user-typed decimal string to token base units without
 * floating-point precision loss (e.g. '1.5', 18 → 1500000000000000000n).
 */
export function parseTokenAmount(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;

  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;

  const padded = fraction.padEnd(decimals, '0');
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
  return result > 0n ? result : null;
}

/**
 * Format token base units back to a human-readable decimal string.
 */
export function formatTokenBaseUnits(value: bigint, decimals: number, maxFraction = 6): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;

  if (fraction === 0n) return whole.toString();

  const fractionStr = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, maxFraction)
    .replace(/0+$/, '');

  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}
