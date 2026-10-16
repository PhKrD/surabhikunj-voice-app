import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCoordinates } from './geo.js'

test('plain "lat, lng"', () => {
  assert.deepEqual(parseCoordinates('18.5204, 73.8567'), { lat: 18.5204, lng: 73.8567 })
  assert.deepEqual(parseCoordinates('-33.86 151.2'), { lat: -33.86, lng: 151.2 })
})

test('Google Maps links', () => {
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/@18.5416631,73.8525083,17z'), { lat: 18.5416631, lng: 73.8525083 })
  assert.deepEqual(parseCoordinates('https://www.google.com/maps?q=18.54,73.85'), { lat: 18.54, lng: 73.85 })
  assert.deepEqual(parseCoordinates('https://maps.google.com/?ll=18.54,73.85&z=15'), { lat: 18.54, lng: 73.85 })
})

test('OpenStreetMap links', () => {
  assert.deepEqual(parseCoordinates('https://www.openstreetmap.org/#map=16/18.5416/73.8525'), { lat: 18.5416, lng: 73.8525 })
})

test('rejects text without coordinates or out of range', () => {
  assert.equal(parseCoordinates('Home'), null)
  assert.equal(parseCoordinates(''), null)
  assert.equal(parseCoordinates(null), null)
  assert.equal(parseCoordinates('95.0, 73.0'), null)
})
