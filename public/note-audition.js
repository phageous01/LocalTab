// Short, independent feedback for note entry. Uses sounding MIDI pitch from the
// score, so tuning, active instrument and grace notes follow the same rules.
export class NoteAudition {
  constructor(getContext) {
    this.getContext = getContext;
    this.generation = 0;
    this.voice = null;
  }

  stop() {
    this.generation++;
    const voice = this.voice;
    this.voice = null;
    if (!voice) return;
    const now = voice.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.004);
    voice.oscillator.stop(now + 0.02);
  }

  async play(tone) {
    this.stop();
    if (!tone || tone.rest || !Number.isFinite(tone.midi) || tone.midi < 0 || tone.midi > 127)
      return false;
    // Capture the edited tone before waiting for the browser's audio unlock.
    const { midi, dead } = tone;
    const generation = this.generation;
    const context = this.getContext();
    if (context.state !== "running") await context.resume();
    if (generation !== this.generation) return false;

    const oscillator = context.createOscillator(), gain = context.createGain();
    const now = context.currentTime, duration = dead ? 0.07 : 0.35;
    oscillator.type = dead ? "square" : "triangle";
    oscillator.frequency.value = dead ? 90 : 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(dead ? 0.025 : 0.13, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    const voice = { context, oscillator, gain };
    this.voice = voice;
    oscillator.onended = () => {
      if (this.voice === voice) this.voice = null;
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    return true;
  }
}
