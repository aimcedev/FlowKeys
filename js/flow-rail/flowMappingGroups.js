/** Presentation-only grouping; never reorder the stored mappings or their execution. */
export function mappingGroups(mappings, app) {
  const groups = new Map();
  for (const mapping of mappings) {
    const target = mapping.target || {};
    const moduleId = target.kind === 'param' ? target.moduleId
      : target.kind === 'event' && /^module:.+:(on|off)$/.test(target.action || '')
        ? target.action.slice(7, target.action.lastIndexOf(':')) : null;
    const module = app._currentModules?.find(m => m.id === moduleId);
    const id = moduleId ? `module:${moduleId}` : target.kind === 'ccOut' ? `cc:${target.channel}` : 'actions';
    if (!groups.has(id)) groups.set(id, { id, label: module?.label || (moduleId ? 'Instrument' : target.kind === 'ccOut' ? `MIDI · Channel ${target.channel}` : 'Actions'), mappings: [] });
    groups.get(id).mappings.push(mapping);
  }
  return [...groups.values()];
}
