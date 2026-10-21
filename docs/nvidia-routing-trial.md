# NVIDIA-first routing trial

Status: implemented; provider smoke tests and Railway deployment not yet verified.

## Routes

| Route | Primary | First fallback |
| --- | --- | --- |
| Everyday Chat | Nemotron 3.5 Lightning | Qwen 2.5 Coder 32B |
| Deep reasoning | Nemotron 3 Ultra | DeepSeek Chat |
| Connected-tool agent | Nemotron 3.5 Super VL | MiMo v2.6 Flash |
| Chat vision | Nemotron 3.5 Super VL | Qwen 2.5 VL 72B |
| Coding planner | Nemotron 3 Ultra | DeepSeek Chat |
| Coding builder | Nemotron 3.5 Super VL | Qwen 2.5 Coder 32B |
| Coding reviewer | Nemotron 3.5 Super VL | DeepSeek Chat |
| Coding vision | Nemotron 3.5 Super VL | Qwen 3 VL 235B |
| Website builder | Nemotron 3.5 Super VL | Qwen 3.7 Plus |

Explicit MiMo/Ling selections remain explicit. Existing server role overrides remain authoritative and disable automatic model fallbacks for that overridden role.

Routes are sent in priority order through OpenRouter's `models` field in LiteLLM `extra_body`. Tool calls require supported parameters. Provider data collection is denied; requests fail if no eligible provider exists. This does not promise zero retention. Authentication, permissions, reviewed actions, task cancellation and token-based wallet settlement are unchanged.

## Free endpoints

Default routes use paid NVIDIA endpoints. Free NVIDIA trial notices prohibit confidential/personal data and disclose logging; test mode alone does not make real Mail/CRM data synthetic. Existing explicit free aliases are not promoted to defaults. Retrieval embeddings and reranking require a separate ingestion/retrieval implementation and are not installed by this change.

## Verification checklist

- [x] Verify primary IDs and supported parameters against OpenRouter live model catalog (2026-10-21).
- [x] Add checks for primary ordering, tool support, fallback model receipts, token settlement and avoiding free endpoints in default routes.
- [ ] Pass gateway CI tests.
- [ ] Deploy gateway through Railway when available; verify running revision and server role overrides.
- [ ] Run synthetic Chat, tool, vision and coding requests; record actual served models and fallback frequency.
- [ ] Compare cost per completed task, completion rate, latency and retries against the previous configuration.
- [ ] Confirm a measured cost reduction; 50% is a target, not a guarantee.

Coding receipts record both requested and actual served model. OpenRouter activity is the source for provider charges; Veltra wallet credits remain token-based. Compare the same task set and include fallback/retry charges. Roll back using the prior config and routing code together. Do not retry partially executed app actions merely because a model response failed.

References: https://openrouter.ai/docs/guides/routing/model-fallbacks and https://openrouter.ai/docs/guides/routing/provider-selection
