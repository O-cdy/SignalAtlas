import { strict as assert } from 'node:assert';
import test from 'node:test';

import handler from './signalatlas-seed.ts';

function snapshotEnv(names) {
  const values = new Map();
  for (const name of names) values.set(name, process.env[name]);
  return () => {
    for (const [name, value] of values) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test('SignalAtlas cron fails closed when CRON_SECRET is missing', async () => {
  const restore = snapshotEnv(['CRON_SECRET']);
  delete process.env.CRON_SECRET;
  try {
    const response = await handler(new Request('https://signalatlas.worldmonitor.app/api/cron/signalatlas-seed'));
    assert.equal(response.status, 500);
    assert.match(await response.text(), /CRON_SECRET/);
  } finally {
    restore();
  }
});

test('SignalAtlas cron rejects incorrect Bearer credentials', async () => {
  const restore = snapshotEnv(['CRON_SECRET']);
  process.env.CRON_SECRET = 'secret';
  try {
    const response = await handler(new Request('https://signalatlas.worldmonitor.app/api/cron/signalatlas-seed', {
      headers: { authorization: 'Bearer wrong' },
    }));
    assert.equal(response.status, 401);
  } finally {
    restore();
  }
});

test('SignalAtlas cron writes core keys and records optional-source degradation', async () => {
  const restore = snapshotEnv([
    'CRON_SECRET',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'NASA_FIRMS_API_KEY',
    'FIRMS_API_KEY',
  ]);
  const originalFetch = globalThis.fetch;
  const redisWrites = [];

  process.env.CRON_SECRET = 'secret';
  process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.NASA_FIRMS_API_KEY;
  delete process.env.FIRMS_API_KEY;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://upstash.test')) {
      redisWrites.push(JSON.parse(String(init?.body ?? '[]')));
      return new Response(JSON.stringify({ result: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('earthquake.usgs.gov')) {
      return new Response(JSON.stringify({
        features: [{
          id: 'usgs-1',
          properties: {
            code: 'usgs-1',
            place: '10 km S of Testville',
            mag: 5.2,
            time: 1_700_000_000_000,
            url: 'https://earthquake.usgs.gov/example',
            type: 'earthquake',
          },
          geometry: { type: 'Point', coordinates: [120.5, 23.5, 12.3] },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('eonet.gsfc.nasa.gov')) {
      return new Response(JSON.stringify({
        events: [{
          id: 'EONET_1',
          title: 'Wildfire test event',
          description: 'Smoke plume observed',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
          geometry: [{ type: 'Point', date: '2026-08-27T00:00:00Z', coordinates: [10, 20] }],
          sources: [{ id: 'NASA_EONET', url: 'https://eonet.gsfc.nasa.gov/example' }],
          closed: null,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('gdacs.org')) {
      return new Response(JSON.stringify({
        features: [{
          geometry: { type: 'Point', coordinates: [30, 40] },
          properties: {
            eventtype: 'FL',
            eventid: '123',
            alertlevel: 'Orange',
            name: 'Flood test event',
            description: 'Flood',
            fromdate: '2026-08-27T00:00:00Z',
            url: { report: 'https://www.gdacs.org/report' },
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/news/v1/list-feed-digest')) {
      return new Response(JSON.stringify({
        categories: [{ key: 'disaster-news', items: [{ title: 'Storm update' }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const response = await handler(new Request('https://signalatlas.worldmonitor.app/api/cron/signalatlas-seed', {
      headers: { authorization: 'Bearer secret' },
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.variant, 'signalatlas');
    assert.equal(body.statuses.find((s) => s.key === 'seismology:earthquakes:v1')?.status, 'ok');
    assert.equal(body.statuses.find((s) => s.key === 'natural:events:v1')?.recordCount, 2);
    assert.equal(body.statuses.find((s) => s.key === 'infra:outages:v1')?.status, 'degraded');
    assert.ok(redisWrites.some((command) => command[1] === 'seismology:earthquakes:v1'));
    assert.ok(redisWrites.some((command) => command[1] === 'natural:events:v1'));
    assert.ok(redisWrites.some((command) => command[1] === 'signalatlas:seed-summary:v1'));
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
