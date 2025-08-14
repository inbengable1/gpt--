/* control.runner.js — ChatGPT 批处理 · 主控制器模块 (IIFE)
   负责任务调度、激活页控制、上传/生成过程管理 */
(function (global) {
  'use strict';

  const NS = (global.GPTBatch = global.GPTBatch || {});

  /** 主控制器 **/
  function processNextIfAny() {
    if (!isActiveRunner()) {
      if (MY_RUN_ID) tryCloseSelf(100);
      return;
    }

    const state = loadState();
    const errors = loadErrors();

    // 停止任务的检测
    if (shouldStop()) return;

    // 没有任务时直接返回
    if (!state.running || !state.items || state.index == null || state.index >= state.items.length) return;

    // 确保在正确的域名上
    if (location.origin !== BASE_URL) return;

    toast(`开始处理第 ${state.index + 1}/${state.items.length} 个文件…`);

    const editor = await waitForSelector(EDITOR_SEL).catch(() => null);
    if (!editor) { toast('找不到输入容器'); return; }

    const item = state.items[state.index];
    const file = dataURLtoFile(item.dataURL, item.name, item.type);
    await sleep(PRE_PASTE_DELAY_MS);

    if (shouldStop() || !isActiveRunner()) return;

    // 粘贴文件到编辑器
    editor.focus();
    pasteFilesToEditor(editor, [file]);

    const ready = await waitUploadReadyByButton(editor, UPLOAD_READY_TIMEOUT_MS);
    if (shouldStop() || !isActiveRunner()) return;
    if (!ready) {
      toast(`上传超时，跳过：${item.name}`);
      errors.push(item.name); saveErrors(errors);
      return gotoNext();
    }
    await sleep(ATTACH_POST_READY_MS);

    // 填充 Prompt
    editor.innerHTML = `<p>${escapeHtml(state.prompt || '').replace(/\n/g, '<br>')}</p>`;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
    await sleep(PROMPT_DELAY_MS);

    if (shouldStop() || !isActiveRunner()) return;

    // 发送请求：首发 + 重试
    let ok = await trySend(getComposerScope(editor), editor);
    let retries = 0;
    while (!ok && retries < SEND_RETRY_MAX && !shouldStop() && isActiveRunner()) {
      toast('未检测到生成开始，重试发送…');
      await sleep(300);
      ok = await trySend(getComposerScope(editor), editor);
      retries++;
    }

    if (shouldStop() || !isActiveRunner()) return;
    if (!ok) {
      toast('发送失败，跳过此文件');
      errors.push(item.name); saveErrors(errors);
      return gotoNext();
    }

    // 回复期间写入字母，确保结束后按钮变回 "send"
    editor.innerHTML = `<p>a</p>`;
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // 等待生成完成（检测到 stop→send 状态），并确保有安静期
    const sendBack = await waitButton(getComposerScope(editor), 'send', true, REPLY_DONE_TIMEOUT_MS);
    if (shouldStop() || !isActiveRunner()) return;
    if (!sendBack) {
      toast('生成超时，跳过保存');
      errors.push(item.name); saveErrors(errors);
      return gotoNext();
    }

    await waitAssistantIdle(QUIET_MS, 4000);

    // 获取并保存回复
    const text = extractAssistantText();
    if (text && text.trim()) {
      const base = item.name ? item.name.replace(/\.[^.]+$/,'') : `reply-${state.index+1}`;
      saveTxt(text, base || 'reply');
    } else {
      toast('回复为空或提取失败');
      errors.push(item.name); saveErrors(errors);
    }

    return gotoNext();

    // 处理下一个文件
    function gotoNext() {
      if (shouldStop()) return;
      state.index += 1;
      if (state.index < state.items.length) {
        saveState(state);
        spawnNextRunnerTab();
      } else {
        clearState();
        const errList = loadErrors();
        if (errList.length) {
          saveTxt(errList.join('\n'), 'error_list');
          toast(`全部完成，但有 ${errList.length} 个失败，已保存 error_list.txt`);
        } else {
          toast('全部完成 ✅');
        }
        clearErrors();
        tryCloseSelf(800);
      }
    }
  }

  /** 激活页面检测 **/
  const MY_RUN_ID = getParam('fresh') || ''; // 当前页面的fresh ID
  function isActiveRunner() {
    const active = getActiveId();
    return active && MY_RUN_ID && active === MY_RUN_ID;
  }

  /** 打开下一个“新标签页”处理下一文件，并尝试关闭当前页 **/
  function spawnNextRunnerTab() {
    const nextId = makeFreshId();
    setActiveId(nextId); // 设置新的激活ID
    const url = buildNewChatURL(nextId);
    openNewTab(url);
    tryCloseSelf(200);
  }

  /** 等待选择器，带超时 **/
  async function waitForSelector(sel, timeout = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (shouldStop() || !isActiveRunner()) return null;
      const el = document.querySelector(sel);
      if (el) return el;
      await sleep(100);
    }
    throw new Error('等待元素超时：' + sel);
  }

  /** 关闭当前页面 **/
  function tryCloseSelf(delayMs = 150) {
    setTimeout(() => {
      try { window.close(); } catch {}
      try { window.opener = null; window.open('', '_self'); window.close(); } catch {}
      try { location.replace('about:blank'); } catch {}
    }, delayMs);
  }

  /** 主程序初始化 **/
  function init() {
    if (getParam('fresh') && !isActiveRunner()) {
      tryCloseSelf(300);
      return;
    }

    if (isActiveRunner() && !shouldStop()) {
      processNextIfAny();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(typeof window !== 'undefined' ? window : this);
