// SignalAtlas variant - signalatlas.worldmonitor.app
// NOTE: This file is a structured canonical description for reference. The
// runtime wiring lives in src/config/panels.ts (SIGNALATLAS_PANELS,
// SIGNALATLAS_MAP_LAYERS, SIGNALATLAS_MOBILE_MAP_LAYERS) — modify both if the
// variant shape changes.
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

export * from './base';

export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'SignalAtlas Map', enabled: true, priority: 1 },
  'disaster-news': { name: 'Disaster News', enabled: true, priority: 1 },
  'outage-news': { name: 'Power & Internet Outage News', enabled: true, priority: 1 },
  insights: { name: 'AI Disaster Insights', enabled: true, priority: 1 },
  forecast: { name: 'AI Risk Forecasts', enabled: true, priority: 1 },
  'threat-timeline': { name: 'Disaster Timeline', enabled: true, priority: 1 },
  'disaster-correlation': { name: 'Disaster Cascade', enabled: true, priority: 1 },
  'internet-disruptions': { name: 'Internet Disruptions', enabled: true, priority: 1 },
  'satellite-fires': { name: 'Wildfire Intelligence', enabled: true, priority: 1 },
  climate: { name: 'Climate Anomalies', enabled: true, priority: 2 },
  'climate-news': { name: 'Climate & Disaster News', enabled: true, priority: 2 },
  'security-advisories': { name: 'Safety Advisories', enabled: true, priority: 2 },
  'world-clock': { name: 'World Clock', enabled: true, priority: 3 },
};

export const DEFAULT_MAP_LAYERS: MapLayers = {
  gpsJamming: false,
  satellites: false,
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  radiationWatch: false,
  sanctions: false,
  weather: true,
  canadaRoads: false,
  canadaAlerts: true,
  economic: false,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: true,
  ucdpEvents: false,
  displacement: false,
  climate: true,
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
  iranAttacks: false,
  ciiChoropleth: false,
  resilienceScore: false,
  dayNight: false,
  miningSites: false,
  processingPlants: false,
  commodityPorts: false,
  webcams: false,
  diseaseOutbreaks: true,
  storageFacilities: false,
  fuelShortages: false,
  liveTankers: false,
};

export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  ...DEFAULT_MAP_LAYERS,
  weather: false,
  canadaAlerts: false,
  fires: false,
  climate: false,
  diseaseOutbreaks: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'signalatlas',
  description: 'Focused disaster and outage monitor for earthquakes, natural hazards, wildfires, internet disruptions, outage news, and AI summaries',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
