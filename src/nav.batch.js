// nav.batch.js — 跨标签页批处理：每页处理 1 个文件 → 开新页 → 关旧页
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};

  const LS_STATE = 'GPTB_BATCH_STATE';
  const LS_LOCK  = 'GPTB_BATCH_LOCK';
  const CHAT_URL = 'https://chatgpt.com/?temporary-chat=true';
  const LOCK_TTL_MS = 180000; // 3 分钟，足够一次对话（可在 conf 里覆盖）
  const WAIT_READY_MS = 3000; // 最多等 3s 让依赖加载
  const LOG = (...a)=>{ try{ console.log('[gptb/batch]', ...a);}catch{} };
  const toast = (m)=> (global.GPTB.utils?.toast ? global.GPTB.utils.toast(m) : LOG(m));

  // ---- 工具：状态 & 锁 ----
  function readJSON(key){ try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
  function writeJSON(key, obj){ try { localStorage.setItem(key, JSON.stringify(obj)); } catch {} }
  function now(){ return Date.now(); }
  function uuid(){ return (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)); }

  function getState(){ return readJSON(LS_STATE) || null; }
  function setState(s){ writeJSON(LS_STATE, s); }

  function acquireLock(owner) {
    const l = readJSON(LS_LOCK);
    if (!l || (l.expiresAt && l.expiresAt < now())) {
      writeJSON(LS_LOCK, { owner, expiresAt: now() + LOCK_TTL_MS });
      LOG('lock acquired by', owner);
      return true;
    }
    LOG('lock busy by', l.owner);
    return false;
  }
  function refreshLock(owner) {
    const l = readJSON(LS_LOCK);
    if (l && l.owner === owner) writeJSON(LS_LOCK, { owner, expiresAt: now() + LOCK_TTL_MS });
  }
  function releaseLock(owner) {
    const l = readJSON(LS_LOCK);
    if (!l || l.owner === owner || (l.expiresAt && l.expiresAt < now())) {
      try { localStorage.removeItem(LS_LOCK); } catch {}
      LOG('lock released by', owner);
      return true;
    }
    return false;
  }

  function openNextTabOrWarn() {
    const w = window.open(CHAT_URL, '_blank', 'noopener');
    if (!w) {
      toast('弹窗被拦截：请允许本域弹窗，或手动打开临时会话后再点“开始批处理”。');
      return false;
    }
    return true;
  }
  function closeSelfSoon() {
    // 某些浏览器需要延迟一下
    setTimeout(() => { try { window.close(); } catch {} }, 50);
  }

  // ---- 等依赖就绪（storage / uiHelpers / dom） ----
  async function waitDepsReady(ms = WAIT_READY_MS) {
    const t0 = now();
    while (now() - t0 < ms) {
      const ok =
        global.GPTB.storage?.listFiles &&
        global.GPTB.uiHelpers?.runSendFromStorageAndSave &&
        global.GPTB.dom?.getComposerScope &&
        global.GPTB.dom?.waitReadyToSend &&
        global.GPTB.dom?.pressEnterInEditor;
      if (ok) return true;
      await new Promise(r=>setTimeout(r,120));
    }
    return false;
  }

  // ---- 工人：处理一个文件并接力 ----
  async function workerLoop(owner) {
    const ready = await waitDepsReady();
    if (!ready) { LOG('deps not ready'); releaseLock(owner); return; }

    const ST  = global.GPTB.storage;
    const UIH = global.GPTB.uiHelpers;

    // 取当前队首
    const all = await ST.listFiles();
    if (!all || !all.length) {
      // 队列空：终止批处理
      const st = getState() || {};
      st.running = false; setState(st);
      releaseLock(owner);
      toast('批处理完成（无待处理文件）');
      // 不再开新页，仅关闭自己
      closeSelfSoon();
      return;
    }

    const file = all[0];
    const st = getState() || {};
    const seq = (st.seq || 0) + 1;
    setState(Object.assign(st, { seq }));

    LOG(`processing #${seq}:`, file.name || file.id);

    // 处理 1 个文件
    try {
      refreshLock(owner); // 刷新锁以覆盖长任务
      await UIH.runSendFromStorageAndSave(file.id, {
        prompt: st.prompt || '',
        deleteAfter: st.deleteAfter !== false, // 默认 true
        timeout: st.timeout || 60000,
        stableMs: st.stableMs || 500,
        replyQuietMs: st.replyQuietMs || 500,
        replyHardMs: st.replyHardMs || 4000
      });
    } catch (e) {
      LOG('process error', e);
    } finally {
      releaseLock(owner);
    }

    // 看看是否还有文件
    const left = await ST.listFiles();
    if (left && left.length) {
      // 还有文件：开下一页接力，关自己
      const ok = openNextTabOrWarn();
      if (ok) closeSelfSoon();
    } else {
      // 没有文件：结束批处理并关自己
      const st2 = getState() || {};
      st2.running = false; setState(st2);
      closeSelfSoon();
    }
  }

  // ---- API：启动批处理（在 UI 按钮中调用） ----
  async function start(opts = {}) {
    // 写运行状态
    const st = {
      running: true,
      prompt: opts.prompt || '',
      deleteAfter: opts.deleteAfter !== false, // 默认 true
      timeout: opts.timeout || 60000,
      stableMs: opts.stableMs || 500,
      replyQuietMs: opts.replyQuietMs || 500,
      replyHardMs: opts.replyHardMs || 4000,
      seq: 0,
      launchedAt: now()
    };
    setState(st);

    // 打开第一张临时页
    const ok = openNextTabOrWarn();
    if (ok) closeSelfSoon();
  }

  // ---- API：在每个页面加载时调用（自动工人） ----
  async function maybeWorkOnLoad() {
    const st = getState();
    if (!st || st.running !== true) { LOG('no running batch'); return; }

    const owner = 'tab-' + uuid();

    // 抢锁（如果忙，就安静退出或直接自关）
    if (!acquireLock(owner)) {
      // 这里选择直接安静退出；必要时也可以 setTimeout 再试
      LOG('lock not acquired, exit');
      return;
    }

    // 真正开工：处理 1 个文件
    await workerLoop(owner);
  }

  // ---- 导出 & 自启动 ----
  global.GPTB.batch = { start, maybeWorkOnLoad };

  // 让控制台可直接访问（沙箱桥接）
  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.GPTB = global.GPTB; } catch {}
  try { console.log('[gptb] nav.batch loaded'); } catch {}

  // 页面就绪后尝试工作（不影响普通使用）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeWorkOnLoad);
  } else {
    // 延迟一点，等其它模块先挂好
    setTimeout(maybeWorkOnLoad, 50);
  }

})(typeof window !== 'undefined' ? window : this);
