// nav.batch.js — 跨标签页批处理：每页处理 1 个文件 → 新标签接力（防重复开页+启动延时） → 强力关闭旧页
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};

  // ---- 常量 & 配置 ----
  const LS_STATE   = 'GPTB_BATCH_STATE';
  const LS_LOCK    = 'GPTB_BATCH_LOCK';
  const LS_KILL    = 'GPTB_BATCH_KILL';
  const LS_ACTIVE  = 'GPTB_ACTIVE_ID';
  const LS_SPAWN   = 'GPTB_SPAWN_GUARD';      // 1.5s 节流，避免误开多页

  const CHAT_ORIGIN = 'https://chatgpt.com';
  const CHAT_URL    = CHAT_ORIGIN + '/?temporary-chat=true';

  const LOCK_TTL_MS      = 180000; // 锁过期
  const WAIT_READY_MS    = 3000;   // 依赖等待
  const START_DELAY_MS   = 800;    // 新页打开后，工作前延时（关键：给 React/DOM 初始化时间）
  const SPAWN_GUARD_MS   = 1500;   // 开页节流窗口

  const LOG   = (...a)=>{ try{ console.log('[gptb/batch]', ...a);}catch{} };
  const toast = (m)=> (global.GPTB.utils?.toast ? global.GPTB.utils.toast(m) : LOG(m));
  const QS    = new URLSearchParams(location.search);
  const MY_FRESH = QS.get('fresh') || '';

  let CURRENT_OWNER = null;

  // ---- 小工具 ----
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  function readJSON(k){ try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null} }
  function writeJSON(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch{} }
  function now(){ return Date.now(); }
  function uuid(){ return crypto?.randomUUID?.() || Math.random().toString(36).slice(2); }

  function getState(){ return readJSON(LS_STATE) || null; }
  function setState(s){ writeJSON(LS_STATE, s); }

  function getActive(){ return localStorage.getItem(LS_ACTIVE) || ''; }
  function setActive(id){ try{ localStorage.setItem(LS_ACTIVE, id || ''); }catch{} }

  // ---- 锁 ----
  function acquireLock(owner){
    const l = readJSON(LS_LOCK);
    if (!l || (l.expiresAt && l.expiresAt < now())) {
      writeJSON(LS_LOCK, { owner, expiresAt: now()+LOCK_TTL_MS });
      CURRENT_OWNER = owner;
      LOG('lock acquired', owner);
      return true;
    }
    LOG('lock busy by', l?.owner);
    return false;
  }
  function refreshLock(owner){
    const l = readJSON(LS_LOCK);
    if (l && l.owner === owner) writeJSON(LS_LOCK, { owner, expiresAt: now()+LOCK_TTL_MS });
  }
  function releaseLock(owner){
    const l = readJSON(LS_LOCK);
    if (!l || l.owner === owner || (l.expiresAt && l.expiresAt < now())) {
      try{ localStorage.removeItem(LS_LOCK); }catch{}
      if (CURRENT_OWNER === owner) CURRENT_OWNER = null;
      LOG('lock released', owner);
      return true;
    }
    return false;
  }

  // ---- 开页节流守卫（1.5s 内只允许一次 spawn）----
  function canSpawnNow() {
    const g = readJSON(LS_SPAWN);
    if (!g || !g.ts || now() - g.ts > SPAWN_GUARD_MS) {
      writeJSON(LS_SPAWN, { ts: now(), from: uuid() });
      return true;
    }
    return false;
  }

  // ---- 打开新标签（优先 GM_openInTab）----
  function openNewTab(url){
    // 节流：避免重复开页
    if (!canSpawnNow()) { LOG('spawn throttled'); return false; }

    try {
      if (typeof GM_openInTab !== 'undefined') {
        GM_openInTab(url, { active:true, setParent:true, insert:true });
        return true;
      }
    } catch {}
    const w = window.open(url, '_blank', 'noopener');
    if (w) return true;
    // 兜底：a 标签模拟
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  }

  // ---- 强力关页（延迟 500ms，给 React 卸载时间）----
  function tryCloseSelf(delayMs = 500){
    setTimeout(() => {
      try { window.close(); } catch {}
      try { window.opener = null; window.open('', '_self'); window.close(); } catch {}
      try { location.replace('about:blank'); } catch {}
    }, delayMs);
  }

  // ---- 依赖就绪 ----
  async function waitDepsReady(ms=WAIT_READY_MS){
    const t0 = now();
    while (now()-t0 < ms) {
      const ok = global.GPTB.storage?.listFiles
        && global.GPTB.uiHelpers?.runSendFromStorageAndSave
        && global.GPTB.dom?.waitReadyToSend
        && global.GPTB.dom?.pressEnterInEditor;
      if (ok) return true;
      await sleep(120);
    }
    return false;
  }

  // ---- storage 广播：ACTIVE 切换 & 硬停 ----
  window.addEventListener('storage', (ev) => {
    if (ev.key === LS_ACTIVE) {
      if (MY_FRESH && ev.newValue && ev.newValue !== MY_FRESH) {
        LOG('inactive tab detected; closing self');
        tryCloseSelf(80);
      }
    }
    if (ev.key === LS_KILL && ev.newValue) {
      LOG('kill signal received');
      try { releaseLock(CURRENT_OWNER); } catch {}
      try { window.stop?.(); } catch {}
      tryCloseSelf(50);
    }
  });

  // ---- 工人：处理 1 个文件并接力 ----
  async function workerLoop(owner){
    // 统一在新页工作前延时（给 React/DOM 初始化）
    await sleep(START_DELAY_MS);

    const ready = await waitDepsReady();
    if (!ready) { LOG('deps not ready'); releaseLock(owner); return; }

    const ST  = global.GPTB.storage;
    const UIH = global.GPTB.uiHelpers;

    const st0 = getState();
    if (!st0 || st0.running !== true) { releaseLock(owner); return; }

    const all = await ST.listFiles();
    if (!all || !all.length) {
      const st = getState() || {};
      st.running = false; setState(st);
      releaseLock(owner);
      toast('批处理完成');
      tryCloseSelf(150);
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

    // 若已被软停，不再接力
    const st2 = getState();
    if (!st2 || st2.running !== true) { tryCloseSelf(120); return; }

    // 还有文件？→ 设置 ACTIVE →（节流）开下一页 → 关自己
    const left = await ST.listFiles();
    if (left && left.length) {
      const nextId = uuid();
      setActive(nextId);
      const nextURL = CHAT_URL + '&fresh=' + encodeURIComponent(nextId);
      const spawned = openNewTab(nextURL);
      if (spawned) tryCloseSelf(150);
    } else {
      const st3 = getState() || {};
      st3.running = false; setState(st3);
      tryCloseSelf(150);
    }
  }

  // ---- API：启动/停止 ----
  async function start(opts={}){
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

    // 设置 ACTIVE 并节流开页
    const firstId = uuid();
    setActive(firstId);
    const url = CHAT_URL + '&fresh=' + encodeURIComponent(firstId);
    const spawned = openNewTab(url);
    if (spawned) tryCloseSelf(120);
  }

  function stopSoft(){
    const st = getState() || {};
    st.running = false; setState(st);
    toast('批处理已停止（本页完成后结束）');
  }

  function stopHard(){
    stopSoft();
    // 禁用页面按钮防止 React 回调
    document.querySelectorAll('button').forEach(btn => {
      btn.disabled = true;
      btn.onclick = null;
    });
    try { localStorage.setItem(LS_KILL, JSON.stringify({ ts: now(), from: uuid() })); } catch {}
    toast('已发出紧急停止信号');
  }

  // ---- 入口：每页加载时尝试成为工人 ----
  async function maybeWorkOnLoad(){
    // 不是最新 ACTIVE 且带 fresh → 自闭
    const active = getActive();
    if (MY_FRESH && active && active !== MY_FRESH) {
      LOG('not active; closing');
      tryCloseSelf(80);
      return;
    }

    const st = getState();
    if (!st || st.running !== true) return;

    // 统一延时，避免刚打开就抢锁导致的竞态
    await sleep(START_DELAY_MS);

    const owner = 'tab-' + uuid();
    if (!acquireLock(owner)) return;

    await workerLoop(owner);
  }

  // ---- 导出 & 自启动 ----
  global.GPTB.batch = { start, stopSoft, stopHard, maybeWorkOnLoad };

  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.GPTB = global.GPTB; } catch {}
  try { console.log('[gptb] nav.batch loaded (spawn-throttle + start-delay)'); } catch {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeWorkOnLoad);
  } else {
    setTimeout(maybeWorkOnLoad, 50);
  }

})(typeof window !== 'undefined' ? window : this);
