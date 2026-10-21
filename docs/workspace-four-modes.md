# Four workspace modes

Personal, Dev, Creator, and Business share the black workspace shell, cyan controls, command navigation, and optional Chat pane. Service businesses use Business tools rather than a fifth mode.

| Mode | Existing entry points | Purpose |
| --- | --- | --- |
| Personal | Chat, Mail, project files, selected personal connectors | Organize the day and personal projects |
| Dev | Super Coder, GitHub, Vercel, Supabase, Railway, n8n | Build, review, preview, and release software using granted capabilities |
| Creator | Chat, image creation, project files, Mail, creative connector catalog | Develop briefs, create images, and prepare campaigns |
| Business | CRM, Mail, Business OS, commerce and service tools | Operate customer workflows and review outreach |

Creator's catalog includes creative, marketing, community, and knowledge tools. A catalog entry does not imply an available integration. Existing planned statuses and connection checks remain authoritative. This increment does not implement video production, scheduling, or automatic publishing.

The mode parser accepts saved `personal`, `dev`, and `business` values and migrates legacy `work` to `business`. `creator` works in saved preferences and `?mode=creator` links. Opening Mail preserves the selected mode; opening development or customer-operation tools selects their relevant mode.

Unsent text, image-mode choice, project files, and the current artifact are held separately for each mode during this mounted workspace session. Mode changes reset active tool and cloud selection as before. These drafts are not durable project storage, new permission boundaries, or separately scoped cloud histories. Cloud conversation access remains enforced by the existing account/workspace rules.

Verification includes four-mode parsing, connector filtering, per-mode starter prompts, browser mode switching and draft restoration, relevant sidebar actions, and mobile layout. Personalization and backgrounds are deferred to the roadmap.
