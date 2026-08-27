import { useState, useEffect, FormEvent } from 'react';
import { useTimer } from '@/hooks/use-timer';
import { Volume2, Zap, Play, Pause, Square, Minus, Plus } from 'lucide-react';
import { playStartTone, initAudio } from '@/lib/audio';

export function TimerScreen() {
  const {
    intervalSec,
    changeInterval,
    state,
    remainingMs,
    beepsPlayed,
    countdown,
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

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const val = Number(inputValue);
    if (Number.isInteger(val) && val >= 5 && val <= 120) {
      changeInterval(val);
    } else {
      setInputValue(intervalSec.toString()); // Revert if invalid
    }
  };

  const handleTestSound = () => {
    initAudio();
    playStartTone();
  };

  const presets = [5, 10, 15, 20, 30];

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground overflow-hidden pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* Top Bar - Status */}
      <header className="flex justify-between items-center p-4 border-b border-border/50">
        <div className="font-bold tracking-widest text-primary flex items-center gap-2 text-sm sm:text-base">
          SWIM START TIMER
        </div>
        <div className="flex gap-2 sm:gap-4 items-center">
          <button
            onClick={handleTestSound}
            className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors active:scale-95"
            title="Test Sound"
            data-testid="button-test-sound"
          >
            <Volume2 className="w-5 h-5" />
            <span className="text-[10px] sm:text-sm font-bold tracking-wider">TEST SOUND</span>
          </button>
          
          <div 
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold tracking-widest transition-colors ${wakeLockActive ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}`}
            title={
              !wakeLockSupported
                ? 'Wake Lock Unsupported'
                : wakeLockActive
                  ? 'Screen Awake Active'
                  : 'Screen May Sleep'
            }
          >
            <Zap className={`w-4 h-4 ${wakeLockActive ? 'animate-pulse' : ''}`} />
            <span className="sr-only sm:not-sr-only">
              {!wakeLockSupported
                ? 'UNSUPPORTED'
                : wakeLockActive
                  ? 'AWAKE'
                  : 'SLEEP'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Display Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 relative z-10">
        {state === 'IDLE' && (
          <div className="flex flex-col items-center w-full max-w-md gap-8 animate-in fade-in zoom-in duration-300">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold tracking-[0.2em] text-muted-foreground">INTERVAL</h2>
              
              <form onSubmit={handleManualSubmit} className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => changeInterval(intervalSec - 1)}
                  disabled={intervalSec <= 5}
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
                  onChange={(e) => setInputValue(e.target.value)}
                  onBlur={handleManualSubmit}
                  className="w-32 h-24 bg-transparent text-center text-6xl font-black tabular-nums border-b-4 border-primary focus:outline-none focus:border-accent transition-colors"
                  data-testid="input-interval"
                />

                <button
                  type="button"
                  onClick={() => changeInterval(intervalSec + 1)}
                  disabled={intervalSec >= 120}
                  className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-primary hover:bg-secondary-border active:scale-90 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  data-testid="button-inc-interval"
                >
                  <Plus className="w-8 h-8" />
                </button>
              </form>
              <div className="text-sm text-muted-foreground font-bold tracking-widest mt-2">SECONDS</div>
            </div>

            <div className="flex flex-wrap justify-center gap-3 w-full">
              {presets.map(p => (
                <button
                  key={p}
                  onClick={() => changeInterval(p)}
                  className={`px-4 py-3 rounded-lg font-bold text-lg tabular-nums tracking-wider transition-all active:scale-95 ${
                    intervalSec === p 
                      ? 'bg-primary text-primary-foreground shadow-[0_0_15px_rgba(0,240,255,0.4)]' 
                      : 'bg-secondary text-foreground hover:bg-secondary-border'
                  }`}
                  data-testid={`button-preset-${p}`}
                >
                  {p}s
                </button>
              ))}
            </div>
          </div>
        )}

        {state === 'COUNTDOWN' && (
          <div className="flex flex-col items-center justify-center h-full w-full animate-in fade-in zoom-in duration-200">
            <div className={`${countdown > 0 ? 'text-[10rem] sm:text-[16rem] md:text-[24rem]' : 'text-[4rem] min-[380px]:text-[5rem] sm:text-[8rem] md:text-[12rem]'} font-black leading-none text-accent animate-pulse-fast drop-shadow-[0_0_30px_rgba(255,165,0,0.6)]`}>
              {countdown > 0 ? countdown : 'START!'}
            </div>
          </div>
        )}

        {(state === 'RUNNING' || state === 'PAUSED') && (
          <div className="flex flex-col items-center justify-center w-full h-full">
            <div className="text-xl sm:text-3xl font-bold text-muted-foreground tracking-[0.3em] mb-4">
              NEXT START
            </div>
            
            <div className={`text-[6rem] min-[380px]:text-[8rem] sm:text-[14rem] md:text-[20rem] font-black leading-none tabular-nums tracking-tighter transition-colors duration-200 drop-shadow-xl ${
              state === 'PAUSED' 
                ? 'text-muted-foreground' 
                : remainingMs < 3000 ? 'text-destructive' : 'text-primary'
            }`}>
              {(Math.max(0, remainingMs) / 1000).toFixed(1)}
            </div>

            <div className="mt-8 sm:mt-12 flex flex-col items-center">
              <div className="text-lg sm:text-xl font-bold text-muted-foreground tracking-[0.2em] mb-2">BEEPS</div>
              <div className="text-6xl sm:text-8xl font-black text-white">{beepsPlayed}</div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Controls Area */}
      <footer className="p-6 pb-8 sm:pb-12 bg-background/80 backdrop-blur-md border-t border-border/50 relative z-20">
        <div className="max-w-2xl mx-auto flex justify-center gap-4 sm:gap-8">
          {state === 'IDLE' ? (
            <button
              onClick={start}
              className="flex-1 max-w-sm h-24 sm:h-32 bg-primary text-primary-foreground text-3xl sm:text-4xl font-black tracking-widest rounded-2xl flex items-center justify-center gap-4 hover:brightness-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(0,240,255,0.3)]"
              data-testid="button-start"
            >
              <Play className="w-10 h-10 sm:w-12 sm:h-12 fill-current" />
              START
            </button>
          ) : (
            <>
              {state === 'RUNNING' && (
                <button
                  onClick={pause}
                  className="flex-1 h-20 sm:h-28 bg-accent text-accent-foreground text-2xl sm:text-3xl font-black tracking-widest rounded-2xl flex items-center justify-center gap-3 hover:brightness-110 active:scale-95 transition-all"
                  data-testid="button-pause"
                >
                  <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-current" />
                  PAUSE
                </button>
              )}
              {state === 'PAUSED' && (
                <button
                  onClick={resume}
                  className="flex-1 h-20 sm:h-28 bg-primary text-primary-foreground text-2xl sm:text-3xl font-black tracking-widest rounded-2xl flex items-center justify-center gap-3 hover:brightness-110 active:scale-95 transition-all"
                  data-testid="button-resume"
                >
                  <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-current" />
                  RESUME
                </button>
              )}
              <button
                onClick={reset}
                className="flex-1 h-20 sm:h-28 bg-destructive text-destructive-foreground text-2xl sm:text-3xl font-black tracking-widest rounded-2xl flex items-center justify-center gap-3 hover:brightness-110 active:scale-95 transition-all"
                data-testid="button-reset"
              >
                <Square className="w-8 h-8 sm:w-10 sm:h-10 fill-current" />
                RESET
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
