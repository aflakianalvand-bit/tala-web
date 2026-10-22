// repo.js — لایه دسترسی داده عمومی (CRUD ساده روی هر Store)
// در فازهای بعد، سرویس‌های تجاری (purchases/sales/ledger) از runTransaction در db.js
// برای نوشتن اتمیک هم‌زمان روی چند Store استفاده خواهند کرد؛ این فایل فقط عملیات تک‌مرحله‌ای عمومی است.
import { openDatabase, stampOrigin } from './db.js';

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).get(key));
}

export async function put(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  return requestToPromise(tx.objectStore(storeName).put(value));
}

export async function add(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  // (Phase 22) مُهر منشأ روی رکورد تازه — همان قاعده‌ی runTransaction.
  return requestToPromise(tx.objectStore(storeName).add(stampOrigin(storeName, value)));
}

export async function remove(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  return requestToPromise(tx.objectStore(storeName).delete(key));
}

export async function count(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).count());
}

export async function getByIndex(storeName, indexName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).index(indexName).getAll(value));
}
