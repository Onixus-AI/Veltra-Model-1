# CRM and connected-tool actions in Chat

The latest explicit user message can execute scoped CRM commands. The server
resolves the selected saved business conversation; without one, it requires
exactly one owned workspace. Browser-supplied workspace IDs never select a tenant.
Writes require the workspace owner. Provider/database failures return errors, not
claimed action receipts. Mail's existing linking, review, suppression and sending
checks stay in force. Bee commands remain exclusive to LiveAskew.

Examples:
- Show CRM status
- Find CRM companies for Acme
- Enable CRM contact enrichment
- Pause CRM contact enrichment
- Start company discovery from FMCSA contacts
- Research CRM contact for CUSTOMER_UUID at https://company.example/
- Show CRM contact research for CUSTOMER_UUID
- Confirm CRM company CUSTOMER_UUID and use sales@company.example from https://company.example/contact
- Connect Mail to CRM
- Show CRM Mail connection
- Retry pending CRM Mail events
- Show CRM campaigns
- Show CRM campaign CAMPAIGN_UUID
- Pause CRM campaign CAMPAIGN_UUID
- Activate CRM campaign CAMPAIGN_UUID
- Approve CRM message MESSAGE_UUID
- Stop CRM message MESSAGE_UUID
- Add CRM task for CUSTOMER_UUID due 2026-10-20T14:00:00Z: Confirm lane requirements
- Save CRM memory for CUSTOMER_UUID: Prefers written lane quotes
- Complete CRM task TASK_UUID

A campaign can be created paused with `Draft CRM campaign:` followed by JSON
containing name, postal_address, customers (explicit CRM customer UUIDs), steps
(subject, body and delay_days), and optional daily_limit/timezone. The server forces
the resolved workspace and create action. Existing Mail validation requires sourced,
reviewed, unsuppressed contacts, a postal address and valid templates. Each actual
message needs approval; activation alone does not approve drafts. Draft operation
IDs are stable across request retries. Supply a new operation UUID when intentionally
creating another otherwise identical campaign.

GitHub's existing reviewed-file draft-PR endpoint is now callable with `Create a
repository pull request:` followed by repository, branch, connection_version, path,
content, sha, title and operation JSON fields. The backend verifies the selected
repository, connection version and file SHA before creating a draft review branch.
No arbitrary URLs, remote API methods, merges or production releases are exposed.
Other developer connectors retain their currently granted read capabilities; a
connected label does not imply permission to write to the provider.

Customer memories remain proposed until reviewed. A contact-source confirmation
is an explicit owner attestation of company identity, not proof of deliverability
or outreach consent. Contact discovery/enrichment never enrolls or sends campaigns.
