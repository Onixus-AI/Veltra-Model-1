"""Evidence-bound planning for the aggregate-only Workspace snapshot.

The model may order eligible actions; it cannot invent facts, people or permissions.
Counts describe a queue, not an outcome or a causal relationship between queues.
"""
import math
from datetime import datetime


# Final cards remain proposals. Their completion means a reviewed handoff, not execution.
DETAILS = {
    'commitments': ('Check source deadlines and owners; resolve overlap between due and overdue queues.',
                    'Return a source-linked next action and accountable owner for each reviewed commitment.',
                    'If records or ownership are missing, ask Onyx to resolve them.'),
    'approvals': ('Check queued drafts for recipient fit, supported claims and existing permissions; do not send.',
                  'Return an approve, revise or reject recommendation with its reason and draft reference.',
                  'If drafts or permissions are unavailable, ask Onyx for access or clarification.'),
    'failures': ('Inspect the failure receipt and prior completion before proposing a separately authorized retry.',
                 'Return the evidenced cause (or unknown), reversible repair proposal and verification check.',
                 'If receipts or access are missing, report the exact gap to Onyx; do not retry.'),
    'replies': ('Check the source thread for a later response before proposing a reply; do not send.',
                'Return a source-linked response recommendation and owner, or evidence no reply is needed.',
                'If the thread is unavailable, ask Onyx for access; reply totals cannot establish unanswered work.'),
}


def explain(item, metric_evidence):
    """Render supported context and acceptance criteria, never model-authored facts."""
    evidence = item.get('priority_evidence', [])
    basis = metric_evidence.get(item['id'], f"Source {item['task']['source']} flags this queue.")
    if evidence:
        strongest = min(evidence, key=lambda e: (-(e['severity'] or 0),
            datetime.fromisoformat(e['since']).timestamp() if e['since'] else float('inf')))
        context = f"Source {strongest['source']}"
        if strongest['severity'] is not None:
            context += f"; severity {strongest['severity']}/3"
        if strongest['since']:
            context += f"; queue date {strongest['since']} (deadline unverified)"
        basis = context + '.'
    action, done, blocked = DETAILS[item['id']]
    reason = f"Why: {basis} Next: {action} Done: {done} Blocked? {blocked}"
    if len(reason) > 600:
        raise ValueError('Planning explanation exceeds Workspace limit')
    return reason


def candidates(snapshot):
    metrics = snapshot.get('metrics', {})
    result = []
    covered = set()
    metric_evidence = {}

    def count(section, key):
        values = metrics.get(section, {})
        value = values.get(key) if isinstance(values, dict) else None
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            return None
        return int(value) if int(value) == value else None

    def add(key, title, owner, source='business_metrics', kind=None):
        result.append({'id': key, 'task': {'title': title, 'owner': owner, 'source': source}})
        if kind:
            covered.add(kind)

    due = count('commitments', 'due_today')
    overdue = count('commitments', 'overdue')
    if due or overdue:
        evidence = '; '.join(f'{key}={value}' for key, value in [('commitments.due_today', due), ('commitments.overdue', overdue)] if value)
        metric_evidence['commitments'] = evidence + '.'
        add('commitments', 'Triage due and overdue commitments', 'onixelia', kind='overdue')
    pending = count('outreach', 'awaiting_approval')
    if pending:
        metric_evidence['approvals'] = f'outreach.awaiting_approval={pending}.'
        add('approvals', 'Review outreach awaiting approval', 'onixa', kind='approval')
    failed = [(key, count('failures', key)) for key in ['failed_sends', 'dead_jobs', 'sync_problems', 'agent_tool_failures']]
    evidence = '; '.join(f'failures.{key}={value}' for key, value in failed if value)
    if evidence:
        metric_evidence['failures'] = evidence + '.'
        add('failures', 'Diagnose recorded failures', 'onyx', kind='failed')
    # Typed priorities may justify review, but arbitrary text and generic "other" do not.
    actions = {
        'overdue': ('commitments', 'Review overdue commitments', 'onixelia'),
        'approval': ('approvals', 'Review pending approvals', 'onixa'),
        'failed': ('failures', 'Investigate failed work', 'onyx'),
        'reply': ('replies', 'Review customer replies', 'onixa'),
    }
    for index, priority in enumerate(snapshot.get('priorities', [])):
        if not isinstance(priority, dict):
            continue
        kind = priority.get('kind')
        if kind in actions and kind not in covered:
            key, title, owner = actions[kind]
            add(key, title, owner, f'business_priority:{index}', kind)
    # Preserve validated source urgency for ranking without forwarding private text.
    ids = {'overdue': 'commitments', 'approval': 'approvals', 'failed': 'failures', 'reply': 'replies'}
    for item in result:
        evidence = []
        for index, priority in enumerate(snapshot.get('priorities', [])[:8]):
            if not isinstance(priority, dict) or ids.get(priority.get('kind')) != item['id']:
                continue
            severity = priority.get('severity')
            since = priority.get('since')
            try:
                parsed = datetime.fromisoformat(since.replace('Z', '+00:00')) if isinstance(since, str) and len(since) <= 35 else None
                since = parsed.isoformat() if parsed and parsed.tzinfo else None
            except ValueError:
                since = None
            if type(severity) is not int or severity not in (1, 2, 3):
                severity = None
            if severity is not None or since:
                evidence.append({'source': f'business_priority:{index}', 'severity': severity, 'since': since})
        if evidence:
            item['priority_evidence'] = evidence
        item['task']['reason'] = explain(item, metric_evidence)
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
