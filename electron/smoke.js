// Smoke test: confirms the native `midi` module loads under Electron's ABI and
// that a virtual port can be opened/sent/closed. Run: npm run smoke
// Exits 0 on success, 1 on failure. Does not open a window.
const { app } = require('electron');

app.whenReady().then(() => {
  try {
    const midi = require('@julusian/midi');
    const out = new midi.Output();
    out.openVirtualPort('Flow Keys Smoke');
    out.sendMessage([0x90, 60, 100]); // note on
    out.sendMessage([0x80, 60, 0]);   // note off
    out.closePort();
    console.log('SMOKE_OK: native MIDI virtual port works under Electron');
    app.exit(0);
  } catch (err) {
    console.error('SMOKE_FAIL:', err);
    app.exit(1);
  }
});
