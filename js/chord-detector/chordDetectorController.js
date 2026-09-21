import { NoteState } from './note-state.js';
import { detectChord } from './chord-engine.js';
import { Stabilizer } from './stability.js';
import { SHARP_NAMES, midiToPitchClass, midiToOctave } from './pitch.js';
import { loadSettings } from '../state/settingsStore.js';

export class ChordDetectorController {
  constructor(app) {
    this.app = app;
    this.noteState = new NoteState();
    this.stabilizer = new Stabilizer();
    this.lastHistoryName = null;
    this.options = {
      key: { tonic: 'C', mode: 'major' },
      previousChord: null,
      mode: 'literal',
      nashvilleStyle: { minorMode: '1m', minorSymbol: 'm' },
      layout: 'both',
      slashSus: 'sus',
      fontSize: 'normal',
    };

    this._cacheDom();
    this._bindEvents();
    this.updateFromSettings();
    
    // Start tick loop
    this.tick();
  }

  _cacheDom() {
    this.container = document.querySelector('.transport-chord');
    this.triggerBtn = document.getElementById('chord-detector-btn');
    this.displayText = document.getElementById('chord-display-text');
    this.popover = document.getElementById('chord-popover');
    this.historyBar = document.getElementById('chord-history-bar');
    this.candTable = document.getElementById('chord-cand-table')?.querySelector('tbody');
    this.resetBtn = document.getElementById('chord-reset-btn');
    this.settingsBtn = document.getElementById('chord-settings-btn');
  }

  _bindEvents() {
    if (!this.triggerBtn || !this.popover) return;

    // Toggle popover on button click
    this.triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = this.popover.classList.contains('chord-popover--open');
      if (!isOpen) this.positionPopover();
      this.popover.classList.toggle('chord-popover--open', !isOpen);
      this.triggerBtn.classList.toggle('active', !isOpen);

      // Close tempo popover if open for UI cleanliness
      document.getElementById('tempo-popover')?.classList.remove('tempo-popover--open');
      document.getElementById('tempo-trigger-btn')?.classList.remove('active');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.popover.contains(e.target) && e.target !== this.triggerBtn && !this.triggerBtn.contains(e.target)) {
        this.popover.classList.remove('chord-popover--open');
        this.triggerBtn.classList.remove('active');
      }
    });

    // Window resize repositioning
    window.addEventListener('resize', () => {
      if (this.popover.classList.contains('chord-popover--open')) {
        this.positionPopover();
      }
    });

    // Reset button
    this.resetBtn?.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent closing popover
      this.reset();
    });

    // Settings button redirects to main Settings Modal
    this.settingsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.popover.classList.remove('chord-popover--open');
      this.triggerBtn.classList.remove('active');
      if (this.app.settingsWindow) {
        this.app.settingsWindow.open();
        this.app.settingsWindow._selectTab('chord-detector');
      }
    });
  }

  positionPopover() {
    const headerRect = document.querySelector('header.top-bar')?.getBoundingClientRect();
    const btnRect = this.triggerBtn.getBoundingClientRect();
    const container = document.querySelector('.app-container');
    if (!headerRect || !container) return;

    const containerRect = container.getBoundingClientRect();
    this.popover.style.top = (headerRect.bottom - containerRect.top + 8) + 'px';

    const popoverWidth = 320;
    let left = (btnRect.left + btnRect.width / 2) - (popoverWidth / 2) - containerRect.left;

    // Clamp to screen boundaries with 12px padding
    left = Math.max(12, left);
    if (left + popoverWidth > containerRect.width - 12) {
      left = Math.max(12, containerRect.width - popoverWidth - 12);
    }

    this.popover.style.left = left + 'px';
    this.popover.style.right = 'auto';
  }

  updateFromSettings() {
    const s = loadSettings();
    const cSettings = s.chordDetector || {
      layout: 'both',
      interpretation: 'literal',
      nashvilleMinor: '1m',
      minorSymbol: 'm',
      slashSus: 'sus',
      fontSize: 'normal'
    };

    this.options.mode = cSettings.interpretation;
    this.options.nashvilleStyle = {
      minorMode: cSettings.nashvilleMinor,
      minorSymbol: cSettings.minorSymbol
    };
    this.options.layout = cSettings.layout;
    this.options.slashSus = cSettings.slashSus;
    this.options.fontSize = cSettings.fontSize || 'normal';

    // Apply font size class to button
    if (this.triggerBtn) {
      this.triggerBtn.classList.remove('size-normal', 'size-medium', 'size-large');
      this.triggerBtn.classList.add(`size-${this.options.fontSize}`);
    }

    // Force key tonic sync
    this.onKeyChange(this.app._currentSongKey);
  }

  onKeyChange(pitchClass) {
    this.options.key = {
      tonic: SHARP_NAMES[pitchClass] || 'C',
      mode: 'major'
    };
  }

  reset() {
    // Clear noteState
    this.noteState.notes.clear();
    this.noteState.sustainHeld.clear();
    this.noteState.released = [];
    
    // Clear stabilizer
    this.stabilizer.displayed = null;
    this.stabilizer.pending = null;
    this.lastHistoryName = null;

    // Reset history UI
    if (this.historyBar) {
      this.historyBar.innerHTML = `
        <div class="chord-history-card empty-slot"><div class="chc-chord">—</div></div>
        <div class="chord-history-card empty-slot"><div class="chc-chord">—</div></div>
        <div class="chord-history-card empty-slot"><div class="chc-chord">—</div></div>
        <div class="chord-history-card empty-slot"><div class="chc-chord">—</div></div>
      `;
    }

    // Reset candidates UI
    if (this.candTable) {
      this.candTable.innerHTML = '<tr><td class="empty-state">No notes played</td></tr>';
    }

    if (this.displayText) {
      this.displayText.innerHTML = '<span class="c-empty">—</span>';
    }
  }

  handleMidiMessage(event) {
    if (!event.data || event.data.length < 2) return;
    const [status, note, velocity] = event.data;
    const cmd = status >> 4;
    const transposedNote = Math.max(0, Math.min(127, note + this.app.engine.transpose));

    if (cmd === 8 || (cmd === 9 && velocity === 0)) {
      this.noteState.handleEvent({
        type: 'noteOff',
        midiNote: transposedNote,
        timestamp: performance.now()
      });
    } else if (cmd === 9) {
      this.noteState.handleEvent({
        type: 'noteOn',
        midiNote: transposedNote,
        velocity: velocity,
        timestamp: performance.now()
      });
    } else if (cmd === 11 && note === 64) {
      this.noteState.handleEvent({
        type: 'sustain',
        value: velocity >= 64,
        timestamp: performance.now()
      });
    }
  }

  handleSyntheticMidi(evt) {
    const { status, note, velocity } = evt;
    const cmd = status >> 4;
    const transposedNote = Math.max(0, Math.min(127, note + this.app.engine.transpose));

    if (cmd === 8 || (cmd === 9 && velocity === 0)) {
      this.noteState.handleEvent({
        type: 'noteOff',
        midiNote: transposedNote,
        timestamp: performance.now()
      });
    } else if (cmd === 9) {
      this.noteState.handleEvent({
        type: 'noteOn',
        midiNote: transposedNote,
        velocity: velocity,
        timestamp: performance.now()
      });
    }
  }

  addChordToHistory(name, nashville) {
    if (!this.historyBar) return;
    const formattedName = this.formatMusicalSymbols(name);
    const formattedNashville = this.formatMusicalSymbols(nashville);

    // Create a new card
    const card = document.createElement('div');
    card.className = 'chord-history-card new-chord';
    card.innerHTML = `
      <div class="hc-chord">${this.esc(formattedName)}</div>
      <div class="hc-nv">${this.esc(formattedNashville)}</div>
    `;

    // Prepend to container
    this.historyBar.insertBefore(card, this.historyBar.firstChild);

    const cards = this.historyBar.querySelectorAll('.chord-history-card');
    const emptySlots = this.historyBar.querySelectorAll('.empty-slot');

    if (emptySlots.length > 0) {
      emptySlots[emptySlots.length - 1].remove();
    } else {
      if (cards.length > 4) {
        cards[4].remove();
      }
    }
  }

  formatMusicalSymbols(str) {
    if (!str) return '';
    return str
      .replace(/([A-G])b(?!b)/g, '$1♭')
      .replace(/([A-G])bb/g, '$1𝄫')
      .replace(/([A-G])#/g, '$1♯')
      .replace(/([A-G])##/g, '$1𝄪')
      .replace(/\bb(\d+)/g, '♭$1')
      .replace(/#(\d+)/g, '♯$1')
      .replace(/(\d+)b(\d+)/g, '$1♭$2')
      .replace(/(\d+)#(\d+)/g, '$1♯$2');
  }

  esc(s) {
    return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  renderChordDisplay(parts, prefix, names) {
    if (!parts) return `<span class="c-empty">—</span>`;
    const rootSpelled = this.formatMusicalSymbols(parts[names.root]);
    let html = `<span class="${prefix}-root">${this.esc(rootSpelled)}</span>`;
    if (parts[names.quality]) html += `<span class="${prefix}-qual">${this.esc(parts[names.quality])}</span>`;
    if (parts[names.extension]) html += `<span class="${prefix}-ext">${this.esc(parts[names.extension])}</span>`;
    if (parts[names.bass]) {
      const bassSpelled = this.formatMusicalSymbols(parts[names.bass]);
      html += `<span class="${prefix}-sep">/</span>`;
      html += `<span class="${prefix}-bass">${this.esc(bassSpelled)}</span>`;
    }
    return html;
  }

  renderCompactDisplay(shown) {
    if (!shown || !shown.chordName) return `<span class="c-empty">—</span>`;

    let chordHtml = '';
    if (shown.parts) {
      const rootSpelled = this.formatMusicalSymbols(shown.parts.root);
      chordHtml = `<span class="c-root">${this.esc(rootSpelled)}</span>`;
      if (shown.parts.qualityLabel) {
        chordHtml += `<span class="c-qual">${this.esc(shown.parts.qualityLabel)}</span>`;
      }
      if (shown.parts.extensionLabel) {
        const extFormatted = this.formatMusicalSymbols(shown.parts.extensionLabel);
        chordHtml += `<span class="c-ext">${this.esc(extFormatted)}</span>`;
      }
      if (shown.parts.bass) {
        const bassSpelled = this.formatMusicalSymbols(shown.parts.bass);
        chordHtml += `<span class="c-sep">/</span><span class="c-bass">${this.esc(bassSpelled)}</span>`;
      }
    } else {
      chordHtml = `<span class="c-root">${this.esc(this.formatMusicalSymbols(shown.chordName))}</span>`;
    }

    let nvHtml = '';
    if (shown.nashvilleParts) {
      const deg = this.formatMusicalSymbols(shown.nashvilleParts.degree);
      nvHtml = `<span class="c-root">${this.esc(deg)}</span>`;
      if (shown.nashvilleParts.qualityLabel) {
        nvHtml += `<span class="c-qual">${this.esc(shown.nashvilleParts.qualityLabel)}</span>`;
      }
      if (shown.nashvilleParts.extensionLabel) {
        const extFormatted = this.formatMusicalSymbols(shown.nashvilleParts.extensionLabel);
        nvHtml += `<span class="c-ext">${this.esc(extFormatted)}</span>`;
      }
      if (shown.nashvilleParts.bass) {
        const bassSpelled = this.formatMusicalSymbols(shown.nashvilleParts.bass);
        nvHtml += `<span class="c-sep">/</span><span class="c-bass">${this.esc(bassSpelled)}</span>`;
      }
    } else if (shown.nashville) {
      nvHtml = `<span class="c-root">${this.esc(this.formatMusicalSymbols(shown.nashville))}</span>`;
    }

    return `
      ${chordHtml}
      ${nvHtml ? `<span style="font-size:0.75em;opacity:0.4;margin:0 6px;">|</span><span style="color:var(--accent-cyan); font-weight:700;">${nvHtml}</span>` : ''}
    `;
  }

  tick() {
    const now = performance.now();
    this.options.previousChord = this.stabilizer.displayed
      ? { rootPc: this.stabilizer.displayed.rootPc, quality: this.stabilizer.displayed.quality }
      : null;

    const snapshot = this.noteState.snapshot(now);
    const result = detectChord(snapshot, this.options);
    const shown = this.stabilizer.update(result, snapshot, now);

    this.render(shown, result, snapshot);
    requestAnimationFrame(() => this.tick());
  }

  render(shown, result, snapshot) {
    const has = shown && shown.chordName;

    // Render LCD text in top-bar based on Layout setting
    if (this.displayText) {
      if (has) {
        let content = '';
        const layout = this.options.layout;
        
        if (layout === 'chords-only') {
          content = this.renderChordDisplay(shown.parts, 'c', { root: 'root', quality: 'qualityLabel', extension: 'extensionLabel', bass: 'bass' });
        } else if (layout === 'nashville-only') {
          content = this.renderChordDisplay(shown.nashvilleParts, 'c', { root: 'degree', quality: 'qualityLabel', extension: 'extensionLabel', bass: 'bass' });
        } else if (layout === 'both') {
          const chordHtml = this.renderChordDisplay(shown.parts, 'c', { root: 'root', quality: 'qualityLabel', extension: 'extensionLabel', bass: 'bass' });
          const nvHtml = this.renderChordDisplay(shown.nashvilleParts, 'c', { root: 'degree', quality: 'qualityLabel', extension: 'extensionLabel', bass: 'bass' });
          content = `<div style="display:flex; flex-direction:column; align-items:center; line-height:1; font-size: 0.9em; padding: 2px 0;">
            <div>${chordHtml}</div>
            <div style="font-size: 0.72em; color: var(--accent-cyan); margin-top: 2px;">${nvHtml}</div>
          </div>`;
        } else if (layout === 'both-alts') {
          const chordHtml = this.renderChordDisplay(shown.parts, 'c', { root: 'root', quality: 'qualityLabel', extension: 'extensionLabel', bass: 'bass' });
          const altsText = shown.alternatives && shown.alternatives.length 
            ? `<span style="font-size:0.65em; color:var(--text-dim); margin-left: 6px;">(${shown.alternatives.map(a => this.formatMusicalSymbols(a)).join(', ')})</span>`
            : '';
          content = `<div style="display:flex; align-items:baseline;">${chordHtml}${altsText}</div>`;
        } else if (layout === 'compact') {
          content = this.renderCompactDisplay(shown);
        }

        this.displayText.innerHTML = content;
      } else {
        this.displayText.innerHTML = '<span class="c-empty">—</span>';
      }
    }

    // If popover is closed, skip rendering detailed fields to save resources
    if (!this.popover.classList.contains('chord-popover--open')) return;

    // History: log each new displayed chord
    if (has && shown.chordName !== this.lastHistoryName) {
      this.lastHistoryName = shown.chordName;
      this.addChordToHistory(shown.chordName, shown.nashville || '');
    } else if (!has) {
      this.lastHistoryName = null;
    }

    // Candidates table
    if (this.candTable) {
      this.candTable.innerHTML = '';
      const cands = result.candidates || [];
      if (cands.length === 0) {
        this.candTable.innerHTML = '<tr><td class="empty-state">No notes played</td></tr>';
      } else {
        cands.forEach((c) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${this.formatMusicalSymbols(c.name)}</td><td class="score">${c.score}</td>`;
          this.candTable.appendChild(tr);
        });
      }
    }
  }
}
