# CRM campaign release

CRM's focused jobs are to keep customer context together, prepare relevant outreach, deliver the exact approved sequence, and surface replies or delivery problems. This release completes the campaign execution path; it does not claim general autonomous deal decisions or fully repaired Mail ingestion.

## Customer experience

Campaigns replaces the Automation label. Users choose one of five goals: introduce their business, reconnect, book a conversation, follow up on a proposal, or welcome a customer. They select recipients, supply the real offer, edit the sequence and sending settings, then save paused. The saved review shows the audience, exact personalized messages, postal address, opt-out line and schedule. An explicit Run campaign decision approves that saved sequence and starts scheduled delivery.

Automatic follow-ups are optional. If enabled and the sequence is explicitly launched, its saved later steps become approved automatically after the preceding send. If disabled, each later draft requires separate approval. Previous campaigns retain their approval rules. Replies, suppression, sending windows, account limits and uncertain-send holds still apply.

## Backend contract

Veltra-Mail PR55 adds `follow_up_mode` and a `launch` action with a review token. The token binds saved config, sequence, audience and message state. Launch revalidates ownership, recipient eligibility and stops, then approves initial drafts and activates in a transaction. Changed or incomplete snapshots cannot launch. Retrying the same completed launch is idempotent.

The frontend does not send directly. No production campaign was created or sent during verification. Real SQL-engine tests verify execution; browser fixtures verify the screen flow and failure states.

## Boundaries

Audience selection is explicit and limited to 50 per campaign. First-party Onixus promotional branding is not applied to customer playbooks. Campaign cards and review reflect the most recent 500 message records; incomplete campaign snapshots fail launch. Provider receipts mean acceptance, not inbox delivery or earned revenue. General Mail partial-failure recovery remains a separate priority with Cursor.

## Business defaults and appointment booking

Campaigns now saves a business name, default offer, mailing address, HTTPS scheduling link, time zone and daily limit for each authorized Mail-account/CRM-workspace pair. The Mail backend checks the existing outreach workspace authorization before every read or update. New campaigns copy the saved profile; changes do not rewrite existing approved messages. The mailing address is explicitly disclosed as part of the email footer.

For Google Calendar appointment schedule links, every newly prepared message includes a public Workspace `/book?calendar=...` link. That page embeds only Google's official public appointment-schedule URL; it exposes no CRM records or Google grant and requires no Workspace account. Other HTTPS providers keep their direct scheduling link. Availability, lead time, busy-time checks, confirmation, Meet links, cancellation and rescheduling remain owned by the scheduling provider. Google Calendar's existing Workspace sync brings confirmed appointments into its calendar view.

The campaign hub shows aggregate daily queue totals and the Mail process's last successful database pass. A worker check is not proof that a particular message sent: receipts and individual message state remain authoritative. A missing or stale worker check and no running campaigns are shown explicitly. Business contact hours and appointment availability do not alter the existing weekday 9am–5pm outbound sending window.
