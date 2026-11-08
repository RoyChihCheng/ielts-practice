/* Client-side DOCX export. Uses the locally bundled docx library; no data leaves the browser. */
window.exportPracticeDocx = async function ({ kind, item, source, drafts, task, study, results }) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } = window.docx;
  const children = [];
  const title = text => children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }));
  const para = text => children.push(new Paragraph({ children: [new TextRun({ text: String(text) })], spacing: { after: 100 } }));
  const blockTags = new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','TR','TABLE','UL','LI']);
  const colours = { 'hl-yellow': 'yellow', 'hl-green': 'green', 'hl-pink': 'magenta', 'hl-blue': 'cyan' };
  let runs = [];
  function flush() { if (runs.length) { children.push(new Paragraph({ children: runs, spacing: { after: 100 } })); runs = []; } }
  async function walk(node, style = {}) {
    if (node.nodeType === Node.TEXT_NODE) { if (node.data) runs.push(new TextRun({ text: node.data.replace(/\u2028/g, ' '), ...style })); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches('button, .key-answer, .check-one')) return;
    if (node.tagName === 'INPUT') { runs.push(new TextRun({ text: ` [${node.value || '　'}] ` })); return; }
    if (node.tagName === 'BR') { runs.push(new TextRun({ break: 1 })); return; }
    if (node.tagName === 'IMG') {
      flush();
      const res = await fetch(node.src); if (!res.ok) throw new Error(`無法讀取圖表：${node.getAttribute('src')}`);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); bitmap.close();
      const width = Math.min(canvas.width, 570), height = Math.max(1, Math.round(canvas.height * width / canvas.width));
      children.push(new Paragraph({ children: [new ImageRun({ data: new Uint8Array(await png.arrayBuffer()), type: 'png', transformation: { width, height } })] })); return;
    }
    const next = { ...style };
    if (['B','STRONG'].includes(node.tagName)) next.bold = true;
    if (['I','EM'].includes(node.tagName)) next.italics = true;
    if (node.tagName === 'U') next.underline = {};
    if (node.tagName === 'MARK') for (const [cls, colour] of Object.entries(colours)) if (node.classList.contains(cls)) next.highlight = colour;
    const block = blockTags.has(node.tagName); if (block) flush();
    for (const child of node.childNodes) await walk(child, next);
    if (node.tagName === 'TD' || node.tagName === 'TH') runs.push(new TextRun({ text: '  |  ' }));
    if (block) flush();
  }
  title(item.title); para(source);
  title(kind === 'reading' ? '閱讀文章' : '寫作題目');
  await walk(document.getElementById('textView')); flush();
  if (kind === 'reading') { title('題目與作答'); await walk(document.getElementById('questionText')); await walk(document.getElementById('answers')); flush(); }
  else { title('我的作文'); await walk(document.getElementById('editor')); flush(); }
  title('畫重點與註記');
  const ids = [...new Set(study.marks.map(mark => mark.id))];
  if (!ids.length) para('（無）');
  for (const id of ids) { const parts = study.marks.filter(m => m.id === id); para(`${parts[0].area === 'question' ? '題目' : '文章'}：${parts.map(m => m.text).join(' … ')}${parts[0].note ? `　註記：${parts[0].note}` : ''}`); }
  if (study.notes?.trim()) { title('既有筆記'); para(study.notes); }
  if (kind === 'reading') {
    title('作答與答案');
    for (let n = item.start; n <= item.end; n++) { const result = results[n]; para(`${n}. ${drafts.answers[n - 1] || '（未作答）'}　${result ? `正解：${result.keys.join(' / ')}　${result.ok ? '正確' : '未答對'}` : '無答案鍵'}`); }
  }
  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `IELTS-${kind}-${item.id}.docx`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
};
