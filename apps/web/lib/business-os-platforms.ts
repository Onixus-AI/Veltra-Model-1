/** Business OS: finished Onixus platforms other entrepreneurs use from Workspace, without a rebuild.
 * TMS and Signal open their existing Workspace panels; the others have a platform page. */
export type PlatformId = 'zee' | 'design' | 'bee';
export type Platform = {
  id: PlatformId;
  name: string;
  logo: string;
  tagline: string;
  description: string;
  action: {label: string; href: string};
  secondary?: {label: string; href: string};
  steps: string[];
};
export const DESIGN_STUDIO_URL = 'https://www.onixus.xyz/workspace/design-studio';
export const platforms: Record<PlatformId, Platform> = {
  zee: {
    id: 'zee',
    name: 'Zee AI',
    logo: 'Zee AI',
    tagline: 'Business OS · Event planning',
    description: 'Plan events with tasks, vendors, budgets and timelines in one place. Built on the platform behind Zee Event Planning.',
    action: {label: 'Request access', href: 'mailto:info@onixus.xyz?subject=Zee%20AI%20access'},
    steps: ['Request access and tell us about your events business.', 'Onixus sets up your event workspace on the Zee AI platform.', 'Plan events here and let Onyx keep tasks and vendors moving.'],
  },
  design: {
    id: 'design',
    name: 'Onixus Design Studio',
    logo: 'Design Studio',
    tagline: 'Business OS · Fashion and brand design',
    description: 'Design clothing, accessories and merch from your inspiration images: concepts, tech flats and colourways in your brand palette.',
    action: {label: 'Open Design Studio ↗', href: DESIGN_STUDIO_URL},
    steps: ['Open the studio and create a project.', 'Add up to 12 inspiration images.', 'Design concepts, tech flats or colourways. Onyx can check your projects and allowance here.'],
  },
  bee: {
    id: 'bee',
    name: 'LiveAskew / Bee',
    logo: 'LiveAskew / Bee',
    tagline: 'Business OS · Personal styling',
    description: 'An AI stylist with saved looks and an outfit calendar, built on the LiveAskew styling method.',
    action: {label: 'Open LiveAskew ↗', href: 'https://www.liveaskew.com/start'},
    secondary: {label: 'Connect Bee to Onyx', href: '/settings/connections?tool=bee'},
    steps: ['Create your LiveAskew account.', 'Connect Bee here so Onyx can read your looks and calendar.', 'Ask Onyx what to wear, or open Bee for the full app.'],
  },
};
export const isPlatformId = (value: string): value is PlatformId => value in platforms;
