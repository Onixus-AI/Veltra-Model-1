"""Ordered server-side model fallbacks, forwarded intact to OpenRouter."""


def routing_options(primary, fallbacks=(), *, tools=False):
    # LiteLLM uses the openrouter/ prefix; OpenRouter's models array does not.
    models = list(dict.fromkeys(model.removeprefix('openrouter/') for model in [primary, *fallbacks]))
    provider = {'allow_fallbacks': True, 'data_collection': 'deny'}
    if tools:
        provider['require_parameters'] = True
    return {'models': models, 'provider': provider}
