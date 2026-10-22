'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const VERSION = require('../../package.json').version;
const UNINSTALL_REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VanillaPlus';
const APP_NAME = 'Vanilla++';

let win = null;

function installDir() {
  return path.dirname(process.execPath);
}

function quote(p) {
  return `"${String(p).replace(/"/g, '')}"`;
}

async function removeLinks() {
  const menu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', APP_NAME);
  await fsp.rm(menu, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(path.join(path.dirname(menu), `${APP_NAME}.lnk`), { force: true }).catch(() => {});
  await fsp.rm(path.join(app.getPath('desktop'), `${APP_NAME}.lnk`), { force: true }).catch(() => {});
}

function scheduleWipe(extraDirs) {
  const install = installDir();
  const lines = [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    'taskkill /f /im "Vanilla++.exe" >nul 2>&1',
    'timeout /t 1 /nobreak >nul',
    `rmdir /s /q ${quote(install)}`,
  ];
  for (const dir of extraDirs) {
    if (dir && path.resolve(dir) !== path.resolve(install)) lines.push(`rmdir /s /q ${quote(dir)}`);
  }
  const script = path.join(app.getPath('temp'), 'vanilla-plus-uninstall.cmd');
  fs.writeFileSync(script, lines.join('\r\n'), 'utf8');
  spawn('cmd.exe', ['/c', 'start', '', '/min', script], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

async function run({ wipe, gameDir }) {
  await removeLinks();
  spawn('reg', ['delete', UNINSTALL_REG, '/f'], { windowsHide: true, stdio: 'ignore' }).unref();
  const extra = [];
  if (wipe) {
    extra.push(app.getPath('userData'));
    if (gameDir) extra.push(gameDir);
  }
  scheduleWipe(extra);
  setTimeout(() => app.quit(), 350);
  return true;
}

function open(info) {
  win = new BrowserWindow({
    width: 920,
    height: 560,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#120a0e',
    title: `${APP_NAME} — удаление`,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'setup', 'uninstall-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', 'setup', 'uninstall.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  const reply = fn => ipcMain.handle('uninstall:run', async (_e, opts) => {
    try {
      return { ok: true, value: await fn(opts || {}) };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle('uninstall:info', async () => ({
    ok: true,
    value: {
      version: VERSION,
      installDir: installDir(),
      sakura: info.sakura,
      logo: info.logo,
    },
  }));
  reply(opts => run({ wipe: !!opts.wipe, gameDir: info.gameDir }));
  ipcMain.handle('uninstall:close', () => app.quit());
  ipcMain.handle('uninstall:minimize', () => win?.minimize());
}

module.exports = { open, run };
