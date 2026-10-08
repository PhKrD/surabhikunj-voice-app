import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateExpression as ev } from './safeExpression.js'

test('arithmetic with precedence and parentheses', () => {
  assert.equal(ev('japa_rounds * 10.9375', { japa_rounds: '16' }), 175)
  assert.equal(ev('2 + 3 * 4'), 14)
  assert.equal(ev('(2 + 3) * 4'), 20)
  assert.equal(ev('-5 + 10 % 4'), -3)
})

test('functions, comparisons and ternaries', () => {
  assert.equal(ev('min(175, reading / 30 * 75)', { reading: 90 }), 175)
  assert.equal(ev('wake <= 270 ? 175 : 0', { wake: '04:30' }), 175)
  assert.equal(ev('wake <= 270 ? 175 : 0', { wake: '05:00' }), 0)
  assert.equal(ev('a > 1 && b ? 1 : 2', { a: 2, b: true }), 1)
  assert.equal(ev('round(2.6) + floor(1.9) + abs(-3)'), 7)
})

test('unknown or non-numeric variables are 0; division by zero is 0', () => {
  assert.equal(ev('missing + 1'), 1)
  assert.equal(ev('x * 2', { x: 'abc' }), 0)
  assert.equal(ev('5 / 0'), 0)
})

test('rejects anything that is not arithmetic', () => {
  for (const evil of [
    'alert(1)',
    'constructor.constructor("return this")()',
    'fetch("https://evil")',
    'x = 1',
    '[1,2]',
    '"str"',
    'a.b',
    '1;2',
  ]) {
    assert.throws(() => ev(evil, {}), SyntaxError, evil)
  }
})

test('prototype names are just unknown variables', () => {
  assert.equal(ev('__proto__ + constructor + toString'), 0)
})
