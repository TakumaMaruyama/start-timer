let audioCtx: AudioContext | null = null;
let restoreAudioSession: (() => void) | null = null;
let sessionGeneration = 0;
let sessionRepairPending = false;

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

function enableBackgroundPlayback() {
  if (restoreAudioSession) return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) return;

  try {
    const previousType = session.type;
    session.type = 'playback';
    restoreAudioSession = () => {
      try {
        if (session.type === 'playback' || sessionRepairPending) session.type = previousType;
      } catch {
        // Audio session settings are optional; leave playback to the browser.
      }
    };
  } catch {
    // The browser can still play Web Audio without the audio session API.
  }
}

async function withAudioTimeout(operation: Promise<void>) {
  let timeout: number | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error('Audio operation timed out.')), 1500);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function ensureAudioRunning(fromUserGesture = false, resetClock = false) {
  enableBackgroundPlayback();
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = createAudioContext();
  }

  const context = audioCtx;
  if (fromUserGesture) {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.addEventListener('ended', () => source.disconnect(), { once: true });
    source.start();
  }
  if (resetClock) await withAudioTimeout(context.suspend());
  if (fromUserGesture || context.state !== 'running') {
    await withAudioTimeout(context.resume());
  }

  if (context !== audioCtx || context.state !== 'running') {
    throw new Error('AudioContext did not enter the running state.');
  }

  return context;
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

export function closeAudioContext() {
  releaseAudioPlayback();
  const context = audioCtx;
  audioCtx = null;
  if (context && context.state !== 'closed') {
    void context.close().catch(() => {});
  }
}

export function releaseAudioPlayback() {
  cancelScheduledTones();
  sessionGeneration += 1;
  restoreAudioSession?.();
  restoreAudioSession = null;
  sessionRepairPending = false;
}

export function repairAudioSession() {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  const generation = sessionGeneration;
  try {
    session.type = 'ambient';
    sessionRepairPending = true;
    window.setTimeout(() => {
      if (generation === sessionGeneration && restoreAudioSession) {
        try { session.type = 'playback'; } catch { /* Playback can still use the browser default. */ }
        sessionRepairPending = false;
      }
    }, 0);
  } catch {
    // Re-priming Web Audio still works when the audio session API is unavailable.
  }
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
