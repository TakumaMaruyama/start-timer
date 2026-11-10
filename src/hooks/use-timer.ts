import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelScheduledTones,
  closeAudioContext,
  ensureAudioRunning,
  getAudioContext,
  schedulePreviewToneAt,
  scheduleStartToneAt,
  type ScheduledTone,
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
const AUDIO_CLOCK_DRIFT_MS = 250;
const AUDIO_REFRESH_MS = 1000;
const AUDIO_REFILL_LEAD_MS = 65_000;
export const MAX_INITIAL_COUNTDOWN_SECONDS = 300;

export function isValidInitialCountdown(seconds: number) {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_INITIAL_COUNTDOWN_SECONDS;
}

export function useTimer(initialInterval = 10) {
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [initialCountdownSec, setInitialCountdownSec] = useState(10);
  const [operationLocked, setOperationLocked] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [audioRecoveryNeeded, setAudioRecoveryNeeded] = useState(false);
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
  const audioRecoveryNeededRef = useRef(false);
  const audioClockRef = useRef<{ performanceMs: number; audioSeconds: number } | null>(null);
  const scheduledThroughRef = useRef(0);
  const scheduledStartTimesRef = useRef(new Set<number>());
  const startFlashTimerRef = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const releaseAudioCleanupRef = useRef<(() => void) | null>(null);

  const lockOperations = useCallback((locked: boolean) => {
    operationLockedRef.current = locked;
    setOperationLocked(locked);
  }, []);

  const reportAudioRecoveryNeeded = useCallback((needed: boolean) => {
    audioRecoveryNeededRef.current = needed;
    setAudioRecoveryNeeded(needed);
  }, []);

  const invalidateAudioSchedule = useCallback((releaseContext = false) => {
    if (releaseContext) closeAudioContext();
    else cancelScheduledTones();
    audioClockRef.current = null;
    scheduledThroughRef.current = 0;
    scheduledStartTimesRef.current.clear();
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
    invalidateAudioSchedule(true);
    reportAudioRecoveryNeeded(false);
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
  }, [invalidateAudioSchedule, releaseWakeLock, reportAudioRecoveryNeeded]);

  const abortStart = useCallback((message: string) => {
    releaseAudioCleanupRef.current?.();
    commandGenerationRef.current += 1;
    startPendingRef.current = false;
    resyncPendingRef.current = false;
    invalidateAudioSchedule(true);
    reportAudioRecoveryNeeded(false);
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
  }, [invalidateAudioSchedule, lockOperations, releaseWakeLock, reportAudioRecoveryNeeded]);

  const scheduleToneAtPerformanceTime = useCallback(
    (
      targetPerformanceMs: number,
      schedule: (audioTime: number) => ScheduledTone | null,
      lateToleranceMs = 0,
    ) => {
      const context = getAudioContext();
      if (!context || context.state !== 'running') return null;

      const nowPerformanceMs = performance.now();
      if (targetPerformanceMs < nowPerformanceMs - lateToleranceMs) return null;

      const delaySeconds = Math.max(
        0.02,
        (targetPerformanceMs - nowPerformanceMs) / 1000,
      );
      return schedule(context.currentTime + delaySeconds);
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
        return false;
      }

      const startTone = scheduleToneAtPerformanceTime(nextStartAtPerformanceMs, scheduleStartToneAt);
      if (!startTone) return false;
      scheduledStartTimesRef.current.add(nextStartAtPerformanceMs);
      PREVIEW_STEPS.forEach(({ offsetMs }) => {
        scheduleToneAtPerformanceTime(
          nextStartAtPerformanceMs - offsetMs,
          schedulePreviewToneAt,
        );
      });
      return true;
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
        if (!scheduleCycleAudio(target)) break;
        scheduledCount += 1;
        target = nextAllowedStartAt(target + NEXT_START_EPSILON_MS);
      }
      scheduledThroughRef.current =
        target ?? completionAtRef.current;
    },
    [nextAllowedStartAt, scheduleCycleAudio],
  );

  const scheduleInitialAudio = useCallback(
    (countdownStartPerformanceMs: number, latePreviewToleranceMs = 0) => {
      const firstStartAt = firstStartAtRef.current;
      const context = getAudioContext();
      const now = performance.now();
      if (
        !context || context.state !== 'running' ||
        firstStartAt - now < AUDIO_SCHEDULE_LEAD_MS
      ) return false;

      const startTone = scheduleStartToneAt(
        context.currentTime + (firstStartAt - performance.now()) / 1000,
      );
      if (!startTone) return false;
      scheduledStartTimesRef.current.add(firstStartAt);
      PREVIEW_STEPS.forEach(({ offsetMs }) => {
        const target = firstStartAt - offsetMs;
        if (target >= countdownStartPerformanceMs) {
          scheduleToneAtPerformanceTime(target, schedulePreviewToneAt, latePreviewToleranceMs);
        }
      });
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

  const recoverAudio = useCallback(async (replaceContext = true) => {
    const currentState = stateRef.current;
    if (currentState !== 'RUNNING' && currentState !== 'COUNTDOWN') return;
    if (startPendingRef.current || resyncPendingRef.current || waitingForCompletionRef.current) return;

    resyncPendingRef.current = true;
    const generation = commandGenerationRef.current;
    invalidateAudioSchedule(replaceContext);

    try {
      const context = await ensureAudioRunning();
      if (generation !== commandGenerationRef.current) return;

      const now = performance.now();
      audioClockRef.current = { performanceMs: now, audioSeconds: context.currentTime };

      if (
        stateRef.current === 'COUNTDOWN' &&
        scheduleInitialAudio(countdownStartRef.current)
      ) {
        reportAudioRecoveryNeeded(false);
        return;
      }

      // Once the timer is underway, only restore cues that are still ahead.
      const nextStart = nextAllowedStartAt(
        Math.max(now + AUDIO_SCHEDULE_LEAD_MS, firstStartAtRef.current + NEXT_START_EPSILON_MS),
      );
      if (nextStart !== null) scheduleUpcomingAudio(nextStart);
      reportAudioRecoveryNeeded(false);
    } catch {
      if (generation === commandGenerationRef.current) {
        invalidateAudioSchedule();
        reportAudioRecoveryNeeded(true);
      }
    } finally {
      if (generation === commandGenerationRef.current) {
        resyncPendingRef.current = false;
      }
    }
  }, [
    invalidateAudioSchedule,
    nextAllowedStartAt,
    reportAudioRecoveryNeeded,
    scheduleInitialAudio,
    scheduleUpcomingAudio,
  ]);

  const maintainAudio = useCallback(() => {
    if (
      (stateRef.current !== 'COUNTDOWN' && stateRef.current !== 'RUNNING') ||
      startPendingRef.current || resyncPendingRef.current || waitingForCompletionRef.current
    ) return;

    const now = performance.now();
    const context = getAudioContext();
    if (context?.state !== 'running') {
      if (audioClockRef.current) invalidateAudioSchedule();
      if (!audioRecoveryNeededRef.current && document.visibilityState === 'visible') {
        void recoverAudio(false);
      }
      return;
    }

    const clock = audioClockRef.current;
    const audioSeconds = context.currentTime;
    if (
      !clock ||
      Math.abs(now - clock.performanceMs - (audioSeconds - clock.audioSeconds) * 1000) > AUDIO_CLOCK_DRIFT_MS
    ) {
      // A browser can report "running" even after its audio clock has stopped.
      // Discard the stale reservations before trying to use the new clock.
      const clockStalled = clock !== null &&
        audioSeconds === clock.audioSeconds &&
        now - clock.performanceMs >= AUDIO_REFRESH_MS;
      if (clockStalled && document.visibilityState !== 'visible') {
        invalidateAudioSchedule();
        audioClockRef.current = clock;
      } else {
        void recoverAudio(clockStalled);
      }
      return;
    }

    for (const scheduledStart of scheduledStartTimesRef.current) {
      if (now - scheduledStart > AUDIO_CLOCK_DRIFT_MS) scheduledStartTimesRef.current.delete(scheduledStart);
    }

    const firstUnscheduled = scheduledThroughRef.current;
    if (
      firstUnscheduled <= now + AUDIO_REFILL_LEAD_MS &&
      firstUnscheduled < completionAtRef.current
    ) {
      scheduleUpcomingAudio(Math.max(firstUnscheduled, now + AUDIO_SCHEDULE_LEAD_MS));
    }
  }, [invalidateAudioSchedule, recoverAudio, scheduleUpcomingAudio]);

  useEffect(() => {
    if (state !== 'RUNNING' && state !== 'COUNTDOWN') return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
      maintainAudio();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', maintainAudio);
    window.addEventListener('focus', maintainAudio);
    // requestAnimationFrame stops when hidden, but audio may still be playing.
    const refresh = window.setInterval(maintainAudio, AUDIO_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', maintainAudio);
      window.removeEventListener('focus', maintainAudio);
      window.clearInterval(refresh);
    };
  }, [maintainAudio, requestWakeLock, state]);

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
        if (startPendingRef.current) {
          abortStart('最初の合図に音声が間に合わなかったため、開始を中止しました。');
          rafId.current = requestAnimationFrame(loop);
          return;
        }
        maintainAudio();
        currentCycleNumberRef.current = 1;
        setCurrentCycleNumber(1);
        updatePracticeCycleProgress(now);
        setCountdown(0);
        setRemainingMs(Math.max(0, nextStartAtRef.current - now));
        stateRef.current = 'RUNNING';
        setState('RUNNING');
        if (
          scheduledStartTimesRef.current.has(firstStartAtRef.current) &&
          now - firstStartAtRef.current <= AUDIO_CLOCK_DRIFT_MS
        ) flashStart();
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
          maintainAudio();
          const nextTarget = nextAllowedStartAt(
            Math.max(now, target) + NEXT_START_EPSILON_MS,
          );
          if (
            scheduledStartTimesRef.current.has(target) &&
            -remaining <= AUDIO_CLOCK_DRIFT_MS
          ) flashStart();

          if (nextTarget !== null) {
            nextStartAtRef.current = nextTarget;
            setRemainingMs(Math.max(0, nextTarget - now));
            setCountdown(0);
          } else {
            enterCompletionWait(now);
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
    maintainAudio,
    nextAllowedStartAt,
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
      invalidateAudioSchedule(true);
      void releaseWakeLock();
    };
  }, [invalidateAudioSchedule, loop, releaseWakeLock]);

  const start = useCallback(async (pressedAt = performance.now(), pointerId?: number) => {
    if (
      stateRef.current !== 'IDLE' ||
      startPendingRef.current ||
      !isValidInitialCountdown(initialCountdownRef.current) ||
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
    invalidateAudioSchedule();
    reportAudioRecoveryNeeded(false);
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

    let releaseAudio: Promise<AudioContext> | null = null;
    if (pointerId !== undefined) {
      releaseAudio = new Promise<AudioContext>((resolve, reject) => {
        const cleanup = () => {
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onCancel, true);
          releaseAudioCleanupRef.current = null;
        };
        const onUp = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          cleanup();
          resolve(ensureAudioRunning());
        };
        const onCancel = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          cleanup();
          reject(new Error('Start pointer was cancelled.'));
        };
        releaseAudioCleanupRef.current = () => {
          cleanup();
          reject(new Error('Start pointer is no longer needed.'));
        };
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onCancel, true);
      });
    }

    try {
      const pressAudio = ensureAudioRunning();
      const context = await (releaseAudio ? Promise.any([pressAudio, releaseAudio]) : pressAudio);
      if (generation !== commandGenerationRef.current) return;
      audioClockRef.current = {
        performanceMs: performance.now(),
        audioSeconds: context.currentTime,
      };
    } catch {
      if (generation === commandGenerationRef.current) {
        abortStart('音声を準備できなかったため、開始を中止しました。');
      }
      return;
    }

    releaseAudioCleanupRef.current?.();
    if (!scheduleInitialAudio(countdownStart, AUDIO_SCHEDULE_LEAD_MS)) {
      abortStart('最初の合図に音声が間に合わなかったため、開始を中止しました。');
      return;
    }
    startPendingRef.current = false;
  }, [
    abortStart,
    invalidateAudioSchedule,
    lockOperations,
    nextAllowedStartAt,
    reportAudioRecoveryNeeded,
    requestWakeLock,
    scheduleInitialAudio,
  ]);

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
    invalidateAudioSchedule(true);
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
  }, [invalidateAudioSchedule, releaseWakeLock, updatePracticeCycleProgress]);

  const resume = useCallback(async () => {
    if (stateRef.current !== 'PAUSED' || operationLockedRef.current || resumePendingRef.current) return;
    resumePendingRef.current = true;
    const generation = commandGenerationRef.current + 1;
    commandGenerationRef.current = generation;
    try {
      const context = await ensureAudioRunning();
      if (generation !== commandGenerationRef.current) return;
      audioClockRef.current = {
        performanceMs: performance.now(),
        audioSeconds: context.currentTime,
      };
      reportAudioRecoveryNeeded(false);
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
    reportAudioRecoveryNeeded,
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
    invalidateAudioSchedule(true);
    reportAudioRecoveryNeeded(false);
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
  }, [invalidateAudioSchedule, releaseWakeLock, reportAudioRecoveryNeeded]);

  const changeInitialCountdown = useCallback((value: number) => {
    if (stateRef.current !== 'IDLE') return;
    if (isValidInitialCountdown(value)) {
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
    audioRecoveryNeeded,
    recoverAudio,
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
