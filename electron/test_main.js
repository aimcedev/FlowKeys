const e = require('electron');
console.log('type:', typeof e);
if (typeof e === 'object' && e) {
  console.log('app:', typeof e.app);
  console.log('BrowserWindow:', typeof e.BrowserWindow);
} else {
  console.log('value:', e);
}
process.exit(0);
