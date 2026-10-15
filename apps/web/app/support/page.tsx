import PublicPage from "@/components/public-page";
export const metadata = {"title": "Support | Veltra"};
const sections = [
  {
    "id": "contact",
    "title": "Contact Veltra",
    "body": "Email info@onixus.xyz. Include the email associated with your account, the feature or provider involved, the approximate time of the issue and a description of what you expected. Share only the information needed to investigate. No particular response time or service-level agreement is promised on this page."
  },
  {
    "id": "credentials",
    "title": "Keep credentials private",
    "body": "Do not email passwords, client secrets, API keys or private keys. Enter provider secrets only in the designated private configuration interface. If you suspect unauthorized access, revoke affected provider credentials and contact support."
  },
  {
    "id": "privacy",
    "title": "Account and privacy requests",
    "body": "For access, correction, export, deletion or account closure requests, email info@onixus.xyz from your account address. We may need to verify identity or your authority to act for a business. Revoking a connector does not delete data you previously created in a third-party service."
  }
];
export default function Page(){return <PublicPage title="Support" intro="Help with access, integrations, usage records and privacy requests." sections={sections}/>;}
