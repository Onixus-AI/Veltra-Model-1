"use client";

import Link from "next/link";
import LogoutButton from "@/components/logout-button";
import UsageDashboard from "@/components/usage-dashboard";
import PlanPackages from "@/components/plan-packages";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, Copy, CreditCard, KeyRound, LoaderCircle,
  Sparkles, TrendingDown, Wallet, X,
} from "lucide-react";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";

type SettingsTab = "usage" | "keys" | "subscription" | "account";

type ConsumptionDay = { date: string; credits: number };
type Account = {
  api_key_prefix: string | null;
  credits_remaining: number;
  monthly_credit_allowance: number;
  plan_name: string;
  monthly_price_cents: number;
  billing_period_end: string;
  consumption: ConsumptionDay[];
};
// plan_name is stored data; legacy Veltra values are relabeled for display only.
const planLabel = (name: string) => name.replace(/^Veltra\b/, "Onixus");
type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  is_current?: boolean;
};
type CreatedKey = ApiKey & { api_key: string };

const tabs: { id: SettingsTab; label: string; icon: typeof Wallet }[] = [
  { id: "usage", label: "Usage & Analytics", icon: TrendingDown },
  { id: "keys", label: "Developer API Keys", icon: KeyRound },
  { id: "subscription", label: "Plans & billing", icon: CreditCard },
  { id: "account", label: "Account & privacy", icon: AlertTriangle },
];

async function authorizationHeaders(): Promise<HeadersInit> {
  return gatewayAuthorizationHeaders();
}

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`,
    );
  }
  return data as T;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("usage");
  const [account, setAccount] = useState<Account | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await authorizationHeaders();
      const [accountResponse, keysResponse] = await Promise.all([
        fetch("/api/account", { headers, cache: "no-store" }),
        fetch("/api/keys", { headers, cache: "no-store" }),
      ]);
      const [accountData, keyData] = await Promise.all([
        responseData<Account>(accountResponse),
        responseData<ApiKey[]>(keysResponse),
      ]);
      setAccount(accountData);
      setKeys(keyData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const tab=new URLSearchParams(window.location.search).get("tab");if(tab==="subscription"||tab==="usage"||tab==="keys"||tab==="account")setActiveTab(tab); }, []);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newKeyName.trim();
    if (!name) return;
    setWorking(true);
    setError("");
    try {
      const created = await responseData<CreatedKey>(await fetch("/api/keys", {
        method: "POST",
        headers: { ...await authorizationHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }));
      setCreatedKey(created);
      setNewKeyName("");
      setKeys((existing) => [created, ...existing]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create API key.");
    } finally {
      setWorking(false);
    }
  }

  async function revokeKey(key: ApiKey) {
    if (!window.confirm(`Revoke the "${key.name}" API key? This cannot be undone.`)) return;
    setRevokingId(key.id);
    setError("");
    try {
      const response = await fetch(`/api/keys?id=${encodeURIComponent(key.id)}`, {
        method: "DELETE",
        headers: await authorizationHeaders(),
      });
      await responseData<unknown>(response);
      setKeys((existing) => existing.filter(({ id }) => id !== key.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke API key.");
    } finally {
      setRevokingId("");
    }
  }

  async function copyCreatedKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.api_key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const activeBalance = account?.credits_remaining ?? 0;
  const balancePercent = Math.max(0, Math.min(100, (activeBalance / Math.max(1,account?.monthly_credit_allowance??1)) * 100));

  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to workspace</Link>
        <div className="brand-lockup"><span className="brand-mark"><img src="/veltra-logo.png" alt="Onixus Workspace logo" /></span> Onixus Workspace</div>
        <LogoutButton/>
      </header>

      <section className="settings-content settings-dashboard">
        <div className="settings-heading">
          <span className="eyebrow">WORKSPACE SETTINGS</span>
          <h1>Settings &amp; analytics</h1>
          <Link href="/settings/connections" className="back-link">Workspace connections →</Link>
          <p>Your credits, developer access, and subscription in one place.</p>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              className={`settings-tab ${activeTab === id ? "is-active" : ""}`}
              id={`settings-tab-${id}`}
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`settings-panel-${id}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {error && <div className="settings-error" role="alert"><AlertTriangle size={15} />{error}</div>}
        {loading ? (
          <div className="settings-loading"><LoaderCircle size={19} className="spin" /> Loading your settings…</div>
        ) : (
          <>
            {activeTab === "account" && <section id="settings-panel-account" className="settings-tab-panel settings-card" role="tabpanel" aria-labelledby="settings-tab-account">
              <h2>Account, security & privacy</h2><p>Manage access and request help with your account data.</p>
              <p><Link href="/settings/connections">Manage and disconnect connected apps →</Link></p>
              <p><Link href="/settings/keys">Manage developer access →</Link></p>
              <h3>Export your data</h3><p>Request an export of your account and server records from your account email.</p><a className="button button-secondary" href="mailto:info@onixus.xyz?subject=Onixus%20Workspace%20data%20export%20request">Request data export</a>
              <h3>Delete or close your account</h3><p>Request deletion from your account email. Support verifies ownership, confirms affected records and explains any required retention before closing the account. Separate provider subscriptions must be cancelled with those providers.</p><a className="button button-secondary" href="mailto:info@onixus.xyz?subject=Onixus%20Workspace%20account%20deletion%20request">Request account deletion</a>
              <p><Link href="/privacy">Privacy policy</Link> · <Link href="/eula">Terms</Link> · <a href="mailto:info@onixus.xyz?subject=Onixus%20Workspace%20support">Contact support</a></p>
            </section>}
            {activeTab === "usage" && (
              <section id="settings-panel-usage" className="settings-tab-panel" role="tabpanel" aria-labelledby="settings-tab-usage">
                <div className="balance-grid">
                  <article className="settings-card balance-card balance-primary">
                    <span className="balance-icon"><Wallet size={16} /></span>
                    <p>Active Balance</p>
                    <strong>{account ? `${activeBalance.toLocaleString()}` : "Unavailable"}</strong>
                    <span className="balance-caption">credits available</span>
                    <div className="credit-track"><div className="credit-fill" style={{ width: `${balancePercent}%` }} /></div>
                  </article>
                </div>
                <div className="credit-rollover-banner" role="note">
                  Your current balance and allowance come from your account. Purchase terms determine renewal, expiration and rollover.
                </div>
                <UsageDashboard/>
                <p className="settings-note">Monthly allowance: {account?.monthly_credit_allowance?.toLocaleString() ?? "Unavailable"} credits.</p>
              </section>
            )}

            {activeTab === "keys" && (
              <section id="settings-panel-keys" className="settings-tab-panel" role="tabpanel" aria-labelledby="settings-tab-keys">
                <section className="settings-card keys-panel">
                  <div className="settings-section-title">
                    <span className="card-icon"><KeyRound size={17} /></span>
                    <div><h2>Developer API keys</h2><p>Create credentials for your own apps and developer tools.</p></div>
                  </div>
                  {createdKey && (
                    <div className="created-key-notice" role="status">
                      <div><strong>Your new key is ready</strong><p>Copy it now. For your security, the full key is shown only once.</p></div>
                      <button className="button button-secondary" type="button" onClick={() => void copyCreatedKey()}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy key"}
                      </button>
                      <code>{createdKey.api_key}</code>
                      <button className="created-key-close icon-button" type="button" onClick={() => setCreatedKey(null)} aria-label="Dismiss new key"><X size={15} /></button>
                    </div>
                  )}
                  <form className="create-key-form" onSubmit={(event) => void createKey(event)}>
                    <label className="field-label" htmlFor="key-name">Key name</label>
                    <div className="key-input-row">
                      <input id="key-name" value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} maxLength={80} placeholder="e.g. Production app" required />
                      <button className="button button-primary create-key-button" type="submit" disabled={working || !newKeyName.trim()}>
                        {working ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}
                        {working ? "Creating…" : "Generate key"}
                      </button>
                    </div>
                  </form>
                  <div className="key-list-heading"><h3>Your keys</h3><span>{keys.length} active</span></div>
                  {keys.length ? (
                    <div className="managed-key-list">
                      {keys.map((key) => (
                        <article className="managed-key" key={key.id}>
                          <span className="managed-key-icon"><KeyRound size={15} /></span>
                          <div className="managed-key-info">
                            <strong>{key.name}</strong>
                            <code>{key.key_prefix}••••••••</code>
                            <span>{key.is_current ? "Currently authorizing this browser session" : `Created ${new Date(key.created_at).toLocaleDateString()} · ${key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}` : "Not used yet"}`}</span>
                          </div>
                          <button
                            className="icon-button revoke-key-button"
                            type="button"
                            aria-label={key.is_current ? `${key.name} authorizes this browser session` : `Revoke ${key.name}`}
                            disabled={key.is_current || revokingId === key.id}
                            onClick={() => void revokeKey(key)}
                          >
                            {revokingId === key.id ? <LoaderCircle size={15} className="spin" /> : key.is_current ? <Check size={15} /> : <X size={16} />}
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : <p className="empty-keys">No developer keys yet. Generate one to connect your tools.</p>}
                </section>
                <p className="settings-note">Store your secret keys securely. Onixus Workspace stores only a one-way hash and will not show a key again after creation.</p>
              </section>
            )}

            {activeTab === "subscription" && (
              <section id="settings-panel-subscription" className="settings-tab-panel" role="tabpanel" aria-labelledby="settings-tab-subscription">
                <section className="settings-card subscription-card">
                  <div className="subscription-top">
                    <div className="subscription-symbol"><Sparkles size={20} /></div>
                    <span className="plan-status">{account?planLabel(account.plan_name):"Plan unavailable"}</span>
                  </div>
                  <span className="eyebrow">YOUR SUBSCRIPTION</span>
                  <h2>{account?planLabel(account.plan_name):"Your plan"}</h2>
                  <p>Everything your team needs to think, build, and move faster.</p>
                  <div className="subscription-price"><strong>{account?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(account.monthly_price_cents/100):"Unavailable"}</strong><span>/ month</span></div>
                  <div className="subscription-rule" />
                  <h3>Manage billing</h3><p>For plan changes, invoices, payment methods, cancellation or refunds, contact billing from your account email. Self-service checkout is not connected yet.</p>
                  <a className="button button-secondary" href="mailto:info@onixus.xyz?subject=Onixus%20Workspace%20billing%20request">Contact billing</a>
                  <div className="allocation-row">
                    <div><span>Monthly credit allocation</span><strong>{account?.monthly_credit_allowance?.toLocaleString() ?? "Unavailable"} credits</strong></div>
                    <div><span>Active balance</span><strong>{account?.credits_remaining.toLocaleString() ?? "—"} credits</strong></div>
                  </div>
                  <div className="allocation-track"><div style={{ width: `${balancePercent}%` }} /></div>
                  <p className="renewal-date">{account?.billing_period_end ? `Billing period ends ${new Date(account.billing_period_end).toLocaleDateString()}` : "Your credit allocation is on a rolling 30-day basis."}</p>
                </section>
                <PlanPackages />
                <div className="subscription-footnote"><Check size={14} /><span>Review your accepted purchase terms for renewal and rollover details.</span></div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
