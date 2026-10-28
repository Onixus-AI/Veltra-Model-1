# Website Builder and package configuration

Website Builder is an application at `/websites`, linked from the workspace app grid and the sidebar in Personal, Creator, Dev and Business modes. It embeds the MIT-licensed Puck core editor. No Puck Cloud or Puck AI subscription is used. The existing Onyx AI design studio remains at `/design`; it generates HTML separately from the structured Puck project.

## Package configuration

| Plan | Monthly USD | Seats |
| --- | ---: | --- |
| Personal | 11.99 | 1 |
| Creator | 29.00 | 1 |
| Dev | 49.00 | 1 |
| Business | 79.00 | 1 included; 30.00 per additional paid user |

Personal, Creator and Dev exclude CRM and business Mail automation in the proposed package definitions. All plans include Website Builder. Business has a shared wallet; its included allowance is intended to increase per paid user. Creator and Dev prices are implementation proposals selected for the requested package comparison.

The package catalogue in `apps/web/lib/plan-catalog.ts` is display/configuration data, **not an entitlement or payment authority**. Existing account plans, permissions, subscriptions, credit grants and invoices are untouched. Workspace modes do not grant CRM membership or any new data access.

The page includes 14-day card-required trial terms and 25/50 USD one-time top-up packages. Checkout, trial enrollment, credit quantities/conversion rates, automatic seat allowance changes and server-side paid-plan enforcement are **not active**. Package purchase actions remain unavailable. Do not advertise this as an activated subscription system.

Before selling: choose economically validated allowances and top-up conversion, configure provider products, signed/idempotent subscription and payment webhooks, cancellation/trial-end flows, and server-side entitlements. Verify payment receipts and wallet ledger reconciliation before enabling signup.

## Website behavior

- Structured sections: hero, features, story, offer and footer.
- Browser-local editing, responsive preview, downloadable project JSON and HTML export.
- JSON imports are bounded, restricted to known blocks and string props, and cannot install arbitrary React components or executable HTML.
- Export escapes text and restricts links to HTTPS or section anchors.
- No cloud saving, automatic hosting, custom domains, live forms, or public publishing is implemented here. Editor UI explicitly describes these limits and has no publish action.
- Personal users can try the editor. AI generation is separate and requires enough credits for the selected reservation. The UI preflight is advisory; existing server-side wallet reservation is authoritative for every generation request. Uncertain retries reuse the same operation ID, without requiring an additional preflight balance for an existing reservation.
- Maximum reservation is not a fixed website price or a quality/completion guarantee. Existing task receipts report actual usage; unused reservations settle through the existing gateway.
- Imported/generated website content does not receive any new application access or credentials.

## Visual direction

Product-first layout, generous spacing, system sans-serif typography, off-white surfaces, charcoal type, restrained blue CTA, translucent navigation, rounded borderless sections, responsive story layouts and reduced-motion support. This is an original Onixus template; no Apple branding, proprietary fonts or copied imagery. Explicit customer branding overrides the default AI design direction.

App logo: `apps/web/public/brands/onixus-websites-icon-v1.png`, an original generated browser-window/cursor mark matching the existing cyan-purple metallic tool family.

## Verification

Run from `apps/web`:

```
npx --yes --package=tsx@4.20.6 tsx --test test/website-document.test.ts test/plan-catalog.test.ts test/design-document.test.ts test/workspace-mode.test.ts test/setup-profile.test.ts
npm run typecheck
npm run build
```

Browser fixture: bundle `test/browser-websites/main.tsx` with esbuild, JSX automatic, `@` aliased to the web directory and `process.env` defined as `{}`. Load the editor or append `?plans` for the package comparison. Test export/import without production customer data or model calls. Manual browser checks verified edit/preview, real HTML/JSON downloads, the edited title in exported JSON, 390px layout without horizontal overflow, and three Business users at 139 USD.

## HTML imports and in-app Onyx revisions

`Import HTML` opens one `.html`/`.htm` file up to 250 KB, locally. Imported markup uses a separate code editor; it is not converted to Puck blocks. The static preview removes active elements, refresh metadata, external stylesheet links, event attributes and navigation targets. A sandbox with no permissions and a restrictive CSP disable scripts, forms and network access. Original source remains intact for export. Linked assets are not uploaded or resolved.

The in-app `Build with Onyx` panel sends the current HTML and user prompt to the existing authenticated agent-run API only after submission. It shows a 12,000/20,000-credit maximum reservation, checks the available wallet, reuses uncertain request IDs and applies HTML only from a completed run receipt. Existing server-side ownership and credit settlement remain authoritative. The UI can request cancellation and undo the most recent Onyx revision. HTML over 39,000 characters can be edited/exported but cannot be sent for a revision through this bounded context path. No image generation or publishing is invoked.
