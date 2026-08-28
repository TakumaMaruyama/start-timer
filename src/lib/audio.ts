let audioCtx: AudioContext | null = null;

export type ScheduledTone = {
  cancel: () => void;
};

const scheduledTones = new Set<ScheduledTone>();

function createAudioContext() {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error('Web Audio API is not supported in this browser.');
  }

  return new AudioContextClass();
}

export async function ensureAudioRunning() {
  if (!audioCtx) {
    audioCtx = createAudioContext();
  }

  if (audioCtx.state !== 'running') {
    await audioCtx.resume();
  }

  if (audioCtx.state !== 'running') {
    throw new Error('AudioContext did not enter the running state.');
  }

  return audioCtx;
}

export function getAudioContext() {
  return audioCtx;
}

export function scheduleToneAt(
  atTime: number,
  frequency: number,
  type: OscillatorType,
  duration: number,
): ScheduledTone | null {
  if (!audioCtx || audioCtx.state !== 'running') return null;

  const context = audioCtx;
  const startAt = Math.max(atTime, context.currentTime + 0.02);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  let cancelled = false;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);

  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(1, startAt + 0.015);
  gain.gain.setValueAtTime(1, startAt + Math.max(0.02, duration - 0.04));
  gain.gain.linearRampToValueAtTime(0, startAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);

  const scheduledTone: ScheduledTone = {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have ended.
      }
      oscillator.disconnect();
      gain.disconnect();
      scheduledTones.delete(scheduledTone);
    },
  };

  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
    scheduledTones.delete(scheduledTone);
  });

  try {
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
    scheduledTones.add(scheduledTone);
  } catch {
    scheduledTone.cancel();
    return null;
  }

  return scheduledTone;
}

export function cancelScheduledTones() {
  [...scheduledTones].forEach((tone) => tone.cancel());
}

export function schedulePreviewToneAt(atTime: number) {
  return scheduleToneAt(atTime, 880, 'sine', 0.18);
}

export function scheduleStartToneAt(atTime: number) {
  return scheduleToneAt(atTime, 1800, 'sine', 1.0);
}

export async function initAudio() {
  return ensureAudioRunning();
}