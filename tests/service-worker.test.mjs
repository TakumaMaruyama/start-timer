import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://timer.example';

function createWorker({ cached = {}, online = true, networkBody = 'スタートタイマー' } = {}) {
  const handlers = {};
  const responses = new Map(Object.entries(cached).map(([path, body]) => [
    new URL(path, origin).href,
    new Response(body),
  ]));
  const requests = [];
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const cache = {
    put: async (request, response) => responses.set(key(request), response.clone()),
  };
  vm.runInNewContext(workerSource, {
    URL,
    Response,
    self: { addEventListener: (type, handler) => { handlers[type] = handler; } },
    caches: {
      match: async (request) => responses.get(key(request))?.clone(),
      open: async () => cache,
    },
    fetch: async (request, options) => {
      requests.push({ url: request.url, cache: options?.cache });
      if (!online) throw new TypeError('Offline');
      return new Response(networkBody);
    },
  });
  return {
    requests,
    async request(path, mode = 'cors') {
      let response;
      handlers.fetch({
        request: { method: 'GET', mode, url: new URL(path, origin).href },
        respondWith: (promise) => { response = promise; },
      });
      return response;
    },
  };
}

for (const [path, mode] of [
  ['/', 'navigate'],
  ['/index.html', 'cors'],
  ['/manifest.json', 'cors'],
  ['/manifest.json?v=8', 'cors'],
]) {
  test(`online ${path} returns the current name even when the old name is cached`, async () => {
    const worker = createWorker({ cached: { [path]: 'Swim Timer' } });
    assert.equal(await (await worker.request(path, mode)).text(), 'スタートタイマー');
    assert.equal(worker.requests[0].cache, 'no-store');
  });
}

test('offline navigation retains the cached Japanese app shell', async () => {
  const worker = createWorker({ online: false, cached: { '/': 'スタートタイマー' } });
  assert.equal(await (await worker.request('/?name=ja-v8', 'navigate')).text(), 'スタートタイマー');
});

test('the versioned install manifest remains available offline', async () => {
  const worker = createWorker({ online: false, cached: { '/manifest.json?v=8': 'スタートタイマー' } });
  assert.equal(await (await worker.request('/manifest.json?v=8')).text(), 'スタートタイマー');
});

test('static assets still use the existing cached response', async () => {
  const worker = createWorker({ cached: { '/icons/pace-clock.svg': 'cached icon' }, networkBody: 'new icon' });
  assert.equal(await (await worker.request('/icons/pace-clock.svg')).text(), 'cached icon');
});
