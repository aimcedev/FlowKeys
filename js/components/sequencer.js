export class SequencerUI {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.steps = options.steps || 16;
    this.onChange = options.onChange || null;

    // Array of velocities (0-127)
    this.velocities = new Array(this.steps).fill(0);

    // Internal state
    this.isDrawing = false;
    this.stepElements = [];
    this.currentStepIndex = -1;
    this._pendingClick = null; // tracks original velocity before first click for dblclick detection

    this.init();
  }

  init() {
    this.container.innerHTML = '';
    this.container.classList.add('sequencer-grid');

    for (let i = 0; i < this.steps; i++) {
      const stepEl = document.createElement('div');
      stepEl.className = 'seq-step';

      const barEl = document.createElement('div');
      barEl.className = 'velocity-bar';

      stepEl.appendChild(barEl);
      this.container.appendChild(stepEl);
      this.stepElements.push(stepEl);
    }

    this.setupEventListeners();
  }

  setupEventListeners() {
    this._listenerController = new AbortController();
    const { signal } = this._listenerController;

    this.container.addEventListener('mousedown', (e) => {
      // Save original velocity before handleInteraction modifies it (needed for dblclick).
      // Only save on the first click of a rapid sequence so the true original is preserved.
      const stepIndex = this._getStepIndexFromEvent(e);
      const now = Date.now();
      if (stepIndex !== null) {
        if (!this._pendingClick || this._pendingClick.index !== stepIndex || (now - this._pendingClick.time > 400)) {
          this._pendingClick = { index: stepIndex, originalVelocity: this.velocities[stepIndex], time: now };
        }
      }
      this.isDrawing = true;
      this.handleInteraction(e);
    }, { signal });

    window.addEventListener('mouseup', () => {
      this.isDrawing = false;
    }, { signal });

    this.container.addEventListener('mousemove', (e) => {
      if (this.isDrawing) this.handleInteraction(e);
    }, { signal });

    this.container.addEventListener('touchstart', (e) => {
      this.isDrawing = true;
      if (e.touches && e.touches[0]) {
        this.handleInteraction(e.touches[0]);
      }
    }, { passive: false, signal });

    window.addEventListener('touchend', () => {
      this.isDrawing = false;
    }, { signal });

    this.container.addEventListener('touchmove', (e) => {
      if (this.isDrawing) {
        e.preventDefault();
        if (e.touches && e.touches[0]) {
          this.handleInteraction(e.touches[0]);
        }
      }
    }, { passive: false, signal });

    // Double-click: toggle between 0 (off) and 127 (max velocity)
    this.container.addEventListener('dblclick', (e) => {
      const stepIndex = this._getStepIndexFromEvent(e);
      if (stepIndex !== null && this._pendingClick && this._pendingClick.index === stepIndex) {
        const originalVelocity = this._pendingClick.originalVelocity;
        const newVelocity = originalVelocity === 0 ? 127 : 0;
        this.setVelocity(stepIndex, newVelocity);
        if (this.onChange) this.onChange(this.velocities);
      }
      this._pendingClick = null;
    }, { signal });
  }

  destroy() {
    this._listenerController?.abort();
  }

  resize(steps, velocities = []) {
    this.destroy();
    this.steps = steps;
    this.velocities = new Array(steps).fill(0);
    this.stepElements = [];
    this.currentStepIndex = -1;
    this._pendingClick = null;
    this.init();
    this.setVelocities(velocities);
  }

  _getStepIndexFromEvent(e) {
    if (!e) return null;
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 0 || x > rect.width) return null;
    const stepWidth = rect.width / this.steps;
    const stepIndex = Math.floor(x / stepWidth);
    if (stepIndex >= 0 && stepIndex < this.steps) return stepIndex;
    return null;
  }

  handleInteraction(e) {
    if (!e) return;
    // Find which step we are over
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Boundary check
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
      // If dragging slightly outside vertically, cap it
      if (x < 0 || x > rect.width) return;
    }

    const stepWidth = rect.width / this.steps;
    const stepIndex = Math.floor(x / stepWidth);

    if (stepIndex >= 0 && stepIndex < this.steps) {
      // Calculate velocity based on Y purely inside the container
      // If Y is above container, velocity is 127
      // If Y is below container, velocity is 0
      let vy = e.clientY - rect.top;
      let ratio = 1 - (vy / rect.height);
      ratio = Math.max(0, Math.min(1, ratio));

      // If user clicks very near the bottom, snap to 0
      if (ratio < 0.1) ratio = 0;

      const velocity = Math.round(ratio * 127);

      if (this.velocities[stepIndex] !== velocity) {
        this.setVelocity(stepIndex, velocity);
        if (this.onChange) this.onChange(this.velocities);
      }
    }
  }

  setVelocity(index, velocity) {
    if (index >= 0 && index < this.steps) {
      this.velocities[index] = velocity;
      this.updateVisuals(index);
    }
  }

  setVelocities(velocitiesArray) {
    if (Array.isArray(velocitiesArray)) {
      for (let i = 0; i < this.steps; i++) {
        this.velocities[i] = velocitiesArray[i] || 0;
        this.updateVisuals(i);
      }
    }
  }

  getVelocities() {
    return [...this.velocities];
  }

  setCurrentStep(index) {
    if (this.currentStepIndex >= 0 && this.currentStepIndex < this.steps) {
      this.stepElements[this.currentStepIndex].classList.remove('current-step');
    }

    if (index >= 0 && index < this.steps) {
      this.stepElements[index].classList.add('current-step');
      this.currentStepIndex = index;
    }
  }

  updateVisuals(index) {
    const el = this.stepElements[index];
    const bar = el.querySelector('.velocity-bar');
    const velocity = this.velocities[index];

    if (velocity > 0) {
      el.classList.add('active-step');
      bar.style.height = `${(velocity / 127) * 100}%`;
    } else {
      el.classList.remove('active-step');
      bar.style.height = '0%';
    }
  }
}
