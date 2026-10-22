'use strict';

const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Which computer this is: a hash of the Windows machine id (made when Windows is installed)
// and the firmware UUID (the motherboard's), never the ids themselves. Changing the registry's machine id alone
// does not make another computer. The same inputs always name the same computer.
let cached = null;

function registry(key, value, pattern) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve('');
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      const match = !error && pattern.exec(String(stdout));
      resolve(match ? match[1].toLowerCase() : '');
    });
  });
}

async function deviceId() {
  if (cached) return cached;
  const [guid, firmware] = await Promise.all([
    registry('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid', /MachineGuid\s+REG_SZ\s+(\S+)/i),
    registry('HKLM\\SYSTEM\\HardwareConfig', 'LastConfig', /LastConfig\s+REG_SZ\s+\{?([0-9A-Fa-f-]+)\}?/),
  ]);
  let source = `${guid}|${firmware}`;
  if (!guid && !firmware) {
    const host = process.env.COMPUTERNAME || os.hostname();
    const user = process.env.USERNAME || os.userInfo().username;
    source = `${host}/${user}`.toLowerCase();
  }
  cached = crypto.createHash('sha256').update(`vanilla-device:${source}`).digest('hex');
  return cached;
}

module.exports = { deviceId };
