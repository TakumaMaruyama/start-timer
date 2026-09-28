import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelScheduledTones,
  ensureAudioRunning,
  getAudioContext,
  schedulePreviewToneAt,
  scheduleStartToneAt,
} from '@/lib/audio';
import {
  isValidCourseSwimmers,
  isValidPracticeCycleSeconds,
  isValidTotalStrokes,
  nextStartToneAtOrAfter,
  practiceCycleStatusAt,
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
const NEXT_START_EPSILON_MS = 0.01;
const UNLIMITED_SCHEDULE_BATCH_SIZE = 12;
const AUDIO_SCHEDULE_LEAD_MS = 25;

export function useTimer(initialInterval = 10) {
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [initialCountdownSec, setInitialCountdownSec] = useState(10);
  const [operationLocked, setOperationLocked] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cycleMinutes, setCycleMinutes] = useState<number | null>(null);
  const [cycleSeconds, setCycleSeconds] = useState<number | null>(null);
  const [totalStrokes, setTotalStrokes] = useState<number | null>(null);
  const [courseSwimmers, setCourseSwimmers] = useState<number | null>(null);
  const [state, setState] = useState<TimerState>('IDLE');
  const [remainingMs, setRemainingMs] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [currentCycleNumber, setCurrentCycleNumber] = useState(0);
  const [practiceCycleRemainingMs, setPracticeCycleRemainingMs] = useState<
    number | null
  >(null);
  const [waitingForCompletion, setWaitingForCompletion] = useState(false);
  const [startFlash, setStartFlash] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const cycleConfigured = cycleMinutes !== null || cycleSeconds !== null;
  const practiceCycleSeconds = cycleConfigured
    ? (cycleMinutes ?? 0) * 60 + (cycleSeconds ?? 0)
    : null;
  const practiceCycleRequired =
    totalStrokes !== null || courseSwimmers !== null;
  const canStart =
    !practiceCycleRequired ||
    isValidPracticeCycleSeconds(practiceCycleSeconds);

  const stateRef = useRef(state);
  const intervalRef = useRef(intervalSec);
  const initialCountdownRef = useRef(initialCountdownSec);
  const operationLockedRef = useRef(false);
  const practiceCycleSecondsRef = useRef<number | null>(
    practiceCycleSeconds,
  );
  const totalStrokesRef = useRef<number | null>(totalStrokes);
  const courseSwimmersRef = useRef<number | null>(courseSwimmers);
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
  const releaseAudioCleanupRef = useRef<(() => void) | null>(null);

  const lockOperations = useCallback((locked: boolean) => {
    operationLockedRef.current = locked;
    setOperationLocked(locked);
  }, []);

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

  useEffect(() => {
    courseSwimmersRef.current = courseSwimmers;
  }, [courseSwimmers]);

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
    releaseAudioCleanupRef.current?.();
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
    setPracticeCycleRemainingMs(null);
    setWaitingForCompletion(false);
    waitingForCompletionRef.current = false;
    stateRef.current = 'COMPLETE';
    setState('COMPLETE');
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const abortStart = useCallback((message: string) => {
    releaseAudioCleanupRef.current?.();
    commandGenerationRef.current += 1;
    startPendingRef.current = false;
    resyncPendingRef.current = false;
    cancelScheduledTones();
    scheduledThroughRef.current = 0;
    stateRef.current = 'IDLE';
    setState('IDLE');
    setRemainingMs(0);
    setCountdown(0);
    setCurrentCycleNumber(0);
    setPracticeCycleRemainingMs(null);
    setWaitingForCompletion(false);
    currentCycleNumberRef.current = 0;
    waitingForCompletionRef.current = false;
    lockOperations(false);
    setStartError(message);
    void releaseWakeLock();
  }, [lockOperations, releaseWakeLock]);

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

  const nextAllowedStartAt = useCallback((fromPerformanceMs: number) => {
    const cycleDurationSeconds = practiceCycleSecondsRef.current;
    return nextStartToneAtOrAfter(fromPerformanceMs, {
      firstStartAtPerformanceMs: firstStartAtRef.current,
      intervalMs: intervalRef.current * 1000,
      practiceCycleDurationMs:
        cycleDurationSeconds === null
          ? null
          : cycleDurationSeconds * 1000,
      courseSwimmers: courseSwimmersRef.current,
      completionAtPerformanceMs: completionAtRef.current,
    });
  }, []);

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
      // This ref stores the first not-yet-scheduled tone. Equality means the
      // boundary tone still needs to be scheduled; only a later value returns.
      if (scheduledThroughRef.current > fromStartAtPerformanceMs) {
        return;
      }

      let target = nextAllowedStartAt(
        fromStartAtPerformanceMs,
      );
      let scheduledCount = 0;
      while (
        target !== null &&
        scheduledCount < UNLIMITED_SCHEDULE_BATCH_SIZE
      ) {
        scheduleCycleAudio(target);
        scheduledCount += 1;
        target = nextAllowedStartAt(target + NEXT_START_EPSILON_MS);
      }
      scheduledThroughRef.current =
        target ?? completionAtRef.current;
    },
    [nextAllowedStartAt, scheduleCycleAudio],
  );

  const scheduleInitialAudio = useCallback(
    (countdownStartPerformanceMs: number) => {
      const firstStartAt = firstStartAtRef.current;
      const context = getAudioContext();
      const now = performance.now();
      if (
        !context || context.state !== 'running' ||
        firstStartAt - now < AUDIO_SCHEDULE_LEAD_MS
      ) return false;

      PREVIEW_STEPS.forEach(({ offsetMs }) => {
        const target = firstStartAt - offsetMs;
        if (target >= countdownStartPerformanceMs) {
          scheduleToneAtPerformanceTime(target, schedulePreviewToneAt);
        }
      });
      const startTone = scheduleStartToneAt(
        context.currentTime + (firstStartAt - performance.now()) / 1000,
      );
      if (!startTone) return false;
      scheduleUpcomingAudio(nextStartAtRef.current);
      return true;
    },
    [scheduleToneAtPerformanceTime, scheduleUpcomingAudio],
  );

  const updatePracticeCycleProgress = useCallback(
    (nowPerformanceMs: number) => {
      const cycleDurationSeconds = practiceCycleSecondsRef.current;
      const total = totalStrokesRef.current;
      if (
        total === null ||
        cycleDurationSeconds === null ||
        !isValidPracticeCycleSeconds(cycleDurationSeconds)
      ) {
        setPracticeCycleRemainingMs(null);
        return null;
      }

      const status = practiceCycleStatusAt(
        nowPerformanceMs,
        firstStartAtRef.current,
        cycleDurationSeconds * 1000,
        total,
      );
      if (status === null) {
        setPracticeCycleRemainingMs(null);
        return null;
      }

      if (
        currentCycleNumberRef.current !== status.currentCycleNumber
      ) {
        currentCycleNumberRef.current = status.currentCycleNumber;
        setCurrentCycleNumber(status.currentCycleNumber);
      }
      setPracticeCycleRemainingMs(status.remainingMs);
      return status;
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
    if (currentState === 'COUNTDOWN' && startPendingRef.current) return;
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
        if (stateRef.current === 'COUNTDOWN') {
          abortStart('音声を準備できなかったため、開始を中止しました。もう一度スタートしてください。');
        }
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
      const expectedFirstStartAt = firstStartAtRef.current;
      if (now < expectedFirstStartAt && scheduleInitialAudio(countdownStartRef.current)) {
        return;
      }
      abortStart('最初の合図に音声が間に合わなかったため、開始を中止しました。');
      return;
    }

    if (now >= completionAtRef.current) {
      finishPractice();
      return;
    }

    updatePracticeCycleProgress(now);

    if (waitingForCompletionRef.current) {
      setRemainingMs(completionAtRef.current - now);
      return;
    }

    const nextStartAt = nextAllowedStartAt(now);
    if (nextStartAt !== null) {
      nextStartAtRef.current = nextStartAt;
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
    abortStart,
    enterCompletionWait,
    finishPractice,
    flashStart,
    nextAllowedStartAt,
    scheduleInitialAudio,
    scheduleUpcomingAudio,
    scheduleToneAtPerformanceTime,
    updatePracticeCycleProgress,
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
      const countdownRemaining = Math.max(
        0,
        initialCountdownRef.current * 1000 - elapsed,
      );
      setRemainingMs(countdownRemaining);
      setCountdown(
        countdownRemaining > 0 ? Math.ceil(countdownRemaining / 1000) : 0,
      );

      if (now >= firstStartAtRef.current) {
        if (startPendingRef.current || resyncPendingRef.current || getAudioContext()?.state !== 'running') {
          abortStart('最初の合図に音声が間に合わなかったため、開始を中止しました。');
          rafId.current = requestAnimationFrame(loop);
          return;
        }
        currentCycleNumberRef.current = 1;
        setCurrentCycleNumber(1);
        updatePracticeCycleProgress(now);
        setCountdown(0);
        setRemainingMs(Math.max(0, nextStartAtRef.current - now));
        stateRef.current = 'RUNNING';
        setState('RUNNING');
        flashStart();
        if (
          !shouldScheduleStartAt(
            nextStartAtRef.current,
            completionAtRef.current,
          )
        ) {
          enterCompletionWait(now);
        }
      }
    } else if (currentState === 'RUNNING') {
      if (now >= completionAtRef.current) {
        finishPractice();
      } else {
        updatePracticeCycleProgress(now);
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
            const nextTarget = nextAllowedStartAt(
              Math.max(now, target) + NEXT_START_EPSILON_MS,
            );
            flashStart();

            if (nextTarget !== null) {
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
    abortStart,
    enterCompletionWait,
    finishPractice,
    flashStart,
    nextAllowedStartAt,
    resyncAudioAfterVisibility,
    scheduleUpcomingAudio,
    updatePracticeCycleProgress,
  ]);

  useEffect(() => {
    rafId.current = requestAnimationFrame(loop);
    return () => {
      commandGenerationRef.current += 1;
      releaseAudioCleanupRef.current?.();
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

  const start = useCallback(async (pressedAt = performance.now(), pointerId?: number) => {
    if (
      stateRef.current !== 'IDLE' ||
      startPendingRef.current ||
      !Number.isInteger(initialCountdownRef.current) ||
      initialCountdownRef.current < 1 ||
      initialCountdownRef.current > 60 ||
      ((totalStrokesRef.current !== null ||
        courseSwimmersRef.current !== null) &&
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
    const countdownStart = pressedAt;
    const firstStartAt = countdownStart + initialCountdownRef.current * 1000;
    const cycleDurationSeconds = practiceCycleSecondsRef.current;
    const total = totalStrokesRef.current;

    countdownStartRef.current = countdownStart;
    firstStartAtRef.current = firstStartAt;
    completionAtRef.current =
      total !== null && cycleDurationSeconds !== null &&
      isValidPracticeCycleSeconds(cycleDurationSeconds)
        ? firstStartAt + total * cycleDurationSeconds * 1000
        : Number.POSITIVE_INFINITY;
    nextStartAtRef.current =
      nextAllowedStartAt(firstStartAt + NEXT_START_EPSILON_MS) ??
      completionAtRef.current;
    currentCycleNumberRef.current = 0;
    waitingForCompletionRef.current = false;
    setCurrentCycleNumber(0);
    setPracticeCycleRemainingMs(null);
    setWaitingForCompletion(false);
    setRemainingMs(Math.max(0, firstStartAt - performance.now()));
    setCountdown(Math.ceil(Math.max(0, firstStartAt - performance.now()) / 1000));
    setStartError(null);
    lockOperations(true);
    stateRef.current = 'COUNTDOWN';
    setState('COUNTDOWN');
    void requestWakeLock();

    let releaseAudio: Promise<boolean> | null = null;
    if (pointerId !== undefined) {
      releaseAudio = new Promise<boolean>((resolve) => {
        const cleanup = () => {
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onCancel, true);
          releaseAudioCleanupRef.current = null;
        };
        const onUp = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          cleanup();
          if (generation === commandGenerationRef.current) {
            void ensureAudioRunning().catch(() => {});
          }
          resolve(true);
        };
        const onCancel = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          cleanup();
          resolve(false);
        };
        releaseAudioCleanupRef.current = cleanup;
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onCancel, true);
      });
    }

    try {
      await ensureAudioRunning();
    } catch {
      if (releaseAudio && generation === commandGenerationRef.current) {
        if (await releaseAudio) {
          try {
            await ensureAudioRunning();
          } catch {
            if (generation === commandGenerationRef.current) {
              abortStart('音声を準備できなかったため、開始を中止しました。');
            }
            return;
          }
        } else {
          if (generation === commandGenerationRef.current) {
            abortStart('音声を準備できなかったため、開始を中止しました。');
          }
          return;
        }
      } else {
        if (generation === commandGenerationRef.current) {
          abortStart('音声を準備できなかったため、開始を中止しました。');
        }
        return;
      }
    }

    if (
      generation !== commandGenerationRef.current ||
      stateRef.current !== 'COUNTDOWN'
    ) {
      if (generation === commandGenerationRef.current) {
        startPendingRef.current = false;
      }
      return;
    }
    if (!scheduleInitialAudio(countdownStart)) {
      abortStart('最初の合図に音声が間に合わなかったため、開始を中止しました。');
      return;
    }
    startPendingRef.current = false;
  }, [abortStart, lockOperations, nextAllowedStartAt, requestWakeLock, scheduleInitialAudio]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'RUNNING' || operationLockedRef.current) return;
    commandGenerationRef.current += 1;
    resyncPendingRef.current = false;
    const now = performance.now();
    updatePracticeCycleProgress(now);
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
  }, [releaseWakeLock, updatePracticeCycleProgress]);

  const resume = useCallback(async () => {
    if (stateRef.current !== 'PAUSED' || operationLockedRef.current || resumePendingRef.current) return;
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
    updatePracticeCycleProgress(now);
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
    lockOperations(true);
    void requestWakeLock();

    if (!pausedWaitingForCompletionRef.current) {
      scheduleUpcomingAudio(nextStartAtRef.current);
    }
  }, [
    requestWakeLock,
    lockOperations,
    scheduleUpcomingAudio,
    updatePracticeCycleProgress,
  ]);

  const reset = useCallback(() => {
    if (operationLockedRef.current) return;
    releaseAudioCleanupRef.current?.();
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
    setStartError(null);
    setRemainingMs(0);
    setCountdown(0);
    setCurrentCycleNumber(0);
    setPracticeCycleRemainingMs(null);
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

  const changeInitialCountdown = useCallback((value: number) => {
    if (stateRef.current !== 'IDLE') return;
    if (Number.isInteger(value) && value >= 1 && value <= 60) {
      initialCountdownRef.current = value;
      setInitialCountdownSec(value);
    }
  }, []);

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

  const changeCourseSwimmers = useCallback((value: number | null) => {
    if (isValidCourseSwimmers(value)) {
      courseSwimmersRef.current = value;
      setCourseSwimmers(value);
    }
  }, []);

  return {
    intervalSec,
    changeInterval,
    initialCountdownSec,
    changeInitialCountdown,
    operationLocked,
    lockOperations,
    startError,
    cycleMinutes,
    cycleSeconds,
    practiceCycleSeconds,
    changeCycleMinutes,
    changeCycleSeconds,
    totalStrokes,
    changeTotalStrokes,
    courseSwimmers,
    changeCourseSwimmers,
    canStart,
    state,
    remainingMs,
    countdown,
    currentCycleNumber,
    practiceCycleRemainingMs,
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
