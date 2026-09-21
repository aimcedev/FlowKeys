/**
 * Flow Rail song-scoped state: defaults, sanitization, orphan cleanup.
 * Lives on the song object (not section state) so one performance path
 * maps the song's module lineup.
 *
 * Continuous / discrete mappings store an N-point envelope:
 *   points: [{ id, cc, value }, ...]
 * Events stay a single `cc` (not an envelope).
 */

const CC_MIN = 0;
const CC_MAX = 127;

export function generateFlowRailId() {
  return 'fr' + Math.random().toString(36).substring(2, 9);
}

export function buildDefaultCheckpoints() {
  // Musical landmarks are optional and named by the performer.
  return [];
}

export function buildDefaultFlowRail() {
  return {
    source: { type: 'cc', cc: null, curve: 'linear' },
    checkpoints: buildDefaultCheckpoints(),
    mappings: [],
  };
}

function clampCc(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(CC_MIN, Math.min(CC_MAX, Math.round(n)));
}

export function makePoint(cc, value) {
  return {
    id: generateFlowRailId(),
    cc: clampCc(cc, 0),
    value: sanitizePointValue(value),
  };
}

function sanitizePointValue(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return 0;
    const n = Number(trimmed);
    if (Number.isFinite(n) && trimmed !== 'song') return n;
    return trimmed;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function sanitizePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateFlowRailId(),
    cc: clampCc(raw.cc, 0),
    value: sanitizePointValue(raw.value),
  };
}

/** Sort by CC; same-CC restamp keeps the later entry. */
export function normalizePoints(points) {
  const list = (Array.isArray(points) ? points : []).filter(Boolean);
  list.sort((a, b) => a.cc - b.cc);
  const byCc = new Map();
  for (const p of list) byCc.set(p.cc, p);
  return Array.from(byCc.values()).sort((a, b) => a.cc - b.cc);
}

export function mappingSpan(mapping) {
  if (mapping?.target?.kind === 'event') {
    const cc = mapping.cc ?? 0;
    return { ccStart: cc, ccEnd: cc };
  }
  const pts = mapping?.points || [];
  if (!pts.length) return { ccStart: 0, ccEnd: 0 };
  return { ccStart: pts[0].cc, ccEnd: pts[pts.length - 1].cc };
}

export function syncMappingRange(mapping) {
  if (!mapping) return mapping;
  mapping.range = mappingSpan(mapping);
  return mapping;
}

export function upsertPoint(mapping, cc, value) {
  if (!mapping) return null;
  if (!Array.isArray(mapping.points)) mapping.points = [];
  const ncc = clampCc(cc, 0);
  const val = sanitizePointValue(value);
  const existing = mapping.points.find(p => p.cc === ncc);
  if (existing) {
    existing.value = val;
    syncMappingRange(mapping);
    return existing;
  }
  const pt = makePoint(ncc, val);
  mapping.points.push(pt);
  mapping.points = normalizePoints(mapping.points);
  syncMappingRange(mapping);
  return mapping.points.find(p => p.cc === ncc) || pt;
}

export function setPointPosition(mapping, pointId, cc, value) {
  if (!mapping || !Array.isArray(mapping.points)) return null;
  const pt = mapping.points.find(p => p.id === pointId);
  if (!pt) return null;
  pt.cc = clampCc(cc, pt.cc);
  if (value !== undefined) pt.value = sanitizePointValue(value);
  mapping.points.sort((a, b) => a.cc - b.cc);
  syncMappingRange(mapping);
  return pt;
}

/** Collapse same-CC points after a drag, keeping `preferId` when colliding. */
export function commitPoints(mapping, preferId = null) {
  if (!mapping || !Array.isArray(mapping.points)) return mapping;
  mapping.points.sort((a, b) => a.cc - b.cc);
  const byCc = new Map();
  for (const p of mapping.points) {
    const existing = byCc.get(p.cc);
    if (existing && preferId && existing.id === preferId && p.id !== preferId) continue;
    byCc.set(p.cc, p);
  }
  mapping.points = Array.from(byCc.values()).sort((a, b) => a.cc - b.cc);
  syncMappingRange(mapping);
  return mapping;
}

export function movePoint(mapping, pointId, cc, value) {
  if (!mapping || !Array.isArray(mapping.points)) return null;
  const pt = mapping.points.find(p => p.id === pointId);
  if (!pt) return null;
  pt.cc = clampCc(cc, pt.cc);
  if (value !== undefined) pt.value = sanitizePointValue(value);
  mapping.points = mapping.points.filter(p => p.id === pointId || p.cc !== pt.cc);
  mapping.points = normalizePoints(mapping.points);
  syncMappingRange(mapping);
  return mapping.points.find(p => p.id === pointId) || pt;
}

export function removePoint(mapping, pointId) {
  if (!mapping || !Array.isArray(mapping.points)) return false;
  if (mapping.points.length <= 1) return false;
  const next = mapping.points.filter(p => p.id !== pointId);
  if (next.length === mapping.points.length) return false;
  mapping.points = next;
  syncMappingRange(mapping);
  return true;
}

function sanitizeCheckpoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'minor' ? 'minor' : 'major';
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim().slice(0, 24)
    : '';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateFlowRailId(),
    cc: clampCc(raw.cc, 0),
    name,
    kind,
  };
}

function sanitizeTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'param') {
    if (!raw.moduleId || !raw.control) return null;
    return { kind: 'param', moduleId: String(raw.moduleId), control: String(raw.control) };
  }
  if (raw.kind === 'ccOut') {
    const channel = Math.max(1, Math.min(16, parseInt(raw.channel, 10) || 1));
    const cc = clampCc(raw.cc, 1);
    return { kind: 'ccOut', channel, cc };
  }
  if (raw.kind === 'event') {
    if (!raw.action) return null;
    return { kind: 'event', action: String(raw.action) };
  }
  return null;
}

function migrateLegacyPoints(raw) {
  const ccStart = clampCc(raw.range?.ccStart ?? raw.cc ?? 0, 0);
  const ccEnd = clampCc(raw.range?.ccEnd ?? raw.cc ?? 127, 127);
  const start = sanitizePointValue(raw.values?.start ?? 0);
  const end = sanitizePointValue(raw.values?.end ?? 127);
  if (ccStart === ccEnd) {
    return [makePoint(ccStart, end)];
  }
  return [makePoint(Math.min(ccStart, ccEnd), start), makePoint(Math.max(ccStart, ccEnd), end)];
}

export function sanitizeMapping(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const target = sanitizeTarget(raw.target);
  if (!target) return null;

  const isEvent = target.kind === 'event';
  const curve = typeof raw.curve === 'string' && raw.curve ? raw.curve : 'linear';
  const label = typeof raw.label === 'string' ? raw.label.slice(0, 40) : '';

  const mapping = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateFlowRailId(),
    target,
    curve,
    label,
    points: [],
  };

  if (isEvent) {
    mapping.cc = clampCc(raw.cc ?? raw.range?.ccStart ?? 0, 0);
    mapping.range = { ccStart: mapping.cc, ccEnd: mapping.cc };
    return mapping;
  }

  const fromArray = Array.isArray(raw.points)
    ? raw.points.map(sanitizePoint).filter(Boolean)
    : [];
  mapping.points = normalizePoints(fromArray.length ? fromArray : migrateLegacyPoints(raw));
  if (!mapping.points.length) mapping.points = [makePoint(0, 0)];
  syncMappingRange(mapping);
  return mapping;
}

export function sanitizeFlowRail(raw) {
  const base = buildDefaultFlowRail();
  if (!raw || typeof raw !== 'object') return base;

  const sourceCc = raw.source?.cc;
  const sourceCurve = raw.source?.curve;
  base.source = {
    type: 'cc',
    cc: (sourceCc === null || sourceCc === undefined || sourceCc === '')
      ? null
      : clampCc(sourceCc, 1),
    curve: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'log'].includes(sourceCurve)
      ? sourceCurve
      : 'linear',
  };

  const checkpoints = Array.isArray(raw.checkpoints)
    ? raw.checkpoints.map(sanitizeCheckpoint).filter(Boolean)
    : [];
  base.checkpoints = checkpoints.length ? checkpoints : buildDefaultCheckpoints();
  base.checkpoints.sort((a, b) => a.cc - b.cc);

  base.mappings = Array.isArray(raw.mappings)
    ? raw.mappings.map(sanitizeMapping).filter(Boolean)
    : [];

  return base;
}

export function dropOrphanMappings(flowRail, moduleIds) {
  if (!flowRail || !Array.isArray(flowRail.mappings)) return flowRail;
  const ids = new Set(moduleIds);
  flowRail.mappings = flowRail.mappings.filter(m => {
    if (m.target?.kind !== 'param') return true;
    return ids.has(m.target.moduleId);
  });
  return flowRail;
}

export function cloneFlowRail(flowRail) {
  return sanitizeFlowRail(JSON.parse(JSON.stringify(flowRail || buildDefaultFlowRail())));
}

export function targetsMatch(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'param') return a.moduleId === b.moduleId && a.control === b.control;
  if (a.kind === 'ccOut') return a.channel === b.channel && a.cc === b.cc;
  if (a.kind === 'event') return a.action === b.action;
  return false;
}
