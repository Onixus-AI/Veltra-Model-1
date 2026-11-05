import dns from "node:dns";
import https from "node:https";
import net from "node:net";

// Ported from Onixus Mail (Railway, retired 2026-11).
// Unsubscribing for the business, the way the sender asked to be told:
//  - RFC 8058 one-click: an HTTPS POST of "List-Unsubscribe=One-Click", no page, no confirmation.
//  - mailto: an email to the address the sender gave.
// A plain https link without one-click is a web page meant for a person, so
// it is not "clicked"; the sender is muted instead (their mail goes to the
// shadow archive). Links come from email, so the POST refuses anything but a
// public internet address on port 443, checked at connect time.

export type Unsub = { url: string | null; mailto: string | null; oneClick: boolean };
export type UnsubResult = { method: "one-click" | "mailto" | "none"; ok: boolean; detail: string };

/** From the List-Unsubscribe and List-Unsubscribe-Post headers. */
export function parseUnsubscribe(header: string | undefined, post: string | undefined): Unsub | null {
  if (!header) return null;
  const links = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim());
  const url = links.find((l) => /^https:\/\//i.test(l)) ?? null;
  const mailto = links.find((l) => /^mailto:/i.test(l)) ?? null;
  if (!url && !mailto) return null;
  return { url, mailto, oneClick: Boolean(url) && /List-Unsubscribe=One-Click/i.test(post ?? "") };
}

/** Whether an IP is on the public internet (not private, loopback, link-local, CGNAT, multicast or reserved). */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51) || (a === 203 && b === 0));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]!);
    if (v === "::" || v === "::1") return false;
    return !/^(f[cd]|fe[89ab]|ff|64:ff9b:|2001:db8:|::ffff:)/.test(v);
  }
  return false;
}

/** dns.lookup that refuses non-public addresses, so the check happens on the address actually connected to. */
const publicLookup: net.LookupFunction = (host, opts, cb) => {
  dns.lookup(host, { all: true, family: (opts as dns.LookupOptions).family ?? 0 }, (err, addrs) => {
    if (err) return (cb as (e: Error) => void)(err);
    const bad = addrs.find((a) => !isPublicIp(a.address));
    if (bad || !addrs.length) return (cb as (e: Error) => void)(new Error(`refusing to connect to ${bad?.address ?? host}`));
    if ((opts as dns.LookupAllOptions).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addrs);
    (cb as (e: null, a: string, f: number) => void)(null, addrs[0]!.address, addrs[0]!.family);
  });
};

/** The RFC 8058 POST. Throws unless the sender answered 2xx. */
export function oneClickPost(raw: string, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return reject(new Error("not a valid link"));
    }
    if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) return reject(new Error("only plain https links are followed"));
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !isPublicIp(host)) return reject(new Error(`refusing to connect to ${host}`));
    const body = "List-Unsubscribe=One-Click";
    const req = https.request(u, { method: "POST", lookup: publicLookup, timeout: timeoutMs, headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body), "user-agent": "Onixus-Unsubscribe/1.0" } }, (res) => {
      res.resume();
      const s = res.statusCode ?? 0;
      s >= 200 && s < 300 ? resolve(s) : reject(new Error(`the sender answered ${s}`));
    });
    req.on("timeout", () => req.destroy(new Error("the sender didn't answer in time")));
    req.on("error", reject);
    req.end(body);
  });
}

/** Unsubscribe by the best method the sender offers. Never throws: the result says what happened. */
export function unsubscriber(mailbox: { send(m: { to: string; subject: string; body: string }): Promise<unknown> }, post: (url: string) => Promise<unknown> = oneClickPost) {
  return async (u: Unsub): Promise<UnsubResult> => {
    if (u.url && u.oneClick) {
      try {
        await post(u.url);
        return { method: "one-click", ok: true, detail: `Unsubscribed (one-click, ${new URL(u.url).hostname})` };
      } catch (e) {
        if (!u.mailto) return { method: "one-click", ok: false, detail: `Unsubscribe failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    if (u.mailto) {
      const m = new URL(u.mailto);
      const to = decodeURIComponent(m.pathname);
      if (!/^[^\s@<>,]+@[^\s@<>,]+\.[a-z]{2,}$/i.test(to)) return { method: "mailto", ok: false, detail: "Unsubscribe address isn't valid" };
      await mailbox.send({ to, subject: (m.searchParams.get("subject") || "unsubscribe").slice(0, 200), body: (m.searchParams.get("body") || "unsubscribe").slice(0, 500) });
      return { method: "mailto", ok: true, detail: `Unsubscribed by email to ${to}` };
    }
    return { method: "none", ok: false, detail: "No automatic unsubscribe offered: sender muted instead" };
  };
}
