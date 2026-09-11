import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, matches, normalizeHost, safeSearchAliasFor, VERDICT } from './webPolicy.js'

test('normalizeHost strips scheme, path, query, port and trailing dot', () => {
  assert.equal(normalizeHost('https://WWW.Example.com/foo?bar=1'), 'www.example.com')
  assert.equal(normalizeHost('example.com:8443'), 'example.com')
  assert.equal(normalizeHost('example.com.'), 'example.com')
  assert.equal(normalizeHost('user:pw@example.com'), 'example.com')
  assert.equal(normalizeHost('  '), null)
  assert.equal(normalizeHost('localhost'), null, 'a bare word is a search term, not a host')
  assert.equal(normalizeHost(undefined), null)
})

test('matches walks parent domains so a rule on the apex covers subdomains', () => {
  assert.equal(matches('a.b.youtube.com', ['youtube.com']), true)
  assert.equal(matches('youtube.com', ['youtube.com']), true)
  assert.equal(matches('notyoutube.com', ['youtube.com']), false)
  assert.equal(matches('youtube.com', []), false)
})

test('allow overrides block, and is the exception list for block-unknown', () => {
  const rules = { allowed: ['school.youtube.com'], blocked: ['youtube.com'] }
  assert.equal(evaluate('youtube.com', rules), VERDICT.BLOCK)
  assert.equal(evaluate('school.youtube.com', rules), VERDICT.ALLOW)
})

test('block-unknown default-denies anything outside the known set', () => {
  const rules = { blockUnknown: true, knownDomains: ['khanacademy.org'] }
  assert.equal(evaluate('khanacademy.org', rules), VERDICT.ALLOW)
  assert.equal(evaluate('somerandomsite.xyz', rules), VERDICT.BLOCK)
})

test('essential infrastructure is never blocked, even by block-unknown', () => {
  const rules = { blockUnknown: true, knownDomains: [], blocked: ['googleapis.com'] }
  assert.equal(evaluate('firebaseinstallations.googleapis.com', rules), VERDICT.ALLOW)
  assert.equal(evaluate('abcdef.supabase.co', rules), VERDICT.ALLOW)
})

test('alert only applies when nothing stronger matched', () => {
  assert.equal(evaluate('reddit.com', { alerted: ['reddit.com'] }), VERDICT.ALERT)
  assert.equal(evaluate('reddit.com', { alerted: ['reddit.com'], blocked: ['reddit.com'] }), VERDICT.BLOCK)
  assert.equal(evaluate('reddit.com', { alerted: ['reddit.com'], allowed: ['reddit.com'] }), VERDICT.ALLOW)
})

// ── Safe Search: the regression this whole module exists for ──────────

test('safe search rewrites only the actual search front-ends', () => {
  assert.equal(safeSearchAliasFor('www.google.com'), 'forcesafesearch.google.com')
  assert.equal(safeSearchAliasFor('google.com'), 'forcesafesearch.google.com')
  assert.equal(safeSearchAliasFor('google.co.in'), 'forcesafesearch.google.com')
  assert.equal(safeSearchAliasFor('www.bing.com'), 'strict.bing.com')
  assert.equal(safeSearchAliasFor('duckduckgo.com'), 'safe.duckduckgo.com')
  assert.equal(safeSearchAliasFor('m.youtube.com'), 'restrictmoderate.youtube.com')
})

test('safe search NEVER touches other Google products or CDNs', () => {
  // Every one of these used to be silently pointed at forcesafesearch /
  // restrict.youtube.com by a substring match, which is why "many other
  // websites stopped working" whenever Safe Search was enabled.
  for (const host of [
    'mail.google.com',
    'drive.google.com',
    'play.google.com',
    'accounts.google.com',
    'photos.google.com',
    'docs.google.com',
    'maps.google.com',
    'clients4.google.com',
    'i.ytimg.com',
    'ytimg.com',
    'fonts.googleapis.com',
    'googlevideo.com',
    'notgoogle.com',
  ]) {
    assert.equal(safeSearchAliasFor(host), null, `${host} must not be rewritten`)
  }
})
