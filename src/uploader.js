// uploader.js — 选文件存库 & 从库还原并粘贴
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const S = global.GPTB.storage;
  const U = global.GPTB.utils;

  function pickFiles() {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }

  async function selectAndSave() {
    const files = await pickFiles();
    if (!files.length) return [];
    const metas = [];
    for (const f of files) {
      const meta = await S.saveFileBlob(f);
      metas.push(meta);
      U.toast(`已保存：${f.name} (${Math.ceil(f.size/1024/1024)}MB)`);
    }
    return metas;
  }

  // 从库还原多个 File
  async function restoreFiles(fileIds) {
    const arr = [];
    for (const id of fileIds) {
      const f = await S.restoreAsFile(id);
      if (f) arr.push(f);
    }
    return arr;
  }

  // 粘贴到编辑器（DataTransfer + ClipboardEvent）
  function pasteFilesToEditor(editor, files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    Object.defineProperty(evt, 'clipboardData', { value: dt });
    editor.dispatchEvent(evt);
  }

  global.GPTB.uploader = { selectAndSave, restoreFiles, pasteFilesToEditor };
  try { console.log('[mini] uploader loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
