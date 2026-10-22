# CRM workspace, enquiry and loading release

This increment fixes gaps identified in the authenticated CRM pilot. It does not depend on Railway, send messages, change existing client records, enable AI permissions, or deploy the standalone CRM.

## Behavior

- The plus control beside the workspace selector opens New workspace. It calls the existing crm_create_workspace RPC, receives the new workspace ID, selects it and updates the URL. A creation failure is not retried automatically; reload the workspace list after an uncertain receipt.
- Customer lists render 50 records per page. Complete snapshot data is retained for dashboard calculations. Snapshot pages after the first load with up to three concurrent readers per table. Activity retains its existing latest-500 bound. These are still multiple requests, not a transactionally consistent database snapshot.
- Snapshot and enquiry requests have bounded waiting, and reads for a superseded workspace cannot replace the current view. An initial load has its own state instead of presenting empty dashboard totals as confirmed results.
- Manual enquiries belong to an existing customer in the selected workspace. Staff record subject, message, source and received time, then manage New, Reviewing or Closed status. Latest 20 are displayed. Website forms and Mail ingestion are not automatically connected by this increment.
- The form retains a stable ID after an uncertain save; retries resolve an existing matching receipt rather than generating another ID. Enquiry details are immutable for browser users in this first version; only status is editable. Closing is not deletion.

## Database release prerequisite

Review and apply `supabase/migrations/20261022100008_crm_customer_inquiries.sql` to the shared Workspace CRM project before deploying this UI. It creates the customer enquiry table and workspace-order indexes. It does not recreate existing CRM tables or change membership policies. The UI reports a missing migration explicitly rather than inventing an empty list.

**Never run the SQL bootstrap in production.** `supabase/tests/crm-inquiries-bootstrap.sql` is for a disposable test database only. The CRM intake database verification workflow runs that bootstrap, the real migration, and the grant/RLS tests on PostgreSQL 16.

## Acceptance

- Create another fictional workspace, reload its URL and check that it stays selected and its records are separate.
- Create a fictional contact and enquiry, reload, change enquiry status and verify the result.
- Check viewer read-only and unauthorized workspace behavior.
- Inspect the existing large Onixus workspace, search and page through customers; compare loading latency with the earlier pilot. Do not claim a measured speedup from mocked tests.
- Keep existing customer data and the paused connection-health motion PR separate from this release.
