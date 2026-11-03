// 브라우저 내부 저장소(IndexedDB): 검토 이력, API 응답 캐시, 설정. 백업/복원은 JSON 파일.
var RC = window.RC || (window.RC = {});

RC.store = (function () {
  const DB_NAME = 'refcheck', VERSION = 1;
  const CACHE_DAYS = 30;
  let dbp = null;

  function db() {
    if (!dbp) dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        const r = d.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
        r.createIndex('fileHash', 'fileHash');
        d.createObjectStore('apiCache', { keyPath: 'key' });
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      const req = fn(s);
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  // 브라우저가 공간이 부족할 때 이 데이터를 자동으로 지우지 않게 요청
  async function requestPersist() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { }
    return false;
  }

  const putReview = r => tx('reviews', 'readwrite', s => s.put(r));
  const getReview = id => tx('reviews', 'readonly', s => s.get(id));
  const allReviews = () => tx('reviews', 'readonly', s => s.getAll());
  const deleteReview = id => tx('reviews', 'readwrite', s => s.delete(id));

  async function cacheGet(key) {
    try {
      const row = await tx('apiCache', 'readonly', s => s.get(key));
      if (row && Date.now() - row.fetchedAt < CACHE_DAYS * 864e5) return row.response;
    } catch (e) { }
    return undefined;
  }
  async function cacheSet(key, response) {
    try { await tx('apiCache', 'readwrite', s => s.put({ key, response, fetchedAt: Date.now() })); } catch (e) { }
  }

  async function getSettings() {
    const rows = await tx('settings', 'readonly', s => s.getAll());
    const out = { threshold: 40, mailto: '', similarCount: 20 };
    for (const r of rows || []) out[r.key] = r.value;
    return out;
  }
  async function setSetting(key, value) {
    await tx('settings', 'readwrite', s => s.put({ key, value }));
  }

  // 백업: 검토 이력과 설정만 (API 캐시는 다시 받으면 되므로 뺀다)
  async function exportBackup() {
    return JSON.stringify({ app: 'RefCheck', version: 1, exportedAt: new Date().toISOString(), settings: await getSettings(), reviews: await allReviews() });
  }
  // 복원: 이미 있는 검토(같은 파일 해시 + 같은 검토 시각)는 건너뛴다. 추가된 개수를 돌려준다.
  async function importBackup(json) {
    const data = JSON.parse(json);
    if (data.app !== 'RefCheck' || !Array.isArray(data.reviews)) throw new Error('RefCheck 백업 파일이 아닙니다.');
    const have = new Set((await allReviews()).map(r => r.fileHash + '|' + r.createdAt));
    let added = 0;
    for (const r of data.reviews) {
      if (have.has(r.fileHash + '|' + r.createdAt)) continue;
      const copy = Object.assign({}, r); delete copy.id;
      await putReview(copy); added++;
    }
    for (const k of ['threshold', 'mailto', 'similarCount']) if (data.settings && data.settings[k] !== undefined) await setSetting(k, data.settings[k]);
    return added;
  }

  return { requestPersist, putReview, getReview, allReviews, deleteReview, cacheGet, cacheSet, getSettings, setSetting, exportBackup, importBackup };
})();
