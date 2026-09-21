// Run: node test/flowMappingGroups.node.mjs
import assert from 'node:assert/strict';
import { mappingGroups } from '../js/flow-rail/flowMappingGroups.js?v=1';
const app = { _currentModules: [{ id: 'a', type: 'keyboard', label: 'Piano' }, { id: 'b', type: 'keyboard', label: 'Organ' }] };
const mappings = [
  { id: 'a-volume', target: { kind: 'param', moduleId: 'a', control: 'volume' } },
  { id: 'b-volume', target: { kind: 'param', moduleId: 'b', control: 'volume' } },
  { id: 'a-wheel', target: { kind: 'param', moduleId: 'a', control: 'modWheel' } },
  { id: 'a-on', target: { kind: 'event', action: 'module:a:on' } },
  { id: 'cc-1', target: { kind: 'ccOut', channel: 1, cc: 11 } },
  { id: 'cc-2', target: { kind: 'ccOut', channel: 2, cc: 11 } },
  { id: 'action', target: { kind: 'event', action: 'nextSection' } },
];
const original = JSON.stringify(mappings);
const groups = mappingGroups(mappings, app);
assert.deepEqual(groups.map(g => g.label), ['Piano', 'Organ', 'MIDI · Channel 1', 'MIDI · Channel 2', 'Actions']);
assert.deepEqual(groups[0].mappings.map(m => m.id), ['a-volume', 'a-wheel', 'a-on']);
assert.equal(JSON.stringify(mappings), original, 'Grouping must not reorder persisted execution');
assert.equal(groups[0].mappings[0], mappings[0], 'Groups reference the original mapping');
assert.deepEqual(mappingGroups([], app), []);
console.log('PASS distinct instruments, module events, MIDI channels, actions, stable order, empty state');
