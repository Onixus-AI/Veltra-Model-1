# Zee AI in Workspace

Zee AI is a Business OS platform. Onyx reads Zee events through `workspace-zee`, a
function on the Zee Supabase project (dpcqgnpoznisqkwkkzhx). Its source lives here, in
`supabase/zee/`, because the Zee app repo is not attached to Workspace work.

Identity, checked on every call (same rules as Signal creative):
1. The caller is signed in to Workspace and owns the business in `x-workspace-id`.
2. The verified Workspace email has a confirmed Zee login (`workspace_zee_identity`,
   service role only).
3. Zee admins see every event; planners see events they own or partner on.

Tools (read only): `upcoming`, `list_events`, `event_overview`. Guest lists, contact
details and notes are never returned. Onyx asks under its own **Zee AI events**
permission (`zee` in the task-access list).

Deploy: apply `supabase/zee/migrations/*` to the Zee project, deploy
`supabase/zee/functions/workspace-zee` there with verify_jwt off, and apply
`supabase/migrations/20261124120000_zee_task_access.sql` to Workspace.
