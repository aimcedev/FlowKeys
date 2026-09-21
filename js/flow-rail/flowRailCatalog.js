/**
 * Explicit Flow Rail parameter catalog.
 * Not a scrape of [data-control] — chrome (meters, sequencers, channel) stays out.
 */

import { applyEasing } from '../utils/easing.js';

export const TYPE_COLOR_VARS = {
  bass: '--color-bass',
  arp: '--color-arp',
  pad: '--color-pad',
  percussion: '--color-percussion',
  keyboard: '--color-keyboard',
  looper: '--color-looper',
  swell: '--color-swell',
  drums: '--color-drums',
  glide: '--accent-cyan',
};

export const LEGACY_COLOR_VARS = {
  'legacy-kick': '--color-kick',
  'legacy-snare': '--color-snare',
  'legacy-shaker': '--color-shaker',
  'legacy-pad': '--color-pad',
  'legacy-bass': '--color-bass',
  'legacy-arp': '--color-arp',
};

export const CURVE_OPTIONS = [
  { id: 'linear', label: 'Linear' },
  { id: 'ease-in', label: 'Ease In' },
  { id: 'ease-out', label: 'Ease Out' },
  { id: 'ease-in-out', label: 'Ease In Out' },
  { id: 'ease-in-3', label: 'Ease In 3' },
  { id: 'log', label: 'Log' },
];

/** Incoming Flow source CC response — pick one to match the hardware. */
export const SOURCE_CURVE_OPTIONS = [
  { id: 'linear', label: 'Linear' },
  { id: 'ease-in', label: 'Soft' },
  { id: 'ease-out', label: 'Hard' },
  { id: 'ease-in-out', label: 'S-Curve' },
  { id: 'log', label: 'Log' },
];

const SOURCE_CURVE_IDS = new Set(SOURCE_CURVE_OPTIONS.map(c => c.id));

export function sanitizeSourceCurve(curve) {
  return SOURCE_CURVE_IDS.has(curve) ? curve : 'linear';
}

/** Map a raw 0–127 controller value through the selected source curve. */
export function applySourceCurve(cc, curve) {
  const t = Math.max(0, Math.min(1, Number(cc) / 127));
  const shaped = applyEasing(t, sanitizeSourceCurve(curve));
  return Math.max(0, Math.min(127, Math.round(shaped * 127)));
}

const CONTINUOUS = 'continuous';
const DISCRETE = 'discrete';

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function reapplyKeyboard(mod) {
  if (!mod || typeof mod.setConfig !== 'function') return;
  mod.setConfig(
    mod.channel,
    mod.octave,
    mod.inversion,
    mod.filterMode,
    mod.filterCount,
    mod.modWheelValue,
    mod.transitionMs,
    mod.fadeMode,
    mod.fadeCurve,
  );
}

function reapplySwell(mod) {
  if (!mod || typeof mod.setConfig !== 'function') return;
  const autoRate = Math.round((mod.minIntervalMs || 2000) / 1000);
  mod.setConfig(
    mod.channel, mod.selectMode, mod.outMin, mod.outMax,
    mod.density, mod.attackMs, mod.holdMs, mod.releaseMs,
    mod.curve, mod.whammy, mod.whammyChance,
    mod.whammySpeed, mod.whammyDouble,
    autoRate, mod.vary,
  );
}

function reapplyArp(mod) {
  if (!mod || typeof mod.setConfig !== 'function') return;
  mod.setConfig(mod.channel, mod.numNotes, mod.mode);
}

function reapplyDrums(mod) {
  if (!mod || typeof mod.setConfig !== 'function') return;
  mod.setConfig(mod.channel, mod.swing, mod.humanize);
}

function reapplyGlide(mod) {
  if (!mod || typeof mod.setConfig !== 'function') return;
  mod.setConfig(mod.channel, mod.glideMs, mod.curve, mod.pitchBendRange);
}

function reapplyLooper(mod) {
  if (!mod || typeof mod.setConfig !== 'function') return;
  mod.setConfig(mod.channel, mod.bars, mod.quantizeDivision);
}

function isModuleMuted(app, moduleId) {
  const card = document.querySelector(`[data-instance-id="${moduleId}"]`);
  return !!card?.querySelector('.cs-mute-btn')?.classList.contains('active');
}

export function midiVolumeToDb(val) {
  if (val <= 0) return '-∞ dB';
  if (val <= 100) {
    const db = 20 * Math.log10(val / 100);
    return `${db.toFixed(1)} dB`;
  }
  const db = 6 * (val - 100) / 27;
  return `+${db.toFixed(1)} dB`;
}

export function syncControlDom(app, moduleId, control, value) {
  const card = document.querySelector(`[data-instance-id="${moduleId}"]`);
  if (!card) return;
  const el = card.querySelector(`[data-control="${control}"]`);
  if (!el) return;

  if (control === 'volume') {
    const v = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
    el.value = String(v);
    const display = card.querySelector('[data-volume-display]');
    if (display) display.textContent = midiVolumeToDb(v);
    const fillEl = card.querySelector('[data-control="fader-fill"]');
    if (fillEl) fillEl.style.height = `${(v / 127) * 120}px`;
    return;
  }

  if (el.type === 'checkbox') {
    el.checked = Number(value) >= 0.5;
    card.classList.toggle('active', el.checked);
    return;
  }

  if (el.value !== undefined) {
    el.value = String(value);
    if (control === 'modWheel') {
      const display = card.querySelector('[data-mod-display]');
      if (display) display.textContent = el.value;
    }
  }
}

function snapshotControlValue(modState, control) {
  if (!modState) return undefined;
  if (control === 'toggle') return modState.active ? 1 : 0;
  if (control === 'volume') return modState.config?.volume;
  return modState.config?.[control];
}

export function restoreControlFromSnapshot(app, modState, control) {
  if (!modState) return;
  const value = snapshotControlValue(modState, control);
  if (value === undefined || value === null || value === '') return;
  syncControlDom(app, modState.id, control, value);
}

function applyVolume(app, moduleId, value) {
  if (isModuleMuted(app, moduleId)) return;
  const mod = app.moduleInstances.get(moduleId);
  if (mod && typeof mod.setVolumeImmediate === 'function') {
    mod.setVolumeImmediate(Math.round(value));
  }
}

function getVolume(app, moduleId) {
  const mod = app.moduleInstances.get(moduleId);
  return mod?.volume ?? 100;
}

function applyToggle(app, moduleId, value) {
  const on = value >= 0.5;
  const mod = app.moduleInstances.get(moduleId);
  if (!mod) return;
  const isPending = app.pendingModuleActivations.includes(mod);
  const effective = mod.isActive || isPending;
  if (effective !== on) app._toggleModuleDirectly(moduleId, on, { persist: false });
}

function getToggle(app, moduleId) {
  const mod = app.moduleInstances.get(moduleId);
  if (!mod) return 0;
  return (mod.isActive || app.pendingModuleActivations.includes(mod)) ? 1 : 0;
}

/** Per-type continuous / discrete parameters (excluding volume + toggle, added for every module). */
const TYPE_PARAMS = {
  arp: [
    { control: 'notes', label: 'Notes', unit: '', min: 1, max: 6, step: 1, style: CONTINUOUS,
      get: (mod) => mod.numNotes ?? 3,
      set: (mod, v) => { mod.numNotes = Math.round(v); reapplyArp(mod); } },
    { control: 'mode', label: 'Mode', unit: '', style: DISCRETE, options: [
      { value: 'chord', label: 'Chord' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' },
    ], get: (mod) => mod.mode || 'chord', set: (mod, v) => { mod.mode = v; reapplyArp(mod); } },
  ],
  pad: [
    { control: 'key', label: 'Key', unit: '', style: DISCRETE, options: [
      { value: 'song', label: 'Song Key' },
      { value: '60', label: 'C' }, { value: '61', label: 'C#' }, { value: '62', label: 'D' },
      { value: '63', label: 'D#' }, { value: '64', label: 'E' }, { value: '65', label: 'F' },
      { value: '66', label: 'F#' }, { value: '67', label: 'G' }, { value: '68', label: 'G#' },
      { value: '69', label: 'A' }, { value: '70', label: 'A#' }, { value: '71', label: 'B' },
    ], get: (mod) => String(mod.rootNote ?? 60), set: (mod, v, app) => {
      const keyVal = String(v);
      const rootNote = keyVal === 'song' ? 60 + (app._currentSongKey || 0) : parseInt(keyVal, 10);
      mod.setConfig(mod.channel, rootNote);
    } },
  ],
  keyboard: [
    { control: 'octave', label: 'Octave', unit: '', min: -2, max: 2, step: 1, style: CONTINUOUS,
      get: (mod) => mod.octave ?? 0,
      set: (mod, v) => { mod.octave = Math.round(v); reapplyKeyboard(mod); } },
    { control: 'modWheel', label: 'Mod Wheel', unit: '', min: 0, max: 127, step: 1, style: CONTINUOUS,
      get: (mod) => mod.modWheelValue ?? 0,
      set: (mod, v) => { if (typeof mod.setModWheelImmediate === 'function') mod.setModWheelImmediate(v); } },
    { control: 'transitionMs', label: 'Transition', unit: 'ms', min: 0, max: 10000, step: 50, style: CONTINUOUS,
      get: (mod) => mod.transitionMs ?? 500,
      set: (mod, v) => { mod.transitionMs = Math.round(v); reapplyKeyboard(mod); } },
    { control: 'fadeMode', label: 'Fade Mode', unit: '', style: DISCRETE, options: [
      { value: 'none', label: 'None' }, { value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' },
    ], get: (mod) => mod.fadeMode || 'none', set: (mod, v) => { mod.fadeMode = v; reapplyKeyboard(mod); } },
    { control: 'fadeCurve', label: 'Fade Curve', unit: '', style: DISCRETE, options: [
      { value: 'linear', label: 'Linear' }, { value: 'ease-in', label: 'Ease In' }, { value: 'ease-out', label: 'Ease Out' },
    ], get: (mod) => mod.fadeCurve || 'linear', set: (mod, v) => { mod.fadeCurve = v; reapplyKeyboard(mod); } },
  ],
  swell: [
    { control: 'density', label: 'Density', unit: '%', min: 0, max: 100, step: 1, style: CONTINUOUS,
      get: (mod) => mod.density ?? 75,
      set: (mod, v) => { mod.density = Math.round(v); reapplySwell(mod); } },
    { control: 'attackMs', label: 'Attack', unit: 'ms', min: 100, max: 3000, step: 50, style: CONTINUOUS,
      get: (mod) => mod.attackMs ?? 2000,
      set: (mod, v) => { mod.attackMs = Math.round(v); reapplySwell(mod); } },
    { control: 'holdMs', label: 'Hold', unit: 'ms', min: 0, max: 1000, step: 50, style: CONTINUOUS,
      get: (mod) => mod.holdMs ?? 200,
      set: (mod, v) => { mod.holdMs = Math.round(v); reapplySwell(mod); } },
    { control: 'releaseMs', label: 'Release', unit: 'ms', min: 100, max: 2000, step: 50, style: CONTINUOUS,
      get: (mod) => mod.releaseMs ?? 600,
      set: (mod, v) => { mod.releaseMs = Math.round(v); reapplySwell(mod); } },
    { control: 'whammy', label: 'Whammy', unit: '', min: 0, max: 3, step: 1, style: CONTINUOUS,
      get: (mod) => mod.whammy ?? 2,
      set: (mod, v) => { mod.whammy = Math.round(v); reapplySwell(mod); } },
    { control: 'whammyChance', label: 'Whammy Chance', unit: '%', min: 0, max: 100, step: 1, style: CONTINUOUS,
      get: (mod) => mod.whammyChance ?? 50,
      set: (mod, v) => { mod.whammyChance = Math.round(v); reapplySwell(mod); } },
    { control: 'vary', label: 'Vary', unit: '%', min: 0, max: 100, step: 1, style: CONTINUOUS,
      get: (mod) => mod.vary ?? 0,
      set: (mod, v) => { mod.vary = Math.round(v); reapplySwell(mod); } },
    { control: 'selectMode', label: 'Select', unit: '', style: DISCRETE, options: [
      { value: 'top1', label: 'Top 1' }, { value: 'top12', label: 'Top 1–2' }, { value: 'top13', label: 'Top 1–3' },
    ], get: (mod) => mod.selectMode || 'top12', set: (mod, v) => { mod.selectMode = v; reapplySwell(mod); } },
    { control: 'curve', label: 'Curve', unit: '', style: DISCRETE, options: [
      { value: 'linear', label: 'Linear' }, { value: 'ease-in', label: 'Ease In' }, { value: 'ease-in-3', label: 'Ease In 3' },
      { value: 'ease-out', label: 'Ease Out' }, { value: 'log', label: 'Log' },
    ], get: (mod) => mod.curve || 'ease-in-3', set: (mod, v) => { mod.curve = v; reapplySwell(mod); } },
  ],
  drums: [
    { control: 'swing', label: 'Swing', unit: '%', min: 0, max: 100, step: 1, style: CONTINUOUS,
      get: (mod) => mod.swing ?? 0,
      set: (mod, v) => { mod.swing = v; reapplyDrums(mod); } },
    { control: 'humanize', label: 'Humanize', unit: '%', min: 0, max: 50, step: 1, style: CONTINUOUS,
      get: (mod) => mod.humanize ?? 15,
      set: (mod, v) => { mod.humanize = v; reapplyDrums(mod); } },
  ],
  glide: [
    { control: 'glideMs', label: 'Glide', unit: 'ms', min: 0, max: 3000, step: 10, style: CONTINUOUS,
      get: (mod) => mod.glideMs ?? 200,
      set: (mod, v) => { mod.glideMs = Math.round(v); reapplyGlide(mod); } },
  ],
  looper: [
    { control: 'bars', label: 'Bars', unit: '', style: DISCRETE, options: [
      { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '4', label: '4' }, { value: '8', label: '8' },
    ], get: (mod) => String(mod.bars ?? 2), set: (mod, v) => { mod.bars = parseInt(v, 10) || 2; reapplyLooper(mod); } },
  ],
  bass: [],
  percussion: [],
};

export function colorVarForModule(type, moduleId) {
  return LEGACY_COLOR_VARS[moduleId] || TYPE_COLOR_VARS[type] || '--accent-cyan';
}

export function mappingPoints(mapping) {
  if (Array.isArray(mapping?.points) && mapping.points.length) return mapping.points;
  const ccStart = mapping?.range?.ccStart ?? mapping?.cc ?? 0;
  const ccEnd = mapping?.range?.ccEnd ?? mapping?.cc ?? 127;
  const v0 = mapping?.values?.start ?? 0;
  const v1 = mapping?.values?.end ?? 127;
  if (ccStart === ccEnd) return [{ cc: ccStart, value: v1 }];
  return [
    { cc: Math.min(ccStart, ccEnd), value: v0 },
    { cc: Math.max(ccStart, ccEnd), value: v1 },
  ];
}

/** Hold the last point at or below `cc` (discrete / step envelopes). */
export function stepValue(cc, mapping) {
  const pts = mappingPoints(mapping);
  if (!pts.length) return 0;
  let value = pts[0].value;
  for (const p of pts) {
    if (p.cc <= cc) value = p.value;
    else break;
  }
  return value;
}

/** Eased interpolation between adjacent numeric points. */
export function interpolate(cc, mapping) {
  const pts = mappingPoints(mapping);
  if (!pts.length) return 0;
  if (pts.length === 1) return num(pts[0].value);
  if (cc <= pts[0].cc) return num(pts[0].value);
  const last = pts[pts.length - 1];
  if (cc >= last.cc) return num(last.value);

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (cc < a.cc || cc > b.cc) continue;
    if (b.cc <= a.cc) return num(b.value);
    const t = applyEasing((cc - a.cc) / (b.cc - a.cc), mapping.curve || 'linear');
    return num(a.value) + (num(b.value) - num(a.value)) * t;
  }
  return num(last.value);
}

export function mappingValueExtent(mapping, type) {
  let min = 0;
  let max = 127;
  if (mapping?.target?.kind === 'ccOut') {
    min = 0;
    max = 127;
  } else {
    const entry = getCatalogEntry(type, mapping?.target?.control);
    min = entry?.min ?? 0;
    max = entry?.max ?? 127;
  }
  for (const p of mappingPoints(mapping)) {
    const n = Number(p.value);
    if (!Number.isFinite(n)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (max <= min) max = min + 1;
  return { min, max };
}

function findTypeParam(type, control) {
  return (TYPE_PARAMS[type] || []).find(p => p.control === control) || null;
}

export function getCatalogEntry(type, control) {
  if (control === 'volume') {
    return { control: 'volume', label: 'Level', unit: '', min: 0, max: 127, step: 1, style: CONTINUOUS };
  }
  if (control === 'toggle') {
    return { control: 'toggle', label: 'On / Off', unit: '', min: 0, max: 1, step: 1, style: DISCRETE,
      options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }] };
  }
  return findTypeParam(type, control);
}

export function isCataloguedControl(type, control) {
  return !!getCatalogEntry(type, control);
}

export function isContinuousMapping(mapping, type) {
  if (mapping.target?.kind === 'ccOut') return true;
  if (mapping.target?.kind === 'event') return false;
  const entry = getCatalogEntry(type, mapping.target?.control);
  return entry?.style === CONTINUOUS;
}

export function applyMappingValue(app, mapping, value, { skipCcOut = false } = {}) {
  const target = mapping.target;
  if (!target) return;

  if (target.kind === 'ccOut') {
    if (skipCcOut) return;
    const v = Math.max(0, Math.min(127, Math.round(value)));
    app.midi.sendCC(target.channel, target.cc, v);
    return;
  }

  if (target.kind === 'event') return;

  const moduleId = target.moduleId;
  const control = target.control;
  if (control === 'volume') {
    syncControlDom(app, moduleId, control, value);
    applyVolume(app, moduleId, value);
    return;
  }
  if (control === 'toggle') {
    applyToggle(app, moduleId, value);
    syncControlDom(app, moduleId, control, value);
    return;
  }

  const desc = app._currentModules.find(m => m.id === moduleId);
  const mod = app.moduleInstances.get(moduleId);
  if (!desc || !mod) return;
  const entry = findTypeParam(desc.type, control);
  if (!entry) return;

  if (entry.style === DISCRETE && entry.options) {
    entry.set(mod, value, app);
    syncControlDom(app, moduleId, control, value);
    return;
  }
  const rounded = entry.step >= 1 ? Math.round(value) : value;
  const clamped = Math.max(entry.min ?? 0, Math.min(entry.max ?? 127, rounded));
  entry.set(mod, clamped, app);
  syncControlDom(app, moduleId, control, clamped);
}

export function readMappingValue(app, mapping) {
  const target = mapping.target;
  if (!target) return 0;
  if (target.kind === 'ccOut') {
    const pts = mappingPoints(mapping);
    return pts.length ? num(pts[0].value) : 0;
  }
  if (target.kind === 'event') return 0;
  if (target.control === 'volume') return getVolume(app, target.moduleId);
  if (target.control === 'toggle') return getToggle(app, target.moduleId);
  const desc = app._currentModules.find(m => m.id === target.moduleId);
  const mod = app.moduleInstances.get(target.moduleId);
  if (!desc || !mod) return 0;
  const entry = findTypeParam(desc.type, target.control);
  if (!entry) return 0;
  return entry.get(mod, app);
}

export function formatParamValue(entry, value) {
  if (!entry) return String(Math.round(num(value)));
  if (entry.style === DISCRETE && entry.options) {
    const match = entry.options.find(o => String(o.value) === String(value));
    return match ? match.label : String(value);
  }
  const n = num(value);
  const shown = (entry.step || 1) >= 1 ? Math.round(n) : n.toFixed(1);
  return entry.unit ? `${shown}${entry.unit === '%' || entry.unit === 'ms' ? (entry.unit === '%' ? '%' : 'ms') : ''}` : String(shown);
}

export function mappingLabel(app, mapping) {
  if (mapping.label) return mapping.label;
  const target = mapping.target;
  if (!target) return 'Mapping';
  if (target.kind === 'ccOut') return `CC ${String(target.cc).padStart(2, '0')} · Ch ${target.channel}`;
  if (target.kind === 'event') return eventLabel(target.action);
  const desc = app._currentModules.find(m => m.id === target.moduleId);
  const entry = desc ? getCatalogEntry(desc.type, target.control) : null;
  const modName = desc?.label || 'Module';
  const param = entry?.label || target.control;
  return `${modName} · ${param}`;
}

export function eventLabel(action) {
  if (action === 'panic') return 'Panic';
  if (action === 'nextSection') return 'Next Section';
  if (action === 'prevSection') return 'Previous Section';
  if (action?.startsWith('module:') && action.endsWith(':on')) return 'Module On';
  if (action?.startsWith('module:') && action.endsWith(':off')) return 'Module Off';
  return action || 'Event';
}

export function listPickerGroups(app) {
  const groups = [];

  for (const desc of app._currentModules) {
    const params = [
      { control: 'volume', label: 'Level', style: CONTINUOUS, min: 0, max: 127, step: 1 },
      { control: 'toggle', label: 'On / Off', style: DISCRETE },
      ...(TYPE_PARAMS[desc.type] || []).map(p => ({
        control: p.control, label: p.label, style: p.style, min: p.min, max: p.max, step: p.step,
      })),
    ];
    groups.push({
      id: desc.id,
      title: desc.label || desc.type,
      type: desc.type,
      colorVar: colorVarForModule(desc.type, desc.id),
      items: params.map(p => ({
        kind: 'param',
        moduleId: desc.id,
        control: p.control,
        label: p.label,
        style: p.style,
        min: p.min,
        max: p.max,
        step: p.step,
      })),
    });
  }

  groups.push({
    id: 'ccOut',
    title: 'Outgoing CC',
    type: 'ccOut',
    colorVar: '--accent-cyan',
    items: [{ kind: 'ccOut', label: 'MIDI CC to output', style: CONTINUOUS, min: 0, max: 127, step: 1 }],
  });

  const eventItems = [
    { kind: 'event', action: 'panic', label: 'Panic' },
    { kind: 'event', action: 'nextSection', label: 'Next Section' },
    { kind: 'event', action: 'prevSection', label: 'Previous Section' },
  ];
  groups.push({
    id: 'events',
    title: 'Events',
    type: 'event',
    colorVar: '--accent-yellow',
    items: eventItems,
  });

  return groups;
}

export function moduleTypeForId(app, moduleId) {
  return app._currentModules.find(m => m.id === moduleId)?.type || null;
}

export { num };
