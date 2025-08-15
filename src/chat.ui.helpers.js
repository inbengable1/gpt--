// chat.ui.helpers.js — 从存储取文件→粘贴→等待可发→填prompt→回车→等待结束→抓取并保存（精简版）
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};

  const ST = global.GPTB.storage  || {};
  const UP = global.GPTB.uploader || {};
  const D  = global.GPTB.dom      || {};
  const U  = global.GPTB.utils    || {};

  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const toast = (m)=> (U.toast ? U.toast(m) : console.log('[gptb]', m));

  // 读取面板里的 Prompt（可传入覆盖）
  function getPromptFromUI(passed) {
    if (typeof passed === 'string') return passed;
    const pid = global.GPTB.conf?.PROMPT_INPUT_ID;
    const el  = (pid && document.getElementById(pid))
             || document.getElementById('gptb-mini-prompt')
             || document.getElementById('gptb-prompt');
    return el?.value ? String(el.value) : '';
  }

  // 写入编辑器文本：优先 ProseMirror（contenteditable），textarea 兜底
  function typePromptIntoEditor(editor, text) {
    if (!editor || !text) return false;

    // ProseMirror
    if (editor.isContentEditable || editor.getAttribute('contenteditable') === 'true') {
      try {
        editor.focus();
        const ok = document.execCommand && document.execCommand('insertText', false, text);
        if (!ok) {
          const sel = getSelection();
          let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
          if (!range) {
            range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
            sel.removeAllRanges(); sel.addRange(range);
          }
          const node = document.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node); range.setEndAfter(node);
          sel.removeAllRanges(); sel.addRange(range);
        }
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
        return true;
      } catch {}
    }

    // textarea 兜底
    if (editor.tagName === 'TEXTAREA') {
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        const prev = editor.value || '';
        const next = prev ? (prev.endsWith(' ') ? prev + text : prev + ' ' + text) : text;
        nativeSetter.call(editor, next);
        editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'insertText', data:text }));
        return true;
      } catch {}
    }
    return false;
  }

  async function getEditorOrWait(sel = '#prompt-textarea, [contenteditable="true"].ProseMirror', timeout = 20000) {
    return D.getEditor?.() || await D.waitForSelector?.(sel, timeout);
  }

  // 回复期写入一个字符，确保结束时按钮能回到 send 可点
  function nudgeEditorForReply(editor) {
    try {
      if (editor?.isContentEditable) {
        editor.focus();
        document.execCommand && document.execCommand('insertText', false, 'a');
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType:'insertText', data:'a' }));
        return true;
      }
      if (editor?.tagName === 'TEXTAREA') {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(editor, (editor.value || '') + 'a');
        editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'insertText', data:'a' }));
        return true;
      }
    } catch {}
    return false;
  }

  // 按钮回到 send 且可点（表示生成结束）
  async function waitReplyDone(scope, { timeout=60000, stableMs=400 } = {}) {
    return !!(await D.waitReadyToSend?.(scope, { timeout, stableMs }));
  }

  // 短安静期，避免截断抓取
  async function waitAssistantIdle(quietMs=500, hardMs=4000) {
    const root = document.querySelector('main') || document.body;
    let lastLen = 0, quietStart = 0;
    const t0 = Date.now();
    return new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        const last = [...root.querySelectorAll('[data-message-author-role="assistant"]')].pop();
        const len = last ? (last.innerText || '').length : 0;
        if (len !== lastLen) { lastLen = len; quietStart = Date.now(); }
      });
      mo.observe(root, { childList:true, subtree:true, characterData:true });
      const tick = setInterval(() => {
        if (quietStart && Date.now() - quietStart >= quietMs) { clearInterval(tick); mo.disconnect(); resolve(true); }
        else if (Date.now() - t0 >= hardMs) { clearInterval(tick); mo.disconnect(); resolve(true); }
      }, 120);
    });
  }

  // 保存文本为文件（base-ISO时间戳.txt）
  function saveTextAsFile(text, base='reply') {
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const blob  = new Blob([text], { type:'text/plain;charset=utf-8' });
    const url   = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${base}-${stamp}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  // 抓取并保存助手回复
  async function captureAndSaveReply({ baseName='reply', quietMs=500, hardMs=4000 } = {}) {
    await waitAssistantIdle(quietMs, hardMs);
    const text = D.extractAssistantText?.() || '';
    if (text.trim()) { saveTextAsFile(text, baseName); toast('已保存回复'); return true; }
    toast('回复为空或提取失败'); return false;
  }

  // 基础发送：取文件→粘贴→等可发→填 prompt→回车
  async function runSendFromStorage(fileId, { prompt, deleteAfter=true, timeout=60000, stableMs=500 } = {}) {
    if (!ST.restoreAsFile || !UP.pasteFilesToEditor || !D.waitReadyToSend || !D.pressEnterInEditor) {
      toast('依赖未就绪'); return false;
    }
    const file = await ST.restoreAsFile(fileId);
    if (!file) { toast('未在存储中找到文件'); return false; }

    const editor = await getEditorOrWait();
    if (!editor) { toast('找不到输入框'); return false; }

    // 粘贴并删除存储条目
    UP.pasteFilesToEditor(editor, [file]);
    if (deleteAfter && ST.deleteFile) { try { await ST.deleteFile(fileId); } catch {} }
    toast(`已粘贴：${file.name || '文件'}`);

    // 等按钮可发
    const scope = D.getComposerScope(editor);
    const ready = await D.waitReadyToSend(scope, { timeout, stableMs });
    if (!ready) { toast('未达到可发送状态'); return false; }

    // 写 prompt → 回车
    const text = getPromptFromUI(prompt);
    if (text) { typePromptIntoEditor(editor, text); await sleep(80); }
    D.pressEnterInEditor(editor);
    toast('已触发发送');
    return true;
  }

  // 完整：发送 + 写一个字符 → 等结束 → 抓取并保存（保存名按上传文件命名）
  async function runSendFromStorageAndSave(fileId, opts = {}) {
    const {
      prompt,
      deleteAfter = true,
      timeout = 60000,
      stableMs = 500,
      replyQuietMs = 500, replyHardMs = 4000
    } = opts;

    // 先读取一次文件名作为保存前缀
    let base = 'reply';
    try {
      const f = await ST.restoreAsFile(fileId);
      if (f?.name) base = f.name.replace(/\.[^.]+$/, '') || base;
    } catch {}

    // 执行基础发送
    const ok = await runSendFromStorage(fileId, { prompt, deleteAfter, timeout, stableMs });
    if (!ok) return false;

    // 写一个字符 → 等结束
    const editor = D.getEditor?.();
    if (editor) nudgeEditorForReply(editor);
    const scope = D.getComposerScope(editor || null);
    const done = await waitReplyDone(scope, { timeout, stableMs: 400 });
    if (!done) { toast('生成超时'); return false; }

    // 抓取并保存（文件名按上传文件）
    return await captureAndSaveReply({ baseName: base, quietMs: replyQuietMs, hardMs: replyHardMs });
  }

  // 导出
  const H = {
    getPromptFromUI,
    typePromptIntoEditor,
    runSendFromStorage,
    runSendFromStorageAndSave,
    captureAndSaveReply
  };
  global.GPTB.uiHelpers = H;

  // 日志 + 桥接，便于控制台调试
  try { console.log('[mini] chat.ui.helpers loaded (concise + use upload name)'); } catch {}
  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.GPTB = global.GPTB; } catch {}

})(typeof window !== 'undefined' ? window : this);
