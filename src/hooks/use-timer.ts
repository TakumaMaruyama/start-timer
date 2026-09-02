import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelScheduledTones,
  ensureAudioRunning,
  getAudioContext,
  schedulePreviewToneAt,
  scheduleStartToneAt,
} from '@/lib/audio';
import {
  INITIAL_START_COUNTDOWN_MS,
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

export function useTimer(initialInterval = 10) {
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [intervalSec, setIntervalSec] = useState(initialInterval);
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
      PREVIEW_STEPS.forEach(({ offsetMs }) => {
        scheduleToneAtPerformanceTime(
          countdownStartPerformanceMs +
            (INITIAL_START_COUNTDOWN_MS - offsetMs),
          (audioTime) => {
            schedulePreviewToneAt(audioTime);
          },
        );
      });
      scheduleToneAtPerformanceTime(
        countdownStartPerformanceMs + INITIAL_START_COUNTDOWN_MS,
        (audioTime) => {
          scheduleStartToneAt(audioTime);
        },
      );
      scheduleUpcomingAudio(nextStartAtRef.current);
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
      const expectedFirstStartAt =
        countdownStartRef.current + INITIAL_START_COUNTDOWN_MS;
      if (now < expectedFirstStartAt) {
        scheduleInitialAudio(countdownStartRef.current);
        return;
      }

      firstStartAtRef.current = expectedFirstStartAt;
      const cycleDurationSeconds = practiceCycleSecondsRef.current;
      const total = totalStrokesRef.current;
      completionAtRef.current =
        total !== null &&
        cycleDurationSeconds !== null &&
        isValidPracticeCycleSeconds(cycleDurationSeconds)
          ? expectedFirstStartAt + total * cycleDurationSeconds * 1000
          : Number.POSITIVE_INFINITY;

      if (now >= completionAtRef.current) {
        finishPractice();
        return;
      }

      // The first scheduled tone could not play while audio was suspended.
      // Replace that missed tone once on return without moving the absolute
      // practice-cycle grid, then continue from the next allowed grid point.
      scheduleToneAtPerformanceTime(now, (audioTime) => {
        scheduleStartToneAt(audioTime);
      });
      updatePracticeCycleProgress(now);
      const nextStartAt = nextAllowedStartAt(
        now + NEXT_START_EPSILON_MS,
      );
      nextStartAtRef.current =
        nextStartAt ?? completionAtRef.current;
      setRemainingMs(
        Math.max(0, nextStartAtRef.current - now),
      );
      setCountdown(0);
      stateRef.current = 'RUNNING';
      setState('RUNNING');
      flashStart();

      if (nextStartAt !== null) {
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
        INITIAL_START_COUNTDOWN_MS - elapsed,
      );
      setRemainingMs(countdownRemaining);
      setCountdown(
        countdownRemaining > 0 ? Math.ceil(countdownRemaining / 1000) : 0,
      );

      if (elapsed >= INITIAL_START_COUNTDOWN_MS) {
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
    const firstStartAt = countdownStart + INITIAL_START_COUNTDOWN_MS;
    const cycleDurationSeconds = practiceCycleSecondsRef.current;
    const total = totalStrokesRef.current;

    countdownStartRef.current = countdownStart;
    firstStartAtRef.current = firstStartAt;
    completionAtRef.current =
      total !== null &&
      cycleDurationSeconds !== null &&
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
    setRemainingMs(INITIAL_START_COUNTDOWN_MS);
    setCountdown(INITIAL_START_COUNTDOWN_MS / 1000);
    stateRef.current = 'COUNTDOWN';
    setState('COUNTDOWN');
    void requestWakeLock();
    scheduleInitialAudio(countdownStart);
  }, [nextAllowedStartAt, requestWakeLock, scheduleInitialAudio]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'RUNNING') return;
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
    void requestWakeLock();

    if (!pausedWaitingForCompletionRef.current) {
      scheduleUpcomingAudio(nextStartAtRef.current);
    }
  }, [
    requestWakeLock,
    scheduleUpcomingAudio,
    updatePracticeCycleProgress,
  ]);

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
