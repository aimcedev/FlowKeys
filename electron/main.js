const { app, BrowserWindow, protocol, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const virtualMidi = require('./virtualMidi');

// The existing web app lives one level up and is served unchanged.
const ROOT = path.join(__dirname, '..');
const SCHEME = 'app';

// Register a custom scheme as standard + secure BEFORE app is ready. Serving the
// app over a standard origin (rather than file://) is what makes ES module
// imports, Web Workers, and fetch behave exactly as they do in a browser —
// file:// breaks module loading and worker instantiation in Chromium.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    // Strip query strings (cache-busting ?v=NN) and decode; default to index.html.
    let pathname = decodeURIComponent(url.pathname);
    if (!pathname || pathname === '/') pathname = '/index.html';

    const filePath = path.normalize(path.join(ROOT, pathname));
    // Path-traversal guard — never serve anything outside ROOT.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        headers: {
          'content-type': mimeFor(filePath),
          'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Critical for a live performance tool: never throttle timers or rendering
      // when the window is backgrounded. This removes the whole class of timing
      // issues the browser build guards against with the Worker clock.
      backgroundThrottling: false,
    },
  });
  win.loadURL(`${SCHEME}://bundle/index.html`);
  return win;
}

app.whenReady().then(() => {
  // Grant Web MIDI — the renderer still uses Web MIDI for normal device I/O.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'midi' || permission === 'midiSysex');
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return permission === 'midi' || permission === 'midiSysex';
  });

  registerProtocol();

  // IPC: create the virtual port on request, and forward outgoing MIDI bytes.
  ipcMain.handle('flowkeys:createVirtualPort', (_e, name) => virtualMidi.createVirtualPort(name));
  ipcMain.on('flowkeys:midiSend', (_e, bytes) => virtualMidi.send(bytes));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  virtualMidi.closePort();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => virtualMidi.closePort());
