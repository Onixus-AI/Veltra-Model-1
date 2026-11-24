# Design Studio connection

Design Studio appears under Business OS in Connections. It is the Onixus
Design Studio: clients design clothing, accessories and merch from inspiration
images, in their brand palette.

Chat talks to the Onixus `design-studio-mcp` connector
(`https://rjwbfkuzgusaoizcmmgf.supabase.co/functions/v1/design-studio-mcp`)
with the signed-in Workspace session. Onixus checks, exactly as it does for
Signal creative, that this user owns the workspace, that the workspace is linked
to a Signal business, and that the linked Signal login shares the verified
Workspace email. The workspace ID is sent as a header from the selected
business; the model never supplies identity, workspace or client fields.

## Supported requests

- What designs do I have left this month? (`context`)
- Show my design projects / open the Spring capsule project (`list_projects`, `get_project`)
- Start a merch drop project (`create_project`)
- Design three colourways of the linen shirt (`generate_design`)

`generate_design` first returns a quote. Workspace saves an exact review for
10 minutes; the person approves it, and Workspace claims the review before the
one confirmed call, so a double click cannot spend two designs. The image opens
in the canvas only if it is a signed link from the private `design-studio`
bucket.

Inspiration images are added on the Onixus Design Studio page
(`/workspace/design-studio`); chat does not upload images.

Design Studio asks for access under the existing Signal permission, because it
uses the same verified Signal business link. A separate permission would need a
change to the task-access app list in the database.

## Configure

1. Ship the Onixus side first (radiant-connect-dash: migration and the
   `design-studio` and `design-studio-mcp` functions), and set
   `DESIGN_STUDIO_WORKSPACE_ENABLED=true` on Onixus.
2. Set `DESIGN_STUDIO_ENABLED=true` here. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is
   already configured.

## Validation

`test/design-studio-agent.test.ts` covers quote → review → one generation,
review reuse, refused identity/extra fields, agency-contact scope, off-bucket
previews, the disabled state, Onixus error reasons, and tool selection. No live
Workspace token or real generation was used.
