'use strict';

const path = require('path');
const { cachedJson, rulesAllow, mavenPath, mavenKey } = require('./util');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES_URL = 'https://resources.download.minecraft.net';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const FABRIC_MAVEN = 'https://maven.fabricmc.net';

async function vanillaVersion(root, id, signal) {
  const manifest = await cachedJson(MANIFEST_URL, path.join(root, 'versions', 'version_manifest_v2.json'), { signal });
  const entry = manifest.versions.find(v => v.id === id);
  if (!entry) throw new Error(`Mojang не знает версию ${id}`);
  return cachedJson(entry.url, path.join(root, 'versions', id, `${id}.json`), { sha1: entry.sha1, signal });
}

async function fabricProfile(root, mc, loader, signal) {
  const id = `fabric-loader-${loader}-${mc}`;
  const url = `${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/profile/json`;
  return cachedJson(url, path.join(root, 'versions', id, `${id}.json`), { signal });
}

// The game's own files: the client jar, the libraries this machine needs and the log setup
function vanillaTasks(root, version) {
  const tasks = [];
  const client = version.downloads.client;
  tasks.push({
    url: client.url, sha1: client.sha1, size: client.size, deep: true,
    file: path.join(root, 'versions', version.id, `${version.id}.jar`),
  });
  for (const lib of version.libraries) {
    if (!rulesAllow(lib.rules)) continue;
    const artifact = lib.downloads?.artifact;
    if (!artifact) continue;
    tasks.push({
      url: artifact.url, sha1: artifact.sha1, size: artifact.size, deep: true,
      file: path.join(root, 'libraries', artifact.path), key: mavenKey(lib.name), library: true,
      seed: { kind: 'libraries', rel: artifact.path },
    });
  }
  const logging = version.logging?.client?.file;
  if (logging) {
    tasks.push({
      url: logging.url, sha1: logging.sha1, size: logging.size,
      file: path.join(root, 'assets', 'log_configs', logging.id),
    });
  }
  return tasks;
}

async function assetTasks(root, version, signal) {
  const ref = version.assetIndex;
  const index = await cachedJson(ref.url, path.join(root, 'assets', 'indexes', `${ref.id}.json`), { sha1: ref.sha1, signal });
  const seen = new Set();
  const tasks = [];
  for (const object of Object.values(index.objects)) {
    if (seen.has(object.hash)) continue;
    seen.add(object.hash);
    const sub = object.hash.slice(0, 2);
    tasks.push({
      url: `${RESOURCES_URL}/${sub}/${object.hash}`, sha1: object.hash, size: object.size,
      file: path.join(root, 'assets', 'objects', sub, object.hash),
      seed: { kind: 'assets', rel: `objects/${sub}/${object.hash}` },
    });
  }
  return tasks;
}

function fabricTasks(root, profile) {
  return profile.libraries.map(lib => {
    const rel = mavenPath(lib.name);
    const base = (lib.url || `${FABRIC_MAVEN}/`).replace(/\/?$/, '/');
    return {
      url: base + rel, sha1: lib.sha1, size: lib.size, deep: !!lib.sha1,
      file: path.join(root, 'libraries', ...rel.split('/')), key: mavenKey(lib.name), library: true,
      seed: { kind: 'libraries', rel },
    };
  });
}

// The vanilla libraries, with whatever Fabric brings of its own in place of the same artifact
function classpath(root, version, vanilla, fabric) {
  const fabricKeys = new Set(fabric.map(t => t.key));
  const entries = [];
  for (const t of fabric) entries.push(t.file);
  for (const t of vanilla) {
    if (t.library && !fabricKeys.has(t.key)) entries.push(t.file);
  }
  entries.push(path.join(root, 'versions', version.id, `${version.id}.jar`));
  return [...new Set(entries)];
}

function expandArguments(list, features, vars) {
  const out = [];
  for (const arg of list || []) {
    if (typeof arg === 'string') {
      out.push(arg);
    } else if (rulesAllow(arg.rules, features)) {
      out.push(...(Array.isArray(arg.value) ? arg.value : [arg.value]));
    }
  }
  return out.map(a => a.replace(/\$\{([a-zA-Z_]+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m)));
}

module.exports = {
  vanillaVersion, fabricProfile, vanillaTasks, assetTasks, fabricTasks, classpath, expandArguments, FABRIC_MAVEN,
};
