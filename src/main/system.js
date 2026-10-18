'use strict';

const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const GB = 1024 ** 3;
const SIZES = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64, 96, 128, 192, 256];
let installed = null;
let reading = null;

// Windows keeps a little for itself (and the graphics chip), so what it can use is just under what is installed
function estimate() {
  const usable = os.totalmem() / GB;
  return SIZES.find(size => size >= usable - 0.05) || Math.ceil(usable);
}

// What is printed on the memory sticks: Windows reports a little less as usable, the sticks know better
function readInstalled() {
  if (installed !== null) return Promise.resolve(installed);
  if (reading) return reading;
  reading = new Promise(resolve => {
    if (process.platform !== 'win32') {
      installed = estimate();
      resolve(installed);
      return;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum'],
    { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      const bytes = parseInt(String(stdout).trim(), 10);
      installed = !err && bytes > 0 ? bytes / GB : estimate();
      resolve(installed);
    });
  });
  return reading;
}

// Without waiting: until the sticks have answered, what Windows can use stands in for them
async function memory({ wait = true } = {}) {
  const usable = os.totalmem() / GB;
  return {
    installed: wait ? await readInstalled() : (installed ?? estimate()),
    exact: installed !== null,
    usable,
    free: os.freemem() / GB,
  };
}

// UUID.nameUUIDFromBytes("OfflinePlayer:" + name): what a server in offline mode calls the player
function offlineUuid(name) {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

module.exports = { memory, readInstalled, offlineUuid };
