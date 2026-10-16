import PublicPage from "@/components/public-page";
export const metadata = {"title": "Connect your workspace | Veltra"};
const sections = [
  {
    "id": "start",
    "title": "Start with an account",
    "body": "Sign in at veltra-model-1.vercel.app, then open Settings → Connections. Connect accounts you own or have permission to use. Authorization occurs on the provider’s website. Each person connects their own accounts; Veltra’s service credentials are never entered into Chat."
  },
  {
    "id": "github",
    "title": "GitHub",
    "body": "Choose Connect GitHub, review the requested repository and profile permissions, and authorize Veltra. Organization repositories may require organization approval. Choose repository, select an accessible repository and save your selection. Open workspace to browse files in the Code canvas. Open a text file, edit it, or ask Veltra about it. Review original and proposed content before explicitly creating a draft pull request. Veltra creates a separate branch and draft PR; it does not merge the change or write directly to the default branch. New branches and pull requests remain in GitHub after disconnecting."
  },
  {
    "id": "vercel",
    "title": "Vercel",
    "body": "The Vercel connector is being configured. When enabled, choose Connect Vercel, approve installation on the intended account or team and select a project. Open the Deployments tab to view recent deployments and their status. Current permissions are read-only for project and deployment information. Creating deployments, changing domains or modifying environment variables is not included in this connector release."
  },
  {
    "id": "supabase",
    "title": "Supabase",
    "body": "Authorize Veltra for your intended organization, then select a project. Open the Database tab to see project metadata and a dashboard link. The current integration requests project read access. Database row access, arbitrary SQL execution, schema migrations and secret retrieval are not included."
  },
  {
    "id": "railway",
    "title": "Railway",
    "body": "When Veltra’s Railway app setup is complete, connect Railway and choose which projects to share on its consent screen. Veltra requests project viewer access and permission to refresh your authorization. Choose a project in Connections, then open its Railway tab. This release displays the selected project and links to its dashboard; it does not deploy services or change variables."
  },
  {
    "id": "n8n",
    "title": "n8n Cloud",
    "body": "Enter your n8n Cloud instance address, then choose Connect n8n. An instance owner must enable instance-level MCP access in n8n. Approve workflow read access, return to Veltra and choose a workflow. Veltra can show workflow previews and link to the workflow in n8n. This release does not execute or edit workflows. Self-hosted instances are not supported yet."
  },
  {
    "id": "mail",
    "title": "Veltra Mail",
    "body": "Mail works independently at veltra-production-5b9c.up.railway.app. You can optionally connect it to Chat with Google from Connections and open the full Mail workspace in the canvas. Review Mail business settings and approval rules before enabling sending, follow-ups or cleanup. Disconnecting Mail from Chat preserves standalone Mail access and mailbox authorization."
  },
  {
    "id": "disconnect",
    "title": "Disconnect and troubleshoot",
    "body": "Use Disconnect in Connections to remove a developer connection. You can also revoke the app at GitHub, Vercel, Supabase, Railway or n8n. If a repository or project is missing, check provider permissions and organization access, then reconnect if needed. If a file changed remotely, reload it before proposing a PR. A setup-required message means Veltra’s provider app is not configured yet. Contact info@onixus.xyz with the provider, approximate time and a non-secret error description. Never send tokens, passwords or private keys."
  },
  {
    "id": "planned",
    "title": "Planned tools",
    "body": "Expanded Google Workspace, HubSpot, Notion, Canva, Higgsfield, Remotion, team messaging and accounting integrations are on the roadmap. Branded business workspaces and rollover credits are also proposals. Listing a planned capability does not mean it is available or included in a paid plan."
  }
];
export default function Page(){return <PublicPage title="Connect your workspace" intro="A guide to Veltra\u2019s current integrations and developer canvas." sections={sections}/>;}
