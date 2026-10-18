'use strict';

// Installs (and with --launch, starts) the game the way the loader does, without its window.
// usage: node scripts/test-install.js [--root dir] [--launch] [--seconds N]
//   JAVA_PATH=...   use this Java instead of Mojang's
//   VANILLA_SEED_ASSETS / VANILLA_SEED_LIBRARIES  extra folders to take files from instead of downloading
const path = require('path');
const game = require('../src/main/game');
const config = require('../launcher.config.json');
const { formatBytes } = require('../src/main/util');

const argv = process.argv.slice(2);
const opt = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const root = path.resolve(opt('--root') || path.join(__dirname, '..', '.test-game'));
const settings = {
  javaMode: process.env.JAVA_PATH ? 'custom' : 'bundled',
  javaPath: process.env.JAVA_PATH || '',
  ram: 3, width: 1280, height: 720, fullscreen: false,
};

(async () => {
  const started = Date.now();
  let lastLine = '';
  const prepared = await game.prepare({
    root, config, settings,
    report: p => {
      let line = `[${p.stage}] ${p.text}`;
      if (p.stage === 'download') line += ` ${formatBytes(p.done)} / ${formatBytes(p.total)} (${p.files}/${p.count})`;
      else if (p.total) line += ` ${p.done}/${p.total}`;
      if (line !== lastLine && (p.stage !== 'download' || Date.now() % 7 === 0 || p.files === p.count)) console.log(line);
      lastLine = line;
    },
  });
  console.log(`prepared in ${((Date.now() - started) / 1000).toFixed(1)}s, downloaded ${prepared.downloaded} files`);
  console.log('java:', prepared.javaPath);
  const command = game.buildCommand({ root, prepared, settings, account: game.accountFor('Player'), server: opt('--server') });
  console.log('args:', command.args.filter(a => !a.includes(path.delimiter) || a.length < 200).join(' ').slice(0, 3000));
  if (!argv.includes('--launch')) return;
  const { child } = await game.start({ root, prepared, settings, account: game.accountFor('Player'), server: opt('--server') });
  const seconds = +(opt('--seconds') || 90);
  child.stdout.on('data', d => process.stdout.write(d));
  child.stderr.on('data', d => process.stderr.write(d));
  const timer = setTimeout(() => { console.log(`--- stopping after ${seconds}s`); child.kill(); }, seconds * 1000);
  child.on('exit', code => { clearTimeout(timer); console.log('--- game exited with', code); });
})().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});
