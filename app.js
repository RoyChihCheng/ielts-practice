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
    } else {
      $('editor').value = drafts[task];
      updateWordCount();
      for (const id of ['task1', 'task2']) { $(id).classList.toggle('active', id === task); $(id).setAttribute('aria-pressed', String(id === task)); }
    }
  }

  // Reading: answer boxes are placed inline in the question text, like the computer-delivered test.
  const gapPattern = /(\d{1,2})\s*(?:[.…]{3,}|_{3,})/g;
  const blankPattern = /[.…]{4,}|_{3,}/;
  function answerInput(n) {
    const input = document.createElement('input');
    input.className = 'answer-input'; input.dataset.q = n; input.placeholder = n;
    input.autocomplete = 'off'; input.spellcheck = false; input.readOnly = locked;
    input.setAttribute('aria-label', `Question ${n}`);
    input.addEventListener('input', () => { drafts.answers[n - 1] = input.value; save(); $('qnav').querySelector(`[data-q="${n}"]`)?.classList.toggle('answered', !!input.value.trim()); });
    input.addEventListener('focus', () => document.querySelectorAll('#qnav button').forEach(b => b.classList.toggle('current', b.dataset.q === String(n))));
    return input;
  }
  function buildQuestions(item) {
    const box = $('questionText'), rest = $('answers'), nav = $('qnav');
    box.replaceChildren(); rest.replaceChildren(); nav.replaceChildren();
    const start = item ? item.start : 1, end = item ? item.end : 40, used = new Set();
    const free = n => n >= start && n <= end && !used.has(n);
    // Replaces numbered gaps ("7 ......") in text with answer boxes; returns false if none were placed.
    const fillGaps = (el, text) => {
      let last = 0;
      for (const m of text.matchAll(gapPattern)) {
        const n = Number(m[1]); if (!free(n)) continue;
        el.append(text.slice(last, m.index), answerInput(n)); used.add(n); last = m.index + m[0].length;
      }
      el.append(text.slice(last));
      return last > 0;
    };
    for (const line of item ? item.questions : []) {
      if (/^Questions?\s+\d/i.test(line)) { const h = document.createElement('h3'); h.textContent = line; box.append(h); continue; }
      if (line.includes(' | ')) {
        // Tables from the handout arrive as rows joined by newlines, cells by " | ".
        const table = document.createElement('table'); table.className = 'q-table';
        for (const row of line.split('\n')) {
          const tr = table.insertRow();
          for (const cell of row.split(' | ')) fillGaps(tr.insertCell(), cell);
        }
        const head = table.rows[0];
        table.classList.toggle('has-head', table.rows.length > 2 && !head.querySelector('input') && !/^(?:[A-Z]|[ivx]+)$/.test(head.cells[0].textContent.trim()));
        box.append(table); continue;
      }
      const p = document.createElement('p');
      if (fillGaps(p, line)) { box.append(p); continue; }
      p.replaceChildren();
      const lead = line.match(/^(\d{1,2})\s+(\S[\s\S]*)$/);
      if (lead && free(Number(lead[1]))) {
        const n = Number(lead[1]); used.add(n); p.className = 'q-item';
        const num = document.createElement('b'); num.className = 'qnum'; num.textContent = n;
        const blank = lead[2].match(blankPattern);
        if (blank) p.append(num, lead[2].slice(0, blank.index), answerInput(n), lead[2].slice(blank.index + blank[0].length));
        else p.append(num, lead[2], ' ', answerInput(n));
      } else p.textContent = line;
      box.append(p);
    }
    // Numbers the parser could not place (tables, unnumbered statements) still get a box.
    const leftover = [];
    for (let n = start; n <= end; n++) if (!used.has(n)) leftover.push(n);
    if (leftover.length) {
      const h = document.createElement('h3'); h.textContent = item ? '其餘題號作答區' : 'Answer sheet 1–40'; rest.append(h);
      for (const n of leftover) { const label = document.createElement('label'); label.className = 'answer'; const b = document.createElement('b'); b.className = 'qnum'; b.textContent = n; label.append(b, answerInput(n)); rest.append(label); }
    }
    for (let n = start; n <= end; n++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.q = n; b.textContent = n; b.setAttribute('aria-label', `前往第 ${n} 題`);
      b.addEventListener('click', () => { const input = document.querySelector(`.answer-input[data-q="${n}"]`); input.scrollIntoView({ block: 'center', behavior: 'smooth' }); input.focus({ preventScroll: true }); });
      nav.append(b);
    }
  }

  function updateWordCount() {
    const words = countWords(drafts[task]), min = task === 'task1' ? 150 : 250;
    $('wordcount').textContent = `Word count: ${words}`;
    $('target').textContent = words >= min ? `已達 ${min} 字` : `至少 ${min} 字，尚差 ${min - words} 字`;
    $('target').classList.toggle('met', words >= min);
  }
  if (kind === 'reading') buildQuestions(null);
  else {
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
    for (const content of (kind === 'reading' ? activeItem.passage : activeItem.prompt)) {
      if (content === activeItem.title) continue;
      const p = document.createElement('p'); p.textContent = content; parent.append(p);
    }
    for (const image of activeItem.images || []) { const img = document.createElement('img'); img.src = image; img.alt = '題目圖表'; img.className = 'task-figure'; parent.append(img); }
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

  // Right-click highlighting, as in the real test. shortcut: highlights are not saved, persist them if students ask.
  $('textView').addEventListener('contextmenu', e => {
    const mark = e.target.closest('mark');
    if (mark) { e.preventDefault(); mark.replaceWith(...mark.childNodes); return; }
    const selection = getSelection();
    if (selection.isCollapsed || !$('textView').contains(selection.anchorNode)) return;
    e.preventDefault();
    try { selection.getRangeAt(0).surroundContents(document.createElement('mark')); } catch { $('status').textContent = '畫重點請在同一段落內選取。'; }
    selection.removeAllRanges();
  });

  function setBanner(title, hint) { $('partTitle').textContent = title; $('partHint').textContent = hint; }
  function loadText(item) {
    activeItem = item;
    if (kind === 'reading') {
      buildQuestions(item);
      const count = item.end - item.start + 1;
      setLimit(Math.ceil(count / 14) * 20);
      setBanner(`Questions ${item.start}–${item.end}`, `閱讀文章並回答第 ${item.start}–${item.end} 題。建議時間 ${limit / 60} 分鐘。選取文字後按右鍵可畫重點。`);
    } else {
      task = item.task === 1 ? 'task1' : 'task2';
      document.querySelector('.tabs').hidden = true;
      setLimit(item.task === 1 ? 20 : 40);
      setBanner(`Part ${item.task}`, `建議時間 ${limit / 60} 分鐘，至少寫 ${item.task === 1 ? 150 : 250} 字。`);
    }
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
    showPdf(item.source, `${item.group} · ${item.title}`); loadText(item);
    setMaterialKey(`ielts-${kind}-question-${item.id}`);
  });
  $('pdf').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { alert('請選擇 PDF 檔案。'); return; }
    if (!canSwitch()) { e.target.value = ''; return; }
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(file); showPdf(pdfUrl, file.name); $('material').value = ''; activeItem = null;
    if (kind === 'reading') buildQuestions(null); else document.querySelector('.tabs').hidden = false;
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
})();
