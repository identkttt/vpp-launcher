'use strict';

const { CloudError } = require('./cloud');

// VANILLA_CLOUD_MOCK=1: a pretend server in memory, for working on the account screens without a Supabase project
class MockCloud {
  constructor() {
    const day = 24 * 3600 * 1000;
    this.signedIn = process.env.VANILLA_CLOUD_MOCK !== 'signed-out';
    this.me = { id: 'me', login: 'kotokroll', avatar: null, mcNick: 'kotokroll', subscriptionUntil: Date.now() + 23 * day + 5 * 3600 * 1000 };
    if (process.env.VANILLA_CLOUD_MOCK === 'expired') this.me.subscriptionUntil = Date.now() - day;
    this.state = {
      friends: [
        { id: 'f1', login: 'Kolya', avatar: null, mc_nick: 'Kolya_PvP', server: 'mc.funtime.su', online: true, sees_my_markers: true },
        { id: 'f2', login: 'sakura_main', avatar: null, mc_nick: 'SoftFox_42', server: null, online: false, sees_my_markers: false },
      ],
      incoming: [{ id: 'r1', login: 'DarkRaven', avatar: null }],
      outgoing: [{ id: 'r2', login: 'night_byte', avatar: null }],
    };
  }

  configured() { return true; }
  async session() { return this.signedIn ? { login: this.me.login, user_id: 'me' } : null; }

  async login(login, password) {
    if (password !== 'vanilla') throw new CloudError('invalid_credentials');
    this.signedIn = true;
    this.me.login = login;
    return this.account();
  }

  async register(login, password) {
    if (login.toLowerCase() === 'kolya') throw new CloudError('login_taken');
    if (String(password).length < 6) throw new CloudError('bad_password');
    this.signedIn = true;
    this.me.login = login;
    this.me.subscriptionUntil = null;
    return this.account();
  }

  async logout() { this.signedIn = false; }

  async account() {
    if (!this.signedIn) throw new CloudError('not_signed_in');
    const until = this.me.subscriptionUntil;
    return {
      id: 'me', login: this.me.login, avatar: this.me.avatar, mcNick: this.me.mcNick,
      subscriptionUntil: until, subscriptionLeftMs: until ? Math.max(0, until - Date.now()) : 0, subscribed: !!until && until > Date.now(),
    };
  }

  async friends() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async sendFriendRequest(login) {
    if (login.toLowerCase() === this.me.login.toLowerCase()) throw new CloudError('self');
    if (this.state.friends.some(f => f.login.toLowerCase() === login.toLowerCase())) throw new CloudError('already');
    if (login.toLowerCase() === 'nobody') throw new CloudError('not_found');
    this.state.outgoing.unshift({ id: 'r' + Date.now(), login, avatar: null });
    return 'sent';
  }

  async respondFriend(id, accept) {
    const i = this.state.incoming.findIndex(r => r.id === id);
    if (i < 0) throw new CloudError('missing');
    const [r] = this.state.incoming.splice(i, 1);
    if (accept) this.state.friends.push({ id: r.id, login: r.login, avatar: null, mc_nick: null, server: null, online: false, sees_my_markers: true });
  }

  async removeFriend(id) {
    for (const key of ['friends', 'outgoing', 'incoming']) this.state[key] = this.state[key].filter(f => f.id !== id);
  }

  async setMarkerVisibility(id, visible) {
    const f = this.state.friends.find(x => x.id === id);
    if (!f) throw new CloudError('not_friends');
    f.sees_my_markers = !!visible;
  }

  async uploadAvatar(png) {
    this.me.avatar = 'data:image/png;base64,' + png.toString('base64');
    return this.account();
  }

  async redeemKey(code) {
    if (!/^[0-9A-Z]{4}-?[0-9A-Z]{4}-?[0-9A-Z]{4}$/i.test(String(code).trim())) throw new CloudError('bad_key');
    this.me.subscriptionUntil = Math.max(this.me.subscriptionUntil || 0, Date.now()) + 30 * 24 * 3600 * 1000;
    return { days: 30, until: this.me.subscriptionUntil };
  }

  // no releases here: point VANILLA_CLIENT_JAR at a build to start the game
  async clientRelease() { return null; }

  async startGame() { return { ok: true, session: '00000000-0000-4000-8000-000000000000' }; }
}

module.exports = { MockCloud };
