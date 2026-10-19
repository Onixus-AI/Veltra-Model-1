# Shared Veltra design and website studio

Connector cards have bounded collapsed heights at desktop/mobile sizes, with native disclosure Settings footers. CRM disconnect and Shopify setup notes are no longer always-expanded content. Developer Settings toggles remain reversible. Workspace Settings moves to the sidebar bottom; Design has its own navigation entry.

Chat, standalone and embedded CRM, and Mail consume identical Veltra theme tokens: black background, #080b0d navigation, #10181d panels, #26363e dividers, #e0eaee text, #a3b5bd secondary text, #9ae8ed cyan, DM Sans and Manrope. Industry/error/status colors retain their meaning. Layout follows each application's content; no Mail or CRM business behavior is replaced.

`/design` uses the existing authenticated, durable OpenRouter-backed coding queue. A user describes a static website, previews index.html, requests revisions, edits source, checks mobile/desktop canvas widths, restores in-session versions and exports HTML. Job IDs resume through the existing owner-scoped endpoint. Credits are reserved visibly before each request and settled by the existing worker. A failed refinement preserves the prior website.

Preview runs in an opaque-origin script-only sandbox with CSP denying remote requests, forms, frames and objects. Generated websites use inline CSS/JS/SVG. No new AI provider, credential bridge, third-party publication, payment or email tool is introduced. Website hosting and real backend services require separate integration; the interface explicitly says so.

Follow-up: dedicated CRM and Mail artwork now comes from the owner's supplied files. Mail uses an SVG viewBox to crop the original transparent envelope artwork at display time; original pixels are embedded unchanged. Compact navigation preserves product icons, only Personal/Work controls stay in the top bar, the duplicate CRM context link is removed and Bee navigation requires a successful live connected status.

The richer Design profile uses Qwen3-Coder-Next through OpenRouter (model ID verified against the live OpenRouter catalog), supports 40,000-character revision context and up to 8,000 builder output tokens within the existing 20,000-credit reservation limit. Code-mode defaults stay the same. Planner context is bounded separately to preserve the task budget. No claim of universal design quality or full application/backend publishing is made.
