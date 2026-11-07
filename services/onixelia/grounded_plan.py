"""Evidence-bound planning for the aggregate-only Workspace snapshot.

The model may order eligible actions; it cannot invent facts, people or permissions.
Counts describe a queue, not an outcome or a causal relationship between queues.
"""
import math


def candidates(snapshot):
    metrics = snapshot.get('metrics', {})
    result = []
    covered = set()

    def count(section, key):
        values = metrics.get(section, {})
        value = values.get(key) if isinstance(values, dict) else None
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            return None
        return int(value) if int(value) == value else None

    def add(key, title, owner, reason, source='business_metrics', kind=None):
        result.append({'id': key, 'task': {'title': title, 'owner': owner, 'reason': reason, 'source': source}})
        if kind:
            covered.add(kind)

    due = count('commitments', 'due_today')
    overdue = count('commitments', 'overdue')
    if due or overdue:
        evidence = '; '.join(f'{key}={value}' for key, value in [('commitments.due_today', due), ('commitments.overdue', overdue)] if value)
        add('commitments', 'Triage due and overdue commitments', 'onixelia',
            f'{evidence}. Inspect the source records, confirm deadlines and owners, and prioritize by urgency. '
            'Check whether the two groups overlap before counting unique work. Record each proposed next step; '
            'completion requires a source receipt, not a changed status alone.', kind='overdue')
    pending = count('outreach', 'awaiting_approval')
    if pending:
        add('approvals', 'Review outreach awaiting approval', 'onixa',
            f'outreach.awaiting_approval={pending}. Inspect the queued drafts for recipient fit, supported claims and existing permissions. '
            'Record an approve, revise or reject recommendation with a reason for each reviewed draft. Do not send from this plan.', kind='approval')
    failed = [(key, count('failures', key)) for key in ['failed_sends', 'dead_jobs', 'sync_problems', 'agent_tool_failures']]
    evidence = '; '.join(f'failures.{key}={value}' for key, value in failed if value)
    if evidence:
        add('failures', 'Diagnose recorded failures', 'onyx',
            evidence + '. Inspect the failure receipts and identify the affected workflow and cause. '
            'Propose a reversible repair with a verification check. Check delivery and duplicate status before any separately authorized retry.', kind='failed')
    # Typed priorities may justify review, but arbitrary text and generic "other" do not.
    actions = {
        'overdue': ('commitments', 'Review overdue commitments', 'onixelia', 'Inspect the supplied priority in the source queue, confirm the deadline and owner, and record the next action and verification needed.'),
        'approval': ('approvals', 'Review pending approvals', 'onixa', 'Inspect the supplied approval priority, verify claims and permissions, and record a recommendation. Sending remains a separate authorized action.'),
        'failed': ('failures', 'Investigate failed work', 'onyx', 'Inspect the supplied failure receipt and propose a reversible repair with a verification check. Check for prior completion before proposing any retry.'),
        'reply': ('replies', 'Review customer replies', 'onixa', 'Inspect the source reply priority and check whether a response is still needed. Prepare a proposed next step and its owner; do not infer unanswered work from aggregate reply counts.'),
    }
    for index, priority in enumerate(snapshot.get('priorities', [])):
        if not isinstance(priority, dict):
            continue
        kind = priority.get('kind')
        if kind in actions and kind not in covered:
            key, title, owner, reason = actions[kind]
            add(key, title, owner, reason, f'business_priority:{index}', kind)
    return result


def materialize(selection, eligible):
    """Require complete, duplicate-free coverage; unknown fields fail closed."""
    if not isinstance(selection, dict) or set(selection) != {'order'}:
        raise ValueError('Invalid planning selection')
    order = selection['order']
    by_id = {item['id']: item['task'] for item in eligible}
    if (not isinstance(order, list) or any(type(key) is not str for key in order)
            or len(order) != len(set(order)) or set(order) != set(by_id)):
        raise ValueError('Missing, duplicate or invented planning action')
    return [dict(by_id[key]) for key in order]
