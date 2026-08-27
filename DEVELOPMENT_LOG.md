2026-08-18T02:27:57Z

# Development Log

## Refork from World Monitor

- Created branch `cursor/refork-worldmonitor-c9ee` from `main`.
- Fetched upstream source from `https://github.com/koala73/worldmonitor.git`.
- Replaced the branch file tree with upstream `main` at `62ff4bcbb` (`feat(seeders): split whole-budget sections onto 1-section bundles (#6874)`).
- Kept the repository's existing `main` branch untouched; this refork is represented as a normal commit on the feature branch for review and rollback.

## SignalAtlas disaster/outage variant

- Started implementation at `2026-08-27T06:27:33Z`.
- Product scope: internal non-commercial SignalAtlas deployment, public Vercel URL protected by Basic Auth.
- Variant strategy: add a `signalatlas` preset instead of deleting upstream modules, keeping future upstream sync practical.
- Default scope: earthquakes, natural disasters, wildfires, internet disruptions, disaster news, outage news, and AI summary/analysis.
- Deployment target: Vercel + Upstash Redis with 15-minute Vercel Cron seeding and no-key degradation states.
- Deployment trigger refreshed at `2026-08-27T08:40:00Z` after the GitHub repository was made public.
