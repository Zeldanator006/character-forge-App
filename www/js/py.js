/* Python semantics the ports of the PC app's modules lean on: truthiness, int(), float(), round(), '{:g}',
   str() and the string methods whose JavaScript namesakes behave differently. */

/** Python truthiness: empty lists, objects and strings, 0, null and false count as false. */
export const T = (v) => Boolean(v) && !(Array.isArray(v) && !v.length)
  && !(typeof v === 'object' && !Array.isArray(v) && !(v instanceof Set) && !(v instanceof Map) && !Object.keys(v).length)
  && !((v instanceof Set || v instanceof Map) && !v.size);

/** Python's `a or b or c`: the first truthy value, else the last one. */
export const or = (...vals) => {
  for (const v of vals) if (T(v)) return v;
  return vals[vals.length - 1];
};

/** dict.get(key, default): the stored value (even null) when the key is there. */
export const get = (obj, key, def = null) => (obj != null && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : def);

export const isDict = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Python's str() for the scalars that turn up as dict keys and in messages. */
export const pyStr = (v) => (v == null ? 'None' : v === true ? 'True' : v === false ? 'False' : String(v));

/** The key a value becomes in json.dumps (None -> "null", True -> "true"). */
export const jsonKey = (v) => (v == null ? 'null' : v === true ? 'true' : v === false ? 'false' : String(v));

const INT_RE = /^\s*[-+]?\d+(?:_\d+)*\s*$/;
const FLOAT_RE = /^\s*[-+]?(?:(?:\d+(?:_\d+)*)?\.?\d+(?:_\d+)*|\d+(?:_\d+)*\.)(?:[eE][-+]?\d+(?:_\d+)*)?\s*$/;

/** int(v) that throws like Python on input it rejects. */
export function int(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`cannot convert ${v} to integer`);
    return Math.trunc(v) || 0;
  }
  if (typeof v === 'string' && INT_RE.test(v)) return parseInt(v.replace(/_/g, ''), 10);
  throw new Error(`invalid literal for int(): ${JSON.stringify(v)}`);
}

/** try: int(v) except (TypeError, ValueError): default */
export function toInt(v, def = 0) {
  if (typeof v === 'number' && !Number.isFinite(v)) return def;
  try { return int(v); } catch { return def; }
}

/** int(str(v).strip()), falling back to the default: numeric strings and whole numbers only. */
export function strInt(v, def = 0) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : def;
  if (typeof v === 'string' && INT_RE.test(v)) return parseInt(v.replace(/_/g, ''), 10);
  return def;
}

/** try: float(v) except (TypeError, ValueError): default */
export function toFloat(v, def = 0) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (/^[-+]?(inf|infinity)$/.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
    if (/^[-+]?nan$/.test(s)) return NaN;
    if (FLOAT_RE.test(v)) return parseFloat(v.replace(/_/g, ''));
  }
  return def;
}

/** Python's round(x, n): correctly rounded, exact ties to even. */
export function round(x, n = 0) {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0, a = Math.abs(x);
  const exact = a.toFixed(100);  // the double's exact decimal value (enough digits for anything we store)
  const dot = exact.indexOf('.');
  const tail = exact.slice(dot + 1 + n);
  let out;
  if (tail[0] === '5' && /^50*$/.test(tail)) {
    const kept = exact.slice(0, dot + 1 + n).replace('.', '');
    let big = BigInt(kept);
    if (big % 2n === 1n) big += 1n;
    out = Number(big) / 10 ** n;
  } else {
    out = parseFloat(a.toFixed(n));
  }
  return neg ? -out : out;
}

/** f'{x:g}' */
export function fmtG(x, precision = 6) {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const [mant, expText] = x.toExponential(precision - 1).split('e');
  const exp = parseInt(expText, 10);
  const strip = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (exp >= -4 && exp < precision) return strip(x.toFixed(precision - 1 - exp));
  return `${strip(mant)}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
}

/** str.capitalize(): first letter upper case, the rest lower case. */
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** str.title() for ASCII words. */
export const title = (s) => s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** sorted() for strings and numbers: code point order, ascending. */
export const sorted = (it, reverse = false) => {
  const out = [...it].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return reverse ? out.reverse() : out;
};

/** str.strip(chars) */
export const stripChars = (s, chars) => {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a += 1;
  while (b > a && chars.includes(s[b - 1])) b -= 1;
  return s.slice(a, b);
};

/** The items of a list (Python iterates whatever `x or []` gives; we only iterate lists). */
export const list = (v) => (Array.isArray(v) ? v : []);

export const sum = (arr) => arr.reduce((t, v) => t + v, 0);

export const deepCopy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** Python 3.12+'s sum(): floats are added with Neumaier compensation, ints plainly. isFloat says which is which
    (by default everything is a float, as with sums of float() results). */
export function fsum(values, isFloat = () => true) {
  let i = 0, ires = 0;
  const n = values.length;
  while (i < n && !isFloat(values[i], i)) { ires += values[i]; i += 1; }
  if (i >= n) return ires;
  let f = ires + values[i], c = 0;
  for (i += 1; i < n; i += 1) {
    const x = values[i];
    if (isFloat(x, i)) {
      const t = f + x;
      if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x;
      else c += (x - t) + f;
      f = t;
    } else f += x;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

/** Python's max(a, b): keeps a unless b is bigger (so a NaN b loses). */
export const max2 = (a, b) => (b > a ? b : a);

/** dict.setdefault(key, value) */
export function setdefault(obj, key, value) {
  if (!Object.hasOwn(obj, key)) obj[key] = value;
  return obj[key];
}
