'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { exists, readJson, writeJson, fetchText } = require('./util');
const { readModInfo } = require('./zip');
const { FABRIC_MAVEN } = require('./minecraft');

async function jarVersion(file) {
  try {
    const mod = await readModInfo(file);
    return mod?.info?.version || null;
  } catch {
    return null;
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// A release file is [12 bytes IV][AES-256-GCM ciphertext][16 bytes tag]. The tag fails on any changed byte, and
// the jar's own sha256 is checked on top, so what lands in the jar is exactly what was published.
async function decryptRelease(source, target, release) {
  const data = await fsp.readFile(source);
  let jar;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(release.key, 'base64'), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(data.length - 16));
    jar = Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]);
  } catch {
    jar = null;
  }
  if (!jar || crypto.createHash('sha256').update(jar).digest('hex') !== release.sha256) {
    await fsp.rm(source, { force: true });
    throw new Error('Клиент скачался с ошибкой - запустите ещё раз');
  }
  const tmp = target + '.tmp';
  await fsp.writeFile(tmp, jar);
  await fsp.rename(tmp, target);
}

// The client jar the game gets. Releases lie encrypted in the open. The installed jar is checked against the
// release's sha256 before every start, so a changed or broken one is fetched again. Offline, the installed jar
// still starts if it is the one that was checked last time. VANILLA_CLIENT_JAR puts another jar in its place - for
// trying a fresh build, never for players. Returns tasks to download (if any) and what to do once they are done.
async function resolveClient({ root, cloud, signal }) {
  const dir = path.join(root, 'launcher');
  const target = path.join(dir, 'client.jar');
  const stateFile = path.join(dir, 'client.json');
  const current = await readJson(stateFile, {});

  const override = process.env.VANILLA_CLIENT_JAR;
  if (override) {
    if (!await exists(override)) throw new Error(`Файл клиента не найден: ${override}`);
    return { file: override, version: await jarVersion(override), source: 'custom', tasks: [] };
  }

  let release = null;
  try {
    release = await cloud.clientRelease();
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e.code !== 'network') throw e;
    if (current.sha256 && await exists(target) && await sha256File(target) === current.sha256) {
      return { file: target, version: current.version, source: 'installed', tasks: [] };
    }
    throw new Error('Нет связи - не получилось скачать клиент');
  }
  if (!release?.url) throw new Error('На сервере пока нет клиента');

  if (await exists(target) && await sha256File(target) === release.sha256) {
    if (current.version !== release.version || current.sha256 !== release.sha256) {
      await writeJson(stateFile, { version: release.version, sha256: release.sha256 });
    }
    return { file: target, version: release.version, source: 'remote', changelog: release.changelog, tasks: [] };
  }
  await fsp.mkdir(dir, { recursive: true });
  const encrypted = path.join(dir, `client-${release.version}.bin`);
  return {
    file: target, version: release.version, source: 'remote', changelog: release.changelog,
    tasks: [{ url: release.url, size: release.size, file: encrypted }],
    after: async () => {
      await decryptRelease(encrypted, target, release);
      await fsp.rm(encrypted, { force: true });
      await writeJson(stateFile, { version: release.version, sha256: release.sha256 });
    },
  };
}

async function fabricApiTask(root, version, signal) {
  const rel = `net/fabricmc/fabric-api/fabric-api/${version}/fabric-api-${version}.jar`;
  const file = path.join(root, 'launcher', `fabric-api-${version}.jar`);
  const sha1File_ = path.join(root, 'launcher', `fabric-api-${version}.jar.sha1`);
  let sha1 = null;
  try {
    sha1 = (await fsp.readFile(sha1File_, 'utf8')).trim();
  } catch {
    try {
      sha1 = (await fetchText(`${FABRIC_MAVEN}/${rel}.sha1`, { signal })).trim().slice(0, 40);
      await fsp.mkdir(path.dirname(sha1File_), { recursive: true });
      await fsp.writeFile(sha1File_, sha1);
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  return { url: `${FABRIC_MAVEN}/${rel}`, sha1, file, deep: !!sha1 };
}

module.exports = { resolveClient, fabricApiTask, jarVersion, decryptRelease, sha256File };
