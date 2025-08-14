/* ui.panel.js — ChatGPT 批处理 · 用户界面面板模块 (IIFE)
   暴露：window.GPTBatch.UI
*/
(function (global) {
  'use strict';
  const NS = (global.GPTBatch = global.GPTBatch || {});

  /** 插入面板 UI **/
  function injectPanel() {
    if (document.getElementById('gpt-batch-panel')) return;

    // 创建面板元素
    const wrap = document.createElement('div');
    wrap.id = 'gpt-batch-panel';
    Object.assign(wrap.style, {
      position: 'fixed', right: '16px', bottom: '16px', width: '360px',
      background: 'rgba(24,24,28,0.95)', color: '#fff', borderRadius: '12px',
      padding: '12px', zIndex: 999999, boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontSize: '13px'
    });
    wrap.innerHTML = `
      <div style="font-weight:600; margin-bottom:8px;">批量发送 (Prompt + 文件) · 每轮新标签（自动关闭旧页）</div>
      <div style="margin-bottom:8px;">
        <div style="opacity:.8; margin-bottom:4px;">Prompt：</div>
        <textarea id="gptb-prompt" rows="5" style="width:100%; resize:vertical; border-radius:8px; padding:8px; border:1px solid #444; background:#111; color:#fff;" placeholder="为每个文件输入相同的 Prompt"></textarea>
      </div>
      <div style="margin-bottom:8px;">
        <div style="opacity:.8; margin-bottom:4px;">选择文件（可多选，按选择顺序处理）：</div>
        <input id="gptb-files" type="file" multiple style="width:100%;"/>
        <div id="gptb-list" style="max-height:120px; overflow:auto; margin-top:6px; padding:6px; border:1px dashed #444; border-radius:8px; background:#0e0e0e;"></div>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="gptb-stop"  style="padding:6px 10px; border-radius:8px; border:none; background:#c0392b; color:#fff; cursor:pointer;">终止任务</button>
        <button id="gptb-start" style="padding:6px 10px; border-radius:8px; border:none; background:#10a37f; color:#fff; cursor:pointer;">启动</button>
        <button id="gptb-close" style="padding:6px 10px; border:1px solid #444; background:transparent; color:#fff; cursor:pointer;">关闭</button>
      </div>
      <div style="opacity:.7; font-size:12px; margin-top:6px;">
        • 每个文件在“新标签页”执行，并自动关闭上一轮<br>
        • 仅 send/stop 判定；发送失败自动重试 ${SEND_RETRY_MAX} 次；生成超时 ${REPLY_DONE_TIMEOUT_MS/1000}s<br>
        • 临时聊天不留历史；“终止任务”一键熔断
      </div>
    `;
    document.body.appendChild(wrap);

    // 获取面板中的元素
    const promptEl = wrap.querySelector('#gptb-prompt');
    const fileEl   = wrap.querySelector('#gptb-files');
    const listEl   = wrap.querySelector('#gptb-list');

    // 处理文件选择
    fileEl.addEventListener('change', () => {
      listEl.innerHTML = '';
      [...fileEl.files].forEach((f, i) => {
        const row = document.createElement('div');
        row.textContent = `${i+1}. ${f.name}`;
        row.style.padding = '4px 0';
        listEl.appendChild(row);
      });
    });

    // 关闭面板
    wrap.querySelector('#gptb-close').onclick = () => wrap.remove();

    // 启动任务
    wrap.querySelector('#gptb-start').onclick = async () => {
      const files = [...(fileEl.files || [])];
      if (!files.length) { toast('请先选择文件'); return; }

      const items = [];
      for (const f of files) {
        const dataURL = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        items.push({ name: f.name, type: f.type, dataURL });
      }

      const state = { running: true, prompt: (promptEl.value || ''), items, index: 0 };
      saveState(state);
      clearErrors();
      clearStopSignal();

      const firstId = makeFreshId();
      setActiveId(firstId);
      const url = buildNewChatURL(firstId);
      toast('开始批处理：打开第一个新标签页…');
      openNewTab(url);
      tryCloseSelf(200);
    };

    // 紧急停止任务
    wrap.querySelector('#gptb-stop').onclick = () => {
      setStopSignal();
      clearState();
      clearErrors();
      GM_deleteValue(ACTIVE_ID_KEY);
      toast('任务已终止，下次不会自动续跑');
      try { window.stop?.(); } catch(_) {}
    };
  }

  /** 初始化函数 **/
  function init() {
    injectPanel();

    // 如果当前页是旧运行页且不是激活页，尝试关闭
    if (getParam('fresh') && !isActiveRunner()) {
      tryCloseSelf(300);
      return;
    }

    if (isActiveRunner() && !shouldStop()) {
      processNextIfAny();
    }
  }

  // 事件监听：页面加载完后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露接口
  NS.UI = {
    injectPanel
  };
})(typeof window !== 'undefined' ? window : this);
