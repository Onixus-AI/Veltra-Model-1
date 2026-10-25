import PublicPage from "@/components/public-page";
export const metadata = {"title": "Privacy Policy | Onixus Workspace"};
const sections = [
  {
    "id": "scope",
    "title": "Scope and operator",
    "body": "This policy covers Onixus Chat, Onixus Mail and integrations operated as part of Onixus Workspace. Onixus owns and operates Onixus Workspace and is responsible for the handling of information described here. Our mailing address is 4805 Purdue Drive, Boynton Beach, Florida 33435, United States. Privacy questions and requests can be sent to info@onixus.xyz. A business using Onixus Workspace may separately control the personal data it uploads; its own privacy responsibilities still apply."
  },
  {
    "id": "data",
    "title": "Information processed",
    "body": "Onixus Workspace processes account identifiers such as email and user ID; prompts, responses, files and images submitted to its features; connected-account identifiers, authorization credentials and selected resources; usage and credit records; and operational information needed to run and secure the service. Mail can process email bodies, headers, recipients, attachments, labels, drafts, business settings and related workflow records. GitHub features access authorized repository metadata and files. Vercel and Supabase features process selected-project metadata and deployment information where applicable. Do not upload information you are not authorized to share."
  },
  {
    "id": "purposes",
    "title": "How information is used",
    "body": "Information is used to authenticate users, operate requested features, generate responses, manage permitted integrations and automation, account for usage, respond to support requests, investigate failures and protect the service. Connected data is accessed according to the permissions granted and features enabled. Selecting a repository or project guides Onixus Workspace’s workflow but does not necessarily narrow the provider token’s underlying scope; provider consent screens and account controls describe that scope."
  },
  {
    "id": "ai",
    "title": "AI services and content sharing",
    "body": "Prompts and the content included in AI tasks are transmitted through OpenRouter to the model providers serving those tasks. Email content may be included when enabled Mail automation sorts messages, drafts replies or performs other AI tasks. Repository content is included when you choose to share it with Chat. Those services may process information in other countries, and retention or training practices vary by provider and account configuration. Onixus Workspace does not promise zero retention across all providers. Review OpenRouter’s privacy policy and the applicable model provider’s practices before submitting sensitive information."
  },
  {
    "id": "google",
    "title": "Google user data",
    "body": "Google sign-in supplies account identity information. Optional Mail authorization requests permissions to read and modify Gmail messages, send email and manage supported Gmail settings for enabled features. Google authorization for Mail does not grant Drive, Docs, Sheets or Calendar access. Onixus Workspace uses Google user data to provide the connected features you request, not to sell it, target advertising or train generalized AI models. Onixus Workspace’s use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including Limited Use requirements. Service-provider processing is limited to delivering permitted user-facing features, security, legal obligations and other uses allowed by that policy."
  },
  {
    "id": "sharing",
    "title": "Service providers and disclosures",
    "body": "Onixus Workspace relies on Vercel for the web application, Railway for backend hosting and database services, Supabase for authentication and application data, and OpenRouter and model providers for AI processing. Google and GitHub process connected-service requests; other providers process requests when their integrations are enabled. Infrastructure providers may process technical logs and network information. Site fonts may be requested from Google Fonts. Information may also be disclosed when required by law, needed to protect rights or security, directed by you, or necessary for a business transfer with appropriate protections. This list describes the current architecture rather than promising any particular geographic hosting location."
  },
  {
    "id": "storage",
    "title": "Storage and retention",
    "body": "Chat history is saved in the browser’s local storage and generated images may be saved in its IndexedDB storage. Clearing local chat history or browser data affects those copies; it does not delete provider logs or server records. Account, credit, Mail workflow and integration records may be stored on backend systems. Integration credentials are encrypted on the backend. Records are retained for as long as reasonably necessary to provide the service, maintain security, resolve disputes and meet accounting or legal obligations. The period depends on the record and the purpose for which it is held. You can request deletion through support. Deletion from active systems may precede removal from backups; information required for legal compliance or an unresolved dispute may be retained for that purpose."
  },
  {
    "id": "controls",
    "title": "Choices and requests",
    "body": "You can disconnect developer integrations in Connections and revoke provider access through the provider’s own account settings. Removing a developer connection deletes Onixus Workspace’s stored connection credentials and selected resource. Disconnecting Mail from Chat preserves the standalone Mail account and mailbox connection; disconnect those separately when desired. To request access, correction, export or deletion of account or server-side data, contact info@onixus.xyz from your account email. Identity or authority verification may be required. Applicable law determines your rights, response deadlines and any exceptions; you may also complain to the relevant regulator."
  },
  {
    "id": "security",
    "title": "Security and international processing",
    "body": "Onixus Workspace uses authentication, account-scoped access controls, encrypted integration credential storage and secure transport for its supported services. No system is completely secure. Providers and support operations may process data outside your country. Transfer safeguards and any required customer data-processing agreement must be assessed for your use case before sending regulated or sensitive data. There is no claim that all customer content is end-to-end encrypted or that any particular certification applies."
  },
  {
    "id": "children",
    "title": "Children and policy updates",
    "body": "Onixus Workspace is intended for adults and is not directed to children under 18. Contact support if a child has supplied personal data. Material policy changes will be reflected with a new effective date and communicated where appropriate. Contact Onixus at info@onixus.xyz or the mailing address above with questions about this notice."
  }
];
export default function Page(){return <PublicPage title="Privacy Policy" intro="How Onixus Workspace handles account information, workspace content and connected services." sections={sections}/>;}
