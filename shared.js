const countWords = text => text.trim() ? text.trim().split(/\s+/u).length : 0;
// First passage lines identified as subtitles from the dataset's formatting and structure.
// Cambridge 21 lines lack formatting metadata, so those three are provisional.
const passageSubtitleIds = new Set(['0-R-5-1','0-R-5-2','0-R-6-1','0-R-6-2','0-R-6-3','0-R-7-2','0-R-8-1','0-R-8-2','0-R-8-3','0-R-9-1','0-R-9-2','0-R-9-3','0-R-10-1','0-R-11-2','0-R-11-3','0-R-12-3','1-R-2-2','1-R-2-3','1-R-4-3','1-R-8-2','1-R-8-3','1-R-9-1','1-R-9-2','1-R-10-2','1-R-11-1','1-R-11-3','1-R-12-3','21-R-1-1','21-R-2-2','21-R-4-3']);
// Excludes title, identified subtitle, labels, image markers and standalone punctuation.
const passageWordTokens = item => {
  const lines = item.passage.filter(line => !line.startsWith('[[IMG'));
  const unpunctuatedLabels = lines.filter(line => /^[A-H] (?=[A-Z])/.test(line)).length >= 3;
  let firstContent = true;
  const text = lines.map(line => {
    if (line === item.title) return '';
    if (firstContent) { firstContent = false; if (passageSubtitleIds.has(item.id)) return ''; }
    if (line.startsWith(item.title)) line = line.slice(item.title.length).trim();
    return line.replace(/^([A-Z]|\d{1,2})\.\s+/, '').replace(unpunctuatedLabels ? /^[A-H]\s+/ : /$^/, '').replace(/\|/g, ' ');
  }).join(' ');
  return text.match(/[\p{L}\p{N}]+(?:[’'\-–.][\p{L}\p{N}]+)*/gu) || [];
};
const formatTime = seconds => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;
const validateBackup = (data, kind) => data && data.version === 1 && data.kind === kind && data.drafts && (kind === 'writing' ? ['task1', 'task2'].every(k => typeof data.drafts[k] === 'string') : Array.isArray(data.drafts.answers) && data.drafts.answers.length === 40 && data.drafts.answers.every(v => typeof v === 'string'));
if (typeof module !== 'undefined') module.exports = { countWords, passageWordTokens, formatTime, validateBackup };
