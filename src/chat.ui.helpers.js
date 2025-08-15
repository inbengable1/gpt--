// chat.ui.helpers.js — 从存储取文件→粘贴→等待可发→填prompt→回车提交（适配 GPTB）
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const H = {};

  // 依赖（存在就用；缺了会在运行时报友好提示）
  const U  = global.GPTB.utils   || {};
  const ST = global.GPTB.storage || {};
  const D  = global.GPTB.dom     || {};
  const UP = global.GPTB.uploader|| {};

  // -------- 小工具 --------
  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
  const toast = (msg)=> (U.toast ? U.toast(msg) : console.log('[gptb]', msg));

  function getPromptFromUI(optsPrompt) {
    if (typeof optsPrompt === 'string') return optsPrompt;
    // 优先自定义 ID（若你在 conf 里定义了 PROMPT_INPUT_ID）
    const pid = global.GPTB.conf?.PROMPT_INPUT_ID;
    const el  = (pid && document.getElementById(pid))
             || document.getElementById('gptb-prompt')
             || document.getElementById('gptb-mini-prompt');
    return (el && el.value) ? String(el.value) : '';
  }

  // 在编辑器里写入文本：兼容 textarea(#prompt-textarea) & ProseMirror(contenteditable)
  function typePromptIntoEditor(editor, text) {
    if (!editor || !text) return false;

    // 1) 如果是 textarea（#prompt-textarea）
    if (editor.tagName === 'TEXTAREA' || editor.id === 'prompt-textarea') {
      try {
        const ta = editor;
        const prev = ta.value || '';
        ta.focus();
        ta.value = prev ? (prev.endsWith(' ') ? prev + text : prev + ' ' + text) : text;
        // 触发 input 让发送按钮刷新状态
        const ev = new Event('input', { bubbles: true });
        ta.dispatchEvent(ev);
        return true;
      } catch (e) {}
    }

    // 2) contenteditable（ProseMirror）
    try {
      editor.focus();
      // 优先使用 insertText（更接近用户输入）
      const ok = document.execCommand && document.execCommand('insertText', false, text);
      if (!ok) {
        // 退化：直接追加到末尾
        const span = document.createElement('span');
        span.textContent = text;
        editor.appendChild(span);
      }
      return true;
    } catch (e) {}

    return false;
  }

  async function getEditorOrWait(sel = '#prompt-textarea', timeout = 20000) {
    const ed = D.getEditor?.();
    if (ed) return ed;
    return await D.waitForSelector?.(sel, timeout);
  }

  // -------- 主流程：从存储取文件→粘贴→（可选删库）→等待可发→填prompt→回车 --------
  /**
   * 从 IndexedDB 取指定文件并发送。
   * @param {string} fileId - 存储里的文件 ID
   * @param {object} opts
   *   - prompt {string} 可选，覆盖从 UI 取的 prompt
   *   - deleteAfter {boolean} 默认 true，粘贴后即删除存储的该文件
   *   - timeout {number} 等待「可发送」的超时，默认 60000ms
   *   - stableMs {number} 状态稳定期，默认 500ms
   * @returns {boolean} 是否成功触发发送
   */
  async function runSendFromStorage(fileId, opts = {}) {
    const {
      prompt      = undefined,
      deleteAfter = true,
      timeout     = 60000,
      stableMs    = 500
    } = opts;

    // 0) 依赖检查
    if (!ST.restoreAsFile || !UP.pasteFilesToEditor) {
      toast('上传/存储依赖缺失（storage/uploader 未加载）');
      return false;
    }
    if (!D.getComposerScope || !D.waitReadyToSend || !D.pressEnterInEditor) {
      toast('DOM 适配依赖缺失（dom.adapters 未加载或缺少必要方法）');
      return false;
    }

    // 1) 取文件
    const file = await ST.restoreAsFile(fileId);
    if (!file) { toast('未在存储中找到文件'); return false; }

    // 2) 找编辑器并粘贴
    const editor = await getEditorOrWait();
    if (!editor) { toast('找不到输入框'); return false; }
    try {
      UP.pasteFilesToEditor(editor, [file]);
      toast(`已粘贴：${file.name || '文件'}`);
    } catch (e) {
      toast('粘贴失败'); return false;
    }

    // 3) （可选）删除存储中的该文件
    if (deleteAfter && ST.deleteFile) {
      try { await ST.deleteFile(fileId); } catch (_) {}
    }

    // 4) 等待按钮「可发送」稳定
    const scope = D.getComposerScope(editor);
    const ready = await D.waitReadyToSend(scope, { timeout, stableMs });
    if (!ready) { toast('未达到可发送状态'); return false; }

    // 5) 写入 prompt（从 UI 读取或 opts.prompt）
    const text = getPromptFromUI(prompt);
    if (text) {
      const ok = typePromptIntoEditor(editor, text);
      if (!ok) toast('写入提示词失败');
      // 写入后稍等一下，让按钮状态/内部模型刷新
      await sleep(80);
    }

    // 6) 回车提交（更稳）
    const sent = D.pressEnterInEditor(editor);
    if (!sent) { toast('回车发送失败'); return false; }

    toast('已触发发送');
    return true;
  }

  // 暴露
  H.runSendFromStorage = runSendFromStorage;
  H.typePromptIntoEditor = typePromptIntoEditor;
  H.getPromptFromUI = getPromptFromUI;

  global.GPTB.uiHelpers = H;
  try { console.log('[mini] chat.ui.helpers loaded (runSendFromStorage)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
