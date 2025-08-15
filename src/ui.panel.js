// ui.panel.js — 极简面板：只负责选择文件与启动批处理（自启动）
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const ST    = global.GPTB.storage   || {};
  const U     = global.GPTB.utils     || {};
  const UP    = global.GPTB.uploader  || {};
  const BATCH = global.GPTB.batch     || {};

  const toast = (msg)=> (U?.toast ? U.toast(msg) : console.log('[gptb]', msg));
  const PANEL_ID = (global.GPTB.conf && global.GPTB.conf.PANEL_ID) || 'gptb-mini-panel';

  function bytes(n){
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1)+' KB';
    return (n/1024/1024).toFixed(1)+' MB';
  }

  async function refreshList() {
    const box = document.getElementById('gptb-file-list');
    if (!box) return;
    box.innerHTML = '';
    const all = await (ST.listFiles ? ST.listFiles() : []);
    if (!all.length) { box.innerHTML = '<div class="gptb-empty">（空）</div>'; return; }
    for (const f of all) {
      const row = document.createElement('div');
      row.className = 'gptb-row';
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed #333;';
      row.innerHTML = `
        <span title="${f.name}">${f.name}</span>
        <span style="opacity:.8">${bytes(f.size)} · ${f.chunks}块</span>
      `;
      box.appendChild(row);
    }
  }

  function ensurePanel(){
    if (document.getElementById(PANEL_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    Object.assign(wrap.style, {
      position:'fixed', right:'16px', bottom:'16px', width:'460px',
      background:'rgba(24,24,28,.96)', color:'#fff', borderRadius:'12px',
      padding:'12px', zIndex:999999, boxShadow:'0 8px 24px rgba(0,0,0,.35)',
      fontSize:'13px', lineHeight:'1.45'
    });
    wrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">Batch Mini · 批处理面板</div>

      <div style="margin-bottom:8px">
        <textarea id="gptb-mini-prompt" rows="3" placeholder="可选提示词（发送前自动填入）"
          style="width:100%;resize:vertical;border-radius:8px;padding:8px;border:1px solid #444;background:#111;color:#fff;"></textarea>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <button id="gptb-pick"    style="padding:6px 10px;border:none;border-radius:8px;background:#10a37f;color:#fff;cursor:pointer">选择并保存</button>
        <button id="gptb-batch"   style="padding:6px 10px;border:none;border-radius:8px;background:#eab308;color:#111;cursor:pointer;font-weight:600">开始批处理（新标签接力）</button>
        <button id="gptb-refresh" style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">刷新列表</button>
        <button id="gptb-clear"   style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">清空存储</button>
        <button id="gptb-close"   style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer;margin-left:auto">关闭</button>
      </div>

      <div style="opacity:.8;margin:4px 0">已保存文件（批处理按队首开始，逐个处理）：</div>
      <div id="gptb-file-list" style="max-height:240px;overflow:auto;border:1px dashed #444;border-radius:8px;padding:6px;background:#0f0f10"></div>

      <div style="opacity:.7;font-size:12px;margin-top:6px">
        说明：点击<b>开始批处理</b>后，将在新标签页打开临时会话。每个标签只处理一个文件→开下一标签→关闭旧标签，直到队列清空。
      </div>
    `;
    document.body.appendChild(wrap);

    // 选择并保存
    wrap.querySelector('#gptb-pick').onclick = async () => {
      const metas = await (UP.selectAndSave ? UP.selectAndSave() : Promise.resolve([]));
      if (metas.length) await refreshList();
    };

    // 开始批处理（新标签接力）
    wrap.querySelector('#gptb-batch').onclick = async (ev) => {
      if (!BATCH?.start) return toast('batch 模块未就绪');
      const files = await (ST.listFiles ? ST.listFiles() : []);
      if (!files.length) return toast('存储为空，请先选择并保存文件');

      const btn = ev.currentTarget;
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = '启动中…';
      try {
        const promptVal = document.getElementById('gptb-mini-prompt')?.value || '';
        await BATCH.start({
          prompt: promptVal,
          deleteAfter: true,
          timeout: 60000,
          stableMs: 500,
          replyQuietMs: 500,
          replyHardMs: 4000
        });
        // start() 会尝试打开新标签并关闭当前页；若弹窗被拦截，会有提示
      } catch (e) {
        console.error(e);
        toast('启动批处理失败');
      } finally {
        // 如果未被关闭（弹窗被拦截），恢复按钮
        if (!document.hidden) { btn.disabled = false; btn.textContent = oldText; }
      }
    };

    // 刷新
    wrap.querySelector('#gptb-refresh').onclick = refreshList;

    // 清空
    wrap.querySelector('#gptb-clear').onclick = async () => {
      const all = await (ST.listFiles ? ST.listFiles() : []);
      for (const f of all) await ST.deleteFile(f.id);
      toast('存储已清空');
      await refreshList();
    };

    // 关闭
    wrap.querySelector('#gptb-close').onclick = () => wrap.remove();

    refreshList();
  }

  // 自启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePanel);
  } else {
    ensurePanel();
  }

  // 导出（避免覆盖其它 ui 字段）
  global.GPTB.ui = Object.assign(global.GPTB.ui || {}, { ensurePanel, refreshList });

  // 控制台桥接
  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.GPTB = global.GPTB; } catch {}
  try { console.log('[mini] ui.panel loaded (batch-only)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
