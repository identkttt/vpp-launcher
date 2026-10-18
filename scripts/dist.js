'use strict';

// Builds:
//  1) app dir → zip payload (for installer)
//  2) sakura-styled Electron installer (VanillaPlus-*-x64.exe)
//  3) portable .exe + portable .zip
const { spawnSync } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const appOut = path.join(root, 'dist-app');
const releaseOut = path.join(root, 'dist-release');
const payloadZip = path.join(root, 'build', 'payload.zip');
const pkg = require('../package.json');

function run(cmd, args, env = {}) {
  console.log('>', cmd, args.join(' '));
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...env },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

async function zipPayload() {
  const unpacked = path.join(appOut, 'win-unpacked');
  if (!fs.existsSync(path.join(unpacked, 'Vanilla++.exe'))) {
    throw new Error('Нет dist-app/win-unpacked/Vanilla++.exe');
  }
  await fsp.mkdir(path.dirname(payloadZip), { recursive: true });
  await fsp.rm(payloadZip, { force: true });
  // tar on Windows 10+ can write zip; archive the contents, not the folder name
  run('tar', ['-a', '-cf', payloadZip, '-C', unpacked, '.']);
  const mb = (fs.statSync(payloadZip).size / 1048576).toFixed(1);
  console.log(`payload.zip · ${mb} МБ`);
}

async function zipPortable() {
  const unpacked = path.join(appOut, 'win-unpacked');
  const outZip = path.join(releaseOut, `VanillaPlus-${pkg.version}-portable.zip`);
  if (!fs.existsSync(path.join(unpacked, 'Vanilla++.exe'))) {
    throw new Error('Нет dist-app/win-unpacked/Vanilla++.exe');
  }
  await fsp.mkdir(releaseOut, { recursive: true });
  await fsp.rm(outZip, { force: true });

  const stage = path.join(os.tmpdir(), `vpp-portable-zip-${pkg.version}`);
  const inner = path.join(stage, 'Vanilla++');
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(inner, { recursive: true });
  // robocopy is fastest on Windows for large Electron trees (exit 0–7 = success)
  const copy = spawnSync(
    'robocopy',
    [unpacked, inner, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'],
    { cwd: root, stdio: 'inherit', shell: true },
  );
  if ((copy.status ?? 1) >= 8) {
    console.error('robocopy failed', copy.status);
    process.exit(1);
  }
  run('tar', ['-a', '-cf', outZip, '-C', stage, 'Vanilla++']);
  await fsp.rm(stage, { recursive: true, force: true });
  const mb = (fs.statSync(outZip).size / 1048576).toFixed(1);
  console.log(`portable.zip · ${mb} МБ → ${path.basename(outZip)}`);
}

async function main() {
  await fsp.rm(appOut, { recursive: true, force: true });
  await fsp.mkdir(releaseOut, { recursive: true });

  run('npx', [
    'electron-builder', '--win', '--dir',
    `--config.directories.output=${appOut}`,
  ]);

  await zipPayload();
  await zipPortable();

  run('npx', [
    'electron-builder', '--win', 'portable',
    '--config', 'electron-builder.setup.json',
  ]);

  run('npx', [
    'electron-builder', '--win', 'portable',
    `--config.directories.output=${releaseOut}`,
    '--config.portable.artifactName=VanillaPlus-${version}-portable.${ext}',
  ]);

  console.log('\nГотово:');
  for (const name of await fsp.readdir(releaseOut)) {
    if (!/\.(exe|zip)$/i.test(name)) continue;
    const size = (fs.statSync(path.join(releaseOut, name)).size / 1048576).toFixed(1);
    console.log(`  ${name} · ${size} МБ`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
