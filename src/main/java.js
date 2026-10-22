'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { cachedJson, exists } = require('./util');

const RUNTIMES_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function platform() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  if (process.arch === 'arm64') return 'linux-arm64';
  if (process.arch === 'ia32') return 'linux-i386';
  return 'linux';
}

function runtimeHome(root, component) {
  return path.join(root, 'runtime', component, platform(), component);
}

function javaExecutable(home) {
  if (process.platform === 'win32') return path.join(home, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(home, 'bin', 'java');
}

// The same Java the official launcher gives the game: Mojang's own build, file by file
async function runtimeTasks(root, javaVersion, signal) {
  const component = javaVersion?.component || 'java-runtime-epsilon';
  const index = await cachedJson(RUNTIMES_URL, path.join(root, 'runtime', 'all.json'), { signal });
  const entry = index[platform()]?.[component]?.[0];
  if (!entry) throw new Error(`Mojang не выпускает Java «${component}» для ${platform()}`);
  const manifest = await cachedJson(entry.manifest.url, path.join(root, 'runtime', `${component}.${platform()}.json`),
    { sha1: entry.manifest.sha1, signal });
  const home = runtimeHome(root, component);
  const tasks = [];
  const executables = [];
  for (const [rel, file] of Object.entries(manifest.files)) {
    if (file.type !== 'file') continue;
    const raw = file.downloads?.raw;
    if (!raw) continue;
    const target = path.join(home, ...rel.split('/'));
    tasks.push({ url: raw.url, sha1: raw.sha1, size: raw.size, file: target });
    if (file.executable) executables.push(target);
  }
  return { component, version: entry.version?.name, home, java: javaExecutable(home), tasks, executables };
}

async function markExecutable(files) {
  if (process.platform === 'win32') return;
  await Promise.all(files.map(f => fsp.chmod(f, 0o755).catch(() => {})));
}

async function checkCustomJava(file) {
  if (!file) throw new Error('Не указан путь к Java');
  if (!await exists(file)) throw new Error(`Java не найдена: ${file}`);
  return file;
}

module.exports = { runtimeTasks, markExecutable, checkCustomJava, platform };
