export class DragDropController {
  constructor(app) {
    this.app = app;
    this._drag = null;
    this._paletteDrag = null;
  }

  // ── Card drag-reorder ─────────────────────────────────────────────────────

  attachCardDrag() {
    const grid = document.querySelector('.modules-grid');
    if (!grid) return;
    grid.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const card = handle.closest('[data-instance-id]');
      if (!card) return;
      this._startDrag(e, card);
    });
  }

  _startDrag(e, cardEl) {
    e.preventDefault();
    const rect = cardEl.getBoundingClientRect();

    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);

    cardEl.classList.add('is-dragging');

    // Cache grid and card rects once — they don't change during the drag
    const grid = document.querySelector('.modules-grid');
    const cachedGridRect = grid.getBoundingClientRect();
    const cachedCards = [...grid.querySelectorAll('[data-instance-id]:not(.is-dragging)')]
      .map(card => ({ card, rect: card.getBoundingClientRect() }));

    this._drag = {
      instanceId: cardEl.dataset.instanceId,
      cardEl,
      ghost,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      currentTargetCard: null,
      currentTargetIndex: null,
      cachedGridRect,
      cachedCards,
    };

    this._drag.boundMove = this._onDragMove.bind(this);
    this._drag.boundUp = this._onDragEnd.bind(this);
    this._drag.boundCancel = this._cancelDrag.bind(this);
    this._drag.boundResize = () => {
      const d = this._drag;
      if (!d) return;
      const g = document.querySelector('.modules-grid');
      d.cachedGridRect = g.getBoundingClientRect();
      d.cachedCards = [...g.querySelectorAll('[data-instance-id]:not(.is-dragging)')]
        .map(c => ({ card: c, rect: c.getBoundingClientRect() }));
      d.ghost.style.width = d.cardEl.getBoundingClientRect().width + 'px';
    };

    document.addEventListener('pointermove', this._drag.boundMove);
    document.addEventListener('pointerup', this._drag.boundUp);
    document.addEventListener('pointercancel', this._drag.boundCancel);
    window.addEventListener('resize', this._drag.boundResize);
  }

  _onDragMove(e) {
    const d = this._drag;
    if (!d) return;

    d.ghost.style.left = (e.clientX - d.offsetX) + 'px';
    d.ghost.style.top = (e.clientY - d.offsetY) + 'px';

    const targetCard = this._findDropTarget(e.clientX, e.clientY);
    if (targetCard === d.currentTargetCard) return;

    if (d.currentTargetCard) {
      d.currentTargetCard.classList.remove('is-drop-target');
    }

    d.currentTargetCard = targetCard;

    if (targetCard) {
      targetCard.classList.add('is-drop-target');
      d.currentTargetIndex = this.app._currentModules.findIndex(
        m => m.id === targetCard.dataset.instanceId
      );
    } else {
      d.currentTargetIndex = null;
    }
  }

  _findDropTarget(clientX, clientY) {
    const { cachedGridRect, cachedCards } = this._drag;

    if (clientX < cachedGridRect.left || clientX > cachedGridRect.right ||
      clientY < cachedGridRect.top || clientY > cachedGridRect.bottom) {
      return null;
    }

    for (const { card, rect } of cachedCards) {
      if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
        return card;
      }
    }

    // Between cards — return nearest by center distance
    let best = null;
    let bestDist = Infinity;
    for (const { card, rect } of cachedCards) {
      const dist = Math.hypot(clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2));
      if (dist < bestDist) { bestDist = dist; best = card; }
    }
    return best;
  }

  _onDragEnd(e) {
    const d = this._drag;
    if (!d) return;

    const gridRect = d.cachedGridRect;
    const outsideGrid = !gridRect ||
      e.clientX < gridRect.left || e.clientX > gridRect.right ||
      e.clientY < gridRect.top || e.clientY > gridRect.bottom;

    const fromIndex = this.app._currentModules.findIndex(m => m.id === d.instanceId);
    const toIndex = d.currentTargetIndex;

    this._cleanupDrag();

    if (outsideGrid || fromIndex === -1 || toIndex === null || toIndex === fromIndex) return;

    // Capture state before clearing DOM
    const currentState = this.app.getCurrentStateData();

    // Remove from old position and insert at target's original slot.
    // When fromIndex < toIndex: target shifts left by 1 after removal, but inserting at
    // the original toIndex naturally places the dragged item in the target's vacated slot.
    const [moved] = this.app._currentModules.splice(fromIndex, 1);
    this.app._currentModules.splice(toIndex, 0, moved);

    // Reorder the captured state's modules array to match
    currentState.modules = this.app._currentModules.map(m =>
      currentState.modules.find(cm => cm.id === m.id)
    ).filter(Boolean);

    // Assign vt-names to existing cards so the transition can match old → new
    for (const mod of this.app._currentModules) {
      const card = this.app._getModuleCard(mod.id);
      if (card) card.style.viewTransitionName = `mc-${mod.id}`;
    }

    const doRender = () => {
      this.app.renderModules(this.app._currentModules);
      this.app.applyStateData(currentState, { persist: false });
    };

    if (document.startViewTransition) {
      document.startViewTransition(doRender);
    } else {
      doRender();
    }

    this.app.saveState();

    // Mirror the new order to every other section in this song
    const _dndSongId = this.app.presetManager.activeSongId;
    const _dndSectionId = this.app.presetManager.activeSectionId;
    if (_dndSongId && _dndSectionId) {
      this.app.presetManager.propagateModuleReorder(
        _dndSongId, _dndSectionId,
        this.app._currentModules.map(m => m.id)
      );
    }
  }

  _cancelDrag() {
    this._cleanupDrag();
  }

  _cleanupDrag() {
    const d = this._drag;
    if (!d) return;

    document.removeEventListener('pointermove', d.boundMove);
    document.removeEventListener('pointerup', d.boundUp);
    document.removeEventListener('pointercancel', d.boundCancel);
    if (d.boundResize) window.removeEventListener('resize', d.boundResize);

    d.ghost.remove();

    if (d.currentTargetCard) {
      d.currentTargetCard.classList.remove('is-drop-target');
    }

    d.cardEl.classList.remove('is-dragging');

    this._drag = null;
  }

  // ── Palette Drag (sidebar → grid) ─────────────────────────────────────────

  attachPaletteDrag() {
    this._paletteDrag = null;

    document.querySelector('.routing-sidebar')?.addEventListener('pointerdown', (e) => {
      const tile = e.target.closest('.palette-tile');
      if (!tile) return;
      const type = tile.dataset.paletteType;
      if (!type) return;
      this._startPaletteDrag(e, type, tile);
    });
  }

  _startPaletteDrag(e, type, tileEl) {
    e.preventDefault();

    const typeColors = {
      bass: 'var(--color-bass)',
      arp: 'var(--color-arp)',
      pad: 'var(--color-pad)',
      percussion: 'var(--color-percussion)',
      keyboard: 'var(--color-keyboard)',
      looper: 'var(--color-looper)',
      swell: 'var(--color-swell)',
      drums: 'var(--color-drums)'
    };
    const label = type === 'drums' ? 'Drum Kit' : (type.charAt(0).toUpperCase() + type.slice(1));

    const ghost = document.createElement('div');
    ghost.className = 'palette-drag-ghost';
    ghost.innerHTML = `
      <span class="palette-ghost-dot" style="background:${typeColors[type] ?? '#fff'}"></span>
      <span class="palette-ghost-label">${label}</span>`;
    ghost.style.left = (e.clientX - 20) + 'px';
    ghost.style.top = (e.clientY - 24) + 'px';
    document.body.appendChild(ghost);

    tileEl.classList.add('is-grabbing');

    this._paletteDrag = {
      type,
      tileEl,
      ghost,
      currentInsertIndex: null,
    };

    this._paletteDrag.boundMove = this._onPaletteDragMove.bind(this);
    this._paletteDrag.boundUp = this._onPaletteDragEnd.bind(this);
    this._paletteDrag.boundCancel = this._cleanupPaletteDrag.bind(this);

    document.addEventListener('pointermove', this._paletteDrag.boundMove);
    document.addEventListener('pointerup', this._paletteDrag.boundUp);
    document.addEventListener('pointercancel', this._paletteDrag.boundCancel);
  }

  _onPaletteDragMove(e) {
    const pd = this._paletteDrag;
    if (!pd) return;

    pd.ghost.style.left = (e.clientX - 20) + 'px';
    pd.ghost.style.top = (e.clientY - 24) + 'px';

    const insertIndex = this._findPaletteInsertIndex(e.clientX, e.clientY);

    if (insertIndex === null) {
      this._clearPaletteDropIndicator();
      pd.currentInsertIndex = null;
      return;
    }

    if (insertIndex === pd.currentInsertIndex) return;
    pd.currentInsertIndex = insertIndex;
    this._updatePaletteDropIndicator(insertIndex);
  }

  _onPaletteDragEnd(_e) {
    const pd = this._paletteDrag;
    if (!pd) return;

    const insertIndex = pd.currentInsertIndex;
    const type = pd.type;

    this._cleanupPaletteDrag();

    if (insertIndex !== null) {
      const doAdd = () => {
        this.app.addModule(type, insertIndex);
      };
      if (document.startViewTransition) {
        document.startViewTransition(doAdd);
      } else {
        doAdd();
      }
    }
  }

  _cleanupPaletteDrag() {
    const pd = this._paletteDrag;
    if (!pd) return;

    document.removeEventListener('pointermove', pd.boundMove);
    document.removeEventListener('pointerup', pd.boundUp);
    document.removeEventListener('pointercancel', pd.boundCancel);

    pd.ghost.remove();
    pd.tileEl.classList.remove('is-grabbing');
    this._clearPaletteDropIndicator();

    this._paletteDrag = null;
  }

  _updatePaletteDropIndicator(insertIndex) {
    this._clearPaletteDropIndicator();
    const cards = [...document.querySelectorAll('.modules-grid [data-instance-id]')];
    if (insertIndex < cards.length) {
      cards[insertIndex].classList.add('palette-insert-before');
    }
  }

  _clearPaletteDropIndicator() {
    document.querySelectorAll('.palette-insert-before, .palette-insert-after').forEach(el => {
      el.classList.remove('palette-insert-before', 'palette-insert-after');
    });
  }

  _findPaletteInsertIndex(clientX, clientY) {
    const grid = document.querySelector('.modules-grid');
    if (!grid) return null;
    const gridRect = grid.getBoundingClientRect();

    if (clientX < gridRect.left || clientX > gridRect.right ||
      clientY < gridRect.top || clientY > gridRect.bottom) {
      return null;
    }

    const cards = [...grid.querySelectorAll('[data-instance-id]')];
    if (!cards.length) return 0;

    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
        return i;
      }
    }

    return cards.length;
  }

  // ── Add Module Picker ─────────────────────────────────────────────────────

  openAddModulePicker(anchorBtn) {
    const existing = document.querySelector('.add-module-picker');
    if (existing) { existing.remove(); return; }

    const picker = document.createElement('div');
    picker.className = 'add-module-picker';
    picker.innerHTML = `
      <button data-type="bass">Bass</button>
      <button data-type="arp">Arp</button>
      <button data-type="pad">Drone</button>
      <button data-type="percussion">Percussion</button>
      <button data-type="keyboard">Keyboard</button>
      <button data-type="swell">Swell</button>
      <button data-type="looper">Looper</button>
      <button data-type="drums">Drum Kit</button>`;

    picker.addEventListener('click', (e) => {
      const type = e.target.dataset.type;
      if (type) { picker.remove(); this.app.addModule(type); }
    });

    // Dismiss on outside click (next tick so this click doesn't immediately close it)
    setTimeout(() => {
      document.addEventListener('click', () => picker.remove(), { once: true });
    }, 0);

    anchorBtn.parentElement.insertBefore(picker, anchorBtn);
  }
}
