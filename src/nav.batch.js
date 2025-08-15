// nav.batch.js — 跨标签页批处理：每页处理 1 个文件 → 开新页 → 关旧页 + 停止/紧急停止
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};

  const LS_STATE = 'GPTB_BATCH_STATE';
  const LS_LOCK  = 'GPTB_BATCH_LOCK';
  const LS_KILL  = 'GPTB_BATCH_KILL';      // 广播硬停
  const CHAT_URL = 'https://chatgpt.com/?temporary-chat=true';

  const LOCK_TTL_MS = 180000;  // 3 分钟
  const WAIT_READY_MS = 3000;  // 依赖就绪等待
  const LOG = (...a)=>{ try{ console.log('[gptb/batch]', ...a);}catch{} };
  const toast = (m)=> (global.GPTB.utils?.toast ? global.GPTB.utils.toast(m) : LOG(m));

  let CURRENT_OWNER = null;    // 当前页持有的锁 owner（便于硬停时释放）

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
      CURRENT_OWNER = owner;
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
      if (CURRENT_OWNER === owner) CURRENT_OWNER = null;
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
  function closeSelfSoon() { setTimeout(() => { try { window.close(); } catch {} }, 50); }

  // ---- 依赖就绪 ----
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

  // ---- 硬停广播监听：任一标签触发后，当前页立即终止并尝试关闭 ----
  window.addEventListener('storage', (ev) => {
    if (ev.key === LS_KILL && ev.newValue) {
      LOG('kill signal received');
      try { releaseLock(CURRENT_OWNER); } catch {}
      try { window.stop?.(); } catch {}
      try { global.GPTB.utils?.toast?.('批处理已紧急停止'); } catch {}
      // 立即跳空页并尝试关闭
      try { location.replace('about:blank'); } catch {}
      closeSelfSoon();
    }
  });

  // ---- 工人：处理一个文件并接力 ----
  async function workerLoop(owner) {
    const ready = await waitDepsReady();
    if (!ready) { LOG('deps not ready'); releaseLock(owner); return; }

    const ST  = global.GPTB.storage;
    const UIH = global.GPTB.uiHelpers;

    // 若已被软停，直接退出
    const st0 = getState();
    if (!st0 || st0.running !== true) { LOG('stopped before work'); releaseLock(owner); return; }

    // 取当前队首
    const all = await ST.listFiles();
    if (!all || !all.length) {
      const st = getState() || {};
      st.running = false; setState(st);
      releaseLock(owner);
      toast('批处理完成（无待处理文件）');
      closeSelfSoon();
      return;
    }

    const file = all[0];
    const st = getState() || {};
    const seq = (st.seq || 0) + 1;
    setState(Object.assign(st, { seq }));

    LOG(`processing #${seq}:`, file.name || file.id);

    try {
      refreshLock(owner);
      await UIH.runSendFromStorageAndSave(file.id, {
        prompt: st.prompt || '',
        deleteAfter: st.deleteAfter !== false,
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

    // 若软停了，不再接力
    const st2 = getState();
    if (!st2 || st2.running !== true) { LOG('stopped after work'); closeSelfSoon(); return; }

    // 看看是否还有文件
    const left = await ST.listFiles();
    if (left && left.length) {
      const ok = openNextTabOrWarn();
      if (ok) closeSelfSoon();
    } else {
      const st3 = getState() || {};
      st3.running = false; setState(st3);
      closeSelfSoon();
    }
  }

  // ---- API：启动/停止 ----
  async function start(opts = {}) {
    const st = {
      running: true,
      prompt: opts.prompt || '',
      deleteAfter: opts.deleteAfter !== false,
      timeout: opts.timeout || 60000,
      stableMs: opts.stableMs || 500,
      replyQuietMs: opts.replyQuietMs || 500,
      replyHardMs: opts.replyHardMs || 4000,
      seq: 0,
      launchedAt: now()
    };
    setState(st);

    const ok = openNextTabOrWarn();
    if (ok) closeSelfSoon();
  }

  // 软停：不再接力，当前页完成后结束
  function stopSoft() {
    const st = getState() || {};
    st.running = false;
    setState(st);
    toast('批处理已停止（本页执行完即结束）');
  }

  // 硬停：立即广播终止，当前页尽快关闭
  function stopHard() {
    stopSoft(); // 先把 running 置 false
    writeJSON(LS_KILL, { ts: now(), from: uuid() }); // 唯一值才能触发 storage 事件
    toast('已发送紧急停止信号');
  }

  // ---- API：在每个页面加载时调用（自动工人） ----
  async function maybeWorkOnLoad() {
    const st = getState();
    if (!st || st.running !== true) { LOG('no running batch'); return; }

    const owner = 'tab-' + uuid();

    if (!acquireLock(owner)) {
      LOG('lock not acquired, exit');
      return;
    }

    await workerLoop(owner);
  }

  // ---- 导出 & 自启动 ----
  global.GPTB.batch = { start, stopSoft, stopHard, maybeWorkOnLoad };

  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.GPTB = global.GPTB; } catch {}
  try { console.log('[gptb] nav.batch loaded (stop/kill supported)'); } catch {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeWorkOnLoad);
  } else {
    setTimeout(maybeWorkOnLoad, 50);
  }

})(typeof window !== 'undefined' ? window : this);
