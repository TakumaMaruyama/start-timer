import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelScheduledTones,
  ensureAudioRunning,
  getAudioContext,
  schedulePreviewToneAt,
  scheduleStartToneAt,
} from '@/lib/audio';
import {
  cycleNumberAt,
  isValidPracticeCycleSeconds,
  isValidTotalStrokes,
  shouldScheduleStartAt,
} from '@/lib/progress';

export type TimerState =
  | 'IDLE'
  | 'COUNTDOWN'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETE';

const PREVIEW_STEPS = [
  { offsetMs: 3000 },
  { offsetMs: 2000 },
  { offsetMs: 1000 },
] as const;
const UNLIMITED_SCHEDULE_BATCH_SIZE = 12;

export function useTimer(initialInterval = 10) {
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [cycleMinutes, setCycleMinutes] = useState<number | null>(null);
  const [cycleSeconds, setCycleSeconds] = useState<number | null>(null);
  const [totalStrokes, setTotalStrokes] = useState<number | null>(null);
  const [state, setState] = useState<TimerState>('IDLE');
  const [remainingMs, setRemainingMs] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [currentCycleNumber, setCurrentCycleNumber] = useState(0);
  const [waitingForCompletion, setWaitingForCompletion] = useState(false);
  const [startFlash, setStartFlash] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const cycleConfigured = cycleMinutes !== null || cycleSeconds !== null;
  const practiceCycleSeconds = cycleConfigured
    ? (cycleMinutes ?? 0) * 60 + (cycleSeconds ?? 0)
    : null;
  const canStart =
    totalStrokes === null ||
    isValidPracticeCycleSeconds(practiceCycleSeconds);

  const stateRef = useRef(state);
  const intervalRef = useRef(intervalSec);
  const practiceCycleSecondsRef = useRef<number | null>(
    practiceCycleSeconds,
  );
  const totalStrokesRef = useRef<number | null>(totalStrokes);
  const countdownStartRef = useRef(0);
  const firstStartAtRef = useRef(0);
  const nextStartAtRef = useRef(0);
  const completionAtRef = useRef(Number.POSITIVE_INFINITY);
  const currentCycleNumberRef = useRef(0);
  const waitingForCompletionRef = useRef(false);
  const pausedRemainingRef = useRef(0);
  const pausedCompletionRemainingRef = useRef(
    Number.POSITIVE_INFINITY,
  );
  const pausedAtRef = useRef(0);
  const pausedWaitingForCompletionRef = useRef(false);
  const commandGenerationRef = useRef(0);
  const startPendingRef = useRef(false);
  const resumePendingRef = useRef(false);
  const resyncPendingRef = useRef(false);
  const scheduledThroughRef = useRef(0);
  const startFlashTimerRef = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    intervalRef.current = intervalSec;
  }, [intervalSec]);

  useEffect(() => {
    practiceCycleSecondsRef.current = practiceCycleSeconds;
  }, [practiceCycleSeconds]);

  useEffect(() => {
    totalStrokesRef.current = totalStrokes;
  }, [totalStrokes]);

  const requestWakeLock = useCallback(async () => {
    const generation = commandGenerationRef.current;
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        const wakeLock = await (navigator as any).wakeLock.request('screen');
        if (
          generation !== commandGenerationRef.current ||
          stateRef.current === 'IDLE' ||
          stateRef.current === 'COMPLETE'
        ) {
          await wakeLock.release();
          return;
        }
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

  const finishPractice = useCallback(() => {
    commandGenerationRef.current += 1;
    startPendingRef.current = false;
    resumePendingRef.current = false;
    resyncPendingRef.current = false;
    cancelScheduledTones();
    scheduledThroughRef.current = 0;
    if (startFlashTimerRef.current !== null) {
      window.clearTimeout(startFlashTimerRef.current);
      startFlashTimerRef.current = null;
    }
    setStartFlash(false);
    setCountdown(0);
    setRemainingMs(0);
    setWaitingForCompletion(false);
    waitingForCompletionRef.current = false;
    stateRef.current = 'COMPLETE';
    setState('COMPLETE');
    void releaseWakeLock();
  }, [releaseWakeLock]);

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
      if (
        !shouldScheduleStartAt(
          nextStartAtPerformanceMs,
          completionAtRef.current,
        )
      ) {
        return;
      }

      PREVIEW_STEPS.forEach(({ offsetMs }) => {
        scheduleToneAtPerformanceTime(
          nextStartAtPerformanceMs - offsetMs,
          (audioTime) => {
            schedulePreviewToneAt(audioTime);
          },
        );
      });
      scheduleToneAtPerformanceTime(nextStartAtPerformanceMs, (audioTime) => {
        scheduleStartToneAt(audioTime);
      });
    },
    [scheduleToneAtPerformanceTime],
  );

  const scheduleUpcomingAudio = useCallback(
    (fromStartAtPerformanceMs: number) => {
      const periodMs = intervalRef.current * 1000;
      if (
        scheduledThroughRef.current >
        fromStartAtPerformanceMs + periodMs * 6
      ) {
        return;
      }
      const firstStartAt = Math.max(
        fromStartAtPerformanceMs,
        scheduledThroughRef.current,
      );
      const batchLimit = Math.min(
        completionAtRef.current,
        firstStartAt + periodMs * UNLIMITED_SCHEDULE_BATCH_SIZE,
      );

      let target = firstStartAt;
      while (target < batchLimit) {
        scheduleCycleAudio(target);
        target += periodMs;
      }
      scheduledThroughRef.current = target;
    },
    [scheduleCycleAudio],
  );

  const scheduleInitialAudio = useCallback(
    (countdownStartPerformanceMs: number) => {
      PREVIEW_STEPS.forEach(({ offsetMs }) => {
        scheduleToneAtPerformanceTime(
          countdownStartPerformanceMs + (3000 - offsetMs),
          (audioTime) => {
            schedulePreviewToneAt(audioTime);
          },
        );
      });
      scheduleToneAtPerformanceTime(
        countdownStartPerformanceMs + 3000,
        (audioTime) => {
          scheduleStartToneAt(audioTime);
        },
      );
      scheduleUpcomingAudio(nextStartAtRef.current);
    },
    [scheduleToneAtPerformanceTime, scheduleUpcomingAudio],
  );

  const updateCurrentCycleNumber = useCallback(
    (nowPerformanceMs: number) => {
      const cycleDurationSeconds = practiceCycleSecondsRef.current;
      const total = totalStrokesRef.current;
      if (
        total === null ||
        cycleDurationSeconds === null ||
        !isValidPracticeCycleSeconds(cycleDurationSeconds)
      ) {
        return;
      }

      const currentCycle = Math.min(
        total,
        cycleNumberAt(
          nowPerformanceMs,
          firstStartAtRef.current,
          cycleDurationSeconds * 1000,
        ),
      );
      if (currentCycleNumberRef.current !== currentCycle) {
        currentCycleNumberRef.current = currentCycle;
        setCurrentCycleNumber(currentCycle);
      }
    },
    [],
  );

  const enterCompletionWait = useCallback((now: number) => {
    nextStartAtRef.current = completionAtRef.current;
    waitingForCompletionRef.current = true;
    setWaitingForCompletion(true);
    setRemainingMs(Math.max(0, completionAtRef.current - now));
    setCountdown(0);
  }, []);

  const resyncAudioAfterVisibility = useCallback(async () => {
    const currentState = stateRef.current;
    if (currentState !== 'RUNNING' && currentState !== 'COUNTDOWN') return;
    if (resyncPendingRef.current) return;

    const context = getAudioContext();
    if (!context || context.state === 'running') return;

    resyncPendingRef.current = true;
    const generation = commandGenerationRef.current;
    cancelScheduledTones();
    scheduledThroughRef.current = 0;
    try {
      await ensureAudioRunning();
    } catch {
      if (generation === commandGenerationRef.current) {
        resyncPendingRef.current = false;
      }
      return;
    }

    if (
      generation !== commandGenerationRef.current ||
      (stateRef.current !== 'RUNNING' &&
        stateRef.current !== 'COUNTDOWN')
    ) {
      if (generation === commandGenerationRef.current) {
        resyncPendingRef.current = false;
      }
      return;
    }
    resyncPendingRef.current = false;

    const now = performance.now();

    if (stateRef.current === 'COUNTDOWN') {
      const expectedFirstStartAt = countdownStartRef.current + 3000;
      if (now < expectedFirstStartAt) {
        scheduleInitialAudio(countdownStartRef.current);
        return;
      }

      firstStartAtRef.current = now;
      const cycleDurationSeconds = practiceCycleSecondsRef.current;
      const total = totalStrokesRef.current;
      completionAtRef.current =
        total !== null &&
        cycleDurationSeconds !== null &&
        isValidPracticeCycleSeconds(cycleDurationSeconds)
          ? now + total * cycleDurationSeconds * 1000
          : Number.POSITIVE_INFINITY;

      scheduleToneAtPerformanceTime(now, (audioTime) => {
        scheduleStartToneAt(audioTime);
      });
      currentCycleNumberRef.current = 1;
      setCurrentCycleNumber(1);
      nextStartAtRef.current = now + intervalRef.current * 1000;
      setRemainingMs(intervalRef.current * 1000);
      setCountdown(0);
      stateRef.current = 'RUNNING';
      setState('RUNNING');
      flashStart();

      if (
        shouldScheduleStartAt(
          nextStartAtRef.current,
          completionAtRef.current,
        )
      ) {
        scheduleUpcomingAudio(nextStartAtRef.current);
      } else {
        enterCompletionWait(now);
      }
      return;
    }

    if (now >= completionAtRef.current) {
      finishPractice();
      return;
    }

    updateCurrentCycleNumber(now);

    if (waitingForCompletionRef.current) {
      setRemainingMs(completionAtRef.current - now);
      return;
    }

    const periodMs = intervalRef.current * 1000;
    while (nextStartAtRef.current <= now) {
      nextStartAtRef.current += periodMs;
    }

    if (
      shouldScheduleStartAt(
        nextStartAtRef.current,
        completionAtRef.current,
      )
    ) {
      setRemainingMs(nextStartAtRef.current - now);
      setCountdown(
        nextStartAtRef.current - now <= 3000
          ? Math.ceil((nextStartAtRef.current - now) / 1000)
          : 0,
      );
      scheduleUpcomingAudio(nextStartAtRef.current);
    } else {
      enterCompletionWait(now);
    }
  }, [
    enterCompletionWait,
    finishPractice,
    flashStart,
    scheduleCycleAudio,
    scheduleInitialAudio,
    scheduleToneAtPerformanceTime,
    updateCurrentCycleNumber,
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

    if (currentState === 'COMPLETE') {
      rafId.current = requestAnimationFrame(loop);
      return;
    }

    if (currentState === 'COUNTDOWN') {
      const elapsed = now - countdownStartRef.current;
      const countdownRemaining = Math.max(0, 3000 - elapsed);
      setRemainingMs(countdownRemaining);
      setCountdown(
        countdownRemaining > 0 ? Math.ceil(countdownRemaining / 1000) : 0,
      );

      if (elapsed >= 3000) {
        currentCycleNumberRef.current = 1;
        setCurrentCycleNumber(1);
        setCountdown(0);
        setRemainingMs(Math.max(0, nextStartAtRef.current - now));
        stateRef.current = 'RUNNING';
        setState('RUNNING');
        flashStart();
      }
    } else if (currentState === 'RUNNING') {
      if (now >= completionAtRef.current) {
        finishPractice();
      } else {
        updateCurrentCycleNumber(now);
      }

      if (
        stateRef.current === 'RUNNING' &&
        waitingForCompletionRef.current
      ) {
        setRemainingMs(completionAtRef.current - now);
        setCountdown(0);
      } else if (stateRef.current === 'RUNNING') {
        const target = nextStartAtRef.current;
        const remaining = target - now;

        if (target > 0 && remaining <= 0) {
          if (getAudioContext()?.state !== 'running') {
            void resyncAudioAfterVisibility();
          } else {
            const periodMs = intervalRef.current * 1000;
            const missedAfterTone = Math.max(
              0,
              Math.floor((now - target) / periodMs),
            );
            const nextTarget =
              target + (missedAfterTone + 1) * periodMs;
            flashStart();

            if (
              shouldScheduleStartAt(
                nextTarget,
                completionAtRef.current,
              )
            ) {
              nextStartAtRef.current = nextTarget;
              waitingForCompletionRef.current = false;
              setWaitingForCompletion(false);
              setRemainingMs(Math.max(0, nextTarget - now));
              setCountdown(0);
              scheduleUpcomingAudio(nextTarget);
            } else {
              enterCompletionWait(now);
            }
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
    }

    rafId.current = requestAnimationFrame(loop);
  }, [
    enterCompletionWait,
    finishPractice,
    flashStart,
    resyncAudioAfterVisibility,
    scheduleUpcomingAudio,
    updateCurrentCycleNumber,
  ]);

  useEffect(() => {
    rafId.current = requestAnimationFrame(loop);
    return () => {
      commandGenerationRef.current += 1;
      startPendingRef.current = false;
      resumePendingRef.current = false;
      resyncPendingRef.current = false;
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      if (startFlashTimerRef.current !== null) {
        window.clearTimeout(startFlashTimerRef.current);
      }
      cancelScheduledTones();
      scheduledThroughRef.current = 0;
      void releaseWakeLock();
    };
  }, [loop, releaseWakeLock]);

  const start = useCallback(async () => {
    if (
      stateRef.current !== 'IDLE' ||
      startPendingRef.current ||
      (totalStrokesRef.current !== null &&
        !isValidPracticeCycleSeconds(
          practiceCycleSecondsRef.current,
        ))
    ) {
      return;
    }

    startPendingRef.current = true;
    const generation = commandGenerationRef.current + 1;
    commandGenerationRef.current = generation;
    cancelScheduledTones();
    scheduledThroughRef.current = 0;
    try {
      await ensureAudioRunning();
    } catch {
      if (generation === commandGenerationRef.current) {
        startPendingRef.current = false;
      }
      return;
    }

    if (
      generation !== commandGenerationRef.current ||
      stateRef.current !== 'IDLE'
    ) {
      if (generation === commandGenerationRef.current) {
        startPendingRef.current = false;
      }
      return;
    }
    startPendingRef.current = false;

    const countdownStart = performance.now();
    const firstStartAt = countdownStart + 3000;
    const cycleDurationSeconds = practiceCycleSecondsRef.current;
    const total = totalStrokesRef.current;

    countdownStartRef.current = countdownStart;
    firstStartAtRef.current = firstStartAt;
    nextStartAtRef.current =
      firstStartAt + intervalRef.current * 1000;
    completionAtRef.current =
      total !== null &&
      cycleDurationSeconds !== null &&
      isValidPracticeCycleSeconds(cycleDurationSeconds)
        ? firstStartAt + total * cycleDurationSeconds * 1000
        : Number.POSITIVE_INFINITY;
    currentCycleNumberRef.current = 0;
    waitingForCompletionRef.current = false;
    setCurrentCycleNumber(0);
    setWaitingForCompletion(false);
    setRemainingMs(3000);
    setCountdown(3);
    stateRef.current = 'COUNTDOWN';
    setState('COUNTDOWN');
    void requestWakeLock();
    scheduleInitialAudio(countdownStart);
  }, [requestWakeLock, scheduleInitialAudio]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'RUNNING') return;
    commandGenerationRef.current += 1;
    resyncPendingRef.current = false;
    const now = performance.now();
    pausedAtRef.current = now;
    pausedWaitingForCompletionRef.current =
      waitingForCompletionRef.current;
    pausedRemainingRef.current =
      (waitingForCompletionRef.current
        ? completionAtRef.current
        : nextStartAtRef.current) - now;
    pausedCompletionRemainingRef.current =
      completionAtRef.current - now;
    cancelScheduledTones();
    scheduledThroughRef.current = 0;
    setRemainingMs(Math.max(0, pausedRemainingRef.current));
    setCountdown(
      !waitingForCompletionRef.current &&
        pausedRemainingRef.current > 0 &&
        pausedRemainingRef.current <= 3000
        ? Math.ceil(pausedRemainingRef.current / 1000)
        : 0,
    );
    stateRef.current = 'PAUSED';
    setState('PAUSED');
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const resume = useCallback(async () => {
    if (stateRef.current !== 'PAUSED' || resumePendingRef.current) return;
    resumePendingRef.current = true;
    const generation = commandGenerationRef.current + 1;
    commandGenerationRef.current = generation;
    try {
      await ensureAudioRunning();
    } catch {
      if (generation === commandGenerationRef.current) {
        resumePendingRef.current = false;
      }
      return;
    }

    if (
      generation !== commandGenerationRef.current ||
      stateRef.current !== 'PAUSED'
    ) {
      if (generation === commandGenerationRef.current) {
        resumePendingRef.current = false;
      }
      return;
    }
    resumePendingRef.current = false;

    const now = performance.now();
    firstStartAtRef.current += Math.max(0, now - pausedAtRef.current);
    completionAtRef.current = Number.isFinite(
      pausedCompletionRemainingRef.current,
    )
      ? now + Math.max(0, pausedCompletionRemainingRef.current)
      : Number.POSITIVE_INFINITY;
    waitingForCompletionRef.current =
      pausedWaitingForCompletionRef.current;
    setWaitingForCompletion(pausedWaitingForCompletionRef.current);
    nextStartAtRef.current =
      now + Math.max(0, pausedRemainingRef.current);
    setRemainingMs(Math.max(0, pausedRemainingRef.current));
    setCountdown(
      !pausedWaitingForCompletionRef.current &&
        pausedRemainingRef.current > 0 &&
        pausedRemainingRef.current <= 3000
        ? Math.ceil(pausedRemainingRef.current / 1000)
        : 0,
    );
    stateRef.current = 'RUNNING';
    setState('RUNNING');
    void requestWakeLock();

    if (!pausedWaitingForCompletionRef.current) {
      scheduleUpcomingAudio(nextStartAtRef.current);
    }
  }, [requestWakeLock, scheduleUpcomingAudio]);

  const reset = useCallback(() => {
    commandGenerationRef.current += 1;
    startPendingRef.current = false;
    resumePendingRef.current = false;
    resyncPendingRef.current = false;
    cancelScheduledTones();
    scheduledThroughRef.current = 0;
    if (startFlashTimerRef.current !== null) {
      window.clearTimeout(startFlashTimerRef.current);
      startFlashTimerRef.current = null;
    }
    stateRef.current = 'IDLE';
    setState('IDLE');
    setRemainingMs(0);
    setCountdown(0);
    setCurrentCycleNumber(0);
    setWaitingForCompletion(false);
    setStartFlash(false);
    currentCycleNumberRef.current = 0;
    waitingForCompletionRef.current = false;
    nextStartAtRef.current = 0;
    completionAtRef.current = Number.POSITIVE_INFINITY;
    pausedRemainingRef.current = 0;
    pausedCompletionRemainingRef.current =
      Number.POSITIVE_INFINITY;
    pausedAtRef.current = 0;
    pausedWaitingForCompletionRef.current = false;
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const changeInterval = useCallback((value: number) => {
    if (Number.isInteger(value) && value >= 5 && value <= 120) {
      intervalRef.current = value;
      setIntervalSec(value);
    }
  }, []);

  const changeCycleMinutes = useCallback((value: number | null) => {
    if (
      value === null ||
      (Number.isInteger(value) && value >= 0 && value <= 99)
    ) {
      setCycleMinutes(value);
    }
  }, []);

  const changeCycleSeconds = useCallback((value: number | null) => {
    if (
      value === null ||
      (Number.isInteger(value) && value >= 0 && value <= 59)
    ) {
      setCycleSeconds(value);
    }
  }, []);

  const changeTotalStrokes = useCallback((value: number | null) => {
    if (isValidTotalStrokes(value)) {
      totalStrokesRef.current = value;
      setTotalStrokes(value);
    }
  }, []);

  return {
    intervalSec,
    changeInterval,
    cycleMinutes,
    cycleSeconds,
    practiceCycleSeconds,
    changeCycleMinutes,
    changeCycleSeconds,
    totalStrokes,
    changeTotalStrokes,
    canStart,
    state,
    remainingMs,
    countdown,
    currentCycleNumber,
    waitingForCompletion,
    startFlash,
    wakeLockActive,
    wakeLockSupported,
    start,
    pause,
    resume,
    reset,
  };
}