/** Main Flow landscape geometry. The compact EDIT rail intentionally stays separate. */
import { interpolate, mappingValueExtent, moduleTypeForId } from './flowRailCatalog.js?v=4';

export function landscapeLayout(width, height, mappings, checkpoints = []) {
  const margin = checkpoints.some(cp => cp.name) ? 120 : 24;
  const count = Math.max(1, mappings.length);
  const laneWidth = Math.max(112, (width - margin - 24) / count);
  return {
    w: width, h: height, padT: 28, padB: 28,
    innerH: Math.max(1, height - 56), margin, laneWidth,
    lanes: new Map(mappings.map((m, i) => [m.id, {
      center: margin + (i + 0.5) * laneWidth,
      radius: Math.min(160, laneWidth * 0.34),
    }])),
  };
}

export function landscapeY(cc, layout) {
  return layout.padT + (1 - cc / 127) * layout.innerH;
}

export function landscapeCc(y, layout) {
  return Math.round(Math.max(0, Math.min(127, (1 - (y - layout.padT) / layout.innerH) * 127)));
}

export function ribbonPoints(mapping, layout, app) {
  const lane = layout.lanes.get(mapping.id);
  if (!lane) return [];
  const type = mapping.target?.kind === 'param' ? moduleTypeForId(app, mapping.target.moduleId) : null;
  const extent = mappingValueExtent(mapping, type);
  return Array.from({ length: 128 }, (_, cc) => {
    const value = interpolate(cc, mapping);
    const t = Math.max(0, Math.min(1, (Number(value) - extent.min) / (extent.max - extent.min)));
    const radius = 3 + (Number.isFinite(t) ? t : 0) * (lane.radius - 3);
    return { cc, value, x: lane.center + radius, left: lane.center - radius, y: landscapeY(cc, layout) };
  });
}

export function ribbonValue(x, mapping, layout, app) {
  const lane = layout.lanes.get(mapping.id);
  const type = mapping.target?.kind === 'param' ? moduleTypeForId(app, mapping.target.moduleId) : null;
  const extent = mappingValueExtent(mapping, type);
  const t = Math.max(0, Math.min(1, (x - lane.center - 3) / (lane.radius - 3)));
  return extent.min + t * (extent.max - extent.min);
}

/** Fixed-size instrument decks occupy one continuous horizontal workspace. */
export function instrumentDeckLayout(width, height, groups, checkpoints = [], expanded = new Set(), remembered = new Map(), anchors = remembered) {
  const base = landscapeLayout(width, height, [], checkpoints);
  const cardWidth = 300, gap = 16, groupGap = 40, peek = 12;
  base.padT = 94; base.padB = 28; base.innerH = Math.max(1, height - 122);
  base.lanes = new Map();
  let left = base.margin;
  for (const group of groups) {
    const open = expanded.has(group.id);
    const focus = Math.max(0, group.mappings.findIndex(m => m.id === remembered.get(group.id)));
    const anchor = Math.max(0, group.mappings.findIndex(m => m.id === anchors.get(group.id)));
    group.mappings.forEach((m, i) => {
      const depth = open ? 0 : (i - focus + group.mappings.length) % group.mappings.length;
      base.lanes.set(m.id, {
        center: left + cardWidth / 2 + (open ? ((i - anchor + group.mappings.length) % group.mappings.length) * (cardWidth + gap) : Math.min(depth, 3) * peek),
        radius: cardWidth * 0.32, cardWidth, depth, groupId: group.id, expanded: open,
      });
    });
    left += (open ? group.mappings.length * (cardWidth + gap) - gap : cardWidth + Math.min(3, group.mappings.length - 1) * peek) + groupGap;
  }
  base.contentWidth = Math.max(360, left - groupGap + 24);
  return base;
}
