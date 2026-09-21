// Native virtual MIDI output port (CoreMIDI on macOS, ALSA on Linux).
//
// Output.openVirtualPort creates a system-wide MIDI *source* — DAWs and other
// apps see it as an input named e.g. "Flow Keys Out" they can record from. No
// IAC Driver setup is required. The renderer forwards its outgoing MIDI bytes
// to this module over IPC; the renderer cannot send here via Web MIDI because a
// virtual source surfaces as an *input* on the Web MIDI side.
//
// Windows has no OS-level virtual MIDI, so openVirtualPort will throw there;
// callers treat a failed createVirtualPort() as "feature unavailable" and fall
// back to normal Web MIDI / IAC Driver behavior.

let midi = null;
let output = null;
let portName = null;

function createVirtualPort(name) {
  try {
    if (output) return { ok: true, name: portName, already: true };
    if (!midi) midi = require('@julusian/midi');
    output = new midi.Output();
    output.openVirtualPort(name);
    portName = name;
    return { ok: true, name };
  } catch (err) {
    output = null;
    portName = null;
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function send(bytes) {
  if (!output || !Array.isArray(bytes)) return;
  try {
    output.sendMessage(bytes);
  } catch (err) {
    // Port closed or malformed packet — ignore so a bad message can't crash main.
  }
}

function closePort() {
  if (output) {
    try {
      output.closePort();
    } catch (err) {
      // ignore
    }
    output = null;
    portName = null;
  }
}

module.exports = { createVirtualPort, send, closePort };
