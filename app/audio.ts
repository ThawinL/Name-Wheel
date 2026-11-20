export class PegAudio {
  private context?: AudioContext;
  private noise?: AudioBuffer;
  private nextTick = 0;

  unlock() {
    if (!('AudioContext' in window)) return;
    this.context ??= new AudioContext();
    if (!this.noise) {
      const length = Math.round(this.context.sampleRate * 0.035);
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let index = 0; index < length; index++) {
        data[index] = (Math.random() * 2 - 1) * (1 - index / length);
      }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  tick(strength: number, volume: number) {
    if (volume <= 0 || this.context?.state !== 'running' || !this.noise) return;
    const context = this.context;
    const time = Math.max(context.currentTime + 0.004, this.nextTick);
    if (time - context.currentTime > 0.035) return;
    this.nextTick = time + 0.012;
    const burst = context.createBufferSource();
    burst.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 850 + strength * 650;
    filter.detune.value = (Math.random() * 2 - 1) * 35;
    filter.Q.value = 1.2;
    const level = context.createGain();
    level.gain.setValueAtTime(volume * (0.22 + strength * 0.29), time);
    level.gain.exponentialRampToValueAtTime(0.001, time + 0.028);
    burst.connect(filter).connect(level).connect(context.destination);
    burst.start(time);
  }

  close() {
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = undefined;
    this.noise = undefined;
    this.nextTick = 0;
  }
}
