"""Fail-closed model allowlist shared by Chat, CRM, coding and image tools."""
import json
from pathlib import Path
import math

POLICY = json.loads(Path(__file__).with_name('model-policy.json').read_text())
ALLOWED = set(POLICY['free_models'] + POLICY['paid_models'])
CHAT_ALLOWED = ALLOWED | set(POLICY['chat_models'])


def routing_options(primary, fallbacks=(), *, tools=False, route=None):
    chat = route in POLICY['chat_routes']
    models = list(dict.fromkeys(model.removeprefix('openrouter/') for model in [primary, *fallbacks]))
    if not models or any(model not in (CHAT_ALLOWED if chat else ALLOWED) for model in models):
        raise ValueError('Model is outside Veltra free/low-cost policy')
    if chat:
        # Chat keeps its quality order; free models may only be a last resort.
        if models[0] in POLICY['free_models']:
            raise ValueError('Chat primary must not be a free model')
        max_price = POLICY['chat_route_max_price'].get(route, POLICY['chat_max_price'])
        provider = {'allow_fallbacks': True, 'data_collection': 'deny', 'sort': 'latency',
                    'ignore': POLICY['blocked_providers'], 'max_price': max_price}
        if tools:
            provider['require_parameters'] = True
        return {'models': models[:3], 'provider': provider}
    # Free first even for environment overrides. No unconstrained router aliases.
    models.sort(key=lambda model: model not in POLICY['free_models'])
    provider = {'allow_fallbacks': True, 'data_collection': 'deny', 'sort': 'price',
                'ignore': POLICY['blocked_providers'], 'max_price': POLICY['max_price']}
    if tools:
        provider['require_parameters'] = True
    return {'models': models[:3], 'provider': provider}


def _tool_choice_kind(tool_choice):
    if isinstance(tool_choice, dict):
        return 'function'
    return tool_choice if tool_choice in ('none', 'required') else 'auto'


def request_groups(primary, fallbacks=(), *, tools=False, tool_choice=None, route=None):
    """Return ordered (free, extra_body) request groups.

    Chat is one deny group. Other routes try free-only groups first, without
    data_collection deny (the account allows training on free endpoints), then
    paid-only groups that always deny.
    """
    if route in POLICY['chat_routes']:
        return [(False, routing_options(primary, fallbacks, tools=tools, route=route))]
    models = list(dict.fromkeys(model.removeprefix('openrouter/') for model in [primary, *fallbacks]))
    if not models or any(model not in ALLOWED for model in models):
        raise ValueError('Model is outside Veltra free/low-cost policy')
    kind = _tool_choice_kind(tool_choice)
    free = [m for m in models if m in POLICY['free_models']
            and (not tools or kind in POLICY['free_tool_choice'].get(m, []))]
    paid = [m for m in models if m not in POLICY['free_models']]
    provider = {'allow_fallbacks': True, 'sort': 'price', 'ignore': POLICY['blocked_providers'],
                'max_price': POLICY['max_price']}
    if tools:
        provider['require_parameters'] = True
    groups = [(True, {'models': free[i:i + 3], 'provider': dict(provider)}) for i in range(0, len(free), 3)]
    groups += [(False, {'models': paid[i:i + 3], 'provider': {**provider, 'data_collection': 'deny'}})
               for i in range(0, len(paid), 3)]
    if not groups:
        raise ValueError('No eligible model for this request')
    return groups


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
    # Dedicated Image API accepts routing controls, not Chat privacy/price fields.
    # Account privacy policy is enforced upstream; live prices gate this request.
    return {'only': allowed, 'allow_fallbacks': False}
