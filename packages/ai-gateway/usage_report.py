from datetime import date, datetime, timedelta, timezone
from typing import Any

SURFACES = ["Mail", "CRM", "Chat", "Super Coder", "Connectors"]
ACTIVITIES = ["Building", "Reasoning", "Images", "Video", "Other"]

DAYS = 30
SKIPPED_TRANSACTIONS = ("model usage", "image generation")


def _text(value: Any) -> str:
    return value.lower() if isinstance(value, str) else ""


def _number(value: Any) -> float:
    if isinstance(value, bool) or value is None:
        return 0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return number if number == number and number not in (float("inf"), float("-inf")) else 0


def _clean(value: float) -> int | float:
    return int(value) if float(value).is_integer() else round(value, 2)


def classify_usage(description: str | None, category: str | None) -> str:
    text = f"{_text(description)} {_text(category)}"
    if "mail" in text:
        return "Mail"
    if any(term in text for term in ("crm", "campaign", "prospect")):
        return "CRM"
    if any(term in text for term in ("coding", "super coder", "design", "agent run")):
        return "Super Coder"
    if any(
        term in text
        for term in ("vercel", "supabase", "railway", "n8n", "github", "shopify", "tms", "bee", "connector")
    ):
        return "Connectors"
    return "Chat"


def classify_activity(description: str | None, category: str | None, surface: str) -> str:
    description_text = _text(description)
    category_text = _text(category)
    if "video" in description_text or "video" in category_text:
        return "Video"
    if "image" in description_text or "image" in category_text:
        return "Images"
    if surface == "Super Coder":
        return "Building"
    if category_text == "chat" or "model usage" in description_text:
        return "Reasoning"
    return "Other"


def _day_of(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc)
    return moment.date().isoformat()


def _today(today: Any) -> date:
    if isinstance(today, datetime):
        if today.tzinfo is not None:
            today = today.astimezone(timezone.utc)
        return today.date()
    if isinstance(today, date):
        return today
    return datetime.now(timezone.utc).date()


def build_usage_report(
    logs: list[dict[str, Any]] | None,
    transactions: list[dict[str, Any]] | None,
    today: Any = None,
) -> dict[str, Any]:
    end = _today(today)
    dates = [(end - timedelta(days=DAYS - 1 - index)).isoformat() for index in range(DAYS)]
    window = set(dates)

    surface_credits = {day: {name: 0.0 for name in SURFACES} for day in dates}
    surface_requests = {day: {name: 0 for name in SURFACES} for day in dates}
    activity_credits = {day: {name: 0.0 for name in ACTIVITIES} for day in dates}
    activity_requests = {name: 0 for name in ACTIVITIES}

    def record(day: str, surface: str, activity: str, credits: float, is_request: bool) -> None:
        surface_credits[day][surface] += credits
        activity_credits[day][activity] += credits
        if is_request:
            surface_requests[day][surface] += 1
            activity_requests[activity] += 1

    for row in logs or []:
        if not isinstance(row, dict):
            continue
        day = _day_of(row.get("created_at"))
        if day not in window:
            continue
        category = row.get("category")
        surface = classify_usage(None, category)
        activity = classify_activity(None, category, surface)
        record(day, surface, activity, _number(row.get("credits_deducted")), True)

    for row in transactions or []:
        if not isinstance(row, dict):
            continue
        description = row.get("description")
        if any(term in _text(description) for term in SKIPPED_TRANSACTIONS):
            continue
        day = _day_of(row.get("created_at"))
        if day not in window:
            continue
        amount = _number(row.get("amount"))
        if amount == 0:
            continue
        surface = classify_usage(description, None)
        activity = classify_activity(description, None, surface)
        # Debits add credits and count as requests; refunds subtract credits only.
        record(day, surface, activity, -amount, amount < 0)

    def daily(series: dict[str, dict[str, Any]], names: list[str]) -> list[dict[str, Any]]:
        return [
            {"date": day, **{name: _clean(max(0, series[day][name])) for name in names}}
            for day in dates
        ]

    daily_credits = daily(surface_credits, SURFACES)
    daily_requests = daily(surface_requests, SURFACES)
    daily_work = daily(activity_credits, ACTIVITIES)

    by_surface = [
        {
            "name": name,
            "credits": _clean(sum(row[name] for row in daily_credits)),
            "requests": _clean(sum(row[name] for row in daily_requests)),
        }
        for name in SURFACES
    ]
    by_activity = [
        {
            "name": name,
            "credits": _clean(sum(row[name] for row in daily_work)),
            "requests": activity_requests[name],
        }
        for name in ACTIVITIES
    ]

    return {
        "credits_used": _clean(sum(item["credits"] for item in by_surface)),
        "requests": sum(item["requests"] for item in by_surface),
        "by_surface": by_surface,
        "by_activity": by_activity,
        "daily_credits": daily_credits,
        "daily_requests": daily_requests,
        "daily_work": daily_work,
    }
