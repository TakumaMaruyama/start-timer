import { useEffect, useState, type FormEvent } from 'react';
import { Minus, Pause, Play, Plus, Square, Volume2, Zap } from 'lucide-react';
import { useTimer } from '@/hooks/use-timer';
import { playStartTone } from '@/lib/audio';

function formatRemaining(remainingMs: number) {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function TimerScreen() {
  const {
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
  } = useTimer(10);

  const [inputValue, setInputValue] = useState(intervalSec.toString());

  useEffect(() => {
    setInputValue(intervalSec.toString());
  }, [intervalSec]);

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(inputValue);
    if (Number.isInteger(value) && value >= 5 && value <= 120) {
      changeInterval(value);
    } else {
      setInputValue(intervalSec.toString());
    }
  };

  const handleTestSound = () => {
    void playStartTone().catch(() => undefined);
  };

  const presets = [5, 10, 15, 20, 30];
  const isActive = state !== 'IDLE';

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground overflow-hidden pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="flex justify-between items-center gap-2 p-4 border-b border-border/50">
        <div className="font-bold tracking-widest text-primary text-xs sm:text-base">
          SWIM START TIMER
        </div>
        <div className="flex gap-2 sm:gap-4 items-center">
          <button
            onClick={handleTestSound}
            className="flex items-center gap-1 sm:gap-2 text-muted-foreground hover:text-white transition-colors active:scale-95 whitespace-nowrap"
            title="音を確認"
            data-testid="button-test-sound"
          >
            <Volume2 className="w-5 h-5" />
            <span className="text-[10px] sm:text-sm font-bold tracking-wider">
              音を確認
            </span>
          </button>

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

      <main className="flex-1 flex flex-col items-center justify-center p-4 relative z-10 min-h-0">
        {state === 'IDLE' && (
          <div className="flex flex-col items-center w-full max-w-md gap-8 animate-in fade-in zoom-in duration-300">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold tracking-[0.2em] text-muted-foreground">
                スタート間隔
              </h2>

              <form
                onSubmit={handleManualSubmit}
                className="flex items-center justify-center gap-4"
              >
                <button
                  type="button"
                  onClick={() => changeInterval(intervalSec - 1)}
                  disabled={intervalSec <= 5}
                  aria-label="スタート間隔を1秒短くする"
                  className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-primary hover:bg-secondary-border active:scale-90 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  data-testid="button-dec-interval"
                >
                  <Minus className="w-8 h-8" />
                </button>

                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={5}
                  max={120}
                  step={1}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onBlur={handleManualSubmit}
                  aria-label="スタート間隔（秒）"
                  className="w-32 h-24 bg-transparent text-center text-6xl font-black tabular-nums border-b-4 border-primary focus:outline-none focus:border-accent transition-colors"
                  data-testid="input-interval"
                />

                <button
                  type="button"
                  onClick={() => changeInterval(intervalSec + 1)}
                  disabled={intervalSec >= 120}
                  aria-label="スタート間隔を1秒長くする"
                  className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-primary hover:bg-secondary-border active:scale-90 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  data-testid="button-inc-interval"
                >
                  <Plus className="w-8 h-8" />
                </button>
              </form>
              <div className="text-sm text-muted-foreground font-bold tracking-widest mt-2">
                秒
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3 w-full">
              {presets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => changeInterval(preset)}
                  className={`px-3 min-[380px]:px-4 py-3 rounded-lg font-bold text-base min-[380px]:text-lg tabular-nums transition-all active:scale-95 ${
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
          </div>
        )}

        {isActive && (
          <div className="flex flex-col items-center justify-center w-full h-full min-h-0">
            <div className="text-lg sm:text-3xl font-bold text-muted-foreground tracking-[0.18em] sm:tracking-[0.25em] mb-1 sm:mb-3">
              次のスタートまで
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

            <div className="mt-3 sm:mt-6 text-2xl sm:text-4xl font-black tracking-[0.08em] text-white">
              スタート回数 {beepsPlayed}回
            </div>
          </div>
        )}
      </main>

      <footer className="p-6 pb-8 sm:pb-12 bg-background/80 backdrop-blur-md border-t border-border/50 relative z-20">
        <div className="max-w-2xl mx-auto flex justify-center gap-4 sm:gap-8">
          {state === 'IDLE' ? (
            <button
              onClick={() => void start()}
              className="flex-1 max-w-sm h-24 sm:h-32 bg-primary text-primary-foreground text-3xl sm:text-4xl font-black tracking-widest rounded-2xl flex items-center justify-center gap-4 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(0,240,255,0.3)]"
              data-testid="button-start"
            >
              <Play className="w-10 h-10 sm:w-12 sm:h-12 fill-current" />
              スタート
            </button>
          ) : (
            <>
              {state === 'RUNNING' && (
                <button
                  onClick={pause}
                  className="flex-1 h-20 sm:h-28 bg-accent text-accent-foreground text-lg min-[380px]:text-xl sm:text-3xl font-black tracking-wide rounded-2xl flex items-center justify-center gap-2 sm:gap-3 hover:brightness-110 active:scale-95 transition-all"
                  data-testid="button-pause"
                >
                  <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-current shrink-0" />
                  一時停止
                </button>
              )}
              {state === 'PAUSED' && (
                <button
                  onClick={() => void resume()}
                  className="flex-1 h-20 sm:h-28 bg-primary text-primary-foreground text-lg min-[380px]:text-xl sm:text-3xl font-black tracking-wide rounded-2xl flex items-center justify-center gap-2 sm:gap-3 hover:brightness-110 active:scale-95 transition-all"
                  data-testid="button-resume"
                >
                  <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-current shrink-0" />
                  再開
                </button>
              )}
              <button
                onClick={reset}
                className="flex-1 h-20 sm:h-28 bg-destructive text-destructive-foreground text-lg min-[380px]:text-xl sm:text-3xl font-black tracking-wide rounded-2xl flex items-center justify-center gap-2 sm:gap-3 hover:brightness-110 active:scale-95 transition-all"
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