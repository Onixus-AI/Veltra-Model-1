# Veltra Workspace

Veltra opens directly into the workspace. The separate business overview remains at `/workspace`.

- **Personal:** everyday Chat, files, images, Mail, personal connector categories.
- **Dev:** Chat, Super Coder, GitHub, Vercel, Supabase, Railway, n8n, development connector categories.
- **Business:** Chat, Mail, CRM, Business OS, customer context and business connector categories.

The raised cyan mode pills stay in the top bar. Mode preferences persist; the previous `work` preference maps to Business. Switching modes closes the current tool and loads the relevant conversation context; clicking the selected mode does nothing. Personal and Dev do not inherit a selected business/customer. Saved records and account permissions are preserved. Modes organize the interface; they are not new authorization boundaries or independent account stores.

Mail and CRM open inside the shared tool panel. A width slider adjusts the split on desktop; expand/retract hides or restores Chat without remounting the open panel. Mobile keeps Chat and tool tabs. Tool access uses the existing authorization flows.

Veltra Business OS is an operations hub using the existing business activity monitor. It opens Mail, CRM, Onixus TMS and Shopify through their existing connectors; it does not imply new autonomous workflows.

Chat messages have individual containers. Short answers stay fully visible. Longer answers show a bounded preview and native expandable Details containing the complete Markdown and code. No reply content is removed. Conversation guidance requests concise responses and preserves complete deliverables.

Validation: six behavior tests cover mode migration and tool grouping, concise/long response rendering, complete code retention and inert HTML. TypeScript and production build are checked separately. Signed-in visual and interaction verification is still required. Preview deployments currently lack sign-in configuration; production credentials were not copied into Preview.
