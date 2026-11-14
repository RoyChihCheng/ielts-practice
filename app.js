(() => {
  const kind = document.body.dataset.kind;
  const $ = id => document.getElementById(id);
  const emptyDraft = () => kind === 'writing' ? { task1: '', task2: '' } : { answers: Array(40).fill('') };
  let baseKey = `ielts-${kind}-untitled`, key = baseKey, currentAttempt = '', drafts = emptyDraft(), task = 'task1', pdfUrl;
  let limit = 3600, remaining = limit, deadline = 0, interval, saveFailed = false, locked = false, activeItem = null;
  const materials = window.ieltsPractice[kind];

  function save() {
    try { localStorage.setItem(key, JSON.stringify(drafts)); saveFailed = false; $('status').textContent = '已自動保存在此瀏覽器'; }
    catch { saveFailed = true; $('status').textContent = '無法自動儲存，請立即下載備份。'; }
  }
  function load() {
    drafts = emptyDraft();
    revealedQuestions.clear();
    $('status').textContent = '';
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (validateBackup({ version: 1, kind, drafts: saved }, kind)) drafts = saved;
    } catch { $('status').textContent = '無法讀取本機儲存，請使用備份還原。'; }
    render();
  }
  // Stored rich text is untrusted: preserve only basic formatting and paragraph breaks.
  function safeWritingHtml(html) {
    const template = document.createElement('template'); template.innerHTML = html;
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'DIV', 'BR']);
    function copy(node, dest) {
      if (node.nodeType === Node.TEXT_NODE) { dest.append(document.createTextNode(node.data)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName)) return;
      const out = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : dest;
      if (out !== dest) dest.append(out);
      for (const child of node.childNodes) copy(child, out);
    }
    const result = document.createElement('div'); for (const node of template.content.childNodes) copy(node, result); return result.innerHTML;
  }
  function render() {
    if (kind === 'reading') {
      document.querySelectorAll('.answer-input').forEach(input => { input.value = drafts.answers[input.dataset.q - 1]; });
      document.querySelectorAll('#qnav button[data-q]').forEach(b => b.classList.toggle('answered', !!drafts.answers[b.dataset.q - 1].trim()));
      if (activeItem) showResults(); else updateCount();
    } else {
      const html = drafts[`${task}Html`];
      if (typeof html === 'string') $('editor').innerHTML = safeWritingHtml(html);
      else $('editor').textContent = drafts[task];
      updateWordCount();
      for (const id of ['task1', 'task2']) { $(id).classList.toggle('active', id === task); $(id).setAttribute('aria-pressed', String(id === task)); }
    }
  }

  // Handout content arrives as lines: "[[IMG:path]]" is a figure, " | " separates table cells (rows by newline).
  function figure(line) {
    const m = line.match(/^\[\[IMG:(.+)\]\]$/); if (!m) return null;
    const img = document.createElement('img'); img.src = m[1]; img.alt = '題目圖表'; img.className = 'task-figure'; img.loading = 'lazy';
    return img;
  }
  // The original files remain available as a fallback for browsers without WebP.
  function optimizedTaskImage(url) {
    return url.startsWith('../figures/') && /\.png$/i.test(url) ? url.replace('../figures/', '../figures/optimized/') + '.webp' : url;
  }
  function taskImage(url) {
    const frame = document.createElement('figure'); frame.className = 'task-image-frame';
    const status = document.createElement('figcaption'); status.className = 'figure-status'; status.setAttribute('role', 'status'); status.textContent = '題目圖表載入中…';
    const img = document.createElement('img'); img.alt = '寫作題目圖表'; img.className = 'task-figure'; img.loading = 'eager'; img.fetchPriority = 'high';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新載入圖表'; retry.hidden = true;
    const original = document.createElement('a'); original.href = url; original.target = '_blank'; original.rel = 'noopener'; original.textContent = '另開原始圖檔'; original.hidden = true;
    let fallback = false;
    img.addEventListener('load', () => { frame.classList.remove('loading', 'failed'); status.textContent = '題目圖表'; retry.hidden = true; original.hidden = true; });
    img.addEventListener('error', () => {
      if (!fallback && optimizedTaskImage(url) !== url) { fallback = true; status.textContent = '正在嘗試載入原始圖檔…'; img.src = url; return; }
      frame.classList.remove('loading'); frame.classList.add('failed'); status.textContent = '圖表載入失敗，請檢查網路後重試。'; retry.hidden = false; original.hidden = false;
    });
    retry.addEventListener('click', () => { fallback = true; frame.classList.remove('failed'); frame.classList.add('loading'); status.textContent = '題目圖表重新載入中…'; retry.hidden = true; original.hidden = true; const src = new URL(url, location.href); src.searchParams.set('retry', Date.now()); img.src = src.href; });
    frame.classList.add('loading'); frame.append(status, img, retry, original); img.src = optimizedTaskImage(url); return frame;
  }
  function makeTable(line, fill) {
    const table = document.createElement('table'); table.className = 'q-table';
    // Line breaks inside a cell arrive as U+2028 (rows are split on "\n"); cells use pre-wrap, so "\n" shows as a break.
    for (const row of line.split('\n')) { const tr = table.insertRow(); for (const cell of row.split(' | ')) fill(tr.insertCell(), cell.replace(/\u2028/g, '\n')); }
    // A row with only its first cell filled ("Māori cloaks") is a title spanning the table, as in the books.
    for (const tr of [...table.rows]) {
      const cells = [...tr.cells];
      if (cells.length > 1 && cells[0].textContent.trim() && cells.slice(1).every(c => !c.textContent.trim())) { cells.slice(1).forEach(c => c.remove()); cells[0].colSpan = cells.length; cells[0].className = 'span-head'; }
    }
    const head = table.rows[0];
    table.classList.toggle('has-head', table.rows.length > 2 && !head.querySelector('input') && !/^(?:[A-Z]|[ivx]+)$/.test(head.cells[0].textContent.trim()));
    return table;
  }
  // The handout's bold/italic phrases for this line (item.fmt) are re-applied as <b>/<i>.
  function rich(text, phrases) {
    const frag = document.createDocumentFragment();
    if (!text) return frag;
    if (!phrases?.length) { frag.append(text); return frag; }
    const sorted = [...phrases].sort((a, b) => b[1].length - a[1].length);
    const pattern = new RegExp(sorted.map(p => `(?<!\\w)${p[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`).join('|'), 'g');
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      const style = sorted.find(p => p[1] === m[0])[0];
      frag.append(text.slice(last, m.index));
      const outer = document.createElement(style.includes('b') ? 'b' : 'i'); outer.textContent = m[0];
      if (style === 'bi') { const inner = document.createElement('i'); inner.textContent = m[0]; outer.replaceChildren(inner); }
      frag.append(outer); last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }
  const passageWords = item => passageWordTokens(item).length;
  // Book/test references were matched by passage text against the source books, not inferred from lesson order.
  const trainerTests = {
    '1-R-1-1': 1, '1-R-1-2': 1, '1-R-1-3': 1,
    '1-R-2-1': 2, '1-R-2-2': 2, '1-R-2-3': 2,
    '1-R-3-1': 3, '1-R-3-2': 3,
    '1-R-4-1': 4, '1-R-5-2': 4, '1-R-5-3': 4,
    '1-R-6-1': 5, '1-R-6-2': 5, '1-R-7-3': 5,
    '1-R-7-1': 6, '1-R-8-2': 6, '1-R-8-3': 6
  };
  function readingReference(item) {
    if (item.id.startsWith('21-R-')) return `Cambridge 21 · Test ${item.test}`;
    if (item.id === '1-R-4-3') return 'Trainer 2 General Training · Test 3';
    if (/^0-R-(?:[5-9]|1[0-2])-[123]$/.test(item.id)) return `Official Guide · Test ${item.week - 4}`;
    if (/^1-R-(?:9|1[0-2])-[123]$/.test(item.id)) return `Cambridge 20 · Test ${item.week - 8}`;
    if (trainerTests[item.id]) return `Trainer 2 · Test ${trainerTests[item.id]}`;
    return `講義第 ${item.week} 週（原書回次未確認）`;
  }

  // Reading: answer boxes are placed inline in the question text, like the computer-delivered test.
  const gapPattern = /(\d{1,2})\.?\s*(?:[.…]{3,}|_{3,})/g;
  const blankPattern = /[.…]{4,}|_{3,}/;
  const numberedGap = /(\d{1,2})\.?\s*(?:[.…]{3,}|_{3,})/;
  let currentQ = 0, checking = false;
  const revealedQuestions = new Set();
  function updateCount() {
    const buttons = [...document.querySelectorAll('#qnav button[data-q]')];
    const done = buttons.filter(b => b.classList.contains('answered')).length;
    $('qcount').textContent = buttons.length ? `${currentQ ? `第 ${currentQ} 題 · ` : ''}已答 ${done}/${buttons.length} · 未答 ${buttons.length - done}` : '';
  }
  function answerInput(n) {
    const input = document.createElement('input');
    input.className = 'answer-input'; input.dataset.q = n; input.placeholder = n;
    input.autocomplete = 'off'; input.spellcheck = false; input.readOnly = locked;
    input.setAttribute('aria-label', `Question ${n}`);
    input.addEventListener('input', () => {
      drafts.answers[n - 1] = input.value; save();
      $('qnav').querySelector(`[data-q="${n}"]`)?.classList.toggle('answered', !!input.value.trim());
      if (checking || revealedQuestions.size) showResults(); else updateCount();
    });
    input.addEventListener('focus', () => { currentQ = n; document.querySelectorAll('#qnav button').forEach(b => b.classList.toggle('current', b.dataset.q === String(n))); if (!checking) updateCount(); });
    return input;
  }
  function goTo(n) {
    const input = document.querySelector(`.answer-input[data-q="${n}"]`); if (!input) return;
    input.scrollIntoView({ block: 'center', behavior: 'smooth' }); input.focus({ preventScroll: true });
  }
  // ── Question layout, modelled on the Cambridge books (Cambridge IELTS 20, Trainer 2, Official Guide) ──
  // Headings in italics; instructions in italics with key words in bold; TRUE/FALSE/NOT GIVEN as a two-column key;
  // bold question numbers with a hanging indent; option lists, notes and summaries in boxes; flow-charts as boxed steps.
  const el = (tag, cls, ...kids) => { const node = document.createElement(tag); if (cls) node.className = cls; node.append(...kids); return node; };
  const INSTRUCTION = /^(?:For Questions|Do the following|In boxes|Write\b|Choose\b|Complete\b|Reading Passage \d+ has|The (?:text|passage|reading passage)\b.*\bhas\b|Which (?:paragraph|section)|Look at|Match\b|Answer the|Label\b|Classify|NB\b|N\.B\.|You may use|Using NO MORE|Use NO MORE)/i;
  const UPRIGHT = /^(?:Do the following|Which (?:paragraph|section)|Reading Passage \d+ has|The (?:text|passage|reading passage)\b.*\bhas\b|Which (?:TWO|THREE)\b)/i;
  const LEGEND = /^(?:•\s*)?(TRUE|FALSE|YES|NO|NOT GIVEN)\s*(if\b.*)$/;
  // Capitalised phrases, letter ranges and "A, B, C or D" are set in bold in the books' instructions.
  const instructionBold = text => [...new Set([
    ...[...text.matchAll(/\b[A-Z][A-Z/]*(?:\s+[A-Z][A-Z/]*)*\b/g)].map(m => m[0]).filter(s => /[A-Z]{2}/.test(s)),
    ...[...text.matchAll(/\b(?:[A-I]|[ivx]{1,4})\s*[–-]\s*(?:[A-I]|[ivx]{1,4})\b/g)].map(m => m[0]),
    ...[...text.matchAll(/\b[A-I](?:,\s*[A-I])*,?\s+or\s+[A-I]\b/g)].map(m => m[0]),
  ])].map(s => ['b', s]);
  function splitOptions(line) {
    // A whole TRUE/FALSE/NOT GIVEN key, or two numbered statements ("20 After … 21 There were …"), typed on one line.
    if (/^(?:•\s*)?(?:TRUE|YES)\s+if\b/.test(line)) return line.split(/\s+(?=(?:FALSE|NO|NOT GIVEN)\s+if\b)/);
    const first = line.match(/^(\d{1,2})\.?\s+\S/);
    if (first) {
      const at = line.search(new RegExp(`\\s${Number(first[1]) + 1}\\.?\\s+[A-Z]`));
      if (at > 0) return [line.slice(0, at), ...splitOptions(line.slice(at + 1))];
    }
    if (/[.…]{4,}|_{3,}/.test(line) || line.includes(' | ')) return [line];
    const named = line.match(/^(List of [A-Za-z ]+?)\s+(?=(?:[A-I]|i)\s+[A-Z])/);
    const rest = named ? line.slice(named[0].length) : line, out = named ? [named[1]] : [];
    // Lettered word lists: three or more "X word" items, each letter once; the books list them in letter order.
    const letters = rest.split(/\s+(?=[A-I]\s+\S)/);
    if (letters.length >= 3 && letters.every(s => /^[A-I]\s/.test(s)) && new Set(letters.map(s => s[0])).size === letters.length) return [...out, ...letters.sort()];
    const romans = rest.split(/\s+(?=(?:ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\s+[A-Z])/);
    if (romans.length >= 2 && /^[ivx]{1,4}\s+[A-Z]/.test(rest)) return [...out, ...romans];
    return named ? [...out, rest] : [line];
  }
  function groupKind(instructions) {
    if (/NOT GIVEN/.test(instructions)) return 'judge';
    if (/flow-?chart/i.test(instructions)) return 'flow';
    if (/complete the (?:notes|summary)/i.test(instructions) && !/list of words|correct letter/i.test(instructions)) return 'box';
    if (/complete the table/i.test(instructions)) return 'table';
    if (/correct letter|correct number|list of|choose (?:two|three)|[A-I]\s*[–-]\s*[A-I]|headings/i.test(instructions)) return 'choice';
    return 'plain';
  }
  function buildQuestions(item) {
    const box = $('questionText'), rest = $('answers'), nav = $('qnav');
    box.replaceChildren(); rest.replaceChildren(); nav.replaceChildren();
    const start = item ? item.start : 1, end = item ? item.end : 40, used = new Set();
    const free = n => n >= start && n <= end && !used.has(n);
    const gapInput = n => { const input = answerInput(n); input.classList.add('gap'); input.placeholder = ''; return [el('b', 'gapnum', String(n)), input]; };
    // Replaces numbered gaps ("7 ......") with the bold number and an answer field; returns false if none were placed.
    const fillGaps = (target, text, phrases) => {
      let last = 0;
      for (const m of text.matchAll(gapPattern)) {
        const n = Number(m[1]); if (!free(n)) continue;
        target.append(rich(text.slice(last, m.index), phrases), ...gapInput(n)); used.add(n); last = m.index + m[0].length;
      }
      target.append(rich(text.slice(last), phrases));
      return last > 0;
    };
    // A numbered line: bold number in the margin, the statement, and its answer field (in its blank if it has one).
    const questionLine = (n, text, phrases) => {
      used.add(n);
      const body = el('div', 'q-text'), blank = text.match(blankPattern);
      if (blank) body.append(rich(text.slice(0, blank.index), phrases), answerInput(n), rich(text.slice(blank.index + blank[0].length), phrases));
      else body.append(rich(text, phrases), ' ', answerInput(n));
      return el('div', 'q-item', el('b', 'qnum', String(n)), body);
    };
    // Options never take the handout's bold: the books print them plain, and a teacher's bold can give the answer away.
    const option = (letter, text, phrases) => el('div', 'opt', el('b', 'opt-key', letter), el('span', '', rich(text, (phrases || []).filter(p => p[0] === 'i'))));
    // Handout paragraphs with soft line breaks hold several lines, and options are sometimes typed on one line
    // ("List of people A … B …", "A safe B competitive …", "v … vi …"); give each its own line. src maps back to item.fmt.
    const lines = [], src = [];
    (item ? item.questions : []).forEach((raw, k) => {
      for (const piece of raw.includes(' | ') ? [raw] : raw.split('\n')) for (const part of splitOptions(piece)) { lines.push(part); src.push(k); }
    });
    const headings = lines.map((l, k) => /^Questions?\s+\d/i.test(l) ? k : -1).filter(k => k >= 0);
    if (lines.length && headings[0] !== 0) headings.unshift(0);
    headings.forEach((from, g) => {
      const to = g + 1 < headings.length ? headings[g + 1] : lines.length;
      const group = el('section', 'q-group'); box.append(group);
      let k = from;
      const head = lines[k].match(/^(Questions?\s+\d+(?:\s*(?:[–-]|and|&)\s*\d+)?)\s*[:.]?\s*(.*)$/i);
      const pending = [];
      if (head) { group.append(el('p', 'q-heading', head[1])); if (head[2]) pending.push([head[2], -1]); k++; }
      while (k < to && INSTRUCTION.test(lines[k]) && !LEGEND.test(lines[k])) { pending.push([lines[k], src[k]]); k++; }
      // Classify from every instruction in the group: some groups open with a lead-in sentence before them.
      const instructions = [...pending.map(p => p[0]), ...lines.slice(k, to).filter(l => INSTRUCTION.test(l))].join(' ');
      const kind = groupKind(instructions);
      const range = head && (head[1].match(/(\d+)\D+(\d+)$/) || head[1].match(/((\d+))$/));
      if (range) group.dataset.range = `${range[1]}-${range[2]}`;
      let legend = null, options = null, mcq = null, content = null, title = null;
      const optionsAllowed = kind === 'choice' || /list of words|correct letter/i.test(instructions);
      // Only multiple-choice groups hang their A–D options under each question; matching groups keep one shared list.
      const isMCQ = /choose the correct (?:letter|answer)|choose (?:two|three) (?:letters|answers)/i.test(instructions);
      // A "Which TWO …" question carries the answer boxes for its own numbers ("37–38 Which TWO …") or the group's range.
      const stemFor = (text, phrases) => {
        const own = text.match(/^(\d{1,2})\s*[–-]\s*(\d{1,2})\s+(.*)$/);
        const stem = el('div', 'q-stem', rich(own ? own[3] : text, phrases));
        const [a, b] = own ? [own[1], own[2]] : range ? [range[1], range[2]] : [1, 0];
        for (let n = Number(a); n <= Number(b); n++) if (free(n)) { used.add(n); stem.append(' ', answerInput(n)); }
        mcq = el('div', 'mcq-opts'); stem.append(mcq); group.append(stem);
      };
      for (const [text, idx] of pending) {
        // Handouts often run several instructions together; the books print one per line.
        for (const part of text.split(/(?<=[.?])\s*(?=(?:Choose|Write|In boxes|Match|Complete|NB|Which)\b)/)) {
          if (isMCQ && /^Which (?:TWO|THREE)\b/.test(part)) { stemFor(part, null); continue; }
          group.append(el('p', UPRIGHT.test(part) ? 'q-instr upright' : 'q-instr', rich(part, [...instructionBold(part), ...(item.fmt?.q?.[idx] || []).filter(p => p[0] !== 'b')])));
        }
      }
      const contentBox = () => {
        if (!content) { content = el('div', kind === 'flow' ? 'q-flow' : 'q-box'); group.append(content); if (title) { content.append(el('p', 'box-title', title)); title = null; } }
        return content;
      };
      for (; k < to; k++) {
        const line = lines[k], phrases = item.fmt?.q?.[src[k]];
        const img = figure(line); if (img) { group.append(img); mcq = options = null; continue; }
        const legendLine = line.match(LEGEND);
        if (legendLine) { if (!legend) { legend = el('div', 'q-legend'); group.append(legend); } legend.append(el('b', '', el('i', '', legendLine[1])), el('i', '', legendLine[2])); continue; }
        if (line.includes(' | ')) {
          const rows = line.split('\n').map(r => r.split(' | '));
          // A two-column table whose first column is A, B, C… is a list of options, set as a box like the books.
          const named = /^List of\b/i.test(rows[0][0]) && rows[0].slice(1).every(c => !c.trim()) ? rows.shift()[0] : null;
          if (rows.length && rows.every(r => r.filter(c => c.trim()).length === 2 && /^(?:[A-I]|[ivx]{1,5})$/.test(r[0].trim()))) {
            const list = el('div', 'opt-box'); if (named) list.append(el('p', 'opt-title', named));
            rows.forEach(r => { const [key, text] = r.filter(c => c.trim()); list.append(option(key.trim(), text, phrases)); }); group.append(list); mcq = null; continue;
          }
          const cells = rows.flat().filter(c => c.trim());
          if (cells.length >= 4 && cells.every(c => /^[A-I]\s+\S/.test(c.trim()))) {
            const list = el('div', 'opt-box'); cells.forEach(c => { const m = c.trim().match(/^([A-I])\s+(.*)$/); list.append(option(m[1], m[2], phrases)); }); group.append(list); mcq = null; continue;
          }
          if (named) rows.unshift([named]);
          group.append(makeTable(line, (td, cell) => fillGaps(td, cell, phrases))); mcq = options = null; continue;
        }
        if (INSTRUCTION.test(line) && !/\.{3,}|_{3,}/.test(line)) { group.append(el('p', UPRIGHT.test(line) ? 'q-instr upright' : 'q-instr', rich(line, instructionBold(line)))); continue; }
        const opt = optionsAllowed && line.match(/^(?:•\s*)?([A-I]|[ivx]{1,5})\.?\s+(\S.*)$/);
        if (opt && !/[.…]{4,}|_{3,}/.test(line)) {
          // Handouts sometimes run two options together ("C … altered. D The participants …"); split them again.
          const parts = []; let letter = opt[1], text = opt[2];
          for (;;) {
            const next = String.fromCharCode(letter.charCodeAt(0) + 1);
            const at = /^[A-H]$/.test(letter) ? text.search(new RegExp(`[.?]\\s+${next}\\s+(?=[A-Z])`)) : -1;
            if (at < 0) { parts.push([letter, text]); break; }
            parts.push([letter, text.slice(0, at + 1)]); text = text.slice(at + 1).trim().slice(2); letter = next;
          }
          if (!mcq && !options) {
            options = el('div', 'opt-box'); group.append(options);
            if (title) { options.append(el('p', 'opt-title', title)); title = null; }
          }
          for (const [key, value] of parts) (mcq || options).append(option(key, value, phrases));
          continue;
        }
        options = null;
        if (/^List of\b/i.test(line)) { title = line; continue; }
        const lead = line.match(/^(?:•\s*)?(\d{1,2})\.?\s+(\S[\s\S]*)$/);
        if (lead && free(Number(lead[1])) && !numberedGap.test(line)) {
          const q = questionLine(Number(lead[1]), lead[2], phrases);
          if (isMCQ) { mcq = el('div', 'mcq-opts'); q.querySelector('.q-text').append(mcq); }
          (content && kind !== 'plain' ? content : group).append(q); continue;
        }
        mcq = null;
        // "Which TWO …" stems of choose-two items take the option list that follows.
        if (isMCQ && /\?$|\bTWO\b|\bTHREE\b/.test(line) && !/[.…]{4,}/.test(line)) { stemFor(line, phrases); continue; }
        if (kind === 'flow') {
          let text = line;
          const lead = (phrases || []).find(p => p[0].includes('b') && line.startsWith(p[1]) && line.length > p[1].length);
          if (lead && !content) { contentBox().append(el('p', 'box-title', lead[1])); text = line.slice(lead[1].length).trim(); }
          for (const step of text.split(/\s*[⬇↓]\s*/).filter(Boolean)) {
            const box2 = contentBox();
            if (box2.children.length && !box2.lastChild.classList.contains('box-title')) box2.append(el('div', 'flow-arrow', '↓'));
            const s = el('div', 'flow-step'); fillGaps(s, step.replace(/^[•\-–]\s*/, ''), phrases); box2.append(s);
          }
          continue;
        }
        if (kind === 'box' || kind === 'table') {
          const hasGap = /[.…]{3,}|_{3,}/.test(line);
          if (kind === 'table') { if (!hasGap && line.length < 80) { group.append(el('p', 'table-title', rich(line, phrases))); continue; } }
          else {
            const target = contentBox();
            if (!hasGap && line.length < 80 && !/^•/.test(line) && !/[.]$/.test(line)) {
              target.append(el('p', target.children.length ? 'box-sub' : 'box-title', rich(line, phrases))); continue;
            }
            const p = el('p', /^•/.test(line) ? 'box-bullet' : 'box-line'); fillGaps(p, line.replace(/^•\s*/, ''), phrases); target.append(p); continue;
          }
        }
        // A short line right before a gapped paragraph is that summary's title, centred in bold like the books.
        if (line.length < 80 && !/[.?:,]$/.test(line) && !blankPattern.test(line) && blankPattern.test(lines[k + 1] || '')) { group.append(el('p', 'table-title', rich(line, phrases))); continue; }
        const p = el('p', 'q-line');
        if (!fillGaps(p, line, phrases)) { p.replaceChildren(rich(line, phrases)); }
        group.append(p);
      }
      if (title) group.append(el('p', 'q-line', title));
      // The books print a List of Headings before its questions, and other lists (people, plants, researchers…) after them.
      const qs = group.querySelectorAll(':scope > .q-item');
      // Options are listed in letter order, and a summary's word list follows the summary.
      group.querySelectorAll('.opt-box').forEach(list => {
        const opts = [...list.querySelectorAll(':scope > .opt')];
        if (opts.every(o => /^[A-I]$/.test(o.firstChild.textContent))) opts.sort((a, b) => a.firstChild.textContent.localeCompare(b.firstChild.textContent)).forEach(o => list.append(o));
        if (!qs.length && group.querySelector('.answer-input.gap')) group.append(list);
      });
      if (qs.length) group.querySelectorAll(':scope > .opt-box').forEach(list => {
        if (/heading/i.test(instructions)) { if (list.compareDocumentPosition(qs[0]) & Node.DOCUMENT_POSITION_PRECEDING) qs[0].before(list); }
        else if (list.compareDocumentPosition(qs[qs.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING) qs[qs.length - 1].after(list);
      });
    });
    // Long lists of short options (summary word banks) are printed in columns in the books.
    box.querySelectorAll('.opt-box').forEach(list => { const opts = [...list.querySelectorAll('.opt')]; if (opts.length >= 6 && opts.every(o => o.textContent.length <= 30)) list.classList.add('cols'); });
    // Numbers the parser could not place (tables, unnumbered statements) still get a box.
    // Questions with no text to hold a box (labels on a diagram) get their boxes at the end of their own group;
    // anything outside every group goes to the answer area below.
    const groups = [...box.querySelectorAll('.q-group[data-range]')];
    for (let n = start; n <= end; n++) {
      if (used.has(n)) continue;
      const label = el('label', 'answer', el('b', 'qnum', String(n)), answerInput(n));
      // When even the heading is part of the diagram image, the boxes go under the nearest earlier group holding a figure.
      const owner = groups.find(g => { const [a, b] = g.dataset.range.split('-').map(Number); return n >= a && n <= b; })
        || groups.filter(g => Number(g.dataset.range.split('-')[1]) < n && g.querySelector('img')).pop();
      if (owner) { let row = owner.querySelector(':scope > .answer-row'); if (!row) { row = el('div', 'answer-row'); owner.append(row); } row.append(label); continue; }
      if (!rest.children.length) rest.append(el('h3', '', item ? '其餘題號作答區' : 'Answer sheet 1–40'));
      rest.append(label);
    }
    if (item) for (const input of [...box.querySelectorAll('.answer-input'), ...rest.querySelectorAll('.answer-input')]) {
      const n = Number(input.dataset.q), button = document.createElement('button');
      button.type = 'button'; button.className = 'check-one'; button.dataset.q = n;
      button.textContent = '對答案'; button.setAttribute('aria-label', `核對第 ${n} 題答案`);
      button.disabled = !item.answers?.[n];
      button.title = button.disabled ? '這一題沒有可用的答案鍵' : '只顯示這一題的答案';
      button.addEventListener('click', () => {
        if (revealedQuestions.has(n)) revealedQuestions.delete(n);
        else {
          revealedQuestions.add(n);
          if (deadline) $('timer').click(); // pause while the student reviews the answer
        }
        showResults();
      });
      const label = input.closest('label.answer');
      (label || input).after(button);
    }
    for (let n = start; n <= end; n++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.q = n; b.textContent = n; b.setAttribute('aria-label', `前往第 ${n} 題`);
      b.addEventListener('click', () => goTo(n));
      nav.append(b);
    }
    currentQ = 0;
  }

  // ── Answer checking ──────────────────────────────────────
  // Lenient on form (case, spaces, "1,000", hyphens, T/F/NG shorthands), strict on content: the key's alternatives decide.
  const TFNG = { t: 'true', true: 'true', f: 'false', false: 'false', ng: 'not given', 'not given': 'not given', y: 'yes', yes: 'yes', n: 'no', no: 'no' };
  const norm = s => s.normalize('NFKC').toLowerCase().replace(/[‘’`]/g, "'").replace(/(\d),(?=\d{3}\b)/g, '$1').trim().replace(/[.,;:!?"]+$/, '').replace(/\s+/g, ' ').trim();
  function matches(answer, keys) {
    const tf = keys.some(k => ['TRUE', 'FALSE', 'NOT GIVEN', 'YES', 'NO'].includes(k));
    const given = tf ? (TFNG[norm(answer)] || norm(answer)) : norm(answer);
    return keys.some(k => { const want = norm(k); return given === want || given.replace(/[-\s]/g, '') === want.replace(/[-\s]/g, ''); });
  }
  function results() {
    const item = activeItem, out = {};
    if (!item?.answers) return out;
    for (let n = item.start; n <= item.end; n++) {
      const keys = item.answers[n]; if (!keys) continue;
      out[n] = { keys, ok: !!drafts.answers[n - 1].trim() && matches(drafts.answers[n - 1], keys) };
    }
    // "Choose TWO" pairs: either order counts, but the same letter twice only scores once.
    for (const [a, b] of item.pairs || []) {
      if (out[a] && out[b] && out[a].ok && out[b].ok && norm(drafts.answers[a - 1]) === norm(drafts.answers[b - 1])) out[b].ok = false;
    }
    return out;
  }
  function clearResults() {
    document.querySelectorAll('.key-answer').forEach(el => el.remove());
    document.querySelectorAll('.answer-input').forEach(el => el.classList.remove('is-correct', 'is-wrong'));
    document.querySelectorAll('#qnav button').forEach(b => b.classList.remove('ok', 'bad'));
  }
  function showResults() {
    clearResults();
    const res = results(); let score = 0;
    document.querySelectorAll('.check-one').forEach(button => {
      const shown = checking || revealedQuestions.has(Number(button.dataset.q));
      button.textContent = shown ? '隱藏' : '對答案';
      button.disabled = checking || !activeItem?.answers?.[button.dataset.q];
      button.title = checking ? '先隱藏全部答案，再個別核對' : button.disabled ? '這一題沒有可用的答案鍵' : '只顯示這一題的答案';
      button.setAttribute('aria-pressed', String(shown));
    });
    for (const [n, r] of Object.entries(res)) {
      if (!checking && !revealedQuestions.has(Number(n))) continue;
      const input = document.querySelector(`.answer-input[data-q="${n}"]`);
      const mark = document.createElement('span'); mark.className = `key-answer ${r.ok ? 'ok' : 'bad'}`;
      mark.textContent = `${r.ok ? '✓' : '✗'} ${r.keys.join(' / ')}`;
      input?.classList.add(r.ok ? 'is-correct' : 'is-wrong'); input?.after(mark);
      $('qnav').querySelector(`[data-q="${n}"]`)?.classList.add(r.ok ? 'ok' : 'bad');
      score += r.ok;
    }
    const total = activeItem.end - activeItem.start + 1, keyed = Object.keys(res).length;
    if (checking) $('qcount').textContent = `得分 ${score} / ${keyed}${keyed < total ? `（${total - keyed} 題無答案鍵）` : ''}`;
    else updateCount();
    return { score, keyed, total, res };
  }
  function toggleCheck() {
    if (!activeItem) return;
    if (!activeItem.answers) { $('status').textContent = '這份講義沒有附答案，無法自動對答案。'; return; }
    checking = !checking;
    $('checkBtn').textContent = checking ? '隱藏答案' : '對答案';
    $('checkBtn').classList.toggle('active', checking);
    if (checking) {
      if (deadline) $('timer').click(); // pause the clock while reviewing
      const { score, keyed } = showResults();
      $('status').textContent = `已對答案：${score} / ${keyed}。可在「筆記」下載你的作答、畫線與註記。`;
    } else { showResults(); }
  }

  function updateWordCount() {
    const words = countWords(drafts[task]), min = task === 'task1' ? 150 : 250;
    $('wordcount').textContent = `Word count: ${words}`;
    $('target').textContent = words >= min ? `已達 ${min} 字` : `至少 ${min} 字，尚差 ${min - words} 字`;
    $('target').classList.toggle('met', words >= min);
    $('wcbar').style.setProperty('--p', `${Math.min(100, words / min * 100)}%`);
    $('wcbar').classList.toggle('met', words >= min);
  }
  if (kind === 'reading') {
    // The blank 1–40 answer sheet is only for a student's own PDF; until then the pane shows its placeholder.
    const step = d => { const qs = [...document.querySelectorAll('#qnav button[data-q]')].map(b => Number(b.dataset.q)); if (!qs.length) return; goTo(currentQ ? Math.min(qs.at(-1), Math.max(qs[0], currentQ + d)) : qs[0]); };
    $('prevQ').addEventListener('click', () => step(-1));
    $('nextQ').addEventListener('click', () => step(1));
    $('checkBtn').addEventListener('click', toggleCheck);
    $('reviewBtn').addEventListener('click', () => {
      if (!activeItem) return;
      if (deadline) $('timer').click();
      const list = $('reviewList'); list.replaceChildren(); const res = results();
      const intro = document.createElement('p'); intro.textContent = '依現有答案鍵核對；未提供答案鍵的題目不計分。本工具未提供來源解析，請自行回原文確認。'; list.append(intro);
      for (let n = activeItem.start; n <= activeItem.end; n++) {
        const r = res[n], given = drafts.answers[n - 1].trim();
        const row = document.createElement('div'); row.className = 'review-row';
        const detail = document.createElement('div'); detail.textContent = `第 ${n} 題 · ${given || '未作答'} · ${r ? `${r.ok ? '正確' : '未答對'} · 正解 ${r.keys.join(' / ')}` : '無答案鍵'}`;
        const question = document.querySelector(`.answer-input[data-q="${n}"]`)?.closest('.q-item');
        if (question) { const snippet = question.cloneNode(true); snippet.querySelectorAll('button,input,.key-answer').forEach(node => node.remove()); const p = document.createElement('small'); p.className = 'review-question'; p.textContent = snippet.textContent.trim().replace(/\s+/g, ' '); detail.append(p); }
        const jump = document.createElement('button'); jump.type = 'button'; jump.textContent = '回到題目'; jump.addEventListener('click', () => { $('reviewDialog').close(); goTo(n); });
        row.append(detail, jump); list.append(row);
      }
      const heading = document.createElement('h3'); heading.textContent = '文章與題目畫記'; list.append(heading);
      const ids = [...new Set(study.marks.map(m => m.id))];
      if (!ids.length) { const p = document.createElement('p'); p.textContent = '尚無畫記。'; list.append(p); }
      for (const id of ids) { const parts = study.marks.filter(m => m.id === id); const row = document.createElement('div'); row.className = 'review-row'; const text = document.createElement('div'); text.textContent = `${parts[0].area === 'question' ? '題目' : '文章'}：「${parts.map(m => m.text).join(' … ')}」${parts[0].note ? ` · ${parts[0].note}` : ''}`; const jump = document.createElement('button'); jump.textContent = '定位畫記'; jump.type = 'button'; jump.addEventListener('click', () => { $('reviewDialog').close(); document.querySelector(`mark.hl[data-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); row.append(text, jump); list.append(row); }
      $('reviewDialog').showModal();
    });
    $('reviewClose').addEventListener('click', () => $('reviewDialog').close());
  } else {
    const editor = $('editor');
    function saveEditor() { drafts[task] = editor.innerText.replace(/\r\n/g, '\n'); drafts[`${task}Html`] = safeWritingHtml(editor.innerHTML); updateWordCount(); save(); }
    editor.addEventListener('input', saveEditor);
    editor.addEventListener('keydown', e => { if ($('practiceMode').value === 'exam' && (e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) e.preventDefault(); });
    // Paste plain text to avoid hidden formatting, external resources and unsafe markup.
    editor.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    document.querySelectorAll('[data-format]').forEach(button => {
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', () => {
        if (locked) return;
        editor.focus(); document.execCommand(button.dataset.format, false); saveEditor();
      });
    });
    for (const id of ['task1', 'task2']) $(id).addEventListener('click', () => { task = id; render(); });
  }
  load();

  const layout = document.querySelector('.layout');
  const splitter = $('splitter');
  try { const saved = Number(localStorage.getItem(`ielts-${kind}-split`)); if (saved >= 35 && saved <= 80) layout.style.setProperty('--left', `${saved}%`); } catch {}
  function setSplit(percent) {
    const value = Math.min(80, Math.max(35, percent));
    layout.style.setProperty('--left', `${value}%`);
    try { localStorage.setItem(`ielts-${kind}-split`, String(value)); } catch {}
  }
  splitter.addEventListener('pointerdown', event => {
    splitter.setPointerCapture(event.pointerId);
    const move = e => setSplit((e.clientX - layout.getBoundingClientRect().left) / layout.clientWidth * 100);
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', () => splitter.removeEventListener('pointermove', move), { once: true });
  });
  splitter.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = parseFloat(getComputedStyle(layout).getPropertyValue('--left')) || 58;
    setSplit(current + (event.key === 'ArrowRight' ? 2 : -2));
  });

  function showText() {
    const view = $('textView'); view.replaceChildren();
    if (kind === 'reading') {
      // Every passage in the books opens with its label and the time guidance.
      const n = activeItem.id.split('-').pop();
      view.append(el('p', 'passage-label', `READING PASSAGE ${n}`),
        el('p', 'passage-intro', 'You should spend about 20 minutes on ', el('b', '', `Questions ${activeItem.start}–${activeItem.end}`), `, which are based on Reading Passage ${n} below.`));
    }
    const title = document.createElement('h1'); title.textContent = activeItem.title; view.append(title);
    const parent = kind === 'reading' ? view : document.createElement('div');
    if (kind === 'writing') { parent.className = 'prompt-box'; view.append(parent); }
    (kind === 'reading' ? activeItem.passage : activeItem.prompt).forEach((content, k) => {
      if (content === activeItem.title) return;
      const phrases = activeItem.fmt?.p?.[k];
      const img = figure(content); if (img) { parent.append(img); return; }
      if (content.includes(' | ')) { parent.append(makeTable(content, (td, text) => td.append(rich(text, phrases)))); return; }
      const p = document.createElement('p');
      // A title and subtitle typed on one line: the title is already the heading, the rest is the subtitle.
      if (k === 0 && kind === 'reading' && content.startsWith(activeItem.title)) { p.className = 'subtitle'; p.append(rich(content.slice(activeItem.title.length).trim(), phrases)); parent.append(p); return; }
      const label = kind === 'reading' && content.match(/^([A-Z]|\d{1,2})\.\s+/);
      if (label) { const b = document.createElement('b'); b.className = 'para-label'; b.textContent = label[1]; p.append(b, rich(content.slice(label[0].length), phrases)); }
      else p.append(rich(content, phrases));
      parent.append(p);
    });
    for (const image of activeItem.images || []) parent.append(taskImage(image));
    if (kind === 'writing') $('viewFigure').hidden = !parent.querySelector('.task-image-frame, table');
    applyMarks();
    view.scrollTop = 0;
  }
  function setView(mode) {
    const textMode = mode === 'text' && !!activeItem;
    $('textView').hidden = !textMode;
    $('viewer').hidden = textMode || !$('viewer').src;
    $('pdfLink').hidden = textMode || !$('viewer').src;
    $('viewText').classList.toggle('active', textMode);
    $('viewPdf').classList.toggle('active', !textMode);
    if (kind === 'writing' && !textMode) $('viewFigure').hidden = true;
    if (textMode) showText();
  }
  $('focus').addEventListener('click', () => { const active = layout.classList.toggle('focus'); $('focus').textContent = active ? '顯示作答區' : '專注閱讀'; $('focus').setAttribute('aria-pressed', String(active)); });
  $('viewText').addEventListener('click', () => setView('text'));
  $('viewPdf').addEventListener('click', () => setView('pdf'));
  if (kind === 'writing') $('viewFigure').addEventListener('click', () => { const target = $('textView').querySelector('.task-image-frame, table'); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  // ── Highlights and notes ─────────────────────────────────
  // A highlight is stored as character offsets inside one block of the text (a paragraph, heading or table),
  // so it survives re-rendering and reloads. Selections across paragraphs become one segment per block.
  const COLORS = { yellow: '黃', green: '綠', pink: '粉紅', blue: '藍' };
  let study = { notes: '', marks: [] };
  const studyKey = () => activeItem && `ielts-${kind}-notes-${activeItem.id}`;
  function loadStudy() {
    study = { notes: '', marks: [] };
    try { const saved = JSON.parse(localStorage.getItem(studyKey()) || 'null'); if (saved && Array.isArray(saved.marks)) study = saved; } catch {}
    $('notesText').value = study.notes || '';
    renderNotes();
  }
  function saveStudy() {
    try { localStorage.setItem(studyKey(), JSON.stringify(study)); } catch { $('status').textContent = '無法保存筆記，請先下載。'; }
    renderNotes();
    refreshInlineNotes();
  }
  const blocks = (area = 'passage') => area === 'question' ? [...$('questionText').children] : [...$('textView').children];
  function cleanText(fragment) { fragment.querySelectorAll('button, input, .key-answer').forEach(el => el.remove()); return fragment.textContent; }
  function blockText(block) { return cleanText(block.cloneNode(true)); }
  function offsetIn(block, node, offset) { const r = document.createRange(); r.setStart(block, 0); r.setEnd(node, offset); return cleanText(r.cloneContents()).length; }
  function wrap(block, start, end, mark) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest('button, .key-answer') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }); const parts = []; let pos = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = node.data.length, a = Math.max(start, pos), b = Math.min(end, pos + len);
      if (a < b) parts.push([node, a - pos, b - pos]);
      pos += len;
    }
    for (const [node, a, b] of parts) {
      const target = node.splitText(a); target.splitText(b - a);
      const el = document.createElement('mark'); el.className = `hl hl-${mark.color}${mark.note ? ' has-note' : ''}`; el.dataset.id = mark.id;
      if (mark.note) el.title = mark.note;
      target.replaceWith(el); el.append(target);
    }
  }
  function refreshInlineNotes() {
    document.querySelectorAll('#textView mark.hl, #questionText mark.hl').forEach(el => { delete el.dataset.note; });
    for (const id of new Set(study.marks.map(m => m.id))) {
      const note = study.marks.find(m => m.id === id)?.note?.trim();
      const marks = document.querySelectorAll(`mark.hl[data-id="${id}"]`);
      if (note && marks.length) marks[marks.length - 1].dataset.note = note;
    }
  }
  function applyMarks() { for (const m of study.marks) if (m.area === 'question') unwrap(m.id); for (const m of study.marks) { const block = blocks(m.area || 'passage')[m.block]; if (block) wrap(block, m.start, m.end, m); } refreshInlineNotes(); }
  function unwrap(id) { document.querySelectorAll(`mark.hl[data-id="${id}"]`).forEach(el => { const parent = el.parentNode; el.replaceWith(...el.childNodes); parent.normalize(); }); }
  function addMark(range, color, area) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5), created = [];
    blocks(area).forEach((block, index) => {
      if (!range.intersectsNode(block)) return;
      const start = block.contains(range.startContainer) ? offsetIn(block, range.startContainer, range.startOffset) : 0;
      const text = blockText(block);
      const end = block.contains(range.endContainer) ? offsetIn(block, range.endContainer, range.endOffset) : text.length;
      if (end > start) created.push({ id, color, area, block: index, start, end, text: text.slice(start, end), note: '' });
    });
    if (!created.length) return null;
    study.marks.push(...created);
    created.forEach(m => wrap(blocks(m.area)[m.block], m.start, m.end, m));
    saveStudy();
    return id;
  }
  function removeMark(id) { unwrap(id); study.marks = study.marks.filter(m => m.id !== id); saveStudy(); }

  // The highlighter bar appears next to a fresh selection, or next to an existing highlight when it is clicked.
  let barRange = null, barMark = null, barArea = 'passage';
  function hideBar() { $('hlbar').hidden = true; barRange = null; barMark = null; }
  function showBar(rect, existing) {
    const bar = $('hlbar'); bar.hidden = false; bar.classList.toggle('existing', !!existing);
    const top = rect.top - bar.offsetHeight - 8 < 8 ? rect.bottom + 8 : rect.top - bar.offsetHeight - 8;
    bar.style.top = `${top}px`; bar.style.left = `${Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, rect.left + rect.width / 2 - bar.offsetWidth / 2))}px`;
  }
  function onSelectEnd() {
    setTimeout(() => {
      const sel = getSelection();
      if ($('practiceMode').value === 'exam' || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return;
      const area = $('textView').contains(sel.anchorNode) && $('textView').contains(sel.focusNode) ? 'passage' : kind === 'reading' && $('questionText').contains(sel.anchorNode) && $('questionText').contains(sel.focusNode) ? 'question' : null;
      if (!area) return;
      barArea = area; barRange = sel.getRangeAt(0).cloneRange(); barMark = null; showBar(barRange.getBoundingClientRect(), false);
    }, 0);
  }
  const highlightAreas = [$('textView'), ...(kind === 'reading' ? [$('questionText')] : [])];
  for (const area of highlightAreas) {
  area.addEventListener('mouseup', onSelectEnd);
  area.addEventListener('touchend', onSelectEnd);
  area.addEventListener('keyup', e => { if (e.shiftKey) onSelectEnd(); });
  area.addEventListener('click', e => {
    if ($('practiceMode').value === 'exam') return;
    const mark = e.target.closest('mark.hl');
    if (mark && getSelection().isCollapsed) { barMark = mark.dataset.id; barRange = null; showBar(mark.getBoundingClientRect(), true); }
  });
  // Right-click stays as the test's quick highlight (or removes one).
  area.addEventListener('contextmenu', e => {
    if ($('practiceMode').value === 'exam') return;
    const mark = e.target.closest('mark.hl');
    if (mark) { e.preventDefault(); removeMark(mark.dataset.id); hideBar(); return; }
    const sel = getSelection();
    if (!sel.isCollapsed && area.contains(sel.anchorNode) && area.contains(sel.focusNode)) { e.preventDefault(); addMark(sel.getRangeAt(0), 'yellow', area.id === 'questionText' ? 'question' : 'passage'); sel.removeAllRanges(); hideBar(); }
  });
  }
  $('hlbar').addEventListener('mousedown', e => e.preventDefault()); // keep the selection while clicking the bar
  $('hlbar').addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button) return;
    const color = button.dataset.color, action = button.dataset.action;
    if (color && barRange) { addMark(barRange, color, barArea); getSelection().removeAllRanges(); }
    else if (color && barMark) { study.marks.filter(m => m.id === barMark).forEach(m => { m.color = color; }); unwrap(barMark); study.marks.filter(m => m.id === barMark).forEach(m => wrap(blocks(m.area || 'passage')[m.block], m.start, m.end, m)); saveStudy(); }
    else if (action === 'note') { const id = barRange ? addMark(barRange, 'yellow', barArea) : barMark; getSelection().removeAllRanges(); if (id) openNotes(id); }
    else if (action === 'remove' && barMark) removeMark(barMark);
    hideBar();
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#hlbar') && !e.target.closest('#textView, #questionText')) hideBar(); });
  $('textView').addEventListener('scroll', hideBar);

  function renderNotes() {
    const list = $('marksList'); list.replaceChildren();
    const groups = [...new Set(study.marks.map(m => m.id))].sort((a, b) => { const x = study.marks.find(m => m.id === a), y = study.marks.find(m => m.id === b); return (x.area === 'question') - (y.area === 'question') || x.block - y.block || x.start - y.start; });
    $('notesBtn').textContent = groups.length || study.notes ? `筆記（${groups.length}）` : '筆記';
    if (!groups.length) { const p = document.createElement('p'); p.className = 'notes-empty'; p.textContent = '在文章中選取文字即可畫重點；按「註記」可為重點寫下想法。'; list.append(p); return; }
    for (const id of groups) {
      const parts = study.marks.filter(m => m.id === id), first = parts[0];
      if ($('noteFilter').value !== 'all' && $('noteFilter').value !== first.color) continue;
      const card = document.createElement('div'); card.className = `mark-card hl-${first.color}`; card.dataset.id = id;
      const where = document.createElement('small'); where.textContent = first.area === 'question' ? '題目' : '文章'; card.append(where);
      const quote = document.createElement('blockquote'); quote.textContent = parts.map(m => m.text).join(' … ');
      const note = document.createElement('textarea'); note.placeholder = '寫下註記…'; note.value = first.note || ''; note.rows = 2;
      note.addEventListener('input', () => { parts.forEach(m => { m.note = note.value; }); try { localStorage.setItem(studyKey(), JSON.stringify(study)); } catch {} document.querySelectorAll(`mark.hl[data-id="${id}"]`).forEach(el => { el.classList.toggle('has-note', !!note.value); el.title = note.value; }); refreshInlineNotes(); });
      const tools = document.createElement('div'); tools.className = 'mark-tools';
      const go = document.createElement('button'); go.type = 'button'; go.textContent = '定位';
      go.addEventListener('click', () => { const el = document.querySelector(`mark.hl[data-id="${id}"]`); if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); });
      const del = document.createElement('button'); del.type = 'button'; del.textContent = '刪除'; del.addEventListener('click', () => removeMark(id));
      const collapse = document.createElement('button'); collapse.type = 'button'; collapse.textContent = '收合'; collapse.addEventListener('click', () => { note.hidden = !note.hidden; collapse.textContent = note.hidden ? '展開' : '收合'; });
      tools.append(go, collapse, del); card.append(quote, note, tools); list.append(card);
    }
  }
  function openNotes(focusId) {
    if (focusId && $('noteFilter').value !== 'all') { $('noteFilter').value = 'all'; renderNotes(); }
    $('notesPanel').hidden = false; $('notesBtn').classList.add('active');
    const target = focusId && $('marksList').querySelector(`[data-id="${focusId}"] textarea`);
    (target || $('notesClose')).focus();
  }
  $('notesBtn').addEventListener('click', () => { if ($('notesPanel').hidden) openNotes(); else { $('notesPanel').hidden = true; $('notesBtn').classList.remove('active'); } });
  $('notesClose').addEventListener('click', () => { $('notesPanel').hidden = true; $('notesBtn').classList.remove('active'); });
  $('notesText').addEventListener('input', e => { study.notes = e.target.value; saveStudy(); });
  $('noteFilter').addEventListener('change', renderNotes);
  $('downloadNotes').addEventListener('click', () => {
    if (!activeItem) { $('status').textContent = '請先選擇題目。'; return; }
    const lines = [`IELTS ${kind === 'reading' ? 'Reading' : 'Writing'} 筆記 — ${activeItem.title}`, `${activeItem.group} · Week ${activeItem.week} · 下載時間 ${new Date().toLocaleString('zh-TW')}`, ''];
    const groups = [...new Set(study.marks.map(m => m.id))];
    lines.push(`【畫重點與註記】${groups.length ? '' : '（無）'}`);
    groups.forEach((id, k) => { const parts = study.marks.filter(m => m.id === id); lines.push(`${k + 1}. 「${parts.map(m => m.text).join(' … ')}」（${COLORS[parts[0].color] || ''}色）`); if (parts[0].note) lines.push(`   註記：${parts[0].note}`); });
    lines.push('', '【我的筆記】', study.notes?.trim() || '（無）');
    if (kind === 'reading') {
      const res = results(); lines.push('', '【我的作答】');
      for (let n = activeItem.start; n <= activeItem.end; n++) {
        const r = res[n], given = drafts.answers[n - 1].trim() || '（未作答）';
        lines.push(`${n}. ${given}${r ? (r.ok ? '  ✓' : `  ✗  正解：${r.keys.join(' / ')}`) : ''}`);
      }
      if (activeItem.answers) { const ok = Object.values(res).filter(r => r.ok).length; lines.push(`得分：${ok} / ${Object.keys(res).length}`); }
    } else lines.push('', '【我的作文】', drafts[task] || '（未作答）', '', `Word count: ${countWords(drafts[task])}`);
    download(`IELTS-${kind}-${activeItem.id}-筆記.txt`, `﻿${lines.join('\n')}\n`, 'text/plain;charset=utf-8');
  });

  function setBanner(title, hint) { $('partTitle').textContent = title; $('partHint').textContent = hint; }
  function loadText(item) {
    activeItem = item; checking = false; hideBar();
    if (kind === 'reading') {
      $('checkBtn').textContent = '對答案'; $('checkBtn').classList.remove('active');
      $('reviewBtn').disabled = false;
      $('checkBtn').disabled = !item.answers; $('checkBtn').title = item.answers ? '核對答案（可再按一次隱藏）' : '這份講義沒有附答案';
      buildQuestions(item);
      const count = item.end - item.start + 1;
      setLimit(Math.ceil(count / 14) * 20);
      setBanner(`Questions ${item.start}–${item.end}`, `正文約 ${passageWords(item)} 字（不含標題、副標） · 建議 ${limit / 60} 分鐘 · 文章與題目均可畫記`);
    } else {
      task = item.task === 1 ? 'task1' : 'task2';
      document.querySelector('.tabs').hidden = true;
      setLimit(item.task === 1 ? 20 : 40);
      setBanner(`Part ${item.task}`, `建議時間 ${limit / 60} 分鐘，至少寫 ${item.task === 1 ? 150 : 250} 字。`);
    }
    loadStudy();
    setView('text');
  }

  for (const group of [...new Set(materials.map(item => item.group))]) {
    const options = document.createElement('optgroup'); options.label = group;
    for (const item of materials.filter(entry => entry.group === group)) {
      const option = document.createElement('option'); option.value = item.id;
      const label = kind === 'reading' && item.label === item.label.toUpperCase() ? item.label.toLowerCase().replace(/^\p{L}/u, c => c.toUpperCase()) : item.label;
      option.textContent = kind === 'reading' ? `${readingReference(item)} · ${label}` : label; options.append(option);
    }
    $('material').append(options);
  }
  function canSwitch() { return !saveFailed || confirm('自動儲存失敗，切換前請先下載備份。仍要繼續嗎？'); }
  $('attempt').addEventListener('change', e => {
    if (!canSwitch()) { e.target.value = currentAttempt; return; }
    currentAttempt = e.target.value.trim().normalize('NFC'); e.target.value = currentAttempt;
    key = currentAttempt ? `${baseKey}-attempt-${JSON.stringify(currentAttempt)}` : baseKey; saveFailed = false; load();
  });
  function setMaterialKey(value) { baseKey = value; key = baseKey; currentAttempt = ''; $('attempt').value = ''; saveFailed = false; load(); }
  function showPdf(url, label) {
    // The published site ships without the source PDFs, so items there have no `source`.
    if (url) { $('viewer').src = url; $('pdfLink').href = url; } else $('viewer').removeAttribute('src');
    $('viewPdf').hidden = !url; $('empty').hidden = true; $('filename').textContent = label;
  }
  $('material').addEventListener('change', e => {
    const item = materials.find(entry => entry.id === e.target.value); if (!item) return;
    if (!canSwitch()) { e.target.value = ''; return; }
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
    showPdf(item.source, `${kind === 'reading' ? readingReference(item) : `${item.group} · Week ${item.week}`} · ${item.title}`); loadText(item);
    if (kind === 'writing') { $('chooseWriting').textContent = `${writingType(item)} · ${writingPreview(item).slice(0, 60)}…`; $('chooseWriting').title = writingPreview(item); }
    setMaterialKey(`ielts-${kind}-question-${item.id}`);
    history.replaceState(null, '', `#${item.id}`);
    try { localStorage.setItem(`ielts-${kind}-last`, item.id); } catch {}
  });

  // Question library: every item grouped by course and week, with this browser's progress.
  function progress(item) {
    try {
      const saved = JSON.parse(localStorage.getItem(`ielts-${kind}-question-${item.id}`) || 'null'); if (!saved) return '';
      if (kind === 'reading') { const done = saved.answers.slice(item.start - 1, item.end).filter(a => a.trim()).length; return done ? `${done}/${item.end - item.start + 1}` : ''; }
      const words = countWords(saved[item.task === 1 ? 'task1' : 'task2'] || ''); return words ? `${words} 字` : '';
    } catch { return ''; }
  }
  function writingType(item) {
    const text = item.prompt.join(' ').toLowerCase();
    if (item.task === 1) {
      const types = [];
      if (/\b(?:maps?|plans?|floor plan)\b/.test(text)) types.push('地圖／平面圖 Maps & plans');
      if (/\b(?:pie charts?)\b/.test(text)) types.push('圓餅圖 Pie charts');
      if (/\b(?:bar charts?|bar graphs?)\b/.test(text)) types.push('長條圖 Bar charts');
      if (/\b(?:line charts?|line graphs?)\b/.test(text)) types.push('折線圖 Line graphs');
      if (/\btables?\b/.test(text)) types.push('表格 Tables');
      if (/\b(?:diagrams?|flowcharts?|life cycle)\b/.test(text) && !/\bfloor plan\b/.test(text)) types.push('流程／示意圖 Diagrams');
      if (/\bgraphs?\b/.test(text) && !/\b(?:line|bar) graphs?\b/.test(text)) types.push('圖表 Graph（細類待確認）');
      if (/\bcharts?\b/.test(text) && !/\b(?:pie|bar|line) charts?\b/.test(text) && !/flowcharts?/.test(text)) types.push('圖表 Chart（細類待確認）');
      return `Task 1 · ${types.join(' ＋ ') || '圖表（類型待確認）'}`;
    }
    if (/advantages?.{0,80}disadvantages?|disadvantages?.{0,80}advantages?|benefits?.{0,80}drawbacks?/s.test(text)) return 'Task 2 · 優缺點 Advantages & disadvantages';
    if (/discuss both|discuss these (?:two )?views/i.test(text)) return 'Task 2 · 雙邊討論 Discuss both views';
    if (/agree or disagree|to what extent/i.test(text)) return 'Task 2 · 同意與否 Opinion';
    if (/problems?.{0,120}solutions?|solutions?.{0,120}problems?/s.test(text)) return 'Task 2 · 問題與解決 Problem & solution';
    return 'Task 2 · 其他題型 Other questions';
  }
  function writingTopic(item) {
    const text = item.prompt.join(' ').toLowerCase();
    const topics = [
      ['全球化與時尚 Globalisation & fashion', /global fashion/],
      ['都市住房 Housing', /enough homes|apartment blocks/],
      ['房屋歷史 House history', /history of the house/],
      ['海外求學 Study abroad', /study(?:ing)? abroad/],
      ['海外工作 Working abroad', /work(?:ing)? (?:in a different country|abroad)/],
      ['學校假期 School holidays', /school holidays/],
      ['上課時數 School day', /school day|school hours/],
      ['學校教育與遊戲 School learning & play', /primary schools focus/],
      ['教育與職涯 Education & careers', /university education.*career/],
      ['老化與長壽 Ageing population', /ageing population|life expectancy|living longer/],
      ['兒少室內活動 Children indoors', /children and teenagers.*indoors/],
      ['食物浪費 Food waste', /food waste|food is thrown away/],
      ['速食與健康 Fast food & health', /fast food/],
      ['乾淨飲水 Clean water', /access to clean water/],
      ['環境與航空旅行 Flying & environment', /reduce the number of times they fly/],
      ['觀光 Tourism', /touris[mt]|tourists/],
      ['瀕危動物 Endangered species', /endangered animal/],
      ['農業科技 Farming technology', /scientific developments in farming/],
      ['工作與職涯 Careers', /work for (?:the same|different)|different organisations/],
      ['遠距工作 Remote work', /working from home/],
      ['社群媒體與人際互動 Social media & interaction', /social media.*(?:interaction|communication)/],
      ['網路與社交 Internet & social connection', /internet.*(?:connected|isolates)/],
      ['網路便利性 Internet convenience', /internet makes/],
      ['數位監控 Digital surveillance', /monitor what people|cellphone tracking/],
      ['手機使用 Smartphone use', /free time using a smartphone/],
      ['電影院與線上娛樂 Cinema & online entertainment', /theatres and cinemas/],
      ['交通壅塞 Traffic congestion', /traffic jam/],
      ['人口與都市化 Population & urbanisation', /population|rural people.*moving to cities/],
      ['經濟與社會進步 Economic progress', /economic progress/],
      ['消費與負債 Consumer debt', /get into debt/],
      ['購物與在地商店 Local shops & online shopping', /local shops.*(?:supermarkets|online)/],
      ['多代同堂 Multigenerational households', /multi-generational households/]
    ];
    return topics.find(([, pattern]) => pattern.test(text))?.[0] || '主題請見題目預覽';
  }
  function writingPreview(item) {
    return item.prompt.map(line => line.replace(/^write (?:on|about) the following topic\s*:?\s*/i, '')).filter(line => !/^(?:you should spend|write at least|writing task|ielts(?: task|: writing)|summari[sz]e|give reasons|you should use your own)/i.test(line.trim()) && !line.includes(' | ')).join(' ');
  }
  function renderLibrary() {
    const query = $('librarySearch').value.trim().toLowerCase(), list = $('libraryList'); list.replaceChildren();
    const groupFor = item => kind === 'reading' ? item.group : writingType(item);
    for (const group of [...new Set(materials.map(groupFor))]) {
      const items = materials.filter(item => groupFor(item) === group && (kind !== 'writing' || ((!$('filterTask').value || String(item.task) === $('filterTask').value) && (!$('filterType').value || writingType(item) === $('filterType').value) && (!$('filterTopic').value || writingTopic(item) === $('filterTopic').value) && (!$('filterSource').value || item.group === $('filterSource').value))) && (!query || `${item.label} ${item.title} ${item.group} ${group} ${kind === 'writing' ? writingTopic(item) : ''} ${(item.prompt || []).join(' ')} week ${item.week} ${kind === 'reading' ? readingReference(item) : ''}`.toLowerCase().includes(query)));
      if (!items.length) continue;
      const section = document.createElement('section'); const h = document.createElement('h3'); h.textContent = group; section.append(h);
      for (const item of items) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'lib-item'; b.classList.toggle('active', item === activeItem);
        const meta = document.createElement('small'); meta.textContent = kind === 'reading' ? `${readingReference(item)} · Q${item.start}–${item.end} · ${passageWords(item)} 字` : `${item.group} · ${item.test ? `Test ${item.test}` : `Week ${item.week}`} · ${writingTopic(item)}`;
        const name = document.createElement('span'); name.textContent = kind === 'reading' ? item.title : writingPreview(item);
        const done = progress(item); const badge = document.createElement('em'); badge.textContent = done; badge.hidden = !done;
        b.append(meta, name, badge);
        if (kind === 'writing' && item.images?.length) { const img = document.createElement('img'); img.className = 'library-thumb'; img.alt = '題目圖表縮圖'; img.loading = 'lazy'; img.addEventListener('error', () => { if (img.dataset.fallback) { img.alt = '圖表暫時無法載入'; return; } img.dataset.fallback = '1'; img.src = item.images[0]; }); img.src = optimizedTaskImage(item.images[0]); b.append(img); }
        b.addEventListener('click', () => { $('library').close(); $('material').value = item.id; $('material').dispatchEvent(new Event('change')); });
        section.append(b);
      }
      list.append(section);
    }
    if (!list.children.length) list.textContent = '找不到符合的題目。';
  }
  if (kind === 'writing') {
    for (const [id, values] of [['filterType', materials.map(writingType)], ['filterTopic', materials.map(writingTopic)], ['filterSource', materials.map(item => item.group)]]) {
      [...new Set(values)].sort().forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; $(id).append(option); });
    }
    for (const id of ['filterTask', 'filterType', 'filterTopic', 'filterSource']) $(id).addEventListener('change', renderLibrary);
  }
  for (const id of ['libraryBtn', 'emptyLibrary', ...(kind === 'writing' ? ['chooseWriting'] : [])]) $(id).addEventListener('click', () => { $('librarySearch').value = ''; renderLibrary(); $('library').showModal(); $('librarySearch').focus(); });
  $('librarySearch').addEventListener('input', renderLibrary);
  $('libraryClose').addEventListener('click', () => $('library').close());
  $('library').addEventListener('click', e => { if (e.target === $('library')) $('library').close(); });
  // Deep link: reading/#<id> opens that item (used by "continue" on the home page).
  function openFromHash() {
    const linked = decodeURIComponent(location.hash.slice(1));
    if (linked !== activeItem?.id && materials.some(item => item.id === linked)) { $('material').value = linked; $('material').dispatchEvent(new Event('change')); }
  }
  $('pdf').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { alert('請選擇 PDF 檔案。'); return; }
    if (!canSwitch()) { e.target.value = ''; return; }
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(file); showPdf(pdfUrl, file.name); $('material').value = ''; activeItem = null; checking = false;
    if (kind === 'reading') { buildQuestions(null); $('checkBtn').disabled = true; } else document.querySelector('.tabs').hidden = false;
    setLimit(60); setBanner('自選 PDF', '依講義題號作答。');
    setView('pdf');
    setMaterialKey(`ielts-${kind}-${file.name}-${file.size}-${file.lastModified}`); e.target.value = '';
  });

  function setFont(px) { document.documentElement.style.setProperty('--font', `${px}px`); $('fontsize').value = px; }
  try { const savedFont = localStorage.getItem('ielts-font'); if (savedFont && [...$('fontsize').options].some(o => o.value === savedFont)) setFont(savedFont); } catch {}
  $('fontsize').addEventListener('change', e => { setFont(e.target.value); try { localStorage.setItem('ielts-font', e.target.value); } catch {} });

  function setLocked(value) {
    locked = value;
    document.querySelectorAll('.answer-input').forEach(el => { el.readOnly = value; });
    if (kind === 'writing') { $('editor').contentEditable = String(!value); $('editor').setAttribute('aria-readonly', String(value)); document.querySelectorAll('[data-format]').forEach(button => { button.disabled = value; }); }
    document.body.classList.toggle('time-up', value);
  }
  let suggestedMinutes = 60;
  function updateClock() {
    if (deadline) remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $('clock').textContent = $('timerMode').value === 'free' ? '不限時' : formatTime(remaining);
    $('clock').classList.toggle('warn', $('timerMode').value !== 'free' && remaining <= 300);
    if (!remaining && deadline) { clearInterval(interval); deadline = 0; $('timer').textContent = '開始計時'; const lock = $('lockOnTimeout').checked; setLocked(lock); $('status').textContent = lock ? '時間到，作答已鎖定（已保存）。按「重設計時」可解除鎖定。' : '時間到，作答仍可繼續。'; }
  }
  function resetTimer() { clearInterval(interval); deadline = 0; limit = ($('timerMode').value === 'custom' ? Math.max(1, Math.min(300, Number($('customTime').value) || suggestedMinutes)) : suggestedMinutes) * 60; remaining = limit; $('timer').textContent = '開始計時'; $('timer').disabled = $('timerMode').value === 'free'; $('customTimeLabel').hidden = $('timerMode').value !== 'custom'; setLocked(false); updateClock(); }
  function setLimit(minutes) { suggestedMinutes = minutes; resetTimer(); }
  $('timer').addEventListener('click', () => {
    if (deadline) { updateClock(); deadline = 0; clearInterval(interval); $('timer').textContent = '繼續計時'; }
    else { if (!remaining) { remaining = limit; setLocked(false); } deadline = Date.now() + remaining * 1000; interval = setInterval(updateClock, 250); $('timer').textContent = '暫停計時'; }
  });
  $('resetTimer').addEventListener('click', resetTimer);
  $('timerMode').addEventListener('change', resetTimer);
  $('customTime').addEventListener('change', resetTimer);
  $('practiceMode').addEventListener('change', () => {
    const exam = $('practiceMode').value === 'exam'; document.body.classList.toggle('exam-mode', exam);
    if (exam) { $('notesPanel').hidden = true; $('notesBtn').classList.remove('active'); hideBar(); if (kind === 'reading') { checking = false; revealedQuestions.clear(); clearResults(); $('checkBtn').textContent = '對答案'; $('checkBtn').classList.remove('active'); updateCount(); } }
    $('status').textContent = exam ? '考試模式：隱藏提示與格式工具；此模式僅模擬練習，不代表正式考試介面。' : '練習模式：可使用筆記、格式與答案回顧。';
  });
  resetTimer();

  function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('download').addEventListener('click', async () => {
    if (!activeItem) { $('status').textContent = '請先選擇題目。'; return; }
    $('download').disabled = true;
    try { $('status').textContent = '正在製作 Word 文件…'; await window.exportPracticeDocx({ kind, item: activeItem, source: $('filename').textContent, drafts, task, study, results: kind === 'reading' ? results() : {} }); $('status').textContent = 'Word 文件已產生。'; }
    catch (error) { console.error(error); $('status').textContent = `Word 匯出失敗：${error.message}`; }
    finally { $('download').disabled = false; }
  });
  if (kind === 'writing') $('downloadText').addEventListener('click', () => download('ielts-writing.txt', `Task 1\n\n${drafts.task1}\n\nTask 2\n\n${drafts.task2}\n`, 'text/plain;charset=utf-8'));
  $('restore').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!validateBackup(backup, kind)) throw new Error('invalid');
      if (confirm('還原會取代目前的作答，建議先下載備份。仍要繼續嗎？')) { drafts = backup.drafts; save(); render(); }
    } catch { alert('備份檔無效，請選擇從本網站下載的 JSON 檔。'); }
    e.target.value = '';
  });
  openFromHash();
  addEventListener('hashchange', openFromHash);
})();
