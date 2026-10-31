# Analytics without hosted quotas

Scope: a separate future Orbit update. The published application and its existing telemetry remain unchanged by this research branch.

## Current integration

`src/lib/analytics.ts` sends opt-in, production-only events to Aptabase Cloud. It already filters event names and properties; it does not send conversations or arbitrary free text. The cloud endpoint and ingestion key are currently fixed in the source. Changing providers will not automatically recover an inaccessible cloud history.

## Options checked

| Option | Commercial event quota | Operational cost / trade-off |
| --- | --- | --- |
| Local SQLite with an in-app statistics view | None | Uses the user's disk; no server or network needed. Best fit for a single-person desktop application. |
| Aptabase self-hosted | No hosted subscription quota | Requires Docker, PostgreSQL, ClickHouse and Aptabase; the host's resources, backups and maintenance remain the owner's responsibility. Closest to the current event API/dashboard. |
| Umami self-hosted | No cloud-plan quota | Requires Node.js/PostgreSQL or Docker, plus adaptation of desktop event ingestion. |
| PostHog Cloud | Free allowance, not unlimited | Official product analytics pricing advertises one million free events per month; this does not satisfy a strict no-quota requirement. |

There is no verified managed cloud option here that is both free and genuinely unbounded. Self-hosted software is not unlimited hardware, and free hosting plans can impose their own limits.

## Recommended direction

For the current single-user Orbit use case, collect allowed events locally and provide counts, activity periods, application versions and session-duration summaries in the app. Preserve opt-in controls and the current property allowlist. Do not add conversation content, filesystem paths, credentials or raw terminal output.

Use SQLite and explicit export/delete controls. State disk usage and retention honestly; do not silently discard data while advertising unlimited history. Start the new history locally; import Aptabase history only through an authorized export if one is available. Keep metrics work separate from the deferred GitHub bug-report feature.

If a central multi-device dashboard becomes necessary, Aptabase self-hosting is the closest migration path. Do not deploy public endpoints, copy example passwords, create accounts or expose services without choosing the hosting scope first.

## Sources

- Aptabase Cloud pricing: https://aptabase.com/pricing
- Official Aptabase self-hosting guide: https://github.com/aptabase/self-hosting
- Official compose stack: https://github.com/aptabase/self-hosting/blob/main/docker-compose.yml
- Umami source and hosting requirements: https://github.com/umami-software/umami
- Umami hosting/pricing: https://umami.is/pricing
- PostHog product analytics pricing: https://posthog.com/product-analytics/pricing

Status: source inspection and documentation research completed. No alternative collector or dashboard has been implemented or deployed.
