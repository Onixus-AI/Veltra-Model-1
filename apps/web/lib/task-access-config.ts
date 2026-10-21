/** Opt-in rollout: existing app behavior is preserved until compatibility is verified. */
export function taskAccessEnabled(){return process.env.VELTRA_TASK_ACCESS_ENABLED==='true';}
