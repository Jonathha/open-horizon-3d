/**
 * Procedural Web Audio synthesizer for footsteps, jump whoosh, and ambient wind.
 * 100% self-contained with zero external audio assets.
 */

class SoundSystem {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private windNode: AudioNode | null = null;
  private windGain: GainNode | null = null;

  public init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.startAmbientWind();
    } catch {
      // AudioContext not allowed or supported
    }
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.windGain && this.ctx) {
      this.windGain.gain.setValueAtTime(this.isMuted ? 0 : 0.04, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  private startAmbientWind() {
    if (!this.ctx || this.windNode) return;

    // Buffer of white noise
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // Low-pass filter for soft breeze tone
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 1.5;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = this.isMuted ? 0 : 0.035;

    whiteNoise.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.ctx.destination);

    whiteNoise.start(0);
    this.windNode = whiteNoise;
  }

  public playFootstep(isSprinting: boolean) {
    if (!this.ctx || this.isMuted) return;
    this.resume();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Noise burst for grass rustle
    const noiseLen = 0.06;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * noiseLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.4));
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;

    filter.type = 'bandpass';
    filter.frequency.value = isSprinting ? 240 + Math.random() * 60 : 180 + Math.random() * 40;
    filter.Q.value = 2.0;

    gain.gain.setValueAtTime(isSprinting ? 0.08 : 0.045, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noiseSource.start(t);
  }

  public playJump() {
    if (!this.ctx || this.isMuted) return;
    this.resume();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.15);

    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.18);
  }
}

export const sound = new SoundSystem();
