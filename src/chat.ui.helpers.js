// chat.ui.helpers.js — 取文件→就绪→粘贴(带重试)→等待可发(超时失败落盘)→覆盖写入prompt→回车→延时插入'a'→等待结束→抓取并保存
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
  
  // 确保回车操作已经发生
  const isEnterPressed = editor.hasAttribute('data-enter-sent') && editor.getAttribute('data-enter-sent') === 'true';

  // 如果回车已经发送，则插入字符 'a'
  if (isEnterPressed) {
    await sleep(delay);
    return nudgeEditorForReply(editor);
  }

  return false;  // 如果没有回车发送，直接返回不插入
}

/** 用于插入字符 'a' 并触发 input 事件 */
function nudgeEditorForReply(editor) {
  try {
    if (editor?.isContentEditable || editor?.getAttribute?.('contenteditable') === 'true') {
      editor.focus();
      document.execCommand('insertText', false, 'a');
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

  /** 失败结果落盘：原名-失败.txt（附原因） */
  function saveFailureFile(base, reason = '上传失败') {
    const text = `处理失败：${reason}\n时间：${new Date().toLocaleString()}\n`;
    const blob = new Blob([text], { type:'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${base}-失败.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  /** 抓取并保存助手回复（使用 dom.extractAssistantText） */
  async function captureAndSaveReply({ baseName='reply', quietMs=500, hardMs=4000 } = {}) {
    await waitAssistantIdle(quietMs, hardMs);
    const text = D.extractAssistantText?.() || '';
    if (text.trim()) { saveTextAsFile(text, baseName); toast('已保存回复'); return true; }
    toast('回复为空或提取失败'); return false;
  }

  // ========== 稳定粘贴：就绪→粘贴→确认→必要时重试一遍 ==========
  async function ensureComposerReady(editor, settleMs = 250) {
    if (!editor) return false;
    try { editor.scrollIntoView({ block: 'center', inline: 'nearest' }); editor.focus(); } catch {}
    await sleep(settleMs);
    return true;
  }
  async function confirmPasteLikelyAccepted(scope, probeMs = 900) {
    await sleep(probeMs); // 给 React 一点处理时间（我们不读内部 DOM，只做时间窗口）
    return true;          // 真正的门禁在后面的 waitReadyToSend
  }
  async function pasteWithRetry(editor, files, scope, pasteFn, { settleMs = 250, probeMs = 900 } = {}) {
    await ensureComposerReady(editor, settleMs);
    pasteFn(editor, files);
    const ok1 = await confirmPasteLikelyAccepted(scope, probeMs);
    if (ok1) return true;
    // 再来一次
    await ensureComposerReady(editor, settleMs);
    pasteFn(editor, files);
    const ok2 = await confirmPasteLikelyAccepted(scope, probeMs);
    return ok2;
  }

  // ========== 基础发送：取文件→就绪→粘贴(带重试)→等待可发(超时失败)→覆盖写入prompt→回车 ==========
  async function runSendFromStorage(fileId, { prompt, deleteAfter=true, timeout=60000, stableMs=500, baseNameForFail='reply' } = {}) {
    if (!ST.restoreAsFile || !UP.pasteFilesToEditor || !D.waitReadyToSend || !D.pressEnterInEditor) {
      toast('依赖未就绪'); return { ok:false, reason:'deps' };
    }
    const file = await ST.restoreAsFile(fileId);
    if (!file) { toast('未在存储中找到文件'); return { ok:false, reason:'nofile' }; }

    const editor = await getEditorOrWait();
    if (!editor) { toast('找不到输入框'); return { ok:false, reason:'noeditor' }; }

    const scope = D.getComposerScope(editor);

    // 粘贴（带就绪/确认/重试）
    const pasted = await pasteWithRetry(editor, [file], scope, UP.pasteFilesToEditor, {
      settleMs: 250, probeMs: 900
    });
    if (!pasted) {
      toast('粘贴可能未被接收');
      if (deleteAfter && ST.deleteFile) { try { await ST.deleteFile(fileId); } catch {} }
      saveFailureFile(baseNameForFail, '粘贴未被接收');
      return { ok:false, reason:'paste' };
    }

    // 贴完即可删除存储条目（你的既定策略）
    if (deleteAfter && ST.deleteFile) { try { await ST.deleteFile(fileId); } catch {} }
    toast(`已粘贴：${file.name || '文件'}`);

    // 真正的门禁：等待进入“可发送”（上传通道就绪）
    const ready = await D.waitReadyToSend(scope, { timeout, stableMs });
    if (!ready) {
      toast('上传超时（60秒）');
      saveFailureFile(baseNameForFail, '上传超时（60秒未进入可发送状态）');
      return { ok:false, reason:'timeout' };
    }

    // 覆盖写入 prompt（避免残留）
    const text = getPromptFromUI(prompt);
    if (text) { typePromptIntoEditor(editor, text, { overwrite: true }); await sleep(80); }

    // 回车提交（真正触发发送）
    D.pressEnterInEditor(editor);
    toast('已触发发送');
    return { ok:true, editor, scope };
  }

  // ========== 完整流程：基础发送 → 延时插'a' → 等结束 → 抓取并保存 / 或失败落盘 ==========
  async function runSendFromStorageAndSave(fileId, opts = {}) {
    const {
      prompt,
      deleteAfter = true,
      timeout = 60000,
      stableMs = 500,
      replyQuietMs = 500,
      replyHardMs = 4000
    } = opts;

    // 取原文件名用于保存前缀/失败文件名
    let base = 'reply';
    try {
      const metas = await ST.listFiles();
      const m = metas?.find(x => x.id === fileId);
      if (m?.name) base = m.name.replace(/\.[^.]+$/, '') || base;
    } catch {}

    // 执行基础发送
    const res = await runSendFromStorage(fileId, { prompt, deleteAfter, timeout, stableMs, baseNameForFail: base });
    if (!res.ok) return false; // 失败已落盘

    // 回车之后延时仅插一次 'a'
    const editor = res.editor || D.getEditor?.();
    if (editor) await delayNudgeAfterEnter(editor, 300);

    // 等到按钮回到 send（生成结束）
    const scope = res.scope || D.getComposerScope(editor || null);
    const done = await waitReplyDone(scope, { timeout, stableMs: 400 });
    if (!done) {
      toast('生成超时'); 
      saveFailureFile(base, '生成超时（未回到可发送状态）');
      return false;
    }

    // 抓取并保存为 “原名-时间戳.txt”
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
  try { console.log('[mini] chat.ui.helpers loaded (robust paste + timeout fail + enter-delay-a)'); } catch {}

})(typeof window !== 'undefined' ? window : this);
