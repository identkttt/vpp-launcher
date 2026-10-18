'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { readJson, writeJson, USER_AGENT } = require('./util');
const { deviceId } = require('./device');
const net = require('./net');

// Accounts on Supabase. The session lives in
// <game dir>/launcher/session.json: the client reads it from there and refreshes it too, so whoever refreshes writes
// the new tokens back for the other.

const REFRESH_EARLY_MS = 120 * 1000;

const ERRORS = {
  bad_login: 'Логин - от 3 до 16 символов: латинские буквы, цифры и _',
  bad_password: 'Пароль - от 6 до 72 символов',
  login_taken: 'Такой логин уже занят',
  invalid_credentials: 'Неверный логин или пароль',
  not_signed_in: 'Войдите в аккаунт',
  no_subscription: 'Нужна активная подписка',
  not_found: 'Нет пользователя с таким логином',
  self: 'Себя в друзья добавить нельзя',
  already: 'Вы уже друзья',
  pending: 'Запрос уже отправлен - ждём ответа',
  too_many: 'Слишком много запросов без ответа',
  missing: 'Запрос уже не актуален',
  not_friends: 'Вы больше не друзья',
  rate_limited: 'Слишком много запросов - подождите немного и попробуйте снова',
  banned: 'Аккаунт или этот компьютер заблокирован',
  other_device: 'Аккаунт привязан к другому компьютеру. Сменили компьютер - напишите в поддержку, привязку сбросят',
  bad_key: 'Такого ключа нет - проверьте, как он введён',
  key_used: 'Этот ключ уже активирован',
};

class CloudError extends Error {
  constructor(code, detail) {
    super(ERRORS[code] || detail || code);
    this.code = code;
  }
}

class Cloud {
  constructor({ config, sessionDir }) {
    const cloud = config.cloud || {};
    this.url = String(cloud.url || '').replace(/\/+$/, '');
    this.anonKey = String(cloud.anonKey || '');
    this.loginDomain = cloud.loginDomain || 'users.invalid';
    this.sessionDir = sessionDir;
    this.refreshing = null;
    this.release = null;
  }

  configured() {
    return !!(this.url && this.anonKey);
  }

  sessionFile() {
    return path.join(this.sessionDir(), 'launcher', 'session.json');
  }

  avatarUrl(avatarPath, version) {
    if (!avatarPath) return null;
    return `${this.url}/storage/v1/object/public/avatars/${avatarPath}?v=${version || 0}`;
  }

  async request(pathname, { method = 'POST', body, token, headers = {}, raw } = {}) {
    if (!this.configured()) throw new CloudError('not_configured', 'Сервер ещё не настроен');
    let res;
    try {
      res = await net.request(this.url + pathname, {
        method,
        headers: {
          apikey: this.anonKey,
          'User-Agent': USER_AGENT,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(raw ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CloudError('network', 'Нет связи с сервером - проверьте интернет');
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const code = data?.error_code || data?.error || data?.code || '';
      const message = String(data?.message || data?.msg || data?.error_description || '');
      if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) throw new CloudError('invalid_credentials');
      for (const known of Object.keys(ERRORS)) {
        if (code === known || message === known) throw new CloudError(known);
      }
      const error = new CloudError(String(code || res.status), message || `Сервер ответил ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  // ------------------------------------------------------------------ session

  async readSession() {
    const session = await readJson(this.sessionFile());
    return session && session.refresh_token ? session : null;
  }

  async saveSession(token, login) {
    const previous = await this.readSession();
    const session = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + (token.expires_in || 3600) * 1000,
      user_id: token.user?.id,
      login: login || token.user?.user_metadata?.login || '',
      url: this.url,
      anon_key: this.anonKey,
    };
    if (previous?.user_id === session.user_id && previous.subscription_until) session.subscription_until = previous.subscription_until;
    await writeJson(this.sessionFile(), session);
    return session;
  }

  // A session good for the next two minutes at least, or null when there is none (or it was revoked)
  async session() {
    if (!this.configured()) return null;
    const session = await this.readSession();
    if (!session) return null;
    if (session.url && session.url !== this.url) return null;
    if (session.expires_at - Date.now() > REFRESH_EARLY_MS) return session;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const token = await this.request('/auth/v1/token?grant_type=refresh_token', {
            body: { refresh_token: session.refresh_token },
          });
          return await this.saveSession(token, session.login);
        } catch (e) {
          if (e.code === 'network') throw e;
          // the client may have refreshed it a moment ago: take what is on disk now
          const latest = await this.readSession();
          if (latest && latest.refresh_token !== session.refresh_token && latest.expires_at - Date.now() > REFRESH_EARLY_MS) {
            return latest;
          }
          await this.forget();
          return null;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async forget() {
    await fsp.rm(this.sessionFile(), { force: true }).catch(() => {});
  }

  async login(login, password) {
    login = String(login || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(login)) throw new CloudError('bad_login');
    if (!password) throw new CloudError('bad_password');
    const token = await this.request('/auth/v1/token?grant_type=password', {
      body: { email: `${login.toLowerCase()}@${this.loginDomain}`, password },
    });
    const session = await this.saveSession(token, login);
    const account = await this.account().catch(() => null);
    if (account?.login && account.login !== session.login) await this.saveSession(token, account.login);
    return account;
  }

  async register(login, password) {
    login = String(login || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(login)) throw new CloudError('bad_login');
    if (String(password || '').length < 6 || String(password).length > 72) throw new CloudError('bad_password');
    await this.request('/functions/v1/register', { body: { login, password }, token: this.anonKey.startsWith('ey') ? this.anonKey : undefined });
    return this.login(login, password);
  }

  async logout() {
    const session = await this.readSession();
    if (session) {
      await this.request('/auth/v1/logout', { token: session.access_token }).catch(() => {});
    }
    await this.forget();
  }

  // ------------------------------------------------------------------ calls as the signed-in player

  async rpc(name, args = {}) {
    return this.call(`/rest/v1/rpc/${name}`, args);
  }

  async call(pathname, args = {}) {
    let session = await this.session();
    if (!session) throw new CloudError('not_signed_in');
    try {
      return await this.request(pathname, { body: args, token: session.access_token });
    } catch (e) {
      if (e.status !== 401) throw e;
      await writeJson(this.sessionFile(), { ...session, expires_at: 0 });
      session = await this.session();
      if (!session) throw new CloudError('not_signed_in');
      return this.request(pathname, { body: args, token: session.access_token });
    }
  }

  async account() {
    const data = await this.rpc('my_account');
    if (!data) return null;
    const until = data.subscription_until ? Date.parse(data.subscription_until) : 0;
    const serverNow = data.now ? Date.parse(data.now) : Date.now();
    const saved = await this.readSession();
    if (saved && (saved.subscription_until !== until || saved.login !== data.login)) {
      await writeJson(this.sessionFile(), { ...saved, subscription_until: until, login: data.login });
    }
    return {
      id: data.id,
      login: data.login,
      avatar: this.avatarUrl(data.avatar, data.avatar_version),
      mcNick: data.mc_nick,
      subscriptionUntil: until || null,
      subscriptionLeftMs: until ? Math.max(0, until - serverNow) : 0,
      subscribed: until > serverNow,
    };
  }

  async friends() {
    const data = await this.rpc('friends_overview');
    const withAvatar = list => (list || []).map(p => ({ ...p, avatar: this.avatarUrl(p.avatar, p.avatar_version) }));
    const now = data?.now ? Date.parse(data.now) : Date.now();
    return {
      friends: withAvatar(data?.friends).map(f => ({
        ...f,
        online: !!(f.seen_at && now - Date.parse(f.seen_at) < 5 * 60 * 1000),
      })),
      incoming: withAvatar(data?.incoming),
      outgoing: withAvatar(data?.outgoing),
    };
  }

  async sendFriendRequest(login) {
    const result = await this.rpc('send_friend_request', { target: String(login || '').trim() });
    if (result === 'sent' || result === 'accepted') return result;
    throw new CloudError(result);
  }

  async respondFriend(id, accept) {
    const result = await this.rpc('respond_friend_request', { requester_id: id, accept: !!accept });
    if (result !== 'ok') throw new CloudError(result);
  }

  async removeFriend(id) {
    const result = await this.rpc('remove_friend', { friend_id: id });
    if (result !== 'ok') throw new CloudError(result);
  }

  async setMarkerVisibility(id, visible) {
    const result = await this.rpc('set_marker_visibility', { friend_id: id, visible: !!visible });
    if (result !== 'ok') throw new CloudError(result);
  }

  // A subscription key (XXXX-XXXX-XXXX, typed any way): its days are added to what is left. { days, until }
  async redeemKey(code) {
    const result = await this.rpc('redeem_key', { code: String(code || '').trim() });
    if (!result?.ok) throw new CloudError(result?.error || 'bad_key');
    return { days: result.days, until: Date.parse(result.until) };
  }

  // The newest client release with the key to decrypt it and a download link that works for a few minutes - given
  // only with an active subscription, and only on the computer the account is tied to (the first one it asked
  // from). Kept for a minute: the launch asks first to check the computer, then again when it gets to the client.
  async clientRelease() {
    if (this.release && Date.now() - this.release.at < 60_000) return this.release.value;
    const value = await this.call('/functions/v1/client-release', { device: await deviceId() });
    this.release = { at: Date.now(), value };
    return value;
  }

  // Opens a game session for this computer; a new one ends the account's other games.
  // { ok: true, session } or { ok: false, reason }
  async startGame(version) {
    return this.rpc('start_game', { device: await deviceId(), version: version || null });
  }

  // A square 256 px PNG of the middle of the picture, so every avatar is light and the same shape everywhere
  async uploadAvatar(png) {
    const session = await this.session();
    if (!session) throw new CloudError('not_signed_in');
    const objectPath = `${session.user_id}/avatar.png`;
    await this.request(`/storage/v1/object/avatars/${objectPath}`, {
      method: 'POST', raw: true, body: png, token: session.access_token,
      headers: { 'Content-Type': 'image/png', 'x-upsert': 'true', 'Cache-Control': 'max-age=60' },
    });
    await this.rpc('set_avatar', { path: objectPath });
    return this.account();
  }
}

module.exports = { Cloud, CloudError };
