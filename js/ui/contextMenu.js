export class ContextMenu {
  constructor(app) {
    this.app = app;
    this.clipboard = null; // { type, config }
    this.targetId = null;
    this.targetType = null;
    this.detail = null;

    this.el = document.createElement('div');
    this.el.className = 'ctx-menu';
    document.body.appendChild(this.el);

    // Close on click outside
    document.addEventListener('mousedown', (e) => {
      if (this.el.classList.contains('open') && !this.el.contains(e.target)) {
        this._close();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._close();
    });
  }

  open(e, targetId, targetType, detail = null) {
    this.targetId = targetId;
    this.targetType = targetType;
    this.detail = detail;

    this.el.innerHTML = '';
    const items = this._buildItems(targetId, targetType, detail);
    items.forEach(item => this.el.appendChild(item));

    this.el.classList.add('open');
    this._position(e.clientX, e.clientY);
  }

  _close() {
    this.el.classList.remove('open');
    this.targetId = null;
    this.targetType = null;
    this.detail = null;
  }

  _position(x, y) {
    // Tentative position
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';

    // Correct for viewport overflow after paint
    requestAnimationFrame(() => {
      const rect = this.el.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        this.el.style.left = (x - rect.width) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        this.el.style.top = (y - rect.height) + 'px';
      }
    });
  }

  _item(label, onClick, disabled = false) {
    const div = document.createElement('div');
    div.className = 'ctx-item' + (disabled ? ' disabled' : '');
    div.textContent = label;
    if (!disabled) {
      div.addEventListener('mousedown', (e) => e.stopPropagation()); // prevent close-on-outside-click
      div.addEventListener('click', () => {
        this._close();
        onClick();
      });
    }
    return div;
  }

  _sep() {
    const div = document.createElement('div');
    div.className = 'ctx-sep';
    return div;
  }

  _buildItems(targetId, targetType, detail) {
    if (targetType === 'flowParam') return this._buildFlowParamItems(targetId, detail);
    if (targetType === 'module') return this._buildModuleItems(targetId);
    if (targetType === 'section') return this._buildSectionItems(targetId);
    if (targetType === 'song') return this._buildSongItems(targetId);
    return [];
  }

  _buildFlowParamItems(instanceId, detail) {
    const control = detail?.control;
    if (!instanceId || !control) return [];
    return [
      this._item('Add Flow Point', () => this.app.flowRail?.addFlowPointFromEdit(instanceId, control)),
      this._sep(),
      ...this._buildModuleItems(instanceId),
    ];
  }

  // ── Module items ────────────────────────────────────────────────────────────

  _buildModuleItems(instanceId) {
    const app = this.app;
    const modDesc = app._currentModules.find(m => m.id === instanceId);
    if (!modDesc) return [];

    const canPaste = this.clipboard?.type === modDesc.type;
    const song = app.presetManager.getSong(app.presetManager.activeSongId);
    const multiSection = song && song.sections.length > 1;

    return [
      this._item('Copy Config', () => this._copyModuleConfig(instanceId)),
      this._item('Paste Config', () => app.pasteModuleConfig(instanceId, this.clipboard.config), !canPaste),
      this._sep(),
      this._item('Apply to All Sections', () => app.applyModuleConfigToAllSections(instanceId), !multiSection),
      this._sep(),
      this._item('Duplicate', () => app.duplicateModule(instanceId)),
      this._item('Reset to Defaults', () => app.resetModuleToDefaults(instanceId)),
      this._sep(),
      this._item('Rename', () => app.startModuleRename(instanceId)),
    ];
  }

  _copyModuleConfig(instanceId) {
    const app = this.app;
    const modDesc = app._currentModules.find(m => m.id === instanceId);
    if (!modDesc) return;
    const full = app._readModuleFromDom(modDesc);
    this.clipboard = { type: modDesc.type, config: full.config };
    app.uiManager.showToast('Config copied');
  }

  // ── Section items ───────────────────────────────────────────────────────────

  _buildSectionItems(sectionId) {
    const app = this.app;
    const song = app.presetManager.getSong(app.presetManager.activeSongId);
    const canDelete = song && song.sections.length > 1;

    return [
      this._item('Rename', () => app.startSectionRename(sectionId)),
      this._item('Duplicate Section', () => app.duplicateSection(sectionId)),
      this._sep(),
      this._item('Delete Section', () => app.deleteSectionWithConfirm(sectionId), !canDelete),
    ];
  }

  // ── Song items ──────────────────────────────────────────────────────────────

  _buildSongItems(songId) {
    const app = this.app;
    const canDelete = app.presetManager.getSongs().length > 1;

    return [
      this._item('Rename', () => app.startSongRename(songId)),
      this._item('Duplicate Song', () => app.duplicateSong(songId)),
      this._sep(),
      this._item('Delete Song', () => app.deleteSongWithConfirm(songId), !canDelete),
    ];
  }
}
