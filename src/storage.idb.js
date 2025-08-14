/* storage.idb.js — ChatGPT 批处理 · IndexedDB 存储模块 (IIFE)
   暴露：window.GPTBatch.Storage
*/
(function (global) {
  'use strict';
  const NS = (global.GPTBatch = global.GPTBatch || {});
  
  /** IndexedDB 操作封装 **/
  const dbName = 'GPTBatchFiles';
  const storeName = 'files';
  let db = null;

  // 打开数据库
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);

      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: true });
        }
      };

      request.onsuccess = function (event) {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  // 存储文件数据
  function saveFile(fileId, fileName, fileData) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const fileRecord = { id: fileId, name: fileName, data: fileData };

        const request = store.put(fileRecord);
        request.onsuccess = function () {
          resolve(true);
        };
        request.onerror = function (event) {
          reject(event.target.error);
        };
      });
    });
  }

  // 从 IndexedDB 加载文件数据
  function loadFile(fileId) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(fileId);

        request.onsuccess = function () {
          if (request.result) {
            resolve(request.result.data);
          } else {
            resolve(null); // 文件不存在
          }
        };
        request.onerror = function (event) {
          reject(event.target.error);
        };
      });
    });
  }

  // 删除文件
  function deleteFile(fileId) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(fileId);

        request.onsuccess = function () {
          resolve(true);
        };
        request.onerror = function (event) {
          reject(event.target.error);
        };
      });
    });
  }

  // 获取所有文件
  function getAllFiles() {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function (event) {
          reject(event.target.error);
        };
      });
    });
  }

  // 导出到命名空间
  NS.Storage = {
    saveFile,
    loadFile,
    deleteFile,
    getAllFiles,
  };
})(typeof window !== 'undefined' ? window : this);
