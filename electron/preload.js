const { contextBridge, ipcRenderer } = require('electron');

// Minimal, capability-scoped bridge between the renderer and the native MIDI
// layer in the main process. The renderer feature-detects window.flowKeysNative;
// when it is absent (a plain browser), the app falls back to Web MIDI / IAC
// Driver with no behavior change.
contextBridge.exposeInMainWorld('flowKeysNative', {
  // Create the system-wide virtual output port. Returns { ok, name } or { ok:false, error }.
  createVirtualPort: (name) => ipcRenderer.invoke('flowkeys:createVirtualPort', name),
  // Forward outgoing MIDI bytes (array of status/data bytes) to the native port.
  send: (bytes) => ipcRenderer.send('flowkeys:midiSend', bytes),
});
