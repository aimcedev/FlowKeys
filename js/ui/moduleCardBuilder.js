import { LEGACY_MODULE_IDS } from '../state/stateSchema.js';

const LEGACY_MIDI_TARGETS = {
  [LEGACY_MODULE_IDS.bass]: 'toggleBass',
  [LEGACY_MODULE_IDS.arp]: 'toggleArp',
  [LEGACY_MODULE_IDS.kick]: 'toggleKick',
  [LEGACY_MODULE_IDS.snare]: 'toggleSnare',
  [LEGACY_MODULE_IDS.shaker]: 'toggleShaker',
  [LEGACY_MODULE_IDS.pad]: 'togglePad',
};

export class ModuleCardBuilder {
  constructor(app) {
    this.app = app;
  }

  buildPresetPanelHtml(type) {
    if (type !== 'arp' && type !== 'percussion' && type !== 'drums') return '';
    return `
        <div class="preset-panel">
          <div class="preset-row">
            <button class="preset-menu-btn" data-action="open-preset-menu" type="button">Presets ▾</button>
          </div>
        </div>`;
  }

  _chanOptions(defaultCh) {
    return Array.from({ length: 16 }, (_, i) => {
      const ch = i + 1;
      const label = ch === 10 ? 'Ch 10 (Drums)' : `Ch ${ch}`;
      const sel = ch === defaultCh ? ' selected' : '';
      return `<option value="${ch}"${sel}>${label}</option>`;
    }).join('');
  }

  _buildChanChipHtml(defaultCh) {
    // Short labels so the chip stays compact (the full "(Drums)" label lives in
    // the original _chanOptions used elsewhere). Value stays numeric 1–16.
    const opts = Array.from({ length: 16 }, (_, i) => {
      const ch = i + 1;
      const sel = ch === defaultCh ? ' selected' : '';
      return `<option value="${ch}"${sel}>Ch ${ch}</option>`;
    }).join('');
    return `<select class="chan-chip" data-control="chan" title="Output Channel">${opts}</select>`;
  }

  _getGlyphSvg(type, id) {
    if (type === 'percussion') {
      if (id === LEGACY_MODULE_IDS.snare) {
        return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="8" cy="7.5" rx="5.5" ry="3" stroke="currentColor" stroke-width="1.4"/>
          <path d="M2.5 7.5 L13.5 7.5" stroke="currentColor" stroke-width="0.8" stroke-opacity="0.4"/>
          <path d="M5.5 10.2 L4.5 13.5 M10.5 10.2 L11.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>`;
      }
      if (id === LEGACY_MODULE_IDS.shaker) {
        return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="8" cy="8" rx="5.5" ry="3" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="5.5" cy="8" r="0.85" fill="currentColor"/>
          <circle cx="8" cy="8" r="0.85" fill="currentColor"/>
          <circle cx="10.5" cy="8" r="0.85" fill="currentColor"/>
        </svg>`;
      }
      // Kick
      return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/>
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1"/>
      </svg>`;
    }

    const glyphs = {
      bass: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 5 Q5 1.5 8 5 Q11 8.5 14 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M2 11 Q5 7.5 8 11 Q11 14.5 14 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`,
      arp: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 14 L2 11 L5.5 11 L5.5 8 L9 8 L9 5 L12.5 5 L12.5 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
      pad: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 8 Q3 4.5 5.5 8 Q8 11.5 10.5 8 Q13 4.5 15 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M1 11 Q3 8 5.5 11 Q8 14 10.5 11 Q13 8 15 11" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-opacity="0.5"/>
      </svg>`,
      looper: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13.5 8 A5.5 5.5 0 1 1 9 2.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M9 1 L9 4.5 L12.5 3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
      swell: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 13.5 L3 13.5 Q4.5 13.5 6 4 L7 4 L8 8.5 L9 13.5 L15 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
      keyboard: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="4.5" width="14" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M4.5 4.5 L4.5 13 M8 4.5 L8 13 M11.5 4.5 L11.5 13" stroke="currentColor" stroke-width="0.75" stroke-opacity="0.35"/>
        <rect x="3" y="4.5" width="1.8" height="5" rx="0.5" fill="currentColor"/>
        <rect x="6.5" y="4.5" width="1.8" height="5" rx="0.5" fill="currentColor"/>
        <rect x="10.2" y="4.5" width="1.8" height="5" rx="0.5" fill="currentColor"/>
      </svg>`,
      drums: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>
        <path d="M4 11 L12 5 M12 11 L4 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <circle cx="8" cy="4.5" r="1.5" fill="currentColor"/>
        <circle cx="4.5" cy="8" r="1.5" fill="currentColor"/>
        <circle cx="11.5" cy="8" r="1.5" fill="currentColor"/>
      </svg>`,
      glide: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="3" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="13" cy="4" r="1.5" fill="currentColor"/>
        <path d="M3 12 C5 12 7 13 10 7 C12 3 13 4 13 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>
      </svg>`,
    };

    return glyphs[type] || `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/></svg>`;
  }

  // Returns { chanDefault, displayLabel, description, mainHtml, advancedHtml, bottomHtml }
  _getModuleContent(id, type) {
    if (type === 'bass') {
      return {
        chanDefault: 2,
        displayLabel: 'SCOPE',
        description: 'Tracks the lowest held note to provide a grounded, stable bass layer.',
        mainHtml: `
          <div class="control-row">
            <label>In Min</label>
            <select class="note-select" data-control="inMin" data-format="string" data-default="A-1" style="width:100px;"></select>
          </div>
          <div class="control-row">
            <label>In Max</label>
            <select class="note-select" data-control="inMax" data-format="string" data-default="C#3" style="width:100px;"></select>
          </div>`,
        advancedHtml: `
          <div class="control-row">
            <label>Out Min</label>
            <select class="note-select" data-control="outMin" data-format="string" data-default="E1" style="width:100px;"></select>
          </div>
          <div class="control-row">
            <label>Out Max</label>
            <select class="note-select" data-control="outMax" data-format="string" data-default="E2" style="width:100px;"></select>
          </div>`,
        bottomHtml: `<div class="freq-viz-container" data-control="freq-viz"><canvas class="freq-viz-canvas"></canvas></div>`,
      };
    }

    if (type === 'arp') {
      return {
        chanDefault: 8,
        displayLabel: 'PATTERN',
        description: 'Extracts top notes into a rhythmic driving pattern. Draw velocity to accent.',
        mainHtml: `
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Mode</label>
              <select data-control="mode">
                <option value="chord" selected>Chord Pulse</option>
                <option value="up">Arp Up</option>
              </select>
            </div>
            <div class="control-group">
              <label>Notes</label>
              <select data-control="notes">
                <option value="2">Top 2</option>
                <option value="3" selected>Top 3</option>
              </select>
            </div>
          </div>
          ${this.buildPresetPanelHtml('arp')}`,
        advancedHtml: '',
        bottomHtml: `<div class="seq-container" data-control="seq" style="width:100%;"></div>`,
      };
    }

    if (type === 'pad') {
      return {
        chanDefault: 7,
        displayLabel: 'SCOPE',
        description: 'Provides a thick, continuous root-fifth drone underneath your playing.',
        mainHtml: `
          <div class="control-row">
            <label>Key Center</label>
            <select data-control="key">
              <option value="song">Song Key</option>
              <option value="60">C</option>
              <option value="61">C# / Db</option>
              <option value="62">D</option>
              <option value="63">D# / Eb</option>
              <option value="64">E</option>
              <option value="65">F</option>
              <option value="66">F# / Gb</option>
              <option value="67">G</option>
              <option value="68">G# / Ab</option>
              <option value="69">A</option>
              <option value="70">A# / Bb</option>
              <option value="71">B</option>
            </select>
          </div>`,
        advancedHtml: '',
        bottomHtml: `<div class="freq-viz-container" data-control="freq-viz"><canvas class="freq-viz-canvas"></canvas></div>`,
      };
    }

    if (type === 'percussion') {
      let chanDefault, desc, defaultNote;
      if (id === LEGACY_MODULE_IDS.shaker) {
        chanDefault = 3;
        desc = 'Outputs a shaker pattern mapped to clock division. Draw velocity to accent.';
        defaultNote = '55';
      } else if (id === LEGACY_MODULE_IDS.snare) {
        chanDefault = 3;
        desc = 'Program your snare drum pattern using the 16-step sequencer below.';
        defaultNote = '38';
      } else {
        chanDefault = 3;
        desc = 'Program your kick drum pattern using the 16-step sequencer below.';
        defaultNote = '36';
      }
      return {
        chanDefault,
        displayLabel: 'PATTERN',
        description: desc,
        mainHtml: `
          <div class="control-row">
            <label>Note</label>
            <select class="note-select" data-control="note" data-format="number" data-default="${defaultNote}" style="width:110px;"></select>
          </div>
          ${this.buildPresetPanelHtml('percussion')}`,
        advancedHtml: '',
        bottomHtml: `<div class="seq-container" data-control="seq" style="width:100%;"></div>`,
      };
    }

    if (type === 'looper') {
      return {
        chanDefault: 10,
        displayLabel: 'RECORD',
        description: 'Record your performance and loop it. Arms at the next bar boundary — timing is quantized automatically.',
        mainHtml: `
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Loop Length</label>
              <select data-control="bars">
                <option value="1">1 Bar</option>
                <option value="2" selected>2 Bars</option>
                <option value="4">4 Bars</option>
                <option value="8">8 Bars</option>
              </select>
            </div>
            <div class="control-group">
              <label>Quantize</label>
              <select data-control="quantize">
                <option value="0">Off</option>
                <option value="3">32nd</option>
                <option value="6" selected>16th</option>
                <option value="12">8th</option>
                <option value="24">Quarter</option>
              </select>
            </div>
          </div>`,
        advancedHtml: '',
        bottomHtml: `
          <div class="looper-transport">
            <button class="looper-arm-btn" data-action="looper-arm" type="button">
              <span class="looper-led" data-looper-led></span>
              <span data-looper-btn-label>ARM</span>
            </button>
            <button class="looper-clear-btn" data-action="looper-clear" type="button">CLEAR</button>
          </div>
          <div class="looper-viz-container">
            <canvas class="looper-viz-canvas"></canvas>
            <span class="looper-status-text" data-looper-status>IDLE</span>
          </div>`,
      };
    }

    if (type === 'swell') {
      return {
        chanDefault: 9,
        displayLabel: 'SCOPE',
        description: 'Swells chord notes in and out like a volume pedal — strikes silent, blooms in, fades away.',
        mainHtml: `
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Note Select</label>
              <select data-control="selectMode">
                <option value="top1">Top note</option>
                <option value="top12" selected>Top 1+2</option>
                <option value="top13">Top 1+3</option>
                <option value="top23">2nd+3rd</option>
                <option value="outer">Outer voices</option>
                <option value="triad">Top triad</option>
                <option value="best2">Best interval</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div class="control-group">
              <label>Density</label>
              <select data-control="density">
                <option value="25">25%</option>
                <option value="50">50%</option>
                <option value="75" selected>75%</option>
                <option value="100">100%</option>
              </select>
            </div>
          </div>
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Range Low</label>
              <select class="note-select" data-control="outMin" data-format="string" data-default="E4" style="width:100px;"></select>
            </div>
            <div class="control-group">
              <label>Range High</label>
              <select class="note-select" data-control="outMax" data-format="string" data-default="E5" style="width:100px;"></select>
            </div>
          </div>`,
        advancedHtml: `
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Min Interval</label>
              <select data-control="autoRate">
                <option value="2" selected>2 sec</option>
                <option value="4">4 sec</option>
                <option value="6">6 sec</option>
                <option value="10">10 sec</option>
                <option value="16">16 sec</option>
              </select>
            </div>
            <div class="control-group">
              <label>Variation</label>
              <select data-control="vary">
                <option value="0" selected>Off</option>
                <option value="30">Low</option>
                <option value="60">Medium</option>
                <option value="100">High</option>
              </select>
            </div>
          </div>
          <div class="control-row">
            <label>Attack Curve</label>
            <select data-control="curve">
              <option value="ease-in">Gentle</option>
              <option value="ease-in-3" selected>Smooth</option>
              <option value="ease-in-4">Late Bloom</option>
              <option value="ease-in-5">Very Late</option>
              <option value="ease-in-out">S-Curve</option>
              <option value="linear">Linear</option>
            </select>
          </div>
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Attack</label>
              <div style="display:flex;align-items:center;gap:4px">
                <input type="number" min="100" max="3000" step="50" value="2000" data-control="attackMs" class="kb-transition-input">
                <span class="kb-transition-unit">ms</span>
              </div>
            </div>
            <div class="control-group">
              <label>Hold</label>
              <div style="display:flex;align-items:center;gap:4px">
                <input type="number" min="0" max="1000" step="50" value="200" data-control="holdMs" class="kb-transition-input">
                <span class="kb-transition-unit">ms</span>
              </div>
            </div>
          </div>
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Release</label>
              <div style="display:flex;align-items:center;gap:4px">
                <input type="number" min="100" max="2000" step="50" value="600" data-control="releaseMs" class="kb-transition-input">
                <span class="kb-transition-unit">ms</span>
              </div>
            </div>
            <div class="control-group">
              <label>Whammy</label>
              <select data-control="whammy">
                <option value="0">Off</option>
                <option value="1">Light</option>
                <option value="2" selected>Medium</option>
                <option value="3">Deep</option>
              </select>
            </div>
          </div>
          <div class="control-row">
            <label>Whammy Chance</label>
            <select data-control="whammyChance">
              <option value="25">25% — Rare</option>
              <option value="50" selected>50% — Sometimes</option>
              <option value="75">75% — Often</option>
              <option value="100">100% — Always</option>
            </select>
          </div>
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Whammy Speed</label>
              <select data-control="whammySpeed" data-format="string">
                <option value="slow" selected>Slow</option>
                <option value="medium">Medium</option>
                <option value="fast">Fast</option>
              </select>
            </div>
            <div class="control-group">
              <label>Double Hit</label>
              <select data-control="whammyDouble">
                <option value="0">Off</option>
                <option value="25">25%</option>
                <option value="50" selected>50%</option>
                <option value="75">75%</option>
              </select>
            </div>
          </div>`,
        bottomHtml: `<div class="freq-viz-container" data-control="freq-viz"><canvas class="freq-viz-canvas"></canvas></div>`,
      };
    }

    if (type === 'keyboard') {
      return {
        chanDefault: 6,
        displayLabel: 'ACTIVITY',
        description: 'Passes your keyboard to a second channel with octave shift and a mod-wheel scene crossfade.',
        mainHtml: `
          <div class="control-row">
            <label>Octave Shift</label>
            <select data-control="octave">
              <option value="-2">−2 Oct</option>
              <option value="-1">−1 Oct</option>
              <option value="0" selected>0 (Same)</option>
              <option value="1">+1 Oct</option>
              <option value="2">+2 Oct</option>
            </select>
          </div>`,
        advancedHtml: `
          <div class="kb-modwheel-section">
            <div class="kb-modwheel-header">
              <label>Mod Wheel</label>
              <span class="kb-modwheel-value" data-mod-display>0</span>
            </div>
            <input type="range" min="0" max="127" value="0" data-control="modWheel" class="kb-modwheel-slider">
          </div>
          <div class="control-row" style="margin-top:0.4rem">
            <label>Fade Mode</label>
            <select data-control="fadeMode">
              <option value="manual">Manual</option>
              <option value="auto" selected>Auto (Bar)</option>
            </select>
          </div>
          <div class="control-row">
            <label>Fade Curve</label>
            <select data-control="fadeCurve">
              <option value="ease-in">Gentle Swell</option>
              <option value="ease-in-3">Smooth Swell</option>
              <option value="ease-in-4">Late Arrival</option>
              <option value="ease-in-5">Very Late</option>
              <option value="linear">Linear</option>
              <option value="ease-in-out">S-Curve</option>
              <option value="ease-out">Fast Start</option>
              <option value="log">Log (Fastest)</option>
            </select>
          </div>
          <div class="control-row">
            <label>Fade Time</label>
            <div class="kb-transition-controls">
              <input type="number" min="0" max="10000" step="100" value="500" data-control="transitionMs" class="kb-transition-input">
              <span class="kb-transition-unit">ms</span>
              <span class="kb-transition-hint">0 = instant</span>
            </div>
          </div>`,
        bottomHtml: `<div class="freq-viz-container" data-control="freq-viz"><canvas class="freq-viz-canvas"></canvas></div>`,
      };
    }

    if (type === 'glide') {
      return {
        chanDefault: 2,
        displayLabel: 'ACTIVITY',
        description: 'Glides between chord changes using MPE per-note pitch bend on channels 2–16. Set your Ableton instrument to MPE to receive it.',
        mainHtml: `
          <div class="control-row control-row-wrap">
            <div class="control-group">
              <label>Glide Time</label>
              <select data-control="glideMs">
                <option value="50">50 ms</option>
                <option value="100">100 ms</option>
                <option value="200" selected>200 ms</option>
                <option value="400">400 ms</option>
                <option value="800">800 ms</option>
                <option value="1500">1.5 s</option>
              </select>
            </div>
            <div class="control-group">
              <label>Curve</label>
              <select data-control="curve">
                <option value="linear">Linear</option>
                <option value="ease-in">Ease In</option>
                <option value="ease-out" selected>Ease Out</option>
                <option value="ease-in-out">S-Curve</option>
              </select>
            </div>
          </div>`,
        advancedHtml: `
          <div class="control-row">
            <label>Bend Range</label>
            <select data-control="pitchBendRange">
              <option value="12">±12 st (1 octave)</option>
              <option value="24" selected>±24 st (2 octaves)</option>
              <option value="48">±48 st (4 octaves)</option>
            </select>
          </div>`,
        bottomHtml: `<div class="freq-viz-container" data-control="freq-viz"><canvas class="freq-viz-canvas"></canvas></div>`,
      };
    }

    if (type === 'drums') {
      // drums card is built dynamically in buildCard() — this path is not reached
      return { chanDefault: 10, displayLabel: '', description: '', mainHtml: '', advancedHtml: '', bottomHtml: '' };
    }

    return { chanDefault: 1, displayLabel: '', description: '', mainHtml: '', advancedHtml: '', bottomHtml: '' };
  }

  // Returns the HTML string for all 128 MIDI note options, with selectedNote pre-selected.
  _buildNoteOptionsHtml(selectedNote) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    let html = '';
    for (let i = 0; i <= 127; i++) {
      const octave = Math.floor(i / 12) - 1;
      const nameStr = `${noteNames[i % 12]}${octave}`;
      const sel = (i === selectedNote) ? ' selected' : '';
      html += `<option value="${i}"${sel}>${nameStr} (${i})</option>`;
    }
    return html;
  }

  buildCard(modDesc) {
    const { id, type, label } = modDesc;
    const card = document.createElement('div');
    card.className = `module-card ${type} active`;
    card.dataset.instanceId = id;
    card.style.viewTransitionName = `mc-${id}`;

    const midiTarget = LEGACY_MIDI_TARGETS[id] || `toggle-${id}`;

    // ── Drums: fully dynamic card with grouped tabs ────────────────
    if (type === 'drums') {
      const modInst = this.app.moduleInstances?.get(id);
      const tracks = modInst?.tracks || [];

      const PAGE_SIZE = 4;
      const groups = [];
      for (let i = 0; i < tracks.length; i += PAGE_SIZE) {
        groups.push(tracks.slice(i, i + PAGE_SIZE));
      }

      // Preserve whatever tab was active before the re-render
      const existingCard = document.querySelector(`[data-instance-id="${id}"]`);
      const prevTabId = modDesc.activeTab || existingCard?.querySelector('.card-tab-btn.active')?.dataset?.tab || 'main';

      let activeTab = 'main';
      if (prevTabId === 'advanced') {
        activeTab = 'advanced';
      } else if (prevTabId === 'main') {
        activeTab = 'main';
      } else if (tracks.length > 0) {
        let targetGroupIdx = 0;
        if (prevTabId.startsWith('group-')) {
          const idx = parseInt(prevTabId.replace('group-', ''), 10);
          if (idx < groups.length) targetGroupIdx = idx;
        } else {
          // If the previous active tab was a track (legacy), find its group
          const selIdx = tracks.findIndex(t => t.id === prevTabId);
          if (selIdx !== -1) {
            targetGroupIdx = Math.floor(selIdx / PAGE_SIZE);
          } else {
            // Or look up from selectedTrackId
            const sIdx = tracks.findIndex(t => t.id === (modInst?.selectedTrackId || ''));
            if (sIdx !== -1) {
              targetGroupIdx = Math.floor(sIdx / PAGE_SIZE);
            }
          }
        }
        activeTab = `group-${targetGroupIdx}`;
      }

      // Knob helper for drums-style rotary knobs
      const knob = (key, name, def, valLabel, range = 100) => `
        <div class="drums-knob-group">
          <div class="cs-pan-knob drums-knob" data-knob data-knob-for="${key}" data-knob-default="${def}" data-knob-range="${range}" tabindex="0" role="slider" aria-label="${name}" title="Drag up/down · double-click to reset">
            <svg class="cs-pan-arc" viewBox="0 0 44 44" fill="none">
              <path d="M 12.5,38.5 A 19,19 0 1 1 31.5,38.5" stroke="rgba(232,67,147,0.28)" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
            <div class="cs-pan-knob-body">
              <div class="cs-pan-knob-indicator"></div>
            </div>
          </div>
          <span class="drums-knob-name">${name}</span>
          <span class="drums-knob-val" data-knob-val-for="${key}">${valLabel}</span>
        </div>`;

      // Tab buttons: Main | Group 1 | Group 2 | ... | Advanced
      let tabBtnsHtml = `<button class="card-tab-btn${activeTab === 'main' ? ' active' : ''}" data-tab="main" type="button">Main</button>`;
      groups.forEach((groupTracks, groupIdx) => {
        const tabId = `group-${groupIdx}`;
        tabBtnsHtml += `<button class="card-tab-btn${activeTab === tabId ? ' active' : ''}" data-tab="${tabId}" type="button">Group ${groupIdx + 1}</button>`;
      });
      tabBtnsHtml += `<button class="card-tab-btn${activeTab === 'advanced' ? ' active' : ''}" data-tab="advanced" type="button">Advanced</button>`;

      // Fader HTML (matching other modules channel strip, with default Ch 10)
      const drumsFaderHtml = `
        <div class="channel-strip">
          ${this._buildChanChipHtml(10)}
          <div class="fader-area">
            <div class="meter-container">
              <div class="meter-bg">
                <div class="meter-bar" data-control="meter-bar"></div>
                <div class="meter-peak" data-control="meter-peak"></div>
              </div>
            </div>
            <div class="fader-container">
              <div class="fader-fill" data-control="fader-fill"></div>
              <input type="range" min="0" max="127" value="100" data-control="volume" class="vertical-fader">
            </div>
            <div class="fader-scale">
              <span class="scale-label" style="top:9.3%">+6</span>
              <span class="scale-label" style="top:26.6%">0</span>
              <span class="scale-label" style="top:58.7%">-6</span>
              <span class="scale-label" style="top:74.7%">-12</span>
              <span class="scale-label" style="top:90.7%">-∞</span>
            </div>
          </div>
          <div class="cs-pan-row">
            <div class="cs-pan-knob" data-control="pan" data-pan-value="64" tabindex="0" aria-label="Pan">
              <svg class="cs-pan-arc" viewBox="0 0 44 44" fill="none">
                <path d="M 12.5,38.5 A 19,19 0 1 1 31.5,38.5" stroke="rgba(0,229,255,0.28)" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
              <div class="cs-pan-knob-body">
                <div class="cs-pan-knob-indicator"></div>
              </div>
            </div>
            <div class="cs-pan-labels"><span>L</span><span>R</span></div>
          </div>
          <div class="cs-ms-row">
            <button class="cs-mute-btn" data-control="mute" type="button" aria-pressed="false">M</button>
            <button class="cs-solo-btn" data-control="solo" type="button" aria-pressed="false">S</button>
          </div>
          <div class="db-readout">
            <span data-volume-display>0.0 dB</span>
          </div>
        </div>
      `;

      // Main panel: knobs left, fader right
      const mainPanelHtml = `
        <div class="card-tab-panel" data-panel="main"${activeTab === 'main' ? '' : ' hidden'}>
          <div class="drums-main-panel-content">
            <div class="drums-left-col">
              <div class="drums-knobs">
                ${knob('swing', 'Swing', 0, '0%')}
                ${knob('humanize', 'Humanize', 15, '15%')}
              </div>
              <input type="hidden" data-control="swing" value="0">
              <input type="hidden" data-control="humanize" value="15">
              ${this.buildPresetPanelHtml('drums')}
            </div>
            <div class="drums-right-col">
              ${drumsFaderHtml}
            </div>
          </div>
          <div class="module-display-region" style="margin-top: 12px;">
            <div class="module-display-header">
              <span class="module-display-label">ACTIVITY</span>
              <span class="module-display-readout" data-display-readout></span>
            </div>
            <div class="freq-viz-container" data-control="freq-viz"><canvas class="freq-viz-canvas"></canvas></div>
          </div>
        </div>`;

      // Per-group panels: contains up to 4 tracks stacked vertically
      let trackPanelsHtml = '';
      groups.forEach((groupTracks, groupIdx) => {
        const panelId = `group-${groupIdx}`;
        const isHidden = activeTab === panelId ? '' : ' hidden';
        
        let tracksHtml = '';
        groupTracks.forEach(track => {
          tracksHtml += `
            <div class="drums-group-track" data-track-id="${track.id}">
              <div class="drums-track-header-left">
                <button class="drums-row-mute${track.muted ? ' muted' : ''}" data-action="drums-mute" data-track-id="${track.id}" title="Mute" type="button">M</button>
                <button class="drums-row-solo${track.soloed ? ' active' : ''}" data-action="drums-solo" data-track-id="${track.id}" title="Solo" type="button">S</button>
                <button class="drums-action-btn" data-action="drums-audition" data-track-id="${track.id}" title="Audition" type="button">▶</button>
                <span class="drums-track-panel-name" title="${track.name}">${track.name}</span>
              </div>
              <div class="drums-tracker-panel" data-tracker-id="${track.id}"></div>
            </div>`;
        });

        trackPanelsHtml += `
          <div class="card-tab-panel drums-group-panel" data-panel="${panelId}"${isHidden}>
            ${tracksHtml}
          </div>`;
      });

      // Advanced panel: kit map table + add/remove instruments
      const advancedPanelHtml = `
        <div class="card-tab-panel" data-panel="advanced"${activeTab === 'advanced' ? '' : ' hidden'}>
          <div class="drums-kit-panel">
            <div class="drums-kit-maprow">
              <label>Kit Map</label>
              <select data-control="drums-profile">
                <option value="gm" selected>General MIDI</option>
                <option value="ez">EZdrummer</option>
                <option value="ad">Addictive Drums</option>
                <option value="battery">Battery</option>
                <option value="ssd">Steven Slate Drums</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <table class="drums-kit-table">
              <thead><tr><th>Instrument</th><th>Note</th><th></th><th></th></tr></thead>
              <tbody data-control="drums-tracks-body"></tbody>
            </table>
            <div class="drums-add-track-row">
              <button class="drums-action-btn" data-action="drums-add" type="button">+ Add Instrument</button>
            </div>
          </div>
        </div>`;

      card.innerHTML = `
        <div class="module-header">
          <div class="drag-handle" title="Drag to reorder">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/>
              <circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/>
              <circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/>
            </svg>
          </div>
          <div class="module-glyph">${this._getGlyphSvg(type, id)}</div>
          <div class="module-title">
            <div class="module-title-dot"></div>
            <h3></h3>
          </div>
          <div class="module-header-actions">
            <label class="toggle-switch mappable" data-midi-target="${midiTarget}">
              <input type="checkbox" data-control="toggle" checked>
              <span class="slider"></span>
            </label>
            <button class="module-remove-btn" data-action="remove" title="Remove module" type="button">×</button>
          </div>
        </div>
        <div class="module-body">
          <div class="card-tabs drums-card-tabs">
            ${tabBtnsHtml}
          </div>
          <div class="module-main-row drums-full-width">
            <div class="module-controls-column">
              ${mainPanelHtml}
              ${trackPanelsHtml}
              ${advancedPanelHtml}
            </div>
          </div>
        </div>`;

      card.querySelector('h3').textContent = label;
      return card;
    }

    // ── Standard (non-drums) card ─────────────────────────────────────────
    const { chanDefault, displayLabel, description, mainHtml, advancedHtml, bottomHtml } = this._getModuleContent(id, type);

    const hasAdvanced = advancedHtml.trim().length > 0;

    const tabRowHtml = hasAdvanced ? `
      <div class="card-tabs">
        <button class="card-tab-btn active" data-tab="main" type="button">Main</button>
        <button class="card-tab-btn" data-tab="advanced" type="button">Advanced</button>
      </div>` : '';

    const controlsAreaHtml = hasAdvanced
      ? `<div class="card-tab-panel" data-panel="main">${mainHtml}</div>
         <div class="card-tab-panel" data-panel="advanced" hidden>${advancedHtml}</div>`
      : mainHtml;

    const faderHtml = `
      <div class="channel-strip">
        ${this._buildChanChipHtml(chanDefault)}
        <div class="fader-area">
          <div class="meter-container">
            <div class="meter-bg">
              <div class="meter-bar" data-control="meter-bar"></div>
              <div class="meter-peak" data-control="meter-peak"></div>
            </div>
          </div>
          <div class="fader-container">
            <div class="fader-fill" data-control="fader-fill"></div>
            <input type="range" min="0" max="127" value="100" data-control="volume" class="vertical-fader">
          </div>
          <div class="fader-scale">
            <span class="scale-label" style="top:9.3%">+6</span>
            <span class="scale-label" style="top:26.6%">0</span>
            <span class="scale-label" style="top:58.7%">-6</span>
            <span class="scale-label" style="top:74.7%">-12</span>
            <span class="scale-label" style="top:90.7%">-∞</span>
          </div>
        </div>
        <div class="cs-pan-row">
          <div class="cs-pan-knob" data-control="pan" data-pan-value="64" tabindex="0" aria-label="Pan">
            <svg class="cs-pan-arc" viewBox="0 0 44 44" fill="none">
              <path d="M 12.5,38.5 A 19,19 0 1 1 31.5,38.5" stroke="rgba(0,229,255,0.28)" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
            <div class="cs-pan-knob-body">
              <div class="cs-pan-knob-indicator"></div>
            </div>
          </div>
          <div class="cs-pan-labels"><span>L</span><span>R</span></div>
        </div>
        <div class="cs-ms-row">
          <button class="cs-mute-btn" data-control="mute" type="button" aria-pressed="false">M</button>
          <button class="cs-solo-btn" data-control="solo" type="button" aria-pressed="false">S</button>
        </div>
        <div class="db-readout">
          <span data-volume-display>0.0 dB</span>
        </div>
      </div>
    `;

    const displayRegionHtml = bottomHtml ? `
      <div class="module-display-region">
        <div class="module-display-header">
          <span class="module-display-label">${displayLabel}</span>
          <span class="module-display-readout" data-display-readout></span>
        </div>
        ${bottomHtml}
      </div>` : '';

    card.innerHTML = `
      <div class="module-header">
        <div class="drag-handle" title="Drag to reorder">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/>
            <circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/>
            <circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/>
          </svg>
        </div>
        <div class="module-glyph">${this._getGlyphSvg(type, id)}</div>
        <div class="module-title">
          <div class="module-title-dot"></div>
          <h3></h3>
        </div>
        <div class="module-header-actions">
          <label class="toggle-switch mappable" data-midi-target="${midiTarget}">
            <input type="checkbox" data-control="toggle" checked>
            <span class="slider"></span>
          </label>
          <button class="module-remove-btn" data-action="remove" title="Remove module" type="button">×</button>
        </div>
      </div>
      <div class="module-body">
        ${description ? `<p class="module-description">${description}</p>` : ''}
        ${tabRowHtml}
        <div class="module-main-row">
          <div class="module-controls-column">
            ${controlsAreaHtml}
          </div>
          <div class="module-fader-column">
            ${faderHtml}
          </div>
        </div>
        ${displayRegionHtml}
      </div>`;

    card.querySelector('h3').textContent = label;

    return card;
  }

  populateNoteSelects() {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const selects = document.querySelectorAll('.note-select');

    const optionsHtml = [];
    for (let i = 0; i <= 127; i++) {
      const octave = Math.floor(i / 12) - 1;
      const noteName = noteNames[i % 12];
      const nameStr = `${noteName}${octave}`;
      optionsHtml.push({ valNum: i, valStr: nameStr, label: `${nameStr} (${i})` });
    }

    selects.forEach(select => {
      const format = select.dataset.format || 'number';

      let html = '';
      optionsHtml.forEach(opt => {
        const val = format === 'string' ? opt.valStr : opt.valNum;
        html += `<option value="${val}">${opt.label}</option>`;
      });
      select.innerHTML = html;

      if (select.dataset.default) {
        select.value = select.dataset.default;
      }
    });
  }
}

