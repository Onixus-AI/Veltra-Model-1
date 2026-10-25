import PublicPage from "@/components/public-page";
export const metadata = {"title": "End User License Agreement | Onixus Workspace"};
const sections = [
  {
    "id": "agreement",
    "title": "About this agreement",
    "body": "This agreement is between you and Onixus, the owner and operator of Onixus Workspace, at 4805 Purdue Drive, Boynton Beach, Florida 33435, United States. It governs access to Onixus Workspace, including its browser workspace, Mail service and integrations. By accepting these terms or using the service after they are presented to you, you agree to them. If you do not agree, do not use the service."
  },
  {
    "id": "access",
    "title": "Accounts and permitted use",
    "body": "Use Onixus Workspace only if you can enter a binding agreement and are at least 18. If you use it for a business, you must have authority to act for that business. Keep account credentials private, keep your contact information accurate and notify support of suspected unauthorized access. Subject to these terms and any applicable order, Onixus Workspace grants you a limited, non-exclusive, non-transferable right to use the service for lawful personal or business purposes."
  },
  {
    "id": "content",
    "title": "Your content and permissions",
    "body": "You retain your rights in content you supply. You grant Onixus Workspace permission to host, process, transmit and display that content as reasonably necessary to provide the features you use, maintain security and comply with law. You must have the rights and permissions to submit material, connect accounts and instruct actions. Third-party content and model outputs may carry separate rights; output is not guaranteed to be unique or free of third-party claims. Onixus Workspace retains its rights in the service, software, branding and documentation."
  },
  {
    "id": "ai",
    "title": "AI output and your review",
    "body": "Onixus Workspace uses third-party models and services. AI output may be incomplete, inaccurate, biased or unsuitable for your purpose. Check important facts and review generated code, documents, images and proposed actions before relying on them. You remain responsible for decisions, communications and changes you authorize. Onixus Workspace is not a substitute for qualified legal, medical, financial or other professional advice."
  },
  {
    "id": "connections",
    "title": "Connected accounts and automation",
    "body": "Connect only accounts you control or are authorized to use. Provider consent screens describe the access requested. GitHub edits are proposed through separate branches and draft pull requests. Vercel and Supabase developer features currently display project information; they do not provide unrestricted deployment or SQL execution. Mail may perform enabled sorting, drafts, follow-ups, sending or cleanup according to your business settings and approvals. Review those settings before enabling automation. Provider availability, permissions and terms can affect features. Disconnecting Chat from Mail does not close a standalone Mail account."
  },
  {
    "id": "credits",
    "title": "Fees and credits",
    "body": "Any paid service, credit allowance, renewal, expiration, refund and cancellation terms must be disclosed at purchase or in a separate order. You authorize only charges you accept through that process. This agreement does not establish a price or a rollover-credit program. Do not treat a planned feature as a purchased entitlement. Contact support to dispute an incorrect charge or credit deduction. Nothing here removes mandatory consumer rights."
  },
  {
    "id": "restrictions",
    "title": "Acceptable use",
    "body": "Do not use Onixus Workspace for unlawful activity, fraud, harassment, unauthorized access, malware, exploitation, privacy violations or infringement. Do not bypass access restrictions, disrupt the service or obtain another customer’s data. Do not submit passwords or private keys as ordinary prompts. Do not use Onixus Workspace for autonomous decisions determining someone’s access to employment, housing, credit or similarly consequential services without appropriate human oversight and a separately agreed lawful process."
  },
  {
    "id": "third-parties",
    "title": "Third-party services",
    "body": "GitHub, Google, Vercel, Supabase, OpenRouter and other connected services have their own terms and privacy practices. You are responsible for complying with applicable provider terms. Onixus Workspace does not own the underlying third-party models and does not guarantee that a particular model or connector will remain available."
  },
  {
    "id": "termination",
    "title": "Suspension and termination",
    "body": "You may stop using Onixus Workspace, disconnect integrations or contact support to request account closure. Onixus Workspace may restrict access when reasonably necessary for security, unlawful use, material breach or nonpayment, subject to applicable notice and legal obligations. Closure does not automatically delete data held independently by providers or cancel separate provider subscriptions. The privacy policy explains retention and deletion requests."
  },
  {
    "id": "liability",
    "title": "Service limitations and liability",
    "body": "To the extent permitted by applicable law, the service is provided as available without a promise of uninterrupted operation or error-free output. Onixus Workspace is not responsible for losses caused by unreviewed AI output or unauthorized customer instructions, except where law provides otherwise. Nothing in these terms excludes liability that cannot lawfully be excluded, including applicable statutory rights. Any additional commercial warranties, service levels or limits must be stated in a separate agreement."
  },
  {
    "id": "changes",
    "title": "Changes and contact",
    "body": "Material changes will be communicated through the service or account contact where appropriate, with an effective date. Changes do not override rights already accrued or mandatory law. Questions about terms, access or account closure can be sent to info@onixus.xyz. Legal notices may also be mailed to Onixus at 4805 Purdue Drive, Boynton Beach, Florida 33435, United States."
  }
];
export default function Page(){return <PublicPage title="End User License Agreement" intro="Terms for using Veltra Chat, Veltra Mail and connected workspace tools." sections={sections}/>;}
