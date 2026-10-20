const STRIPE_HOSTS = new Set(["checkout.stripe.com", "billing.stripe.com", "pay.stripe.com"]);
export function billingRedirect(target: string, apiBase: string): string | null {
  let url: URL;
  let api: URL;
  try {
    url = new URL(target);
    api = new URL(apiBase);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (STRIPE_HOSTS.has(url.hostname) || url.hostname === api.hostname) return url.toString();
  return null;
}
