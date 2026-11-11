// Socket.io client, clock sync with the server, and smoothing buffers for other players.
/* global io */

class Net {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
    this.offset = 0;
    this.bestRtt = Infinity;
    this.buffers = new Map(); // id -> [{t,x,y,z,ry,anim,flags,emote}]
    this.socket.on('connect', () => {
      this.bestRtt = Infinity;
      for (let i = 0; i < 5; i++) setTimeout(() => this.sync(), i * 250);
    });
    setInterval(() => this.sync(), 10000);
    this.socket.on('snap', (s) => this.onSnap(s));
  }

  sync() {
    if (!this.socket.connected) return;
    const t0 = Date.now();
    this.socket.emit('timesync', t0, (r) => {
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (rtt <= this.bestRtt * 1.5 || rtt < 120) {
        this.bestRtt = Math.min(this.bestRtt, rtt);
        this.offset = r.server - (t0 + rtt / 2);
      }
    });
  }

  now() {
    return Date.now() + this.offset;
  }

  on(ev, fn) {
    this.socket.on(ev, fn);
  }

  off(ev, fn) {
    this.socket.off(ev, fn);
  }

  emit(ev, data) {
    this.socket.emit(ev, data);
  }

  request(ev, data, timeout = 8000) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve({ error: 'The server did not answer. Check your connection.' }); }
      }, timeout);
      this.socket.emit(ev, data, (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res || {});
      });
    });
  }

  onSnap(s) {
    for (const a of s.p) {
      const [id, x, y, z, ry, anim, flags, emote] = a;
      let b = this.buffers.get(id);
      if (!b) this.buffers.set(id, (b = []));
      b.push({ t: s.t, x, y, z, ry, anim, flags, emote });
      if (b.length > 30) b.shift();
    }
  }

  // Interpolated state of another player, ~130 ms in the past so movement is smooth.
  sample(id) {
    const b = this.buffers.get(id);
    if (!b || !b.length) return null;
    const rt = this.now() - 130;
    if (rt <= b[0].t) return b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= rt) {
        const a = b[i];
        const c = b[i + 1];
        if (!c) return a;
        const k = (rt - a.t) / Math.max(1, c.t - a.t);
        // big jumps (respawn) snap instead of sliding
        if (Math.abs(c.y - a.y) > 8 || Math.hypot(c.x - a.x, c.z - a.z) > 8) return k < 0.5 ? a : c;
        let dr = c.ry - a.ry;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, ry: a.ry + dr * k, anim: c.anim, flags: c.flags, emote: c.emote, t: rt };
      }
    }
    return b[b.length - 1];
  }

  latest(id) {
    const b = this.buffers.get(id);
    return b && b.length ? b[b.length - 1] : null;
  }

  clearBuffers() {
    this.buffers.clear();
  }
}

export const net = new Net();
