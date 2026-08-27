import { CHROME_UA } from '../../server/_shared/constants';
import { setCachedJson } from '../../server/_shared/redis';

const TTL_SECONDS = 60 * 60;
const META_TTL_SECONDS = 3 * 60 * 60;
const USGS_FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
const EONET_API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30';
const GDACS_API_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP';
const CF_RADAR_URL = 'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=28d&limit=50';

type SeedStatus = {
  key: string;
  status: 'ok' | 'degraded' | 'error';
  recordCount: number;
  reason?: string;
};

type NaturalEvent = {
  id: string;
  title: string;
  description: string;
  category: string;
  categoryTitle: string;
  lat: number;
  lon: number;
  date: number;
  magnitude: number;
  magnitudeUnit: string;
  sourceUrl: string;
  sourceName: string;
  closed: boolean;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function bearerToken(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
}

function assertCronAuthorized(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'CRON_SECRET is required for SignalAtlas cron' }, 500);
  if (bearerToken(req) !== secret) return json({ error: 'Unauthorized' }, 401);
  return null;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function writeMeta(domain: string, resource: string, status: SeedStatus): Promise<void> {
  await setCachedJson(`seed-meta:${domain}:${resource}`, {
    fetchedAt: Date.now(),
    recordCount: status.recordCount,
    sourceVersion: 'signalatlas-vercel-cron-v1',
    ttlSeconds: TTL_SECONDS,
    status: status.status,
    ...(status.reason ? { reason: status.reason } : {}),
  }, META_TTL_SECONDS, true);
}

async function publish(key: string, value: unknown, status: SeedStatus, domain: string, resource: string): Promise<SeedStatus> {
  const wroteData = await setCachedJson(key, value, TTL_SECONDS, true);
  await writeMeta(domain, resource, status);
  return wroteData ? status : { ...status, status: 'error', reason: 'Redis data write failed' };
}

async function seedEarthquakes(): Promise<SeedStatus> {
  const data = await fetchJson(USGS_FEED_URL);
  const earthquakes = (Array.isArray(data.features) ? data.features : [])
    .map((feature: any) => {
      const props = feature?.properties ?? {};
      const coords = feature?.geometry?.coordinates ?? [];
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      const depthKm = Number(coords[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: String(feature.id || props.code || props.ids || props.url || `${lat}:${lon}:${props.time}`),
        place: String(props.place || ''),
        magnitude: Number(props.mag) || 0,
        depthKm: Number.isFinite(depthKm) ? depthKm : 0,
        location: { latitude: lat, longitude: lon },
        occurredAt: Number(props.time) || 0,
        sourceUrl: String(props.url || ''),
        source: 'usgs',
        category: String(props.type || 'earthquake'),
      };
    })
    .filter(Boolean);

  return publish(
    'seismology:earthquakes:v1',
    { earthquakes },
    { key: 'seismology:earthquakes:v1', status: 'ok', recordCount: earthquakes.length },
    'seismology',
    'earthquakes',
  );
}

function normalizeEonetCategory(id: string): string {
  const categories: Record<string, string> = {
    severeStorms: 'severeStorms',
    wildfires: 'wildfires',
    volcanoes: 'volcanoes',
    earthquakes: 'earthquakes',
    floods: 'floods',
    landslides: 'landslides',
    drought: 'drought',
    dustHaze: 'dustHaze',
    snow: 'snow',
    tempExtremes: 'tempExtremes',
    seaLakeIce: 'seaLakeIce',
    waterColor: 'waterColor',
  };
  return categories[id] ?? 'manmade';
}

async function fetchEonetEvents(): Promise<NaturalEvent[]> {
  const data = await fetchJson(EONET_API_URL);
  return (Array.isArray(data.events) ? data.events : [])
    .map((event: any): NaturalEvent | null => {
      const latestGeo = Array.isArray(event.geometry) ? event.geometry[event.geometry.length - 1] : null;
      const coords = latestGeo?.coordinates ?? [];
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (latestGeo?.type !== 'Point' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const category = event.categories?.[0] ?? {};
      if (category.id === 'earthquakes') return null;
      const source = event.sources?.[0] ?? {};
      return {
        id: String(event.id || ''),
        title: String(event.title || ''),
        description: String(event.description || ''),
        category: normalizeEonetCategory(String(category.id || '')),
        categoryTitle: String(category.title || ''),
        lat,
        lon,
        date: Date.parse(String(latestGeo.date || '')) || 0,
        magnitude: Number(latestGeo.magnitudeValue) || 0,
        magnitudeUnit: String(latestGeo.magnitudeUnit || ''),
        sourceUrl: String(source.url || ''),
        sourceName: String(source.id || 'EONET'),
        closed: event.closed !== null,
      };
    })
    .filter((event: NaturalEvent | null): event is NaturalEvent => Boolean(event));
}

async function fetchGdacsEvents(): Promise<NaturalEvent[]> {
  const data = await fetchJson(GDACS_API_URL);
  const map: Record<string, string> = {
    EQ: 'earthquakes',
    FL: 'floods',
    TC: 'severeStorms',
    VO: 'volcanoes',
    WF: 'wildfires',
    DR: 'drought',
  };
  return (Array.isArray(data.features) ? data.features : [])
    .map((feature: any): NaturalEvent | null => {
      const props = feature?.properties ?? {};
      if (props.alertlevel === 'Green') return null;
      const coords = feature?.geometry?.coordinates ?? [];
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (feature?.geometry?.type !== 'Point' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const eventType = String(props.eventtype || 'OT');
      const description = String(props.description || eventType);
      const severity = String(props.severitydata?.severitytext || '');
      return {
        id: `gdacs-${eventType}-${String(props.eventid || props.name || `${lat}:${lon}`)}`,
        title: String(props.name || description),
        description: `${description}${severity ? ` - ${severity}` : ''}`,
        category: map[eventType] ?? 'manmade',
        categoryTitle: description,
        lat,
        lon,
        date: Date.parse(String(props.fromdate || '')) || 0,
        magnitude: 0,
        magnitudeUnit: '',
        sourceUrl: String(props.url?.report || ''),
        sourceName: 'GDACS',
        closed: false,
      };
    })
    .filter((event: NaturalEvent | null): event is NaturalEvent => Boolean(event))
    .slice(0, 100);
}

async function seedNaturalEvents(): Promise<SeedStatus> {
  const results = await Promise.allSettled([fetchEonetEvents(), fetchGdacsEvents()]);
  const events = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = results.filter((result) => result.status === 'rejected');
  const status: SeedStatus = {
    key: 'natural:events:v1',
    status: events.length > 0 ? 'ok' : 'degraded',
    recordCount: events.length,
    ...(failures.length ? { reason: `${failures.length} natural source(s) failed` } : {}),
  };
  return publish('natural:events:v1', { events, fetchedAt: Date.now(), dataAvailable: events.length > 0 }, status, 'natural', 'events');
}

async function seedInternetOutages(): Promise<SeedStatus> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    const status: SeedStatus = {
      key: 'infra:outages:v1',
      status: 'degraded',
      recordCount: 0,
      reason: 'CLOUDFLARE_API_TOKEN not configured',
    };
    await writeMeta('infra', 'outages', status);
    return status;
  }

  const response = await fetch(CF_RADAR_URL, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Cloudflare Radar HTTP ${response.status}`);
  const data = await response.json();
  const outages = (data.result?.annotations ?? []).map((raw: any) => ({
    id: `cf-${String(raw.id || raw.startDate || raw.scope || '')}`,
    title: raw.scope ? `${raw.scope} outage` : 'Internet disruption',
    link: raw.linkedUrl || 'https://radar.cloudflare.com/outage-center',
    description: raw.description ?? '',
    detectedAt: Date.parse(String(raw.startDate || '')) || 0,
    country: raw.locationsDetails?.[0]?.name ?? raw.locations?.[0] ?? '',
    region: '',
    location: { latitude: 0, longitude: 0 },
    severity: raw.outage?.outageType === 'NATIONWIDE' ? 'OUTAGE_SEVERITY_TOTAL' : raw.outage?.outageType === 'REGIONAL' ? 'OUTAGE_SEVERITY_MAJOR' : 'OUTAGE_SEVERITY_PARTIAL',
    categories: ['Cloudflare Radar', raw.outage?.outageCause, raw.outage?.outageType].filter(Boolean),
    cause: raw.outage?.outageCause || '',
    outageType: raw.outage?.outageType || '',
    endedAt: Date.parse(String(raw.endDate || '')) || 0,
  }));

  return publish(
    'infra:outages:v1',
    { outages, pagination: undefined },
    { key: 'infra:outages:v1', status: 'ok', recordCount: outages.length },
    'infra',
    'outages',
  );
}

async function seedWildfireDegradation(): Promise<SeedStatus> {
  const hasFirmsKey = Boolean(process.env.NASA_FIRMS_API_KEY || process.env.FIRMS_API_KEY);
  if (hasFirmsKey) {
    return {
      key: 'wildfire:fires:v1',
      status: 'degraded',
      recordCount: 0,
      reason: 'Vercel cron does not run the long FIRMS regional fetch; use the upstream Railway seeder for live wildfire detections',
    };
  }
  const status: SeedStatus = {
    key: 'wildfire:fires:v1',
    status: 'degraded',
    recordCount: 0,
    reason: 'NASA_FIRMS_API_KEY or FIRMS_API_KEY not configured',
  };
  await Promise.all([
    writeMeta('wildfire', 'fires', status),
    writeMeta('wildfire', 'fires-bootstrap', { ...status, key: 'wildfire:fires-bootstrap:v1' }),
  ]);
  return status;
}

async function warmSignalAtlasDigest(req: Request): Promise<SeedStatus> {
  const url = new URL('/api/news/v1/list-feed-digest?variant=signalatlas&lang=en', req.url);
  const headers: Record<string, string> = { 'User-Agent': CHROME_UA };
  const basicUser = process.env.SIGNALATLAS_BASIC_AUTH_USER;
  const basicPass = process.env.SIGNALATLAS_BASIC_AUTH_PASSWORD;
  if (basicUser && basicPass) {
    headers.Authorization = `Basic ${btoa(`${basicUser}:${basicPass}`)}`;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(18_000) });
  if (!response.ok) {
    return { key: 'news:digest:v1:signalatlas:en', status: 'degraded', recordCount: 0, reason: `digest warm HTTP ${response.status}` };
  }
  const digest = await response.json();
  const count = Array.isArray(digest.categories)
    ? digest.categories.reduce((sum: number, category: any) => sum + (Array.isArray(category.items) ? category.items.length : 0), 0)
    : 0;
  return { key: 'news:digest:v1:signalatlas:en', status: count > 0 ? 'ok' : 'degraded', recordCount: count };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }
  const unauthorized = assertCronAuthorized(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  const tasks = await Promise.allSettled([
    seedEarthquakes(),
    seedNaturalEvents(),
    seedInternetOutages(),
    seedWildfireDegradation(),
    warmSignalAtlasDigest(req),
  ]);

  const statuses = tasks.map((task, index): SeedStatus => {
    if (task.status === 'fulfilled') return task.value;
    const keys = ['seismology:earthquakes:v1', 'natural:events:v1', 'infra:outages:v1', 'wildfire:fires:v1', 'news:digest:v1:signalatlas:en'];
    return {
      key: keys[index] ?? 'unknown',
      status: 'error',
      recordCount: 0,
      reason: task.reason instanceof Error ? task.reason.message : String(task.reason),
    };
  });

  const summary = {
    variant: 'signalatlas',
    startedAt,
    finishedAt: Date.now(),
    statuses,
  };
  await setCachedJson('signalatlas:seed-summary:v1', summary, META_TTL_SECONDS, true);

  const hasErrors = statuses.some((status) => status.status === 'error');
  return json(summary, hasErrors ? 207 : 200);
}
