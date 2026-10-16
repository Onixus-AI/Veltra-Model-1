export const discoverySources=[
 {id:'google_maps',name:'Google Maps',purpose:'Local businesses, locations, websites and published business numbers.',access:'Google Places connection required; usage may be billed.'},
 {id:'openstreetmap',name:'OpenStreetMap',purpose:'Open map data for business and place discovery.',access:'Open-source option; configure a hosted or self-hosted search service.'},
 {id:'linkedin',name:'LinkedIn',purpose:'Companies, owners and decision-makers from permitted exports or approved access.',access:'Import or approved provider connection required; no arbitrary profile or follower scraping.'},
 {id:'social_listening',name:'Social listening',purpose:'Public mentions, buying questions and relevant discussions.',access:'Platform-specific approved API, permitted feed or supplied export required.'},
 {id:'influencers',name:'Influencer discovery',purpose:'Creator profiles, niche, public business contact and partnership history.',access:'Public creator sites, opt-in submissions or a licensed data provider.'},
 {id:'decision_makers',name:'Owners & decision-makers',purpose:'Named business contacts and their verified roles.',access:'Company websites, directories, first-party introductions or licensed export.'},
 {id:'directories',name:'Directories & associations',purpose:'Chambers, trade associations, exhibitors and industry listings.',access:'Onixus research worker already supports directory research; CRM dispatch still needs connecting.'},
 {id:'first_party',name:'Your own leads',purpose:'Forms, referrals, inquiries, Mail contacts and existing customer lists.',access:'Onixus Relay import is available; connected Mail can add real customer conversations.'},
] as const;
