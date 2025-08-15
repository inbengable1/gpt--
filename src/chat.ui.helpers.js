// chat.ui.helpers.js — 从存储取文件→粘贴→等待可发→填prompt→回车→等待结束→抓取并保存
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const H  = {};
  const ST = global.GPTB.storage  || {};
  const UP = global.GPTB.uploader || {};
  const D  = global.GPTB.dom      || {};
  const U  = global.GPTB.utils    || {};

  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const toast = (m)=> (U.toast ? U.toast(m) : console.log('[gptb]', m));

  /** 取面板 Prompt（可传入覆盖） */
  function getPromptFromUI(passed) {
    if (typeof passed === 'string') return passed;
    const pid = global.GPTB.conf?.PROMPT_INPUT_ID;
    const el  = (pid && document.getElementById(pid))
             || document.getElementById('gptb-mini-prompt')
             || document.getElementById('gptb-prompt');
    return (el && el.value) ? String(el.value) : '';
  }

  /** 更稳的文本写入（优先 ProseMirror；兼容 textarea） */
  function typePromptIntoEditor(editor, text) {
    if (!editor || !text) return false;

    // ProseMirror（你的页面就是这种）
    if (editor.isContentEditable || editor.getAttribute('contenteditable') === 'true') {
      try {
        editor.focus();
        const ok = document.execCommand && document.execCommand('insertText', false, text);
        if (!ok) {
          const sel = window.getSelection();
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

    // 兜底：普通 textarea
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

  /** 回复期“写一个字符”，保证结束时按钮回到 send 可点 */
  function nudgeEditorForReply(editor) {
    if (!editor) return false;
    try {
      if (editor.isContentEditable) {
        editor.focus();
        document.execCommand && document.execCommand('insertText', false, 'a');
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType:'insertText', data:'a' }));
        return true;
      }
      if (editor.tagName === 'TEXTAREA') {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(editor, (editor.value || '') + 'a');
        editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'insertText', data:'a' }));
        return true;
      }
    } catch {}
    return false;
  }

  /** 等按钮回到 send 且可点（表示生成结束） */
  async function waitReplyDone(scope, { timeout=60000, stableMs=400 } = {}) {
    return !!(await D.waitReadyToSend?.(scope, { timeout, stableMs }));
  }

  /** 安静期，避免截断 */
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

  /** 保存文本到文件 */
  function saveTextAsFile(text, base='reply') {
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const blob = new Blob([text], { type:'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${base}-${stamp}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  /** 抓取并保存最后一条助手文本 */
  async function captureAndSaveReply({ baseName='reply', quietMs=500, hardMs=4000 } = {}) {
    await waitAssistantIdle(quietMs, hardMs);
    const text = D.extractAssistantText?.() || '';
    if (text.trim()) { saveTextAsFile(text, baseName); toast('已保存回复'); return true; }
    toast('回复为空或提取失败'); return false;
  }

  /** 基础流程：取文件→粘贴→等可发→填 prompt→回车 */
  async function runSendFromStorage(fileId, { prompt, deleteAfter=true, timeout=60000, stableMs=500 } = {}) {
    if (!ST.restoreAsFile || !UP.pasteFilesToEditor || !D.waitReadyToSend || !D.pressEnterInEditor) {
      toast('依赖未就绪'); return false;
    }
    const file = await ST.restoreAsFile(fileId);
    if (!file) { toast('未在存储中找到文件'); return false; }

    const editor = await getEditorOrWait();
    if (!editor) { toast('找不到输入框'); return false; }

    // 粘贴文件（立即删除存储中的条目）
    UP.pasteFilesToEditor(editor, [file]);
    if (deleteAfter && ST.deleteFile) { try { await ST.deleteFile(fileId); } catch {} }
    toast(`已粘贴：${file.name || '文件'}`);

    // 等按钮“可发送”
    const scope = D.getComposerScope(editor);
    const ready = await D.waitReadyToSend(scope, { timeout, stableMs });
    if (!ready) { toast('未达到可发送状态'); return false; }

    // 写 prompt
    const text = getPromptFromUI(prompt);
    if (text) { typePromptIntoEditor(editor, text); await sleep(80); }

    // 回车提交
    D.pressEnterInEditor(editor);
    toast('已触发发送');
    return true;
  }

  /** 完整流程：基础发送 + 写一个字符 → 等结束 → 抓取并保存 */
  async function runSendFromStorageAndSave(fileId, opts = {}) {
    const {
      prompt,
      deleteAfter = true,
      timeout = 60000,
      stableMs = 500,
      replyBaseName, replyQuietMs = 500, replyHardMs = 4000
    } = opts;

    const ok = await runSendFromStorage(fileId, { prompt, deleteAfter, timeout, stableMs });
    if (!ok) return false;

    const editor = D.getEditor?.();
    if (editor) nudgeEditorForReply(editor);

    const scope = D.getComposerScope(editor || null);
    const done = await waitReplyDone(scope, { timeout, stableMs: 400 });
    if (!done) { toast('生成超时'); return false; }

    let base = replyBaseName || 'reply';
    try {
      if (!replyBaseName && ST.listFiles) {
        const meta = (await ST.listFiles())?.find(x => x.id === fileId);
        base = meta?.name ? meta.name.replace(/\.[^.]+$/, '') : base;
      }
    } catch {}

    return await captureAndSaveReply({ baseName: base, quietMs: replyQuietMs, hardMs: replyHardMs });
  }

  // 导出
  H.getPromptFromUI = getPromptFromUI;
  H.typePromptIntoEditor = typePromptIntoEditor;
  H.runSendFromStorage = runSendFromStorage;
  H.runSendFromStorageAndSave = runSendFromStorageAndSave;
  H.captureAndSaveReply = captureAndSaveReply;

  global.GPTB.uiHelpers = H;
  try { console.log('[mini] chat.ui.helpers loaded (concise)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
