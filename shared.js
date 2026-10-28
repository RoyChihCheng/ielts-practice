const countWords = text => text.trim() ? text.trim().split(/\s+/u).length : 0;
const formatTime = seconds => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;
const validateBackup = (data, kind) => data && data.version === 1 && data.kind === kind && data.drafts && (kind === 'writing' ? ['task1', 'task2'].every(k => typeof data.drafts[k] === 'string') : Array.isArray(data.drafts.answers) && data.drafts.answers.length === 40 && data.drafts.answers.every(v => typeof v === 'string'));
if (typeof module !== 'undefined') module.exports = { countWords, formatTime, validateBackup };
