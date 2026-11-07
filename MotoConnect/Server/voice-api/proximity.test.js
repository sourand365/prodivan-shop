import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectedComponent,
  distanceMetres,
  getFreshPresence,
  proximityRoomName,
} from './proximity.js';

const now = 1_800_000_000_000;
const row = (userId, longitude, updatedAt = now) => ({
  userId, displayName: userId, latitude: 0, longitude, enabled: true, updatedAt,
});

test('calculates geographic distance in metres', () => {
  assert.ok(Math.abs(distanceMetres(row('a', 0), row('b', 0.00899)) - 1000) < 2);
});

test('connected component includes chain-connected users beyond direct range', () => {
  const rows = [row('A', 0), row('B', 0.008), row('C', 0.016)];
  const component = connectedComponent(rows, 'A');
  assert.deepEqual(component.map((item) => item.userId), ['A', 'B', 'C']);
  assert.ok(distanceMetres(rows[0], rows[2]) > 1000);
});

test('does not include disconnected users', () => {
  const rows = [row('A', 0), row('B', 0.005), row('C', 0.03)];
  assert.deepEqual(connectedComponent(rows, 'A').map((item) => item.userId), ['A', 'B']);
});

test('stale or invalid presence is excluded', () => {
  const rows = [row('fresh', 0), row('stale', 0.001, now - 90_001), {
    ...row('invalid', 0.002), latitude: 100,
  }];
  assert.deepEqual(getFreshPresence(rows, now).map((item) => item.userId), ['fresh']);
});

test('room name is stable regardless of input order', () => {
  const a = [row('A', 0), row('B', 0.001)];
  assert.equal(proximityRoomName(a), proximityRoomName([...a].reverse()));
});
