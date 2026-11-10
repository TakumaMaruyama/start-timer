import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let now = 1000;
let frames = [];
let server;
let useTimer;
let TimerScreen;
let createElement;
let act;
let createRoot;
let root;
let container;
let timer;
const played = [];

class FakeAudioContext {
  static current;
  static resumeMode = 'immediate';
  static pending = [];
  state = 'suspended';
  destination = {};
  clockLag = 0;
  clockStoppedAt = null;

  constructor() { FakeAudioContext.current = this; }
  get currentTime() { return (this.clockStoppedAt ?? now) / 1000 - this.clockLag; }
  resume() {
    if (this.state === 'closed') return Promise.reject(new Error('audio context closed'));
    if (FakeAudioContext.resumeMode === 'fail') return Promise.reject(new Error('audio failed'));
    if (FakeAudioContext.resumeMode === 'deferred') {
      return new Promise((resolve) => FakeAudioContext.pending.push(() => {
        this.state = 'running';
        resolve();
      }));
    }
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createOscillator() {
    const oscillator = {
      frequency: { setValueAtTime(value) { oscillator.frequencyValue = value; } },
      connect() {}, disconnect() { if (oscillator.tone) oscillator.tone.cancelled = true; },
      addEventListener() {}, stop() {},
      start(at) {
        oscillator.tone = { frequency: oscillator.frequencyValue, at, cancelled: false };
        played.push(oscillator.tone);
      },
    };
    return oscillator;
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {}, disconnect() {},
    };
  }
}

before(async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.AudioContext = FakeAudioContext;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  ({ createElement, act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    esbuild: { jsx: 'automatic' },
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { middlewareMode: true, ws: false, hmr: false, preTransformRequests: false },
  });
  ({ useTimer } = await server.ssrLoadModule('/src/hooks/use-timer.ts'));
  ({ TimerScreen } = await server.ssrLoadModule('/src/components/timer-screen.tsx'));
});

after(async () => {
  await server?.close();
  window?.close();
});

afterEach(async () => {
  if (root) await unmount();
});

async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  function Holder() { timer = useTimer(); return null; }
  root = createRoot(container);
  await act(async () => root.render(createElement(Holder)));
}

async function mountScreen() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(TimerScreen)));
}

function pointer(type, id = 1, button = 0, x = 0, y = 0) {
  const event = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  Object.defineProperties(event, {
    pointerId: { value: id },
    isPrimary: { value: id === 1 },
  });
  return event;
}

async function inputValue(element, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function unmount() {
  await act(async () => root.unmount());
  root = null;
  container.remove();
  frames = [];
  played.length = 0;
  FakeAudioContext.pending = [];
  FakeAudioContext.resumeMode = 'immediate';
  now = 1000;
}

async function tick(ms) {
  now += ms;
  const pending = frames;
  frames = [];
  await act(async () => pending.forEach((callback) => callback(now)));
}

async function resolveAudio() {
  const pending = FakeAudioContext.pending;
  FakeAudioContext.pending = [];
  await act(async () => pending.forEach((resolve) => resolve()));
}

test('押下時点で表示を開始し、遅い音声準備でも初回合図の時刻をずらさない', async () => {
  await mount();
  FakeAudioContext.current && (FakeAudioContext.current.state = 'suspended');
  FakeAudioContext.resumeMode = 'deferred';
  await act(async () => timer.changeInitialCountdown(1));
  await act(async () => { void timer.start(now, 7); void timer.start(now, 7); });
  assert.equal(timer.state, 'COUNTDOWN');
  assert.equal(timer.remainingMs, 1000);
  assert.equal(timer.operationLocked, true);
  await tick(400);
  assert.equal(timer.remainingMs, 600);
  assert.equal(played.length, 0);
  await resolveAudio();
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 2).length, 1);
  await tick(600);
  assert.equal(timer.state, 'RUNNING');
});

test('初回期限超過では遅れた音を鳴らさず設定を保持する', async () => {
  await mount();
  FakeAudioContext.current.state = 'suspended';
  FakeAudioContext.resumeMode = 'deferred';
  await act(async () => timer.changeInitialCountdown(2));
  await act(async () => { void timer.start(now); });
  await tick(2000);
  assert.equal(timer.state, 'IDLE');
  assert.equal(timer.initialCountdownSec, 2);
  assert.match(timer.startError, /音声が間に合わなかった/);
  await resolveAudio();
  assert.equal(played.filter((tone) => tone.frequency === 1800).length, 0);
});

test('解除後リセットすると古い音声準備結果は初回合図を予約しない', async () => {
  await mount();
  FakeAudioContext.current.state = 'suspended';
  FakeAudioContext.resumeMode = 'deferred';
  await act(async () => { void timer.start(now); });
  await act(async () => { timer.lockOperations(false); timer.reset(); });
  await resolveAudio();
  assert.equal(timer.state, 'IDLE');
  assert.equal(played.filter((tone) => tone.frequency === 1800).length, 0);
});

test('初期音声準備中の画面復帰で初回合図を二重予約しない', async () => {
  await mount();
  FakeAudioContext.current.state = 'suspended';
  FakeAudioContext.resumeMode = 'deferred';
  await act(async () => { void timer.start(now); });
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  assert.equal(FakeAudioContext.pending.length, 1);
  await resolveAudio();
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 11).length, 1);
});

test('音声初期化失敗では設定に戻り理由を表示する', async () => {
  await mount();
  FakeAudioContext.current.state = 'suspended';
  FakeAudioContext.resumeMode = 'fail';
  await act(async () => { void timer.start(now); });
  assert.equal(timer.state, 'IDLE');
  assert.match(timer.startError, /音声を準備できなかった/);
  assert.equal(timer.operationLocked, false);
});

test('押下時の音声有効化が保留されたままでも指を離す操作で再試行する', async () => {
  await mount();
  FakeAudioContext.current.state = 'suspended';
  FakeAudioContext.resumeMode = 'deferred';
  await act(async () => { void timer.start(now, 4); });
  assert.equal(timer.state, 'COUNTDOWN');
  FakeAudioContext.resumeMode = 'immediate';
  await act(async () => window.dispatchEvent(pointer('pointerup', 4)));
  assert.equal(timer.state, 'COUNTDOWN');
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 11).length, 1);
  await resolveAudio();
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 11).length, 1);
});

test('設定に戻って再スタートすると閉じた音声コンテキストを再利用しない', async () => {
  await mount();
  await act(async () => {
    timer.changeInitialCountdown(1);
    await timer.start(now);
  });
  const oldContext = FakeAudioContext.current;
  await tick(1000);
  await act(async () => { timer.lockOperations(false); timer.reset(); });
  assert.equal(oldContext.state, 'closed');
  assert.ok(played.every((tone) => tone.cancelled));
  await act(async () => { await timer.start(now); });
  assert.notEqual(FakeAudioContext.current, oldContext);
  assert.equal(timer.state, 'COUNTDOWN');
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 3 && !tone.cancelled).length, 1);
});

test('音声が自動でrunningに戻った場合も時計のずれを修正し、次の合図を一度だけ予約する', async () => {
  await mount();
  await act(async () => {
    timer.changeInitialCountdown(1);
    await timer.start(now);
  });
  await tick(1000);
  now = 17000;
  FakeAudioContext.current.clockLag = 10;
  await act(async () => {
    window.dispatchEvent(new window.Event('pageshow'));
    window.dispatchEvent(new window.Event('focus'));
  });
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 12 && !tone.cancelled).length, 1);
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 22 && !tone.cancelled).length, 1);
  assert.ok(played.some((tone) => tone.frequency === 1800 && tone.at === 12 && tone.cancelled));
});

test('running表示のまま音声時計が停止した場合は新しい音声コンテキストを作る', async () => {
  await mount();
  await act(async () => { await timer.start(now); });
  const stalledContext = FakeAudioContext.current;
  stalledContext.clockStoppedAt = now;
  now += 4000;
  await act(async () => window.dispatchEvent(new window.Event('focus')));

  assert.equal(stalledContext.state, 'closed');
  assert.notEqual(FakeAudioContext.current, stalledContext);
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 11 && !tone.cancelled).length, 1);
});

test('バックグラウンドで描画が止まっても初回予約の先を補充し、停止で音声設定を戻す', async (t) => {
  let refreshAudio;
  const setInterval = window.setInterval;
  window.setInterval = (callback, delay) => {
    if (delay === 1000) refreshAudio = callback;
    return 1;
  };
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const audioSession = { type: 'ambient' };
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: audioSession });
  t.after(() => {
    window.setInterval = setInterval;
    delete document.visibilityState;
    delete navigator.audioSession;
  });

  await mount();
  await act(async () => {
    timer.changeInitialCountdown(1);
    timer.changeInterval(5);
    await timer.start(now);
  });
  assert.equal(audioSession.type, 'playback');
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 67).length, 0);

  now = 61000;
  await act(async () => {
    refreshAudio();
    refreshAudio();
  });
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 67).length, 1);
  assert.equal(played.filter((tone) => tone.frequency === 880 && tone.at === 64).length, 1);

  now = 121000;
  await act(async () => refreshAudio());
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 127).length, 1);
  assert.equal(played.filter((tone) => tone.frequency === 880 && tone.at === 124).length, 1);

  FakeAudioContext.current.state = 'interrupted';
  now = 123000;
  await act(async () => refreshAudio());
  assert.ok(played.every((tone) => tone.cancelled));
  FakeAudioContext.current.state = 'running';
  FakeAudioContext.current.clockLag = 2;
  now = 124000;
  await act(async () => refreshAudio());
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 125 && !tone.cancelled).length, 1);

  await act(async () => { timer.lockOperations(false); timer.reset(); });
  assert.equal(audioSession.type, 'ambient');
  assert.ok(played.every((tone) => tone.cancelled));
});

test('自動再開のタイムアウト後も同じコンテキストが自然復帰すると合図を予約し直す', async (t) => {
  let expireResume;
  const setTimeout = window.setTimeout;
  window.setTimeout = (callback, delay) => {
    if (delay === 1500) {
      expireResume = callback;
      return undefined;
    }
    return setTimeout(callback, delay);
  };
  t.after(() => { window.setTimeout = setTimeout; });

  await mount();
  await act(async () => { await timer.start(now); });
  await tick(10000);
  const context = FakeAudioContext.current;
  context.state = 'interrupted';
  FakeAudioContext.resumeMode = 'deferred';
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  await act(async () => expireResume());
  assert.equal(timer.audioRecoveryNeeded, true);

  await resolveAudio();
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.equal(FakeAudioContext.current, context);
  assert.equal(timer.audioRecoveryNeeded, false);
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 21 && !tone.cancelled).length, 1);
});

test('復帰が初回の期限を過ぎた場合は音もスタート表示も飛ばし、次の合図を予約する', async () => {
  await mount();
  await act(async () => { await timer.start(now); });
  now = 11050;
  FakeAudioContext.current.state = 'suspended';
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  await tick(0);

  assert.equal(timer.state, 'RUNNING');
  assert.equal(timer.startFlash, false);
  assert.equal(played.filter((tone) => tone.frequency === 1800 && !tone.cancelled && tone.at < 20).length, 0);
  assert.equal(played.filter((tone) => tone.frequency === 1800 && !tone.cancelled && tone.at === 21).length, 1);
});

test('復帰時に自動で音が戻らない場合、画面の音声再開ボタンで次の合図を予約する', async () => {
  await mountScreen();
  await act(async () => container.querySelector('[data-testid="button-start"]').click());
  await tick(10000);
  const oldContext = FakeAudioContext.current;
  oldContext.state = 'interrupted';
  FakeAudioContext.resumeMode = 'fail';
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  const recoverButton = container.querySelector('[data-testid="button-recover-audio"]');
  assert.ok(recoverButton);
  assert.ok(played.every((tone) => tone.cancelled));

  FakeAudioContext.resumeMode = 'immediate';
  await act(async () => recoverButton.click());
  assert.notEqual(FakeAudioContext.current, oldContext);
  assert.equal(container.querySelector('[data-testid="button-recover-audio"]'), null);
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 21 && !tone.cancelled).length, 1);
});

test('操作ロック中はpauseとresetを処理側で拒否し、再開時に再ロックする', async () => {
  await mount();
  FakeAudioContext.current.state = 'suspended';
  await act(async () => { void timer.start(now); });
  await tick(10000);
  assert.equal(timer.state, 'RUNNING');
  await act(async () => { timer.pause(); timer.reset(); });
  assert.equal(timer.state, 'RUNNING');
  await act(async () => timer.lockOperations(false));
  await act(async () => timer.pause());
  assert.equal(timer.state, 'PAUSED');
  await act(async () => { void timer.resume(); });
  assert.equal(timer.state, 'RUNNING');
  assert.equal(timer.operationLocked, true);
});

test('1・2・3・10・60・300秒の初回合図と予告音を押下時刻から予約する', async () => {
  for (const seconds of [1, 2, 3, 10, 60, 300]) {
    await mount();
    FakeAudioContext.current && (FakeAudioContext.current.state = 'suspended');
    await act(async () => timer.changeInitialCountdown(seconds));
    await act(async () => { void timer.start(now); });
    assert.equal(timer.remainingMs, seconds * 1000);
    assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 1 + seconds).length, 1);
    const expectedPreviews = Math.min(3, seconds);
    assert.equal(played.filter((tone) => tone.frequency === 880 && tone.at < 1 + seconds).length, expectedPreviews);
    await unmount();
  }
});

test('99本目と完了後も本数・ロックを維持し、設定値を保って戻れる', async () => {
  await mount();
  FakeAudioContext.current.state = 'suspended';
  await act(async () => {
    timer.changeInitialCountdown(1);
    timer.changeCycleSeconds(1);
    timer.changeTotalStrokes(99);
  });
  await act(async () => { void timer.start(now); });
  await tick(1000);
  assert.equal(timer.currentCycleNumber, 1);
  await tick(98000);
  assert.equal(timer.currentCycleNumber, 99);
  await tick(1000);
  assert.equal(timer.state, 'COMPLETE');
  assert.equal(timer.operationLocked, true);
  await act(async () => { timer.reset(); });
  assert.equal(timer.state, 'COMPLETE');
  await act(async () => { timer.lockOperations(false); timer.reset(); });
  assert.equal(timer.state, 'IDLE');
  assert.equal(timer.initialCountdownSec, 1);
});

test('開始前秒数の不正入力を拒否し、押下で即時開始してロックする', async () => {
  await mountScreen();
  const countdownInput = container.querySelector('[data-testid="input-initial-countdown"]');
  const startButton = container.querySelector('[data-testid="button-start"]');
  assert.equal(countdownInput.value, '10');
  for (const invalid of ['', '1.5', '0', '301']) {
    await inputValue(countdownInput, invalid);
    assert.equal(startButton.disabled, true, invalid);
  }
  await inputValue(countdownInput, '300');
  assert.equal(startButton.disabled, false);
  await act(async () => startButton.dispatchEvent(pointer('pointerdown')));
  assert.ok(container.querySelector('[data-testid="button-unlock"]'));
  assert.equal(container.querySelector('[data-testid="button-pause"]'), null);
  assert.match(container.textContent, /05:00/);
});

test('間隔入力の直後に押しても最新の有効値で開始する', async () => {
  await mountScreen();
  const intervalInput = container.querySelector('[data-testid="input-interval"]');
  const startButton = container.querySelector('[data-testid="button-start"]');
  await inputValue(intervalInput, '7');
  await act(async () => startButton.dispatchEvent(pointer('pointerdown')));
  assert.equal(played.filter((tone) => tone.frequency === 1800 && tone.at === 18).length, 1);
});

test('短押しは解除せず、キーボードの2秒長押しとkeyupで解除する', async () => {
  await mountScreen();
  const startButton = container.querySelector('[data-testid="button-start"]');
  await act(async () => startButton.dispatchEvent(pointer('pointerdown')));
  const unlock = container.querySelector('[data-testid="button-unlock"]');
  await act(async () => {
    unlock.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  });
  now += 1000;
  await act(async () => unlock.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true, key: 'Enter' })));
  assert.ok(container.querySelector('[data-testid="button-unlock"]'));
  await act(async () => unlock.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
  now += 2000;
  await act(async () => unlock.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true, key: 'Enter' })));
  await act(async () => unlock.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  assert.ok(container.querySelector('[data-testid="button-relock"]'));
  assert.ok(container.querySelector('[data-testid="button-reset"]'));
});

test('解除のpointerupに続くclickで即時再ロックされない', async () => {
  await mountScreen();
  await act(async () => container.querySelector('[data-testid="button-start"]').dispatchEvent(pointer('pointerdown')));
  const unlock = container.querySelector('[data-testid="button-unlock"]');
  await act(async () => unlock.dispatchEvent(pointer('pointerdown')));
  now += 2000;
  await act(async () => unlock.dispatchEvent(pointer('pointerup')));
  await act(async () => unlock.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  assert.ok(container.querySelector('[data-testid="button-relock"]'));
  assert.equal(container.querySelector('[data-testid="button-unlock"]'), null);
});

test('解除ボタンは領域外移動・別の指・キャンセルで長押しを破棄する', async () => {
  await mountScreen();
  await act(async () => container.querySelector('[data-testid="button-start"]').dispatchEvent(pointer('pointerdown')));
  const unlock = container.querySelector('[data-testid="button-unlock"]');
  await act(async () => unlock.dispatchEvent(pointer('pointerdown')));
  now += 2100;
  await act(async () => unlock.dispatchEvent(pointer('pointermove', 1, 0, 10, 10)));
  await act(async () => unlock.dispatchEvent(pointer('pointerup')));
  assert.ok(container.querySelector('[data-testid="button-unlock"]'));
  await act(async () => unlock.dispatchEvent(pointer('pointerdown')));
  await act(async () => unlock.dispatchEvent(pointer('pointerdown', 2)));
  now += 2100;
  await act(async () => unlock.dispatchEvent(pointer('pointerup')));
  assert.ok(container.querySelector('[data-testid="button-unlock"]'));
  await act(async () => unlock.dispatchEvent(pointer('pointerdown')));
  now += 2100;
  await act(async () => unlock.dispatchEvent(pointer('pointercancel')));
  await act(async () => unlock.dispatchEvent(pointer('pointerup')));
  assert.ok(container.querySelector('[data-testid="button-unlock"]'));
});
