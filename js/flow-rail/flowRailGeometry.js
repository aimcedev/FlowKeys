/**
 * Shared Flow Rail trajectory geometry for the main canvas and EDIT mini-rail.
 */

import { isContinuousMapping, moduleTypeForId, interpolate, mappingValueExtent } from './flowRailCatalog.js?v=3';
import { mappingSpan } from './flowRailState.js?v=3';

export function assignLanes(rail, app, { magBase = 40, magStep = 28 } = {}) {
  const lanes = new Map();
  const cont = (rail?.mappings || []).filter(m => {
    if (m.target?.kind === 'event') return false;
    const type = m.target?.kind === 'param' ? moduleTypeForId(app, m.target.moduleId) : null;
    return isContinuousMapping(m, type);
  }).slice().sort((a, b) => mappingSpan(a).ccStart - mappingSpan(b).ccStart);

  cont.forEach((m, i) => {
    lanes.set(m.id, {
      sign: i % 2 === 0 ? 1 : -1,
      mag: magBase + Math.floor(i / 2) * magStep,
    });
  });
  return lanes;
}

export function trajectoryPoints(mapping, lay, lanes, app, ccToY) {
  const lane = lanes.get(mapping.id) || { sign: 1, mag: 40 };
  const peel = lane.sign * lane.mag;
  const type = mapping.target?.kind === 'param'
    ? moduleTypeForId(app, mapping.target.moduleId)
    : null;
  const extent = mappingValueExtent(mapping, type);
  const span = Math.max(1e-6, extent.max - extent.min);
  const points = [];
  for (let cc = 0; cc <= 127; cc += 1) {
    const value = interpolate(cc, mapping);
    const n = Number(value);
    const t = Math.max(0, Math.min(1, ((Number.isFinite(n) ? n : 0) - extent.min) / span));
    const x = lay.railX + peel * (0.1 + 0.9 * t);
    points.push({ cc, x, y: ccToY(cc, lay), value });
  }
  return points;
}

export function xToValue(x, mapping, lay, lanes, app) {
  const lane = lanes.get(mapping.id) || { sign: 1, mag: 40 };
  const peel = lane.sign * lane.mag;
  const type = mapping.target?.kind === 'param'
    ? moduleTypeForId(app, mapping.target.moduleId)
    : null;
  const extent = mappingValueExtent(mapping, type);
  if (Math.abs(peel) < 1) return extent.min;
  const tRaw = (x - lay.railX) / peel;
  const t = Math.max(0, Math.min(1, (tRaw - 0.1) / 0.9));
  return extent.min + t * (extent.max - extent.min);
}

export function strokeSpan(ctx, pts, ccA, ccB, rgba, width) {
  const a = Math.max(0, Math.min(127, ccA));
  const b = Math.max(0, Math.min(127, ccB));
  if (b < a) return;
  ctx.strokeStyle = rgba;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let started = false;
  for (let cc = a; cc <= b; cc++) {
    const p = pts[cc];
    if (!p) continue;
    if (!started) { ctx.moveTo(p.x, p.y); started = true; }
    else ctx.lineTo(p.x, p.y);
  }
  if (started) ctx.stroke();
}
