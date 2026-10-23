"""Fail-closed model allowlist shared by Chat, CRM, coding and image tools."""
import json
from pathlib import Path
import math

POLICY = json.loads(Path(__file__).with_name('model-policy.json').read_text())
ALLOWED = set(POLICY['free_models'] + POLICY['paid_models'])


def routing_options(primary, fallbacks=(), *, tools=False):
    models = list(dict.fromkeys(model.removeprefix('openrouter/') for model in [primary, *fallbacks]))
    if not models or any(model not in ALLOWED for model in models):
        raise ValueError('Model is outside Veltra free/low-cost policy')
    # Free first even for environment overrides. No unconstrained router aliases.
    models.sort(key=lambda model: model not in POLICY['free_models'])
    provider = {'allow_fallbacks': True, 'data_collection': 'deny', 'sort': 'price',
                'ignore': POLICY['blocked_providers'], 'max_price': POLICY['max_price']}
    if tools:
        provider['require_parameters'] = True
    return {'models': models, 'provider': provider}


async def image_provider(client, model):
    if model not in POLICY['image_models']:
        raise ValueError('Image model is outside Veltra low-cost policy')
    # Verify live per-image prices before spending; unknown or per-megapixel
    # pricing is rejected because output dimensions cannot be capped here.
    response = await client.get('https://openrouter.ai/api/v1/images/models/' + model + '/endpoints')
    response.raise_for_status()
    allowed = []
    for endpoint in response.json().get('endpoints', []):
        prices = endpoint.get('pricing', [])
        outputs = [p for p in prices if p.get('billable') == 'output_image']
        try:
            valid = len(outputs) == 1 and outputs[0].get('unit') == 'image'
            cost = float(outputs[0]['cost_usd']) if valid else float('inf')
            # Other nonzero charges also make the total unverifiable.
            valid = valid and all(p == outputs[0] or float(p['cost_usd']) == 0 for p in prices)
            valid = valid and math.isfinite(cost) and 0 <= cost <= POLICY['image_max_usd']
        except (KeyError, TypeError, ValueError):
            valid = False
        slug = endpoint.get('provider_slug')
        if valid and slug and slug not in POLICY['blocked_providers']:
            allowed.append(slug)
    if not allowed:
        raise ValueError('No image endpoint within Veltra price limit')
    return {'only': allowed, 'allow_fallbacks': False, 'data_collection': 'deny',
            'max_price': {'image': POLICY['image_max_usd']}}
