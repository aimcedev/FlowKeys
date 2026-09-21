// Run: node test/flowDeckLayout.node.mjs
import assert from 'node:assert/strict';
import { instrumentDeckLayout } from '../js/flow-rail/flowLandscapeGeometry.js?v=4';
const groups = [{ id: 'piano', mappings: [{ id: 'level' }, { id: 'tone' }, { id: 'on' }] }, { id: 'drums', mappings: [{ id: 'kick' }] }];
const original = JSON.stringify(groups);
for (const viewport of [360, 800, 1600]) {
  const closed = instrumentDeckLayout(viewport, 500, groups);
  const open = instrumentDeckLayout(viewport, 500, groups, [], new Set(['piano']));
  assert.equal(closed.lanes.size, 4, 'Every instrument remains in the workspace');
  for (const [id, lane] of closed.lanes) {
    assert.equal(lane.cardWidth, open.lanes.get(id).cardWidth, 'Fanning must not resize');
    assert.equal(lane.cardWidth, 300);
  }
  assert.equal(open.lanes.get('level').center, closed.lanes.get('level').center, 'Front card stays anchored');
  assert.ok(open.lanes.get('tone').center > open.lanes.get('level').center, 'Expand to the right');
  assert.ok(open.lanes.get('kick').center > closed.lanes.get('kick').center, 'Neighbor moves out of the way');
  assert.equal(open.innerH, closed.innerH, 'Vertical scale stays fixed');
}
const remembered = new Map([['piano', 'tone']]);
const collapsed = instrumentDeckLayout(800, 500, groups, [], new Set(), remembered);
const reopened = instrumentDeckLayout(800, 500, groups, [], new Set(['piano']), remembered);
assert.equal(collapsed.lanes.get('tone').depth, 0, 'Chosen card becomes the front');
assert.equal(collapsed.lanes.get('tone').center, reopened.lanes.get('tone').center, 'Reopening keeps chosen front in place');
assert.equal(JSON.stringify(groups), original, 'Layout never mutates execution order');
assert.equal(instrumentDeckLayout(800, 500, []).lanes.size, 0);
console.log('PASS fixed card size, shared workspace, rightward expansion, anchored reopening, neighbors, stable order, empty state');
