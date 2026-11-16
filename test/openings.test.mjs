import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_TYPES, OPENING_BY_ID, LEGACY_OPEN, mapLegacy, roughOpening, headerSpec, openingItems, OPERATION } from '../src/sim/content/openings.js';

test('the catalog has every window and door type, with sizes, operation and prices', () => {
  const ids = OPENING_TYPES.map((t) => t.id);
  for (const id of ['picture', 'double_hung', 'slider', 'casement', 'awning', 'transom', 'arched', 'clerestory', 'door_single', 'door_french', 'door_patio', 'door_dutch', 'door_barn', 'door_pocket', 'door_bifold', 'door_garage']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of OPENING_TYPES) {
    assert.ok(t.w.length >= 1 && t.w.length <= 4 && t.h.length >= 1 && t.h.length <= 4, t.id);
    assert.ok(OPERATION[t.op] && t.price > 0 && t.mass > 0 && t.store, t.id);
    assert.ok(t.kind === 'door' ? t.sill === 0 : t.sill > 0.3, t.id);
  }
  assert.equal(OPENING_BY_ID.door_pocket.frame, 'pocket');
  assert.equal(OPENING_BY_ID.door_garage.frame, 'beam');
  assert.ok(OPENING_BY_ID.door_barn.surface);
});

test('old module shapes map to catalog types', () => {
  for (const k in LEGACY_OPEN) assert.ok(OPENING_BY_ID[mapLegacy(k).type], k);
  assert.equal(mapLegacy('nope'), null);
});

test('header table: sized by span, engineered beyond 3 m with doubled jacks', () => {
  assert.deepEqual([0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.8, 3.0].map((s) => headerSpec(s).size), ['2x6', '2x6', '2x8', '2x8', '2x10', '2x10', '2x12', '2x12']);
  const b = headerSpec(3.2);
  assert.ok(b.engineered && b.jacks === 2);
});

test('rough opening is the unit plus a gap; doors sit on the floor', () => {
  const r = roughOpening('door_patio', 2.44, 2.03);
  assert.ok(Math.abs(r.width - 2.464) < 1e-9 && r.sill < 0.05 && r.height > 2.05);
  assert.ok(roughOpening('casement', 0.9, 1.2, 0.9).sill < 0.9);
});

test('every size is a store item', () => {
  const items = openingItems();
  assert.ok(items.op_door_patio_2440x2030.priceUsd > 700);
  assert.ok(Object.keys(items).length > 60);
});
