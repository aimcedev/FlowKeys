# Flow Keys CSS Partials

`../styles.css` is the cascade manifest. Keep imports ordered unless you are intentionally changing which rules win.

## Files

- `01-layout-transport.css` - app shell, top bar, transport controls, beat indicator, global selects.
- `02-workspace-modules-sequencer.css` - edit workspace, module cards, module controls, visualizer, sequencer.
- `03-midi-mapping.css` - mapping drawer, mapping list, learn-mode target visuals.
- `04-responsive.css` - viewport breakpoints.
- `05-modes-live.css` - edit/live mode switching, live sidebar, song and section cards.
- `06-modals-toasts-actions.css` - modals, toasts, buttons, utility classes, song settings.
- `07-edit-context-midi-targets.css` - edit context bar, save status, mapping target buttons.
- `08-tempo-widget.css` - tempo tracker widget and MIDI device panel heading styles.
- `09-drag-palette-activity.css` - drag/drop states, module palette, MIDI activity monitor.
- `10-presets-context-menu.css` - preset controls, preset import/export, context menu.

## Refactor Rule

First move rules without changing them. Then clean up duplicates or naming one small area at a time, with a browser smoke test after each step.
