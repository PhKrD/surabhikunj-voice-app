// Safe evaluator for admin-written scoring formulas, e.g.
//   japa_rounds * 10.9375
//   min(175, reading_min / 30 * 75)
//   wake_up_time <= 270 ? 175 : 0
//
// Formulas used to run through `new Function`, which executes arbitrary
// JavaScript on every member's phone — anyone allowed to edit a tracker
// could have run code inside other people's sessions. This parser only
// understands arithmetic, comparisons, && || !, ternaries and a few maths
// functions. Anything else is a syntax error and scores 0.
//
// Variables resolve to numbers: numeric strings as numbers, "HH:MM" as
// minutes since midnight, true/false as 1/0, anything else as 0.

const FUNCTIONS = {
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const t = value.trim()
    const hm = t.match(/^(\d{1,2}):(\d{2})$/)
    if (hm) return Number(hm[1]) * 60 + Number(hm[2])
    const n = Number(t)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function tokenize(src) {
  const tokens = []
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[-+*/%()<>!?:,]))/y
  let pos = 0
  while (pos < src.length) {
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(pos))) break
      throw new SyntaxError(`Unexpected character at ${pos}`)
    }
    pos = re.lastIndex
    if (m[1] !== undefined) tokens.push({ type: 'num', value: Number(m[1]) })
    else if (m[2] !== undefined) tokens.push({ type: 'id', value: m[2] })
    else tokens.push({ type: 'op', value: m[3] })
  }
  return tokens
}

/**
 * @param {string} expr
 * @param {Record<string, unknown>} variables
 * @returns {number}  NaN-free; throws SyntaxError on invalid input
 */
export function evaluateExpression(expr, variables = {}) {
  const tokens = tokenize(String(expr ?? ''))
  let i = 0
  const peek = () => tokens[i]
  const isOp = (v) => tokens[i]?.type === 'op' && tokens[i].value === v
  const expect = (v) => {
    if (!isOp(v)) throw new SyntaxError(`Expected "${v}"`)
    i++
  }

  // Precedence, lowest first: ternary, ||, &&, equality, relational,
  // additive, multiplicative, unary, primary.
  function ternary() {
    const cond = or()
    if (isOp('?')) {
      i++
      const a = ternary()
      expect(':')
      const b = ternary()
      return cond ? a : b
    }
    return cond
  }
  function or() {
    let v = and()
    while (isOp('||')) { i++; const r = and(); v = v || r ? 1 : 0 }
    return v
  }
  function and() {
    let v = equality()
    while (isOp('&&')) { i++; const r = equality(); v = v && r ? 1 : 0 }
    return v
  }
  function equality() {
    let v = relational()
    while (isOp('==') || isOp('!=')) {
      const op = tokens[i++].value
      const r = relational()
      v = (op === '==' ? v === r : v !== r) ? 1 : 0
    }
    return v
  }
  function relational() {
    let v = additive()
    while (isOp('<') || isOp('<=') || isOp('>') || isOp('>=')) {
      const op = tokens[i++].value
      const r = additive()
      v = (op === '<' ? v < r : op === '<=' ? v <= r : op === '>' ? v > r : v >= r) ? 1 : 0
    }
    return v
  }
  function additive() {
    let v = multiplicative()
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].value
      const r = multiplicative()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  function multiplicative() {
    let v = unary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[i++].value
      const r = unary()
      v = op === '*' ? v * r : op === '/' ? (r === 0 ? 0 : v / r) : (r === 0 ? 0 : v % r)
    }
    return v
  }
  function unary() {
    if (isOp('-')) { i++; return -unary() }
    if (isOp('+')) { i++; return unary() }
    if (isOp('!')) { i++; return unary() ? 0 : 1 }
    return primary()
  }
  function primary() {
    const t = peek()
    if (!t) throw new SyntaxError('Unexpected end of formula')
    if (t.type === 'num') { i++; return t.value }
    if (t.type === 'op' && t.value === '(') {
      i++
      const v = ternary()
      expect(')')
      return v
    }
    if (t.type === 'id') {
      i++
      if (isOp('(')) {
        const fn = Object.hasOwn(FUNCTIONS, t.value) ? FUNCTIONS[t.value] : null
        if (!fn) throw new SyntaxError(`Unknown function "${t.value}"`)
        i++
        const args = []
        if (!isOp(')')) {
          args.push(ternary())
          while (isOp(',')) { i++; args.push(ternary()) }
        }
        expect(')')
        return fn(...args)
      }
      if (t.value === 'true') return 1
      if (t.value === 'false') return 0
      return toNumber(Object.hasOwn(variables, t.value) ? variables[t.value] : 0)
    }
    throw new SyntaxError(`Unexpected "${t.value}"`)
  }

  const result = ternary()
  if (i !== tokens.length) throw new SyntaxError(`Unexpected "${tokens[i].value}"`)
  return Number.isFinite(result) ? result : 0
}
