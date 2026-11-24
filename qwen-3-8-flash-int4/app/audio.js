// Procedural sound: hydraulic rumble bed, footfall thuds, collapsing
// structure cracks and the rise roar. WebAudio only, starts on first gesture.

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // noise buffer for rumble/impacts
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let lastV = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      lastV = (lastV + 0.02 * w) / 1.02; // brown-ish
      d[i] = lastV * 3.2;
    }
    this.noiseBuf = buf;

    // continuous rumble bed
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 70;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    src.connect(lp).connect(this.rumbleGain).connect(this.master);
    src.start();
  }

  setRumble(v) {
    if (!this.ctx) return;
    this.rumbleGain.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.15);
  }

  impact(power = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(55 * (0.8 + 0.4 * power), t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * power, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.8);

    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5 * power, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 0.7);
  }

  crack() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05 + Math.random() * 0.3;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.7 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 900;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.55);
  }

  roar() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(38, t);
    o.frequency.exponentialRampToValueAtTime(14, t + 1.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 2.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}
