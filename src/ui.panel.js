// ui.panel.js — 面板 UI 逻辑
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const H = {};

  const ST = global.GPTB.storage || {};
  const U  = global.GPTB.utils   || {};
  const UIH = global.GPTB.uiHelpers || {};

  const toast = (msg) => (U.toast ? U.toast(msg) : console.log('[gptb]', msg));

  // 渲染文件列表
  async function refreshList() {
    const listEl = document.getElementById('gptb-file-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const files = await ST.listFiles();
    if (!files.length) {
      listEl.innerHTML = '<li class="gptb-empty">（无文件）</li>';
      return;
    }
    files.forEach(f => {
      const li = document.createElement('li');
      li.dataset.id = f.id;
      li.textContent = f.name || '(未命名)';
      listEl.appendChild(li);
    });
  }

  // 获取当前选中文件的 id
  function getSelectedId() {
    const sel = document.querySelector('#gptb-file-list li.selected');
    return sel ? sel.dataset.id : null;
  }

  // 初始化 UI 面板
  H.initPanel = function () {
    const wrap = document.createElement('div');
    wrap.id = 'gptb-panel';
    wrap.innerHTML = `
      <div class="gptb-header">GPT Batch</div>
      <div class="gptb-controls">
        <input type="text" id="gptb-mini-prompt" placeholder="输入要附加的提示词">
        <button id="gptb-send">发送并保存</button>
        <button id="gptb-refresh">刷新列表</button>
      </div>
      <ul id="gptb-file-list" class="gptb-list"></ul>
    `;
    document.body.appendChild(wrap);

    // 列表点击选中
    wrap.querySelector('#gptb-file-list').onclick = (ev) => {
      if (ev.target.tagName === 'LI') {
        wrap.querySelectorAll('li').forEach(li => li.classList.remove('selected'));
        ev.target.classList.add('selected');
      }
    };

    // 发送并保存
    wrap.querySelector('#gptb-send').onclick = async (ev) => {
      const btn = ev.currentTarget;
      const id = getSelectedId();
      if (!id) return toast('请先在列表中选择一个文件');

      btn.disabled = true;
      btn.textContent = '发送中…';
      try {
        const promptVal = document.getElementById('gptb-mini-prompt')?.value || '';
        const ok = await UIH.runSendFromStorageAndSave(id, {
          deleteAfter: true,        // 粘贴成功后即删除文件
          timeout: 60000,           // 等待按钮可用的超时
          stableMs: 500,            // 稳定检测时长
          prompt: promptVal         // 使用面板里的 Prompt
        });
        if (ok) toast('已触发发送并保存');
        else    toast('发送失败或条件未满足');
      } catch (err) {
        console.error(err);
        toast('发送过程中出错');
      } finally {
        btn.disabled = false;
        btn.textContent = '发送并保存';
        await refreshList();
      }
    };

    // 刷新列表
    wrap.querySelector('#gptb-refresh').onclick = refreshList;

    refreshList();
  };

  global.GPTB.uiPanel = H;
  try { console.log('[mini] ui.panel loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
