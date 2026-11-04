-- One discovery source per (workspace, provider, category, bounds) blocked a second Google Places search:
-- Places sources have no bounds, so every Places search in a workspace collided (NULLS NOT DISTINCT).
-- The rule now also includes the search text. Map and registry sources have no search text, so for them the
-- rule is unchanged. The same Places search can still be added only once per workspace (case-insensitive).
alter table public.crm_discovery_sources drop constraint if exists crm_discovery_sources_workspace_id_provider_category_bounds_key;
create unique index if not exists crm_discovery_sources_unique_source
 on public.crm_discovery_sources (workspace_id, provider, category, bounds, lower(search_text)) nulls not distinct;
