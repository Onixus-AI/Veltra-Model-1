-- Mail (Cloud Run) keeps its accounts, approvals and agent checkpoints in a
-- private schema it creates and owns. It can create schemas, not read others.
-- Applied to production on 2026-11-19 when Mail moved from Railway to Cloud Run.
-- The veltra_mail login role is provisioned outside migrations, so skip it where absent.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'veltra_mail') then
    execute format('grant create on database %I to veltra_mail', current_database());
  end if;
end $$;
