# Veltra model policy — 2026-10-23

All inference goes through the server policy: Chat, embedded/standalone CRM planners, coding/design/vision workers, Mail sorting, drafts, quotes, follow-ups, and the Mail configuration assistant.

Free models are tried before paid models. Company exclusions apply even to free models: Anthropic, OpenAI, Google, and xAI are excluded. Unconstrained router aliases are excluded because their targets could violate these exclusions. The reviewed catalog snapshot allows 14 free tool-capable models and 9 paid alternatives. New models require a reviewed catalog refresh, not automatic trust of a provider's whole catalog.

Paid text requests enforce OpenRouter provider.max_price: $0.50 input and $1.00 output per million tokens. Provider routes are sorted by price; prompt collection is denied. A paid model's price increase cannot bypass the request cap. No match produces a failure, never an unrestricted retry. Mail environment overrides are filtered and receive the free-first prefix; coding overrides are rejected if unapproved. The emergency Mail backup is Ling Flash, with the same free-first and cost rules.

Images use the dedicated Image API. Recraft Flash ($0.007/image at verification) is default; Seedream Flash ($0.018/image) is the alternative. There is no verified free image endpoint in this release. Every request checks live endpoint prices and allows only verified per-image charges up to $0.02 for one image. Unknown pricing, extra nonzero fees, and per-megapixel pricing are rejected. FLUX Klein and Qwen Image 3 are removed from the selector. Image and coding image tools share this check. Provider prices can change between preflight and inference; the Image API has no verified transactional quote lock here. Existing Veltra customer credit charges are separate from provider costs.

No video inference endpoint is implemented here; the speculative video catalog is empty until a separate budget is verified. OAuth sign-in and Google Maps integrations are not model inference and remain unchanged.

Public read-only /v1/model-policy reports the deployed policy (no credentials). Model configuration alone does not repair a rejected OpenRouter API key. Chat's key remains separate from Mail's; a valid credential and signed-in smoke test are required for live completion verification.

Sources: https://openrouter.ai/api/v1/models and https://openrouter.ai/api/v1/images/models, plus each approved image model's /endpoints pricing response.
