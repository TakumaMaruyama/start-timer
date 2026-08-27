import { useCallback, useEffect, useRef, useState } from 'react';
import { initAudio, playPreviewTone, playStartTone } from '@/lib/audio';

export type TimerState = 'IDLE' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED';

export function useTimer(initialInterval = 10) {
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [state, setState] = useState<TimerState>('IDLE');
  const [beepsPlayed, setBeepsPlayed] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [startFlash, setStartFlash] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const stateRef = useRef(state);
  const intervalRef = useRef(intervalSec);
  const countdownStartRef = useRef(0);
  const lastSecRef = useRef(-1);
  const nextStartAtRef = useRef(0);
  const beepsRef = useRef(0);
  const pausedRemainingRef = useRef(0);
  const startFlashTimerRef = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    intervalRef.current = intervalSec;
  }, [intervalSec]);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        const wakeLock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = wakeLock;
        setWakeLockActive(true);
        wakeLock.addEventListener('release', () => {
          setWakeLockActive(false);
          wakeLockRef.current = null;
        });
      }
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch {
      // The browser may already have released it when the tab was hidden.
    }
    wakeLockRef.current = null;
    setWakeLockActive(false);
  }, []);

  const flashStart = useCallback(() => {
    setStartFlash(true);
    if (startFlashTimerRef.current !== null) {
      window.clearTimeout(startFlashTimerRef.current);
    }
    startFlashTimerRef.current = window.setTimeout(() => {
      setStartFlash(false);
      startFlashTimerRef.current = null;
    }, 700);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;

      if (
        stateRef.current === 'RUNNING' ||
        stateRef.current === 'COUNTDOWN'
      ) {
        void requestWakeLock();
      }

      if (stateRef.current === 'RUNNING') {
        const now = performance.now();
        const periodMs = intervalRef.current * 1000;

        if (nextStartAtRef.current > 0 && now >= nextStartAtRef.current) {
          const missed =
            Math.floor((now - nextStartAtRef.current) / periodMs) + 1;
          nextStartAtRef.current += missed * periodMs;
        }

        setRemainingMs(Math.max(0, nextStartAtRef.current - now));
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [requestWakeLock]);

  const loop = useCallback(() => {
    const now = performance.now();
    const currentState = stateRef.current;

    if (currentState === 'COUNTDOWN') {
      const elapsed = now - countdownStartRef.current;
      const countdownRemaining = Math.max(0, 3000 - elapsed);
      const second = Math.floor(elapsed / 1000);

      setRemainingMs(countdownRemaining);

      if (second === 0 && lastSecRef.current !== 0) {
        playPreviewTone();
        setCountdown(3);
        lastSecRef.current = 0;
      } else if (second === 1 && lastSecRef.current !== 1) {
        playPreviewTone();
        setCountdown(2);
        lastSecRef.current = 1;
      } else if (second === 2 && lastSecRef.current !== 2) {
        playPreviewTone();
        setCountdown(1);
        lastSecRef.current = 2;
      } else if (second >= 3) {
        playStartTone();
        nextStartAtRef.current =
          countdownStartRef.current + 3000 + intervalRef.current * 1000;
        beepsRef.current = 1;
        setBeepsPlayed(1);
        setCountdown(0);
        setRemainingMs(intervalRef.current * 1000);
        setState('RUNNING');
        flashStart();
        lastSecRef.current = -1;
      }
    } else if (currentState === 'RUNNING') {
      const target = nextStartAtRef.current;
      const remaining = target - now;

      if (target > 0 && remaining <= 0) {
        playStartTone();
        beepsRef.current += 1;
        setBeepsPlayed(beepsRef.current);

        const periodMs = intervalRef.current * 1000;
        const missedAfterTone = Math.max(
          0,
          Math.floor((now - target) / periodMs),
        );
        nextStartAtRef.current =
          target + (missedAfterTone + 1) * periodMs;
        setRemainingMs(Math.max(0, nextStartAtRef.current - now));
        setCountdown(0);
        flashStart();
      } else {
        const safeRemaining = Math.max(0, remaining);
        setRemainingMs(safeRemaining);
        setCountdown(
          safeRemaining > 0 && safeRemaining <= 3000
            ? Math.ceil(safeRemaining / 1000)
            : 0,
        );
      }
    }

    rafId.current = requestAnimationFrame(loop);
  }, [flashStart]);

  useEffect(() => {
    rafId.current = requestAnimationFrame(loop);
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      if (startFlashTimerRef.current !== null) {
        window.clearTimeout(startFlashTimerRef.current);
      }
      void releaseWakeLock();
    };
  }, [loop, releaseWakeLock]);

  const start = useCallback(() => {
    initAudio();
    void requestWakeLock();
    countdownStartRef.current = performance.now();
    lastSecRef.current = -1;
    nextStartAtRef.current = 0;
    beepsRef.current = 0;
    setBeepsPlayed(0);
    setRemainingMs(3000);
    setCountdown(3);
    setState('COUNTDOWN');
  }, [requestWakeLock]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'RUNNING') return;
    pausedRemainingRef.current =
      nextStartAtRef.current - performance.now();
    setRemainingMs(Math.max(0, pausedRemainingRef.current));
    setState('PAUSED');
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const resume = useCallback(() => {
    if (stateRef.current !== 'PAUSED') return;
    initAudio();
    void requestWakeLock();
    nextStartAtRef.current =
      performance.now() + Math.max(0, pausedRemainingRef.current);
    setRemainingMs(Math.max(0, pausedRemainingRef.current));
    setState('RUNNING');
  }, [requestWakeLock]);

  const reset = useCallback(() => {
    setState('IDLE');
    setRemainingMs(0);
    setBeepsPlayed(0);
    setCountdown(0);
    setStartFlash(false);
    nextStartAtRef.current = 0;
    beepsRef.current = 0;
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const changeInterval = useCallback((value: number) => {
    if (Number.isInteger(value) && value >= 5 && value <= 120) {
      setIntervalSec(value);
    }
  }, []);

  return {
    intervalSec,
    changeInterval,
    state,
    remainingMs,
    beepsPlayed,
    countdown,
    startFlash,
    wakeLockActive,
    wakeLockSupported,
    start,
    pause,
    resume,
    reset,
  };
}