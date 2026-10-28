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
    $('status').textContent = '';
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (validateBackup({ version: 1, kind, drafts: saved }, kind)) drafts = saved;
    } catch { $('status').textContent = '無法讀取本機儲存，請使用備份還原。'; }
    render();
  }
  function render() {
    if (kind === 'reading') {
      document.querySelectorAll('.answer-input').forEach(input => { input.value = drafts.answers[input.dataset.q - 1]; });
      document.querySelectorAll('#qnav button[data-q]').forEach(b => b.classList.toggle('answered', !!drafts.answers[b.dataset.q - 1].trim()));
      if (checking) showResults(); else updateCount();
    } else {
      $('editor').value = drafts[task];
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
  function makeTable(line, fill) {
    const table = document.createElement('table'); table.className = 'q-table';
    for (const row of line.split('\n')) { const tr = table.insertRow(); for (const cell of row.split(' | ')) fill(tr.insertCell(), cell); }
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
  const passageWords = item => countWords(item.passage.filter(l => !l.startsWith('[[IMG') && l !== item.title).join(' ').replace(/\|/g, ' '));

  // Reading: answer boxes are placed inline in the question text, like the computer-delivered test.
  const gapPattern = /(\d{1,2})\.?\s*(?:[.…]{3,}|_{3,})/g;
  const blankPattern = /[.…]{4,}|_{3,}/;
  let currentQ = 0, checking = false;
  function updateCount() {
    const buttons = [...document.querySelectorAll('#qnav button[data-q]')];
    $('qcount').textContent = buttons.length ? `已作答 ${buttons.filter(b => b.classList.contains('answered')).length} / ${buttons.length}` : '';
  }
  function answerInput(n) {
    const input = document.createElement('input');
    input.className = 'answer-input'; input.dataset.q = n; input.placeholder = n;
    input.autocomplete = 'off'; input.spellcheck = false; input.readOnly = locked;
    input.setAttribute('aria-label', `Question ${n}`);
    input.addEventListener('input', () => {
      drafts.answers[n - 1] = input.value; save();
      $('qnav').querySelector(`[data-q="${n}"]`)?.classList.toggle('answered', !!input.value.trim());
      if (checking) showResults(); else updateCount();
    });
    input.addEventListener('focus', () => { currentQ = n; document.querySelectorAll('#qnav button').forEach(b => b.classList.toggle('current', b.dataset.q === String(n))); });
    return input;
  }
  function goTo(n) {
    const input = document.querySelector(`.answer-input[data-q="${n}"]`); if (!input) return;
    input.scrollIntoView({ block: 'center', behavior: 'smooth' }); input.focus({ preventScroll: true });
  }
  function buildQuestions(item) {
    const box = $('questionText'), rest = $('answers'), nav = $('qnav');
    box.replaceChildren(); rest.replaceChildren(); nav.replaceChildren();
    const start = item ? item.start : 1, end = item ? item.end : 40, used = new Set();
    const free = n => n >= start && n <= end && !used.has(n);
    // Replaces numbered gaps ("7 ......") in text with answer boxes; returns false if none were placed.
    const fillGaps = (el, text, phrases) => {
      let last = 0;
      for (const m of text.matchAll(gapPattern)) {
        const n = Number(m[1]); if (!free(n)) continue;
        el.append(rich(text.slice(last, m.index), phrases), answerInput(n)); used.add(n); last = m.index + m[0].length;
      }
      el.append(rich(text.slice(last), phrases));
      return last > 0;
    };
    (item ? item.questions : []).forEach((line, k) => {
      const phrases = item.fmt?.q?.[k];
      if (/^Questions?\s+\d/i.test(line)) { const h = document.createElement('h3'); h.textContent = line; box.append(h); return; }
      const img = figure(line); if (img) { box.append(img); return; }
      if (line.includes(' | ')) { box.append(makeTable(line, (td, cell) => fillGaps(td, cell, phrases))); return; }
      const p = document.createElement('p');
      if (fillGaps(p, line, phrases)) { box.append(p); return; }
      p.replaceChildren();
      const lead = line.match(/^(\d{1,2})\.?\s+(\S[\s\S]*)$/);
      if (lead && free(Number(lead[1]))) {
        const n = Number(lead[1]); used.add(n); p.className = 'q-item';
        const num = document.createElement('b'); num.className = 'qnum'; num.textContent = n;
        const blank = lead[2].match(blankPattern);
        if (blank) p.append(num, rich(lead[2].slice(0, blank.index), phrases), answerInput(n), rich(lead[2].slice(blank.index + blank[0].length), phrases));
        else p.append(num, rich(lead[2], phrases), ' ', answerInput(n));
      } else p.append(rich(line, phrases));
      box.append(p);
    });
    // Numbers the parser could not place (tables, unnumbered statements) still get a box.
    const leftover = [];
    for (let n = start; n <= end; n++) if (!used.has(n)) leftover.push(n);
    if (leftover.length) {
      const h = document.createElement('h3'); h.textContent = item ? '其餘題號作答區' : 'Answer sheet 1–40'; rest.append(h);
      for (const n of leftover) { const label = document.createElement('label'); label.className = 'answer'; const b = document.createElement('b'); b.className = 'qnum'; b.textContent = n; label.append(b, answerInput(n)); rest.append(label); }
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
  const norm = s => s.normalize('NFKC').toLowerCase().replace(/[‘’`]/g, "'").replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[.,;:!?"]+$/, '').replace(/\s+/g, ' ').trim();
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
    for (const [n, r] of Object.entries(res)) {
      const input = document.querySelector(`.answer-input[data-q="${n}"]`);
      const mark = document.createElement('span'); mark.className = `key-answer ${r.ok ? 'ok' : 'bad'}`;
      mark.textContent = r.ok ? '✓' : `✗ ${r.keys.join(' / ')}`;
      input?.classList.add(r.ok ? 'is-correct' : 'is-wrong'); input?.after(mark);
      $('qnav').querySelector(`[data-q="${n}"]`)?.classList.add(r.ok ? 'ok' : 'bad');
      score += r.ok;
    }
    const total = activeItem.end - activeItem.start + 1, keyed = Object.keys(res).length;
    $('qcount').textContent = `得分 ${score} / ${keyed}${keyed < total ? `（${total - keyed} 題無答案鍵）` : ''}`;
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
    } else { clearResults(); updateCount(); }
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
  } else {
    $('editor').addEventListener('input', e => { drafts[task] = e.target.value; updateWordCount(); save(); });
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
    const title = document.createElement('h1'); title.textContent = activeItem.title; view.append(title);
    const parent = kind === 'reading' ? view : document.createElement('div');
    if (kind === 'writing') { parent.className = 'prompt-box'; view.append(parent); }
    (kind === 'reading' ? activeItem.passage : activeItem.prompt).forEach((content, k) => {
      if (content === activeItem.title) return;
      const phrases = activeItem.fmt?.p?.[k];
      const img = figure(content); if (img) { parent.append(img); return; }
      if (content.includes(' | ')) { parent.append(makeTable(content, (td, text) => td.append(rich(text, phrases)))); return; }
      const p = document.createElement('p');
      // Paragraph letters/numbers (A., 1.) are what matching questions refer to, so make them stand out.
      const label = kind === 'reading' && content.match(/^([A-Z]|\d{1,2})\.\s+/);
      if (label) { const b = document.createElement('b'); b.className = 'para-label'; b.textContent = label[1]; p.append(b, rich(content.slice(label[0].length), phrases)); }
      else p.append(rich(content, phrases));
      parent.append(p);
    });
    for (const image of activeItem.images || []) { const img = document.createElement('img'); img.src = image; img.alt = '題目圖表'; img.className = 'task-figure'; parent.append(img); }
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
    if (textMode) showText();
  }
  $('focus').addEventListener('click', () => { const active = layout.classList.toggle('focus'); $('focus').textContent = active ? '顯示作答區' : '專注閱讀'; $('focus').setAttribute('aria-pressed', String(active)); });
  $('viewText').addEventListener('click', () => setView('text'));
  $('viewPdf').addEventListener('click', () => setView('pdf'));

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
  }
  const blocks = () => [...$('textView').children];
  function offsetIn(block, node, offset) { const r = document.createRange(); r.setStart(block, 0); r.setEnd(node, offset); return r.toString().length; }
  function wrap(block, start, end, mark) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); const parts = []; let pos = 0;
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
  function applyMarks() { for (const m of study.marks) { const block = blocks()[m.block]; if (block) wrap(block, m.start, m.end, m); } }
  function unwrap(id) { document.querySelectorAll(`#textView mark[data-id="${id}"]`).forEach(el => { const parent = el.parentNode; el.replaceWith(...el.childNodes); parent.normalize(); }); }
  function addMark(range, color) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5), created = [];
    blocks().forEach((block, index) => {
      if (!range.intersectsNode(block)) return;
      const start = block.contains(range.startContainer) ? offsetIn(block, range.startContainer, range.startOffset) : 0;
      const end = block.contains(range.endContainer) ? offsetIn(block, range.endContainer, range.endOffset) : block.textContent.length;
      if (end > start) created.push({ id, color, block: index, start, end, text: block.textContent.slice(start, end), note: '' });
    });
    if (!created.length) return null;
    study.marks.push(...created);
    created.forEach(m => wrap(blocks()[m.block], m.start, m.end, m));
    saveStudy();
    return id;
  }
  function removeMark(id) { unwrap(id); study.marks = study.marks.filter(m => m.id !== id); saveStudy(); }

  // The highlighter bar appears next to a fresh selection, or next to an existing highlight when it is clicked.
  let barRange = null, barMark = null;
  function hideBar() { $('hlbar').hidden = true; barRange = null; barMark = null; }
  function showBar(rect, existing) {
    const bar = $('hlbar'); bar.hidden = false; bar.classList.toggle('existing', !!existing);
    const top = rect.top - bar.offsetHeight - 8 < 8 ? rect.bottom + 8 : rect.top - bar.offsetHeight - 8;
    bar.style.top = `${top}px`; bar.style.left = `${Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, rect.left + rect.width / 2 - bar.offsetWidth / 2))}px`;
  }
  function onSelectEnd() {
    setTimeout(() => {
      const sel = getSelection();
      if (sel.isCollapsed || !sel.rangeCount || !$('textView').contains(sel.anchorNode) || !sel.toString().trim()) return;
      barRange = sel.getRangeAt(0).cloneRange(); barMark = null; showBar(barRange.getBoundingClientRect(), false);
    }, 0);
  }
  $('textView').addEventListener('mouseup', onSelectEnd);
  $('textView').addEventListener('touchend', onSelectEnd);
  $('textView').addEventListener('keyup', e => { if (e.shiftKey) onSelectEnd(); });
  $('textView').addEventListener('click', e => {
    const mark = e.target.closest('mark.hl');
    if (mark && getSelection().isCollapsed) { barMark = mark.dataset.id; barRange = null; showBar(mark.getBoundingClientRect(), true); }
  });
  // Right-click stays as the test's quick highlight (or removes one).
  $('textView').addEventListener('contextmenu', e => {
    const mark = e.target.closest('mark.hl');
    if (mark) { e.preventDefault(); removeMark(mark.dataset.id); hideBar(); return; }
    const sel = getSelection();
    if (!sel.isCollapsed && $('textView').contains(sel.anchorNode)) { e.preventDefault(); addMark(sel.getRangeAt(0), 'yellow'); sel.removeAllRanges(); hideBar(); }
  });
  $('hlbar').addEventListener('mousedown', e => e.preventDefault()); // keep the selection while clicking the bar
  $('hlbar').addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button) return;
    const color = button.dataset.color, action = button.dataset.action;
    if (color && barRange) { addMark(barRange, color); getSelection().removeAllRanges(); }
    else if (color && barMark) { study.marks.filter(m => m.id === barMark).forEach(m => { m.color = color; }); unwrap(barMark); study.marks.filter(m => m.id === barMark).forEach(m => wrap(blocks()[m.block], m.start, m.end, m)); saveStudy(); }
    else if (action === 'note') { const id = barRange ? addMark(barRange, 'yellow') : barMark; getSelection().removeAllRanges(); if (id) openNotes(id); }
    else if (action === 'remove' && barMark) removeMark(barMark);
    hideBar();
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#hlbar') && !e.target.closest('#textView')) hideBar(); });
  $('textView').addEventListener('scroll', hideBar);

  function renderNotes() {
    const list = $('marksList'); list.replaceChildren();
    const groups = [...new Set(study.marks.map(m => m.id))];
    $('notesBtn').textContent = groups.length || study.notes ? `筆記（${groups.length}）` : '筆記';
    if (!groups.length) { const p = document.createElement('p'); p.className = 'notes-empty'; p.textContent = '在文章中選取文字即可畫重點；按「註記」可為重點寫下想法。'; list.append(p); return; }
    for (const id of groups) {
      const parts = study.marks.filter(m => m.id === id), first = parts[0];
      const card = document.createElement('div'); card.className = `mark-card hl-${first.color}`; card.dataset.id = id;
      const quote = document.createElement('blockquote'); quote.textContent = parts.map(m => m.text).join(' … ');
      const note = document.createElement('textarea'); note.placeholder = '寫下註記…'; note.value = first.note || ''; note.rows = 2;
      note.addEventListener('input', () => { parts.forEach(m => { m.note = note.value; }); try { localStorage.setItem(studyKey(), JSON.stringify(study)); } catch {} document.querySelectorAll(`#textView mark[data-id="${id}"]`).forEach(el => { el.classList.toggle('has-note', !!note.value); el.title = note.value; }); });
      const tools = document.createElement('div'); tools.className = 'mark-tools';
      const go = document.createElement('button'); go.type = 'button'; go.textContent = '定位';
      go.addEventListener('click', () => { const el = document.querySelector(`#textView mark[data-id="${id}"]`); if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); });
      const del = document.createElement('button'); del.type = 'button'; del.textContent = '刪除'; del.addEventListener('click', () => removeMark(id));
      tools.append(go, del); card.append(quote, note, tools); list.append(card);
    }
  }
  function openNotes(focusId) {
    $('notesPanel').hidden = false; $('notesBtn').classList.add('active');
    const target = focusId && $('marksList').querySelector(`[data-id="${focusId}"] textarea`);
    (target || $('notesText')).focus();
  }
  $('notesBtn').addEventListener('click', () => { if ($('notesPanel').hidden) openNotes(); else { $('notesPanel').hidden = true; $('notesBtn').classList.remove('active'); } });
  $('notesClose').addEventListener('click', () => { $('notesPanel').hidden = true; $('notesBtn').classList.remove('active'); });
  $('notesText').addEventListener('input', e => { study.notes = e.target.value; saveStudy(); });
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
      $('checkBtn').disabled = !item.answers; $('checkBtn').title = item.answers ? '核對答案（可再按一次隱藏）' : '這份講義沒有附答案';
      buildQuestions(item);
      const count = item.end - item.start + 1;
      setLimit(Math.ceil(count / 14) * 20);
      setBanner(`Questions ${item.start}–${item.end}`, `文章約 ${passageWords(item)} 字 · 建議 ${limit / 60} 分鐘 · 選取文字即可畫重點`);
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
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; options.append(option);
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
    showPdf(item.source, `${item.group} · Week ${item.week} · ${item.title}`); loadText(item);
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
  function renderLibrary() {
    const query = $('librarySearch').value.trim().toLowerCase(), list = $('libraryList'); list.replaceChildren();
    for (const group of [...new Set(materials.map(item => item.group))]) {
      const items = materials.filter(item => item.group === group && (!query || `${item.label} ${item.title} week ${item.week}`.toLowerCase().includes(query)));
      if (!items.length) continue;
      const section = document.createElement('section'); const h = document.createElement('h3'); h.textContent = group; section.append(h);
      for (const item of items) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'lib-item'; b.classList.toggle('active', item === activeItem);
        const meta = document.createElement('small'); meta.textContent = `Week ${item.week} · ${kind === 'reading' ? `Q${item.start}–${item.end} · ${passageWords(item)} 字` : `Task ${item.task}`}`;
        const name = document.createElement('span'); name.textContent = kind === 'reading' ? item.title : item.label.replace(/^Task \d · /, '');
        const done = progress(item); const badge = document.createElement('em'); badge.textContent = done; badge.hidden = !done;
        b.append(meta, name, badge);
        b.addEventListener('click', () => { $('library').close(); $('material').value = item.id; $('material').dispatchEvent(new Event('change')); });
        section.append(b);
      }
      list.append(section);
    }
    if (!list.children.length) list.textContent = '找不到符合的題目。';
  }
  for (const id of ['libraryBtn', 'emptyLibrary']) $(id).addEventListener('click', () => { $('librarySearch').value = ''; renderLibrary(); $('library').showModal(); $('librarySearch').focus(); });
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
    document.querySelectorAll('.answer-input, #editor').forEach(el => { el.readOnly = value; });
    document.body.classList.toggle('time-up', value);
  }
  function updateClock() {
    if (deadline) remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $('clock').textContent = formatTime(remaining);
    $('clock').classList.toggle('warn', remaining <= 300);
    if (!remaining && deadline) { clearInterval(interval); deadline = 0; $('timer').textContent = '開始計時'; setLocked(true); $('status').textContent = '時間到，作答已鎖定（已保存）。按「重設計時」可解除鎖定。'; }
  }
  function resetTimer() { clearInterval(interval); deadline = 0; remaining = limit; $('timer').textContent = '開始計時'; setLocked(false); updateClock(); }
  function setLimit(minutes) { limit = minutes * 60; resetTimer(); }
  $('timer').addEventListener('click', () => {
    if (deadline) { updateClock(); deadline = 0; clearInterval(interval); $('timer').textContent = '繼續計時'; }
    else { if (!remaining) { remaining = limit; setLocked(false); } deadline = Date.now() + remaining * 1000; interval = setInterval(updateClock, 250); $('timer').textContent = '暫停計時'; }
  });
  $('resetTimer').addEventListener('click', resetTimer);
  resetTimer();

  function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('download').addEventListener('click', () => download(`ielts-${kind}-backup.json`, JSON.stringify({ version: 1, kind, document: $('filename').textContent, drafts }, null, 2), 'application/json;charset=utf-8'));
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
