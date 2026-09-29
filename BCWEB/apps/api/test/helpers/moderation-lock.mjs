// assetskey (agent-assets-key): ONE name for the lock around the moderation/AI settings rows.
//
// `moderation.settings`, `moderation.policies`, `moderation.rules`, `ai.config` and `ai.killed`
// are singleton AdminSetting rows. moderation-engine, moderation-followups and ai-provider each
// snapshot them, write their own fixture and put the snapshot back — and node --test runs the
// three files in parallel, so without a lock each one saw the others' fixtures (the followups
// file had grown a save-and-re-read retry loop to paper over it). Each file now takes this lock
// through ./row-lock.mjs for as long as it owns the rows. Written once so the three cannot
// drift onto different names, which would be three locks guarding nothing.
export const MODERATION_SETTINGS_LOCK = 'adminSetting:moderation+ai';
