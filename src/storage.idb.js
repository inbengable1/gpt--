// storage.idb.js — IndexedDB chunk storage (大文件友好)
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const DB_NAME = 'GPTB_FilesDB';
  const META = 'files_meta';
  const CHUNK = 'files_chunks';
  const VERSION = 2;
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB/块，按需改大/小

  let _dbPromise = null;
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(META)) {
          const m = db.createObjectStore(META, { keyPath: 'id' });
          m.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains(CHUNK)) {
          // 复合键：fileId + index
          db.createObjectStore(CHUNK, { keyPath: ['fileId','index'] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  async function saveFileBlob(file) {
    const db = await openDB();
    const id = crypto.randomUUID();
    const tx = db.transaction([META, CHUNK], 'readwrite');
    const metaStore = tx.objectStore(META);
    const chunkStore = tx.objectStore(CHUNK);

    const size = file.size;
    const type = file.type || 'application/octet-stream';
    const name = file.name || `file-${Date.now()}`;
    const chunks = Math.ceil(size / CHUNK_SIZE);

    // 先写 meta
    await reqAsPromise(metaStore.put({
      id, name, type, size, chunks, createdAt: Date.now()
    }));

    // 再写分片（Blob.slice 不会把整文件一次读入内存）
    for (let i = 0; i < chunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(size, start + CHUNK_SIZE);
      const blob = file.slice(start, end);
      await reqAsPromise(chunkStore.put({ fileId: id, index: i, blob }));
    }
    await txDone(tx);
    return { id, name, type, size, chunks };
  }

  async function listFiles() {
    const db = await openDB();
    const tx = db.transaction(META, 'readonly');
    const store = tx.objectStore(META);
    const all = await reqAsPromise(store.getAll());
    await txDone(tx);
    // 按时间倒序
    return (all || []).sort((a,b)=>b.createdAt-a.createdAt);
  }

  async function deleteFile(fileId) {
    const db = await openDB();
    const tx = db.transaction([META, CHUNK], 'readwrite');
    await reqAsPromise(tx.objectStore(META).delete(fileId));

    // 删除所有分片：用游标
    const cstore = tx.objectStore(CHUNK);
    await new Promise((res, rej) => {
      const range = IDBKeyRange.bound([fileId, -Infinity], [fileId, Infinity]);
      const cursorReq = cstore.openCursor(range);
      cursorReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return res();
        cstore.delete(cur.primaryKey);
        cur.continue();
      };
      cursorReq.onerror = () => rej(cursorReq.error);
    });

    await txDone(tx);
    return true;
  }

  async function getFileBlob(fileId) {
    const db = await openDB();
    const meta = await reqAsPromise(db.transaction(META,'readonly').objectStore(META).get(fileId));
    if (!meta) return null;
    const blobs = new Array(meta.chunks);
    const tx = db.transaction(CHUNK, 'readonly');
    const cstore = tx.objectStore(CHUNK);
    await new Promise((res, rej) => {
      const range = IDBKeyRange.bound([fileId, -Infinity], [fileId, Infinity]);
      const curReq = cstore.openCursor(range);
      curReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return res();
        const { index, blob } = cur.value;
        blobs[index] = blob;
        cur.continue();
      };
      curReq.onerror = () => rej(curReq.error);
    });
    await txDone(tx);
    return new Blob(blobs, { type: meta.type || 'application/octet-stream' });
  }

  async function restoreAsFile(fileId) {
    const db = await openDB();
    const meta = await reqAsPromise(db.transaction(META,'readonly').objectStore(META).get(fileId));
    if (!meta) return null;
    const blob = await getFileBlob(fileId);
    // File 构造器在旧浏览器可能不可用；回退 Blob 并附 name
    try { return new File([blob], meta.name, { type: meta.type }); }
    catch { blob.name = meta.name; return blob; }
  }

  // 小工具：把 IDBRequest 包装成 Promise
  function reqAsPromise(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  function txDone(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('tx aborted'));
    });
  }

  // 导出
  global.GPTB.storage = {
    saveFileBlob, listFiles, deleteFile, getFileBlob, restoreAsFile, CHUNK_SIZE
  };
  try { console.log('[mini] storage.idb loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
