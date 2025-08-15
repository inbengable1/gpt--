// chat.ui.helpers.js — 从存储取文件→粘贴→等待可发→覆盖写入 prompt→回车→（延时）插入'a'→等待结束→抓取并保存
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};

  const ST = global.GPTB.storage  || {};
  const UP = global.GPTB.uploader || {};
  const D  = global.GPTB.dom      || {};
  const U  = global.GPTB.utils    || {};

  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const toast = (m)=> (U?.toast ? U.toast(m) : console.log('[gptb]', m));

  /** 读取面板里的 Prompt（可传入覆盖） */
  function getPromptFromUI(passed) {
    if (typeof passed === 'string') return passed;
    const pid = global.GPTB.conf?.PROMPT_INPUT_ID;
    const el  = (pid && document.getElementById(pid))
             || document.getElementById('gptb-mini-prompt')
             || document.getElementById('gptb-prompt');
    return el?.value ? String(el.value) : '';
  }

  /** 清空编辑器内容（ProseMirror 优先，textarea 兜底） */
  function clearEditor(editor) {
    if (!editor) return;
    try { editor.focus(); } catch {}
    if (editor.isContentEditable || editor.getAttribute?.('contenteditable') === 'true') {
      const sel = getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges(); sel.addRange(range);
      if (document.execCommand) document.execCommand('delete', false, null);
      editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'deleteContentBackward' }));
      return;
    }
    if (editor.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, '');
      editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'deleteContentBackward' }));
    }
  }

  /** 覆盖写入文本到编辑器：ProseMirror 优先，textarea 兜底（默认覆盖） */
  function typePromptIntoEditor(editor, text, { overwrite = true } = {}) {
    if (!editor || !text) return false;
    try { editor.focus(); } catch {}
    if (overwrite) clearEditor(editor);

    // ProseMirror（contenteditable）
    if (editor.isContentEditable || editor.getAttribute?.('contenteditable') === 'true') {
      const ok = document.execCommand && document.execCommand('insertText', false, text);
      if (!ok) {
        const sel = getSelection();
        let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        if (!range) { range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); sel.removeAllRanges(); sel.addRange(range); }
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node); range.setEndAfter(node);
        sel.removeAllRanges(); sel.addRange(range);
      }
      editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'insertText', data:text }));
      return true;
    }

    // textarea 兜底
    if (editor.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, text);
      editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'insertText', data:text }));
      return true;
    }

    return false;
  }

  async function getEditorOrWait(sel = '#prompt-textarea, [contenteditable="true"].ProseMirror', timeout = 20000) {
    return D.getEditor?.() || await D.waitForSelector?.(sel, timeout);
  }

  /**（内部）向编辑器插入一个字符 'a'，并触发 input 事件 */
  function nudgeEditorForReply(editor) {
    try {
      if (editor?.isContentEditable || editor?.getAttribute?.('contenteditable') === 'true') {
        editor.focus();
        if (document.execCommand) document.execCommand('insertText', false, 'a');
        editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'insertText', data:'a' }));
        return true;
      }
      if (editor?.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(editor, (editor.value || '') + 'a');
        editor.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, inputType:'insertText', data:'a' }));
        return true;
      }
    } catch {}
    return false;
  }

  /** 只在“回车发送后”延时插入一次 'a'（其它地方不插） */
  async function delayNudgeAfterEnter(editor, delay = 300) {
    if (!editor) return false;
    await sleep(delay);
    return nudgeEditorForReply(editor);
  }

  /** 等按钮回到 send 且可点（表示生成结束） */
  async function waitReplyDone(scope, { timeout=60000, stableMs=400 } = {}) {
    return !!(await D.waitReadyToSend?.(scope, { timeout, stableMs }));
  }

  /** 短安静期，避免截断抓取 */
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

  /** 保存文本为文件（base-ISO时间戳.txt） */
  function saveTextAsFile(text, base='reply') {
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const blob  = new Blob([text], { type:'text/plain;charset=utf-8' });
    const url   = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${base}-${stamp}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  /** 抓取并保存助手回复（使用 dom.extractAssistantText） */
  async function captureAndSaveReply({ baseName='reply', quietMs=500, hardMs=4000 } = {}) {
    await waitAssistantIdle(quietMs, hardMs);
    const text = D.extractAssistantText?.() || '';
    if (text.trim()) { saveTextAsFile(text, baseName); toast('已保存回复'); return true; }
    toast('回复为空或提取失败'); return false;
  }

  /** 基础发送：取文件→粘贴→等可发→覆盖写入 prompt→回车 */
  async function runSendFromStorage(fileId, { prompt, deleteAfter=true, timeout=60000, stableMs=500 } = {}) {
    if (!ST.restoreAsFile || !UP.pasteFilesToEditor || !D.waitReadyToSend || !D.pressEnterInEditor) {
      toast('依赖未就绪'); return false;
    }
    const file = await ST.restoreAsFile(fileId);
    if (!file) { toast('未在存储中找到文件'); return false; }

    const editor = await getEditorOrWait();
    if (!editor) { toast('找不到输入框'); return false; }

    // 仅粘贴文件，不做任何 'a' 注入
    UP.pasteFilesToEditor(editor, [file]);

    // 贴完即可删除存储条目（按你的要求）
    if (deleteAfter && ST.deleteFile) { try { await ST.deleteFile(fileId); } catch {} }
    toast(`已粘贴：${file.name || '文件'}`);

    // 等按钮“可发送”
    const scope = D.getComposerScope(editor);
    const ready = await D.waitReadyToSend(scope, { timeout, stableMs });
    if (!ready) { toast('未达到可发送状态'); return false; }

    // 覆盖写入 prompt（避免任何残留字符）
    const text = getPromptFromUI(prompt);
    if (text) { typePromptIntoEditor(editor, text, { overwrite: true }); await sleep(80); }

    // 回车提交（真正触发发送）
    D.pressEnterInEditor(editor);
    toast('已触发发送');
    return true;
  }

  /** 完整：发送 →（延时）插入 'a' → 等结束 → 抓取并保存（保存名按上传文件命名） */
  async function runSendFromStorageAndSave(fileId, opts = {}) {
    const {
      prompt,
      deleteAfter = true,
      timeout = 60000,
      stableMs = 500,
      replyQuietMs = 500,
      replyHardMs = 4000
    } = opts;

    // 发送前先取一次名称用于保存前缀
    let base = 'reply';
    try {
      const metas = await ST.listFiles();
      const m = metas?.find(x => x.id === fileId);
      if (m?.name) base = m.name.replace(/\.[^.]+$/, '') || base;
    } catch {}

    // 执行基础发送（此处不插 'a'）
    const ok = await runSendFromStorage(fileId, { prompt, deleteAfter, timeout, stableMs });
    if (!ok) return false;

    // 回车之后，延时仅插一次 'a'
    const editor = D.getEditor?.();
    if (editor) await delayNudgeAfterEnter(editor, 300);

    // 等到按钮回到 send（生成结束）
    const scope = D.getComposerScope(editor || null);
    const done = await waitReplyDone(scope, { timeout, stableMs: 400 });
    if (!done) { toast('生成超时'); return false; }

    // 抓取并保存
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

  // 控制台桥接
  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.GPTB = global.GPTB; } catch {}
  try { console.log('[mini] chat.ui.helpers loaded (enter-delay-nudge + overwrite)'); } catch {}

})(typeof window !== 'undefined' ? window : this);
