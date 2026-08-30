import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  ArrowLeft,
  Minus,
  Pause,
  Play,
  Plus,
  Square,
  Zap,
} from 'lucide-react';
import { useTimer } from '@/hooks/use-timer';
import {
  adjustPracticeCycleSeconds,
  MAX_PRACTICE_CYCLE_SECONDS,
} from '@/lib/practice-cycle';

function formatRemaining(remainingMs: number) {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatCycleLabel(totalSeconds: number | null) {
  if (totalSeconds === null || totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds === 0) {
    return `${minutes}分サイクル`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒サイクル`;
  }
  return `${seconds}秒サイクル`;
}

export function TimerScreen() {
  const {
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
  } = useTimer(10);

  const [intervalInput, setIntervalInput] = useState(intervalSec.toString());
  const [cycleMinutesInput, setCycleMinutesInput] = useState('');
  const [cycleSecondsInput, setCycleSecondsInput] = useState('');
  const [totalInput, setTotalInput] = useState('');

  useEffect(() => {
    setIntervalInput(intervalSec.toString());
  }, [intervalSec]);

  useEffect(() => {
    setCycleMinutesInput(cycleMinutes?.toString() ?? '');
  }, [cycleMinutes]);

  useEffect(() => {
    setCycleSecondsInput(
      cycleSeconds === null ? '' : cycleSeconds.toString().padStart(2, '0'),
    );
  }, [cycleSeconds]);

  useEffect(() => {
    setTotalInput(totalStrokes?.toString() ?? '');
  }, [totalStrokes]);

  const commitInterval = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(intervalInput);
    if (Number.isInteger(value) && value >= 5 && value <= 120) {
      changeInterval(value);
    } else {
      setIntervalInput(intervalSec.toString());
    }
  };

  const handleCycleMinutesInput = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.target.value;
    setCycleMinutesInput(value);
    if (value === '') {
      changeCycleMinutes(null);
      return;
    }
    const numericValue = Number(value);
    if (
      Number.isInteger(numericValue) &&
      numericValue >= 0 &&
      numericValue <= 99
    ) {
      changeCycleMinutes(numericValue);
    }
  };

  const handleCycleSecondsInput = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.target.value;
    setCycleSecondsInput(value);
    if (value === '') {
      changeCycleSeconds(null);
      return;
    }
    const numericValue = Number(value);
    if (
      Number.isInteger(numericValue) &&
      numericValue >= 0 &&
      numericValue <= 59
    ) {
      changeCycleSeconds(numericValue);
    }
  };

  const commitCycle = (event: FormEvent) => {
    event.preventDefault();

    const minutes =
      cycleMinutesInput === '' ? null : Number(cycleMinutesInput);
    const seconds =
      cycleSecondsInput === '' ? null : Number(cycleSecondsInput);
    const minutesValid =
      minutes === null ||
      (Number.isInteger(minutes) && minutes >= 0 && minutes <= 99);
    const secondsValid =
      seconds === null ||
      (Number.isInteger(seconds) && seconds >= 0 && seconds <= 59);

    if (minutesValid && secondsValid) {
      changeCycleMinutes(minutes);
      changeCycleSeconds(seconds);
    } else {
      setCycleMinutesInput(cycleMinutes?.toString() ?? '');
      setCycleSecondsInput(
        cycleSeconds === null
          ? ''
          : cycleSeconds.toString().padStart(2, '0'),
      );
    }
  };

  const commitTotal = (event: FormEvent) => {
    event.preventDefault();
    if (totalInput === '') {
      changeTotalStrokes(null);
      return;
    }

    const value = Number(totalInput);
    if (Number.isInteger(value) && value >= 1 && value <= 99) {
      changeTotalStrokes(value);
    } else {
      setTotalInput(totalStrokes?.toString() ?? '');
    }
  };

  const handleTotalInput = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setTotalInput(value);

    if (value === '') {
      changeTotalStrokes(null);
      return;
    }

    const numericValue = Number(value);
    if (
      Number.isInteger(numericValue) &&
      numericValue >= 1 &&
      numericValue <= 99
    ) {
      changeTotalStrokes(numericValue);
    }
  };

  const decreaseTotal = () => {
    if (totalStrokes === null) return;
    changeTotalStrokes(totalStrokes === 1 ? null : totalStrokes - 1);
  };

  const increaseTotal = () => {
    changeTotalStrokes(totalStrokes === null ? 1 : totalStrokes + 1);
  };

  const adjustCycle = (deltaSeconds: number) => {
    const nextSeconds = adjustPracticeCycleSeconds(
      practiceCycleSeconds,
      deltaSeconds,
    );
    if (nextSeconds === null) {
      changeCycleMinutes(null);
      changeCycleSeconds(null);
      return;
    }
    changeCycleMinutes(Math.floor(nextSeconds / 60));
    changeCycleSeconds(nextSeconds % 60);
  };

  const presets = [5, 10, 15, 20, 30];
  const cycleLabel = formatCycleLabel(practiceCycleSeconds);
  const cycleRequired = totalStrokes !== null && !canStart;
  const isTimerActive =
    state === 'COUNTDOWN' || state === 'RUNNING' || state === 'PAUSED';

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground overflow-hidden pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="flex justify-between items-center gap-2 p-4 border-b border-border/50">
        <div className="font-bold tracking-widest text-primary text-xs sm:text-base">
          SWIM START TIMER
        </div>
        <div className="flex gap-2 sm:gap-4 items-center">
          <div
            className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded font-bold transition-colors ${
              wakeLockActive
                ? 'bg-accent/20 text-accent'
                : 'bg-muted text-muted-foreground'
            }`}
            title={
              !wakeLockSupported
                ? '画面維持は利用できません'
                : wakeLockActive
                  ? '画面維持は有効です'
                  : '画面維持は待機中です'
            }
          >
            <Zap className={`w-4 h-4 ${wakeLockActive ? 'animate-pulse' : ''}`} />
            <span className="text-[9px] sm:text-xs whitespace-nowrap">
              画面維持：
              {!wakeLockSupported
                ? '利用不可'
                : wakeLockActive
                  ? '有効'
                  : '待機'}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 relative z-10 min-h-0 overflow-y-auto">
        {state === 'IDLE' && (
          <div className="flex flex-col items-center w-full max-w-lg gap-3 sm:gap-5 py-2 animate-in fade-in zoom-in duration-300">
            <section className="text-center space-y-1">
              <h2 className="text-base sm:text-xl font-bold tracking-[0.15em] text-muted-foreground">
                スタート音の間隔
              </h2>

              <form
                onSubmit={commitInterval}
                className="flex items-center justify-center gap-3 sm:gap-4"
              >
                <button
                  type="button"
                  onClick={() => changeInterval(intervalSec - 1)}
                  disabled={intervalSec <= 5}
                  aria-label="スタート音の間隔を1秒短くする"
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-secondary flex items-center justify-center text-primary hover:bg-secondary-border active:scale-90 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  data-testid="button-dec-interval"
                >
                  <Minus className="w-6 h-6 sm:w-7 sm:h-7" />
                </button>

                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={5}
                  max={120}
                  step={1}
                  value={intervalInput}
                  onChange={(event) => setIntervalInput(event.target.value)}
                  onBlur={commitInterval}
                  aria-label="スタート音の間隔（秒）"
                  className="w-24 sm:w-28 h-14 sm:h-16 bg-transparent text-center text-4xl sm:text-5xl font-black tabular-nums border-b-4 border-primary focus:outline-none focus:border-accent transition-colors"
                  data-testid="input-interval"
                />

                <button
                  type="button"
                  onClick={() => changeInterval(intervalSec + 1)}
                  disabled={intervalSec >= 120}
                  aria-label="スタート音の間隔を1秒長くする"
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-secondary flex items-center justify-center text-primary hover:bg-secondary-border active:scale-90 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  data-testid="button-inc-interval"
                >
                  <Plus className="w-6 h-6 sm:w-7 sm:h-7" />
                </button>
              </form>
              <div className="text-xs text-muted-foreground font-bold tracking-widest">
                秒
              </div>
            </section>

            <div className="flex flex-wrap justify-center gap-2 w-full">
              {presets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => changeInterval(preset)}
                  className={`px-3 py-2 rounded-lg font-bold text-sm sm:text-base tabular-nums transition-all active:scale-95 ${
                    intervalSec === preset
                      ? 'bg-primary text-primary-foreground shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                      : 'bg-secondary text-foreground hover:bg-secondary-border'
                  }`}
                  data-testid={`button-preset-${preset}`}
                >
                  {preset}秒
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              <section
                className={`rounded-2xl border bg-card/70 p-3 text-center ${
                  cycleRequired ? 'border-destructive' : 'border-border'
                }`}
              >
                <h2 className="text-base sm:text-lg font-bold tracking-[0.1em] text-muted-foreground">
                  練習サイクル
                </h2>
                <form
                  onSubmit={commitCycle}
                  className="mt-2 flex flex-col items-center gap-2"
                >
                  <div className="flex items-end justify-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      max={99}
                      step={1}
                      value={cycleMinutesInput}
                      onChange={handleCycleMinutesInput}
                      onBlur={commitCycle}
                      placeholder="--"
                      aria-label="練習サイクルの分"
                      className="w-14 h-11 bg-transparent text-center text-3xl font-black tabular-nums border-b-4 border-accent placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                      data-testid="input-cycle-minutes"
                    />
                    <span className="mb-1 text-sm font-bold text-muted-foreground">
                      分
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      max={59}
                      step={1}
                      value={cycleSecondsInput}
                      onChange={handleCycleSecondsInput}
                      onBlur={commitCycle}
                      placeholder="--"
                      aria-label="練習サイクルの秒"
                      className="w-14 h-11 bg-transparent text-center text-3xl font-black tabular-nums border-b-4 border-accent placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                      data-testid="input-cycle-seconds"
                    />
                    <span className="mb-1 text-sm font-bold text-muted-foreground">
                      秒
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 w-full max-w-[220px]">
                    <button
                      type="button"
                      onClick={() => adjustCycle(-60)}
                      disabled={(practiceCycleSeconds ?? 0) < 60}
                      aria-label="練習サイクルを1分減らす"
                      className="h-10 rounded-lg bg-secondary px-2 text-xs font-bold text-accent active:scale-95 transition-all disabled:opacity-35 disabled:pointer-events-none"
                      data-testid="button-dec-cycle-minute"
                    >
                      −1分
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCycle(60)}
                      disabled={
                        (practiceCycleSeconds ?? 0) >
                        MAX_PRACTICE_CYCLE_SECONDS - 60
                      }
                      aria-label="練習サイクルを1分増やす"
                      className="h-10 rounded-lg bg-secondary px-2 text-xs font-bold text-accent active:scale-95 transition-all disabled:opacity-35 disabled:pointer-events-none"
                      data-testid="button-inc-cycle-minute"
                    >
                      ＋1分
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1 w-full max-w-[220px]">
                    {[
                      {
                        delta: -10,
                        label: '10秒減らす',
                        testId: 'button-dec-cycle-10',
                      },
                      {
                        delta: -5,
                        label: '5秒減らす',
                        testId: 'button-dec-cycle-5',
                      },
                      {
                        delta: 5,
                        label: '5秒増やす',
                        testId: 'button-inc-cycle-5',
                      },
                      {
                        delta: 10,
                        label: '10秒増やす',
                        testId: 'button-inc-cycle-10',
                      },
                    ].map(({ delta, label, testId }) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => adjustCycle(delta)}
                        disabled={
                          delta < 0
                            ? (practiceCycleSeconds ?? 0) < -delta
                            : (practiceCycleSeconds ?? 0) >
                              MAX_PRACTICE_CYCLE_SECONDS - delta
                        }
                        aria-label={`練習サイクルを${label}`}
                        className="h-10 rounded-lg bg-secondary px-1 text-xs font-bold text-accent active:scale-95 transition-all disabled:opacity-35 disabled:pointer-events-none"
                        data-testid={testId}
                      >
                        {delta > 0 ? `＋${delta}秒` : `−${-delta}秒`}
                      </button>
                    ))}
                  </div>
                </form>
                <p
                  className={`mt-2 text-xs sm:text-sm font-bold normal-case ${
                    cycleRequired ? 'text-destructive' : 'text-accent'
                  }`}
                  data-testid="text-cycle-summary"
                >
                  {cycleRequired
                    ? '合計本数を入力する場合は必須です'
                    : cycleLabel ?? '合計本数を使う場合に設定'}
                </p>
              </section>

              <section className="rounded-2xl border border-border bg-card/70 p-3 text-center">
                <h2 className="text-base sm:text-lg font-bold tracking-[0.1em] text-muted-foreground">
                  合計本数
                  <span className="ml-2 text-xs tracking-normal">
                    （任意）
                  </span>
                </h2>

                <form
                  onSubmit={commitTotal}
                  className="mt-2 flex items-center justify-center gap-2"
                >
                  <button
                    type="button"
                    onClick={decreaseTotal}
                    disabled={totalStrokes === null}
                    aria-label="合計本数を1本減らす"
                    className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-accent active:scale-90 transition-all disabled:opacity-35 disabled:pointer-events-none"
                    data-testid="button-dec-total"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <div className="flex items-end">
                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={1}
                      max={99}
                      step={1}
                      value={totalInput}
                      onChange={handleTotalInput}
                      onBlur={commitTotal}
                      placeholder="—"
                      aria-label="合計本数（任意）"
                      className="w-20 h-11 bg-transparent text-center text-3xl font-black tabular-nums border-b-4 border-accent placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                      data-testid="input-total"
                    />
                    <span className="mb-1 ml-1 text-sm font-bold text-muted-foreground">
                      本
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={increaseTotal}
                    disabled={totalStrokes === 99}
                    aria-label="合計本数を1本増やす"
                    className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-accent active:scale-90 transition-all disabled:opacity-35 disabled:pointer-events-none"
                    data-testid="button-inc-total"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </form>

                <p className="mt-2 text-[11px] sm:text-xs font-bold text-muted-foreground normal-case">
                  空欄なら停止するまで繰り返します
                </p>
              </section>
            </div>
          </div>
        )}

        {isTimerActive && (
          <div className="flex flex-col items-center justify-center w-full h-full min-h-0">
            {totalStrokes !== null && (
              <div
                className={`mb-2 sm:mb-5 rounded-full border px-4 py-2 text-lg sm:text-3xl font-black ${
                  startFlash
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-accent/60 bg-accent/10 text-accent'
                }`}
                aria-live="polite"
                data-testid="text-progress"
              >
                {state === 'COUNTDOWN'
                  ? `次は 全${totalStrokes}本中 1本目`
                  : `全${totalStrokes}本中 ${currentCycleNumber}本目`}
              </div>
            )}

            <div className="text-lg sm:text-3xl font-bold text-muted-foreground tracking-[0.15em] sm:tracking-[0.25em] mb-1 sm:mb-3">
              {waitingForCompletion ? '練習完了まで' : '次のスタートまで'}
            </div>

            <div
              className={`text-[3.75rem] min-[380px]:text-[5rem] sm:text-[8rem] md:text-[12rem] font-black leading-none tabular-nums tracking-tighter transition-colors duration-200 drop-shadow-xl ${
                state === 'PAUSED'
                  ? 'text-muted-foreground'
                  : countdown > 0
                    ? 'text-destructive'
                    : 'text-primary'
              }`}
              aria-live="polite"
            >
              {formatRemaining(remainingMs)}
            </div>

            {(countdown > 0 || startFlash) && (
              <div
                className={`font-black leading-none drop-shadow-[0_0_30px_rgba(255,165,0,0.6)] animate-pulse-fast ${
                  startFlash
                    ? 'text-[3.5rem] min-[380px]:text-[5rem] sm:text-[8rem] md:text-[12rem] text-primary'
                    : 'text-[8rem] min-[380px]:text-[10rem] sm:text-[14rem] md:text-[20rem] text-accent'
                }`}
                aria-live="assertive"
              >
                {startFlash ? 'スタート！' : countdown}
              </div>
            )}
          </div>
        )}

        {state === 'COMPLETE' && totalStrokes !== null && (
          <div
            className="flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300"
            aria-live="assertive"
            data-testid="practice-complete"
          >
            <div className="text-xl sm:text-3xl font-bold tracking-[0.2em] text-muted-foreground">
              練習完了
            </div>
            <div className="mt-3 text-6xl sm:text-8xl font-black tabular-nums text-primary drop-shadow-[0_0_25px_rgba(0,240,255,0.35)]">
              全{totalStrokes}本
            </div>
            <div className="mt-4 text-5xl sm:text-7xl font-black text-accent">
              完了！
            </div>
          </div>
        )}
      </main>

      <footer className="p-4 sm:p-6 pb-6 sm:pb-12 bg-background/80 backdrop-blur-md border-t border-border/50 relative z-20">
        <div className="max-w-2xl mx-auto flex justify-center gap-3 sm:gap-8">
          {state === 'IDLE' && (
            <button
              onClick={() => void start()}
              disabled={!canStart}
              className="flex-1 max-w-sm h-20 sm:h-28 bg-primary text-primary-foreground text-3xl sm:text-4xl font-black tracking-widest rounded-2xl flex items-center justify-center gap-3 sm:gap-4 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(0,240,255,0.3)] disabled:opacity-35 disabled:shadow-none disabled:pointer-events-none"
              data-testid="button-start"
            >
              <Play className="w-9 h-9 sm:w-12 sm:h-12 fill-current" />
              スタート
            </button>
          )}

          {state === 'COMPLETE' && (
            <button
              onClick={reset}
              className="flex-1 max-w-sm h-20 sm:h-28 bg-primary text-primary-foreground text-xl sm:text-3xl font-black tracking-wide rounded-2xl flex items-center justify-center gap-3 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(0,240,255,0.3)]"
              data-testid="button-back-settings"
            >
              <ArrowLeft className="w-8 h-8 sm:w-10 sm:h-10" />
              設定に戻る
            </button>
          )}

          {state !== 'IDLE' && state !== 'COMPLETE' && (
            <>
              {state === 'RUNNING' && (
                <button
                  onClick={pause}
                  className="flex-1 h-20 sm:h-28 bg-accent text-accent-foreground text-lg min-[380px]:text-xl sm:text-3xl font-black tracking-wide rounded-2xl flex items-center justify-center gap-2 sm:gap-3 active:scale-95 transition-all"
                  data-testid="button-pause"
                >
                  <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-current shrink-0" />
                  一時停止
                </button>
              )}
              {state === 'PAUSED' && (
                <button
                  onClick={() => void resume()}
                  className="flex-1 h-20 sm:h-28 bg-primary text-primary-foreground text-lg min-[380px]:text-xl sm:text-3xl font-black tracking-wide rounded-2xl flex items-center justify-center gap-2 sm:gap-3 active:scale-95 transition-all"
                  data-testid="button-resume"
                >
                  <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-current shrink-0" />
                  再開
                </button>
              )}
              <button
                onClick={reset}
                className="flex-1 h-20 sm:h-28 bg-destructive text-destructive-foreground text-lg min-[380px]:text-xl sm:text-3xl font-black tracking-wide rounded-2xl flex items-center justify-center gap-2 sm:gap-3 active:scale-95 transition-all"
                data-testid="button-reset"
              >
                <Square className="w-8 h-8 sm:w-10 sm:h-10 fill-current shrink-0" />
                リセット
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
