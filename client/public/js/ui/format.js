// Integer with comma grouping (1,000,000) — locale-independent.
export function formatGrouped(n) {
  const v = Math.trunc(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Seat stacks on the table page (circles), not felt bets.
export function formatStack(n) {
  return formatGrouped(n);
}

// Pot / street bets: k/M with '.' decimal, exact fraction, no trailing zeros.
export function formatCompact(n) {
  const v = Math.trunc(Number(n) || 0);
  if (v === 0) return '0';
  if (v >= 1_000_000) return _compact(v, 1_000_000, 'M');
  if (v >= 1000) return _compact(v, 1000, 'k');
  return String(v);
}

function _compact(v, div, suffix) {
  const whole = Math.floor(v / div);
  const rem = v % div;
  if (rem === 0) return `${whole}${suffix}`;
  const width = String(div).length - 1;
  const frac = String(rem).padStart(width, '0').replace(/0+$/, '');
  return `${whole}.${frac}${suffix}`;
}

export function formatExact(n) {
  return formatCompact(n);
}
