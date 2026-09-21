/**
 * Flow mapping toggles use the scene-mode musical boundaries:
 * entry/exit on a sustain release, tempo-to-tempo on a bar.
 * Requests are batched so a simultaneous off/on keeps the groove running.
 * Runtime only; song mappings continue storing the requested on/off envelope.
 */
export class FlowTempoTransitions {
  constructor(app, changed = () => {}) {
    this.app = app;
    this.changed = changed;
    this.pending = new Map();
    this.wait = null;
    this.kind = null;
    this._batch = 0;
    this._committing = false;
    this._sustainDown = !!app.engine.physicalSustainDown;
    this.beat = null;
  }

  enabled() {
    return this.app.uiManager?.currentMode === 'flow' && this.app._getActiveSongMode() === 'flow';
  }

  beginUpdate() { this._batch++; }
  endUpdate() {
    this._batch = Math.max(0, this._batch - 1);
    if (!this._batch) this._plan();
  }

  request(id, on) {
    const mod = this.app.moduleInstances?.get(id);
    if (!this.enabled() || !mod?.isTempoBased) return false;
    // This coordinator owns these requests; don't leave a second bar queue behind.
    this.app.pendingModuleActivations = this.app.pendingModuleActivations.filter(item => item !== mod);
    if (!!mod.isActive === !!on) this.pending.delete(id);
    else this.pending.set(id, !!on);
    if (!this._batch) this._plan();
    return true;
  }

  _modules() { return [...this.app.moduleInstances.values()].filter(mod => mod.isTempoBased); }

  _plan() {
    if (this._committing) return;
    if (!this.enabled()) { this.clear(); return; }
    for (const [id, on] of this.pending) {
      const mod = this.app.moduleInstances.get(id);
      if (!mod || !!mod.isActive === on) this.pending.delete(id);
    }
    if (!this.pending.size) {
      this.wait = null; this.kind = null; this.changed(); return;
    }
    const mods = this._modules();
    const active = mods.some(mod => mod.isActive);
    const desired = mods.some(mod => this.pending.has(mod.instanceId)
      ? this.pending.get(mod.instanceId)
      : (mod.isActive || this.app.pendingModuleActivations.includes(mod)));
    const inGroove = active && this.app.engine.clock.isRunning;
    this.kind = !inGroove && desired ? 'entry' : inGroove && !desired ? 'exit' : 'change';
    this.wait = this.kind === 'change' && inGroove ? 'bar' : 'pedal';
    // An already-up pedal is not a release. Crossing alone never starts/stops tempo.
    this._sustainDown = !!this.app.engine.physicalSustainDown;
    this.changed();
  }

  onStateChange(state) {
    const wasDown = this._sustainDown;
    this._sustainDown = !!state.sustainDown;
    if (this.enabled() && this.wait === 'pedal' && wasDown && !this._sustainDown) this._commit();
    this.changed();
  }

  onBar() {
    if (this.enabled() && this.wait === 'bar') this._commit();
    this.changed();
  }

  _commit() {
    if (!this.pending.size || this._committing) return;
    const requests = [...this.pending];
    this.pending.clear(); this.wait = null; this.kind = null;
    this._committing = true;
    const clock = this.app.engine.clock;
    const wasRunning = clock.isRunning;
    try {
      for (const [id, on] of requests) {
        const mod = this.app.moduleInstances.get(id);
        if (!mod?.isTempoBased) continue;
        this.app.pendingModuleActivations = this.app.pendingModuleActivations.filter(item => item !== mod);
        mod.toggle(on);
        if (on) mod.resetPhase?.();
        this.app._getModuleCard(id)?.classList.toggle('active', on);
        const toggle = this.app._getModuleEl(id, 'toggle');
        if (toggle) toggle.checked = on;
      }
      const anyActive = this._modules().some(mod => mod.isActive);
      if (anyActive && !wasRunning) {
        clock.restartFromZero();
        this.app._clockNeedsReset = false;
        this.beat = 0;
      } else if (!anyActive && !this.app.pendingModuleActivations.some(mod => mod.isTempoBased)) {
        clock.stop();
        this.app._clockNeedsReset = true;
        this.beat = null;
      }
      // Arps need currently-held voicing when joining at a bar without a new strike.
      this.app.engine.broadcastCurrentState();
    } finally {
      this._committing = false;
      this.changed();
    }
  }

  cancelModule(id) {
    if (this.pending.delete(id)) this._plan();
  }

  clear() {
    this.pending.clear(); this.wait = null; this.kind = null;
    this._sustainDown = !!this.app.engine.physicalSustainDown;
    this.beat = null;
    this.changed();
  }

  mappingStatus(mapping) {
    const target = mapping.target;
    const id = target?.kind === 'param' && target.control === 'toggle' ? target.moduleId
      : target?.kind === 'event' && /^module:.+:(on|off)$/.test(target.action || '') ? target.action.slice(7, target.action.lastIndexOf(':')) : null;
    const mod = this.app.moduleInstances?.get(id);
    if (!id || !mod?.isTempoBased) return null;
    const pending = this.pending.has(id) || this.app.pendingModuleActivations.includes(mod);
    const on = !!mod.isActive;
    return { on, pending, timing: pending
      ? this.wait === 'pedal' ? `${this.pending.get(id) ? 'Entry' : 'Exit'} armed · sustain` : 'Next bar'
      : on && this.app.engine.clock.isRunning ? 'In groove' : on ? 'Clock stopped' : 'Out of groove' };
  }

  status() {
    const active = this._modules().filter(mod => mod.isActive).length;
    const inGroove = active > 0 && this.app.engine.clock.isRunning;
    const pedal = this._sustainDown ? 'Release sustain' : 'Press and release sustain';
    if (this.wait === 'pedal') return {
      state: this.kind === 'entry' ? 'entry' : 'exit', inGroove,
      title: this.kind === 'entry' ? 'Entry armed' : 'Exit armed · groove playing',
      detail: `${pedal} to ${this.kind === 'entry' ? 'start on beat 1' : 'leave the groove'}.`,
    };
    if (this.wait === 'bar') return { state: 'queued', inGroove, title: 'In groove · change queued', detail: 'Sound changes land on the next bar.' };
    if (inGroove) return { state: 'playing', inGroove, title: 'In groove', detail: `${active} tempo ${active === 1 ? 'module' : 'modules'} playing · stays in until you exit.` };
    return { state: 'free', inGroove: false, title: 'Out of groove', detail: active ? 'Tempo modules enabled · clock stopped.' : 'Cross an on/off point to arm the groove.' };
  }
}
