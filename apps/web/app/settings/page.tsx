"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, Copy, CreditCard, KeyRound, LoaderCircle,
  Sparkles, TrendingDown, Wallet, X,
} from "lucide-react";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";

type SettingsTab = "usage" | "keys" | "subscription";

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
  { id: "subscription", label: "Subscription", icon: CreditCard },
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

function ConsumptionChart({ consumption }: { consumption: ConsumptionDay[] }) {
  const points = useMemo(() => {
    const amounts = new Map(consumption.map(({ date, credits }) => [date, credits]));
    const today = new Date();
    const lastThirtyDays = Array.from({ length: 30 }, (_, index) => {
      const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29 + index));
      const date = day.toISOString().slice(0, 10);
      return { date, credits: amounts.get(date) ?? 0 };
    });
    const max = Math.max(1, ...lastThirtyDays.map(({ credits }) => credits));
    return lastThirtyDays.map(({ date, credits }, index) => ({
      date,
      credits,
      x: 12 + (index * 576) / 29,
      y: 170 - (credits / max) * 145,
    }));
  }, [consumption]);
  const areaPath = `M ${points[0].x} 170 ${points.map(({ x, y }) => `L ${x} ${y}`).join(" ")} L ${points[points.length - 1].x} 170 Z`;
  const linePath = points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

  return (
    <div className="analytics-chart">
      <div className="analytics-chart-heading">
        <div><h3>Credit consumption</h3><p>Daily usage over the last 30 days</p></div>
        <span><i /> Credits used</span>
      </div>
      <svg viewBox="0 0 600 210" role="img" aria-label="Area chart of daily credit consumption over the past 30 days">
        <defs>
          <linearGradient id="usage-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#a995ff" stopOpacity=".35" />
            <stop offset="100%" stopColor="#a995ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 73, 121, 170].map((y) => <line key={y} x1="12" x2="588" y1={y} y2={y} className="chart-gridline" />)}
        <path d={areaPath} fill="url(#usage-area)" />
        <path d={linePath} className="chart-line" />
      </svg>
      <div className="chart-dates"><span>{points[0].date}</span><span>Today</span></div>
    </div>
  );
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
  const balancePercent = Math.max(0, Math.min(100, (activeBalance / 10_000) * 100));

  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to workspace</Link>
        <div className="brand-lockup"><span className="brand-mark"><Sparkles size={16} /></span> veltra</div>
      </header>

      <section className="settings-content settings-dashboard">
        <div className="settings-heading">
          <span className="eyebrow">WORKSPACE SETTINGS</span>
          <h1>Settings &amp; analytics</h1>
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
            {activeTab === "usage" && (
              <section id="settings-panel-usage" className="settings-tab-panel" role="tabpanel" aria-labelledby="settings-tab-usage">
                <div className="balance-grid">
                  <article className="settings-card balance-card balance-primary">
                    <span className="balance-icon"><Wallet size={16} /></span>
                    <p>Active Balance</p>
                    <strong>{account ? `${activeBalance.toLocaleString()} / 10,000` : "— / 10,000"}</strong>
                    <span className="balance-caption">max credits</span>
                    <div className="credit-track"><div className="credit-fill" style={{ width: `${balancePercent}%` }} /></div>
                  </article>
                </div>
                <div className="credit-rollover-banner" role="note">
                  Your credits never expire while your subscription is active! Max rollover balance cap: 10,000 credits.
                </div>
                <section className="settings-card chart-card">
                  <ConsumptionChart consumption={account?.consumption ?? []} />
                </section>
                <p className="settings-note">Your monthly 3,000-credit allocation rolls over up to a maximum balance of 10,000 credits.</p>
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
                <p className="settings-note">Store your secret keys securely. Veltra stores only a one-way hash and will not show a key again after creation.</p>
              </section>
            )}

            {activeTab === "subscription" && (
              <section id="settings-panel-subscription" className="settings-tab-panel" role="tabpanel" aria-labelledby="settings-tab-subscription">
                <section className="settings-card subscription-card">
                  <div className="subscription-top">
                    <div className="subscription-symbol"><Sparkles size={20} /></div>
                    <span className="plan-status"><i /> ACTIVE PLAN</span>
                  </div>
                  <span className="eyebrow">YOUR SUBSCRIPTION</span>
                  <h2>Veltra Business OS</h2>
                  <p>Everything your team needs to think, build, and move faster.</p>
                  <div className="subscription-price"><strong>$59</strong><span>/ month</span></div>
                  <div className="subscription-rule" />
                  <div className="allocation-row">
                    <div><span>Monthly credit allocation</span><strong>{account?.monthly_credit_allowance.toLocaleString() ?? "3,000"} credits</strong></div>
                    <div><span>Active balance</span><strong>{account?.credits_remaining.toLocaleString() ?? "—"} credits</strong></div>
                  </div>
                  <div className="allocation-track"><div style={{ width: `${balancePercent}%` }} /></div>
                  <p className="renewal-date">{account?.billing_period_end ? `Billing period ends ${new Date(account.billing_period_end).toLocaleDateString()}` : "Your credit allocation is on a rolling 30-day basis."}</p>
                </section>
                <div className="subscription-footnote"><Check size={14} /><span>Credits roll over monthly up to a 10,000-credit balance cap.</span></div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
