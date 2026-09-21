import { SUSTAIN_CC } from '../utils/midiConstants.js';

// Sentinel output id for the native virtual MIDI port (Electron host only).
// Selected like any Web MIDI output, but routed through a native send function
// instead of a Web MIDI port. Never present in a plain browser.
export const VIRTUAL_OUTPUT_ID = '__flowkeys_virtual__';

export class MidiManager {
  constructor() {
    this.midiAccess = null;
    this.inputs = new Map();
    this.outputs = new Map();

    this.selectedInputId = null;
    this.selectedOutputId = null;
    this._lastOutputName = null; // used for name-based re-match after device reconnect

    // Native virtual MIDI output (Electron host only). When _nativeOutputActive
    // is true, outgoing MIDI is routed through _nativeSend instead of a Web MIDI
    // port. These stay inert in a browser, where enableNativeOutput is never
    // called and _nativeAvailable remains false.
    this._nativeAvailable = false;
    this._nativeOutputActive = false;
    this._nativeSend = null;
    this._virtualPortName = null;

    // Callbacks
    this.onMessageCallback = null;
    this.onStateChangeCallback = null;
    this._inputActivityCb = null;
    this._outputActivityCb = null;
    this._outputDisconnectCb = null;
    this._outputReconnectCb = null;

    // Cache bound handler so _applyInputListeners doesn't allocate a new
    // function object on every device connect/disconnect event.
    this._boundHandler = this.handleMidiMessage.bind(this);
  }

  async initialize() {
    try {
      if (navigator.requestMIDIAccess) {
        this.midiAccess = await navigator.requestMIDIAccess();
        this.updateDevices();
        
        // Listen for device connect/disconnect
        this.midiAccess.onstatechange = (e) => {
          this.updateDevices();
          if (this.onStateChangeCallback) {
            this.onStateChangeCallback(this.inputs, this.outputs);
          }
        };
        return true;
      } else {
        console.warn('Web MIDI API not supported in this browser.');
        return false;
      }
    } catch (err) {
      console.error('MIDI Access denied or failed:', err);
      return false;
    }
  }

  updateDevices() {
    this.inputs = this.midiAccess.inputs;
    this.outputs = this.midiAccess.outputs;

    // If the selected output vanished, attempt a name-based re-match. This
    // covers the common case where a USB replug gives the device a new ID.
    // The native virtual port lives outside this.outputs, so skip it here.
    if (this.selectedOutputId && !this._nativeOutputActive && !this.outputs.has(this.selectedOutputId)) {
      const match = this._lastOutputName
        ? Array.from(this.outputs.values()).find(o => o.name === this._lastOutputName)
        : null;
      if (match) {
        this.selectedOutputId = match.id;
        if (this._outputReconnectCb) this._outputReconnectCb(match);
      } else {
        this.selectedOutputId = null;
        if (this._outputDisconnectCb) this._outputDisconnectCb(this._lastOutputName);
      }
    }

    // Re-apply listeners when devices connect/disconnect so "any" mode picks up new hardware
    this._applyInputListeners();
  }

  setInput(id) {
    // id = '' or null → listen to all devices ("any" mode)
    this.selectedInputId = id || null;
    this._applyInputListeners();
  }

  // Register a native virtual MIDI output port (Electron host only). Called once
  // at startup. No-op in a browser, where it is never invoked.
  enableNativeOutput(portName, sendFn) {
    this._nativeAvailable = true;
    this._virtualPortName = portName;
    this._nativeSend = sendFn;
    // Re-apply input listeners so our own virtual port is excluded from "any" mode.
    this._applyInputListeners();
  }

  hasNativeOutput() {
    return this._nativeAvailable;
  }

  _applyInputListeners() {
    const handler = this._boundHandler;

    // In "any" mode, exclude input ports that share a name with the selected output
    // to prevent feedback loops (e.g. IAC Driver appearing as both input and output).
    let loopbackName = null;
    if (!this.selectedInputId && this.selectedOutputId && this.outputs.has(this.selectedOutputId)) {
      loopbackName = this.outputs.get(this.selectedOutputId).name;
    }

    for (const input of this.inputs.values()) {
      input.onmidimessage = null;
      const shouldListen = !this.selectedInputId || input.id === this.selectedInputId;
      const isLoopback = loopbackName && input.name === loopbackName;
      // Never listen to our own native virtual port — it surfaces as an input in
      // Electron and would feed our output straight back in, creating a loop.
      const isOwnVirtual = this._virtualPortName && input.name === this._virtualPortName;
      if (shouldListen && !isLoopback && !isOwnVirtual) input.onmidimessage = handler;
    }
  }

  setOutput(id) {
    this.selectedOutputId = id;
    this._nativeOutputActive = (id === VIRTUAL_OUTPUT_ID);
    // Track the name so we can re-match by name if the device reconnects with a new ID
    if (id && !this._nativeOutputActive && this.outputs.has(id)) {
      this._lastOutputName = this.outputs.get(id).name;
    }
    // Re-apply input listeners so the new output is excluded from "any" mode
    if (!this.selectedInputId) this._applyInputListeners();
  }

  handleMidiMessage(event) {
    if (this._inputActivityCb) this._inputActivityCb();
    if (this.onMessageCallback) {
      // Use the actual source port ID so MIDI mappings can match the right device
      // even when listening to all devices simultaneously.
      this.onMessageCallback(event, event.target?.id ?? this.selectedInputId);
    }
  }

  onMidiMessage(callback) {
    this.onMessageCallback = callback;
  }

  onStateChange(callback) {
    this.onStateChangeCallback = callback;
  }

  onInputActivity(callback) {
    this._inputActivityCb = callback;
  }

  onOutputActivity(callback) {
    this._outputActivityCb = callback;
  }

  onOutputDisconnect(callback) {
    this._outputDisconnectCb = callback;
  }

  onOutputReconnect(callback) {
    this._outputReconnectCb = callback;
  }

  _safeSend(output, data, when) {
    try {
      // `when` is a performance.now()-timeline timestamp. Web MIDI dispatches the
      // bytes at that exact moment; undefined / 0 / past values send immediately,
      // so callers that don't schedule ahead behave exactly as before.
      output.send(data, when);
    } catch (e) {
      // Device disconnected mid-performance — ignore silently
    }
  }

  // Single dispatch point for all outgoing MIDI. Routes to the native virtual
  // port when active, otherwise to the selected Web MIDI output. With no native
  // output in use (the browser case), behavior is identical to before.
  //
  // `when` (optional) is the precise time the message should sound. The Web MIDI
  // path passes it straight to output.send() for sample-accurate dispatch. The
  // native path (node `midi`, no timestamp arg) honours it with a timer so the
  // two transports stay aligned.
  _emit(bytes, when) {
    if (this._nativeOutputActive) {
      if (this._nativeSend) {
        const dispatch = () => {
          try {
            this._nativeSend(bytes);
          } catch (e) {
            // Native port closed — ignore silently
          }
          if (this._outputActivityCb) this._outputActivityCb();
        };
        const delay = when ? when - performance.now() : 0;
        if (delay > 1) setTimeout(dispatch, delay);
        else dispatch();
      }
      return;
    }
    if (!this.selectedOutputId) return;
    const output = this.outputs.get(this.selectedOutputId);
    if (output) {
      this._safeSend(output, bytes, when);
      if (this._outputActivityCb) this._outputActivityCb();
    }
  }

  sendNoteOn(channel, note, velocity, when) {
    this._emit([0x90 + (channel - 1), note, velocity], when);
  }

  sendNoteOff(channel, note, when) {
    this._emit([0x80 + (channel - 1), note, 0], when);
  }

  sendNoteMessage(channel, status, note, velocity, when) {
    const cmd = status >> 4;
    this._emit([(cmd << 4) | (channel - 1), note, velocity], when);
  }

  sendRawMessage(channel, status, data1, data2, when) {
    const cmd = status >> 4;
    if (data2 !== undefined) {
      this._emit([(cmd << 4) | (channel - 1), data1, data2], when);
    } else {
      this._emit([(cmd << 4) | (channel - 1), data1], when);
    }
  }

  sendCC(channel, cc, value, when) {
    this._emit([0xB0 + (channel - 1), cc, value], when);
  }

  // Single-byte System Realtime message (clock tick / start / continue / stop).
  // Routes through _emit() so it follows the same native/Web-MIDI selection.
  sendRealtime(statusByte, when) {
    this._emit([statusByte], when);
  }

  sendPanic() {
    // Send All Notes Off (CC 123) and Sustain Pedal Off (CC 64) for all 16 channels.
    // Sweep twice: once now, and once a little past the clock's lookahead window —
    // tempo modules may have committed note-ons with timestamps slightly in the
    // future, and the delayed sweep guarantees those get silenced too.
    const sweep = (when) => {
      for (let ch = 0; ch < 16; ch++) {
        this._emit([0xB0 + ch, 123, 0], when);           // All Notes Off
        this._emit([0xB0 + ch, SUSTAIN_CC, 0], when);    // Sustain off
      }
    };
    sweep();
    sweep(performance.now() + 60);
  }

  getInputs() {
    return Array.from(this.inputs.values());
  }

  getOutputs() {
    return Array.from(this.outputs.values());
  }
}
