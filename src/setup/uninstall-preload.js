'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld('uninstall', {
  info: () => call('uninstall:info'),
  run: opts => call('uninstall:run', opts),
  close: () => call('uninstall:close'),
  minimize: () => call('uninstall:minimize'),
});
