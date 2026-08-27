let audioCtx: AudioContext | null = null;

export const initAudio = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
};

export const playTone = (freq: number, type: OscillatorType, duration: number) => {
  if (!audioCtx) initAudio();
  if (audioCtx!.state === 'suspended') audioCtx!.resume();
  
  const osc = audioCtx!.createOscillator();
  const gain = audioCtx!.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx!.currentTime);
  
  // Envelope to prevent audio clicks
  gain.gain.setValueAtTime(0, audioCtx!.currentTime);
  gain.gain.linearRampToValueAtTime(1, audioCtx!.currentTime + 0.02);
  gain.gain.setValueAtTime(1, audioCtx!.currentTime + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, audioCtx!.currentTime + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx!.destination);
  
  osc.start();
  osc.stop(audioCtx!.currentTime + duration);
};

export const playPreviewTone = () => playTone(880, 'sine', 0.15);
export const playStartTone = () => playTone(1400, 'square', 0.4);
