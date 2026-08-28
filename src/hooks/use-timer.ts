import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelScheduledTones,
  ensureAudioRunning,
  getAudioContext,
  schedulePreviewToneAt,
  scheduleStartToneAt,
} from '@/lib/audio';

export type TimerState = 'IDLE' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED';

const PREVIEW_STEPS = [
  { offsetMs: 3000, frequency: 660 },
  { offsetMs: 2000, frequency: 880 },
  { offsetMs: 1000, frequency: 1100 },
] as const;

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

  const scheduleToneAtPerformanceTime = useCallback(
    (
      targetPerformanceMs: number,
      schedule: (audioTime: number) => void,
    ) => {
      const context = getAudioContext();
      if (!context || context.state !== 'running') return;

      const nowPerformanceMs = performance.now();
      if (targetPerformanceMs < nowPerformanceMs - 25) return;

      const delaySeconds = Math.max(
        0.02,
        (targetPerformanceMs - nowPerformanceMs) / 1000,
      );
      schedule(context.currentTime + delaySeconds);
    },
    [],
  );

  const scheduleCycleAudio = useCallback(
    (nextStartAtPerformanceMs: number) => {
      PREVIEW_STEPS.forEach(({ offsetMs, frequency }) => {
        scheduleToneAtPerformanceTime(
          nextStartAtPerformanceMs - offsetMs,
          (audioTime) => {
            schedulePreviewToneAt(audioTime, frequency);
          },
        );
      });
      scheduleToneAtPerformanceTime(nextStartAtPerformanceMs, (audioTime) => {
        scheduleStartToneAt(audioTime);
      });
    },
    [scheduleToneAtPerformanceTime],
  );

  const scheduleInitialAudio = useCallback(
    (countdownStartPerformanceMs: number) => {
      PREVIEW_STEPS.forEach(({ offsetMs, frequency }) => {
        scheduleToneAtPerformanceTime(
          countdownStartPerformanceMs + (3000 - offsetMs),
          (audioTime) => {
            schedulePreviewToneAt(audioTime, frequency);
          },
        );
      });
      scheduleToneAtPerformanceTime(
        countdownStartPerformanceMs + 3000,
        (audioTime) => {
          scheduleStartToneAt(audioTime);
        },
      );

      scheduleCycleAudio(
        countdownStartPerformanceMs + 3000 + intervalRef.current * 1000,
      );
    },
    [scheduleCycleAudio, scheduleToneAtPerformanceTime],
  );

  const resyncAudioAfterVisibility = useCallback(async () => {
    const currentState = stateRef.current;
    if (currentState !== 'RUNNING' && currentState !== 'COUNTDOWN') return;

    const context = getAudioContext();
    if (!context || context.state === 'running') return;

    cancelScheduledTones();
    try {
      await ensureAudioRunning();
    } catch {
      return;
    }

    const now = performance.now();

    if (stateRef.current === 'COUNTDOWN') {
      const firstStartAt = countdownStartRef.current + 3000;
      if (now < firstStartAt) {
        scheduleInitialAudio(countdownStartRef.current);
        return;
      }

      // The initial start was missed while suspended. Start a fresh audible
      // cycle now, then keep every following start exactly interval seconds
      // apart from this audible anchor.
      scheduleToneAtPerformanceTime(now, (audioTime) => {
        scheduleStartToneAt(audioTime);
      });
      beepsRef.current = 1;
      setBeepsPlayed(1);
      setCountdown(0);
      nextStartAtRef.current = now + intervalRef.current * 1000;
      setRemainingMs(intervalRef.current * 1000);
      setState('RUNNING');
      flashStart();
      scheduleCycleAudio(nextStartAtRef.current);
      return;
    }

    const periodMs = intervalRef.current * 1000;
    while (nextStartAtRef.current <= now) {
      nextStartAtRef.current += periodMs;
    }
    setRemainingMs(nextStartAtRef.current - now);
    setCountdown(
      nextStartAtRef.current - now <= 3000
        ? Math.ceil((nextStartAtRef.current - now) / 1000)
        : 0,
    );
    scheduleCycleAudio(nextStartAtRef.current);
  }, [
    flashStart,
    scheduleCycleAudio,
    scheduleInitialAudio,
    scheduleToneAtPerformanceTime,
  ]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;

      if (
        stateRef.current === 'RUNNING' ||
        stateRef.current === 'COUNTDOWN'
      ) {
        void requestWakeLock();
        void resyncAudioAfterVisibility();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [requestWakeLock, resyncAudioAfterVisibility]);

  const loop = useCallback(() => {
    const now = performance.now();
    const currentState = stateRef.current;

    if (currentState === 'COUNTDOWN') {
      const elapsed = now - countdownStartRef.current;
      const countdownRemaining = Math.max(0, 3000 - elapsed);
      setRemainingMs(countdownRemaining);
      setCountdown(
        countdownRemaining > 0 ? Math.ceil(countdownRemaining / 1000) : 0,
      );

      if (elapsed >= 3000) {
        nextStartAtRef.current =
          countdownStartRef.current + 3000 + intervalRef.current * 1000;
        beepsRef.current = 1;
        setBeepsPlayed(1);
        setCountdown(0);
        setRemainingMs(intervalRef.current * 1000);
        setState('RUNNING');
        flashStart();
      }
    } else if (currentState === 'RUNNING') {
      const target = nextStartAtRef.current;
      const remaining = target - now;

      if (target > 0 && remaining <= 0) {
        if (getAudioContext()?.state !== 'running') {
          void resyncAudioAfterVisibility();
        } else {
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
          scheduleCycleAudio(nextStartAtRef.current);
        }
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
  }, [
    flashStart,
    resyncAudioAfterVisibility,
    scheduleCycleAudio,
  ]);

  useEffect(() => {
    rafId.current = requestAnimationFrame(loop);
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      if (startFlashTimerRef.current !== null) {
        window.clearTimeout(startFlashTimerRef.current);
      }
      cancelScheduledTones();
      void releaseWakeLock();
    };
  }, [loop, releaseWakeLock]);

  const start = useCallback(async () => {
    cancelScheduledTones();
    try {
      await ensureAudioRunning();
    } catch {
      return;
    }

    const countdownStart = performance.now();
    countdownStartRef.current = countdownStart;
    nextStartAtRef.current = 0;
    beepsRef.current = 0;
    setBeepsPlayed(0);
    setRemainingMs(3000);
    setCountdown(3);
    setState('COUNTDOWN');
    void requestWakeLock();
    scheduleInitialAudio(countdownStart);
  }, [requestWakeLock, scheduleInitialAudio]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'RUNNING') return;
    pausedRemainingRef.current =
      nextStartAtRef.current - performance.now();
    cancelScheduledTones();
    setRemainingMs(Math.max(0, pausedRemainingRef.current));
    setCountdown(
      pausedRemainingRef.current > 0 &&
        pausedRemainingRef.current <= 3000
        ? Math.ceil(pausedRemainingRef.current / 1000)
        : 0,
    );
    setState('PAUSED');
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const resume = useCallback(async () => {
    if (stateRef.current !== 'PAUSED') return;
    try {
      await ensureAudioRunning();
    } catch {
      return;
    }

    const resumedTarget =
      performance.now() + Math.max(0, pausedRemainingRef.current);
    nextStartAtRef.current = resumedTarget;
    setRemainingMs(Math.max(0, pausedRemainingRef.current));
    setState('RUNNING');
    void requestWakeLock();
    scheduleCycleAudio(resumedTarget);
  }, [requestWakeLock, scheduleCycleAudio]);

  const reset = useCallback(() => {
    cancelScheduledTones();
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