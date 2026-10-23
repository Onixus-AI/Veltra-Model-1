/** Fresh platform facts, independent of the selected model or its training cutoff. */
export function currentTime(timeZone: unknown, now = new Date()) {
  let zone = 'UTC';
  let timezoneSource = 'UTC fallback; customer timezone unknown';
  if (typeof timeZone === 'string' && timeZone.length <= 100) {
    try {
      zone = new Intl.DateTimeFormat('en-US', {timeZone}).resolvedOptions().timeZone;
      timezoneSource = 'request timezone; device-derived unless explicitly selected';
    } catch { /* Never infer a location from an invalid timezone. */ }
  }
  return {
    source: 'Veltra server clock',
    observed_at: now.toISOString(),
    time_zone: zone,
    timezone_source: timezoneSource,
    local_datetime: new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'long',
    }).format(now),
  };
}

export function runtimeContext(timeZone: unknown) {
  return 'Fresh platform time for this request: ' + JSON.stringify(currentTime(timeZone)) +
    '\nUse this clock for current date/time, not training knowledge or old conversation timestamps. ' +
    'The timezone is context, not proof of the customer\'s physical location. If unknown, state UTC or ask. ' +
    'Use current_time to refresh the clock or convert to a requested IANA timezone. ' +
    'Time context does not provide current news, web search, calendar access, or scheduling. ' +
    'Use an available authorized information tool for changing facts; if no such tool is available, explain that you cannot verify them. Never invent a source or claim a reminder was scheduled without a tool receipt.';
}

export function deviceTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  catch { return undefined; }
}
