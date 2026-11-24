const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const path = require('node:path');

function storage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v),
    removeItem: k => data.delete(k), key: i => [...data.keys()][i], get length() { return data.size; } };
}

function app({ rows = [], fetcher = async () => new Response('{}'), online = true, pathname = '/reports' } = {}) {
  const window = new EventTarget();
  Object.assign(window, { localStorage: storage(), sessionStorage: storage(), location: { pathname } });
  const calls = [], events = [], writes = [];
  window.addEventListener('fleet-cache-updated', event => events.push(event.detail));
  let source = readFileSync(path.join(__dirname, '../src/lib/api.ts'), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const context = vm.createContext({ window, navigator: { onLine: online }, CustomEvent, URLSearchParams,
    AbortSignal, console, fleetCacheScope: () => "user-test:", storedFleetUser: () => ({ role: "manager" }), clearFleetUser() {}, idbClear: async () => {}, idbAll: async () => rows.map(row => ({ ...row, key: "user-test:" + row.key })), idbPut: async (key, data) => writes.push({ key, data }),
    fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init); } });
  vm.runInContext(stripTypeScriptTypes(source) + '\nglobalThis.api = { fetchCachedJson, refreshLocalFleetDb, syncFleetNow, readCachedJson, readLastSync, DASHBOARD_CACHE_KEY };', context);
  return { ...context, context, calls, events, writes };
}

test('cold offline start restores IndexedDB before requesting data', async () => {
  const a = app({ rows: [{ key: 'large-report', data: { rows: [1, 2] } }], online: false,
    fetcher: async () => { throw Error('offline'); } });
  const data = await a.api.fetchCachedJson('/api/reports/test', undefined, { cacheKey: 'large-report' });
  assert.deepEqual(data, { rows: [1, 2] });
  assert.equal(a.calls.length, 0);
});

test('minute refresh publishes on the open reports page and deduplicates aliases', async () => {
  const a = app({ fetcher: async url => new Response(JSON.stringify(url.endsWith('sync-status')
    ? { synced_at: '2026-11-23T08:00:00Z' } : { version: 2 })) });
  await Promise.all([a.api.refreshLocalFleetDb(), a.api.refreshLocalFleetDb()]);
  assert.equal(a.calls.filter(c => c.url === '/api/reports/payment-requests').length, 1);
  assert.ok(a.events.some(e => e.cacheKey === 'reports:payment-requests:odoo-db-v6-trip' && e.data.version === 2));
  assert.equal(a.api.readLastSync(), '2026-11-23T08:00:00Z');
});

test('manual sync requests Odoo refresh before downloading and publishing copies', async () => {
  const a = app({ fetcher: async url => new Response(JSON.stringify(url === '/api/fleet/sync'
    ? { live: true, failed_count: 0 } : { version: 3 })) });
  await a.api.syncFleetNow();
  assert.equal(a.calls[0].url, '/api/fleet/sync');
  assert.equal(a.calls[0].init.method, 'POST');
  assert.ok(a.events.some(e => e.data.version === 3));
});

test('background sync pulls server copies without starting another server sync job', async () => {
  const a = app();
  await a.api.syncFleetNow({ background: true });
  assert.ok(a.calls.length > 0);
  assert.ok(a.calls.every(c => c.init.method !== 'POST'));
});

test('network failure preserves cached data and confirmed sync time', async () => {
  const a = app({ rows: [{ key: 'report', data: { version: 1 } }], fetcher: async () => { throw Error('offline'); } });
  a.window.localStorage.setItem('user-test:fleet-last-sync', 'previous');
  await a.api.refreshLocalFleetDb();
  assert.deepEqual(a.api.readCachedJson('report'), { version: 1 });
  assert.equal(a.api.readLastSync(), 'previous');
});

test('service-worker fallback does not overwrite newer local copies or sync time', async () => {
  const a = app({ rows: [{ key: 'reports:payment-requests:odoo-db-v6-trip', data: { version: 2 } }],
    fetcher: async () => new Response('{"version":1,"synced_at":"wrong"}', { headers: { 'X-Fleet-Cached': '1' } }) });
  await a.api.refreshLocalFleetDb();
  assert.equal(a.api.readCachedJson('reports:payment-requests:odoo-db-v6-trip').version, 2);
  assert.equal(a.api.readLastSync(), null);
});

test('filtered reports refresh their server cache and force refresh uses supported query parameter', async () => {
  const a = app();
  await a.api.fetchCachedJson('/api/reports/daily-profit?report_date=2026-11-22', undefined,
    { cacheKey: 'dated-report', forceRefresh: true });
  assert.equal(a.calls[0].url, '/api/reports/daily-profit?report_date=2026-11-22&refresh=true');
  await a.api.refreshLocalFleetDb();
  assert.equal(a.calls.filter(c => c.url === a.calls[0].url).length, 2);
});

test('offline sync makes no requests and retains saved data', async () => {
  const a = app({ online: false, rows: [{ key: 'report', data: [1] }] });
  await a.api.syncFleetNow();
  assert.equal(a.calls.length, 0);
  assert.deepEqual(a.api.readCachedJson('report'), [1]);
});

test('access denied never falls back to cached authorized data', async () => {
  const a = app({ rows: [{ key: 'report', data: { secret: 1 } }],
    fetcher: async () => new Response('denied', { status: 403 }) });
  await assert.rejects(a.api.fetchCachedJson('/api/report', undefined, { cacheKey: 'report', forceRefresh: true }), /Access denied/);
});

test('account switch during a request discards the old account response', async () => {
  let release;
  const a = app({ fetcher: () => new Promise(resolve => { release = resolve; }) });
  const request = a.api.fetchCachedJson('/api/report', undefined, { cacheKey: 'report' });
  await new Promise(resolve => setImmediate(resolve));
  vm.runInContext('fleetCacheScope = () => "other-user:"', a.context);
  release(new Response('{"private":true}'));
  await assert.rejects(request, /Account changed/);
  assert.equal(a.writes.length, 0);
});

test('legacy shared service worker response is not imported into an account', async () => {
  const a = app({ fetcher: async () => new Response('{"private":true}', { headers: { 'X-Fleet-Cached': '1' } }) });
  await assert.rejects(a.api.fetchCachedJson('/api/report'), /Legacy shared cache/);
  assert.equal(a.writes.length, 0);
});

test('real identity storage separates accounts and expires offline access', () => {
  let source = readFileSync(path.join(__dirname, '../src/lib/scope.ts'), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const window = { localStorage: storage(), sessionStorage: storage() };
  const context = vm.createContext({ window });
  vm.runInContext(stripTypeScriptTypes(source) + '\nglobalThis.scopeApi = {rememberFleetUser, storedFleetUser, fleetCacheScope, clearFleetUser};', context);
  const api = context.scopeApi;
  api.rememberFleetUser({ username: 'alice', role: 'supervisor', name: 'Alice' });
  const aliceScope = api.fleetCacheScope();
  api.rememberFleetUser({ username: 'bob', role: 'supervisor', name: 'Bob' });
  assert.notEqual(api.fleetCacheScope(), aliceScope);
  api.rememberFleetUser({ username: 'bob', role: 'supervisor', name: 'Bob', expires_at: 1 });
  assert.equal(api.storedFleetUser(), null);
  assert.equal(api.fleetCacheScope(), '');
  api.clearFleetUser();
  assert.equal(api.storedFleetUser(), null);
});

test('service worker keeps API query parameters distinct and falls back on server errors', async () => {
  const source = readFileSync(path.join(__dirname, '../src/lib/service-worker-source.ts'), 'utf8');
  const script = source.slice(source.indexOf('String.raw`') + 11, source.lastIndexOf('`;'));
  const matches = [];
  const context = vm.createContext({ URL, Headers, Response, Request, Set,
    self: { addEventListener() {}, location: { origin: 'https://fleet.test' } },
    fetch: async () => new Response('unavailable', { status: 503 }),
    caches: { open: async () => ({ match: async request => {
      matches.push(request.url);
      return request.url.includes('period=daily') ? new Response('{"daily":true}') : undefined;
    } }) } });
  vm.runInContext(script + '\nglobalThis.worker = { networkFirst, fromCache };', context);
  const response = await context.worker.networkFirst(new Request('https://fleet.test/api/report?period=daily'), 'api');
  assert.equal(response.headers.get('X-Fleet-Cached'), '1');
  const missing = await context.worker.fromCache('api', new Request('https://fleet.test/api/report?period=monthly'));
  assert.equal(missing, undefined);
  assert.ok(matches.every(url => url.includes('?period=')));
});
