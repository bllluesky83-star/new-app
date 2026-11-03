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

  // 검토 이력: Supabase에 로그인해 있으면 Supabase, 아니면 이 브라우저(IndexedDB)
  const cloudOn = () => !!(RC.cloud && RC.cloud.active());
  const localPut = r => tx('reviews', 'readwrite', s => s.put(r));
  const localAll = () => tx('reviews', 'readonly', s => s.getAll());
  const putReview = r => cloudOn() ? RC.cloud.putReview(r) : localPut(r);
  const getReview = id => cloudOn() ? RC.cloud.getReview(id) : tx('reviews', 'readonly', s => s.get(Number(id)));
  const allReviews = () => cloudOn() ? RC.cloud.allReviews() : localAll();
  const deleteReview = id => cloudOn() ? RC.cloud.deleteReview(id) : tx('reviews', 'readwrite', s => s.delete(Number(id)));
  // 같은 검토인지: 파일 해시 + 검토 시각 (시각은 저장 형식이 달라도 같게 비교)
  const sameKey = r => r.fileHash + '|' + Date.parse(r.createdAt);

  // 이 브라우저에 저장된 검토 중 Supabase에 없는 것을 올린다. 올린 개수를 돌려준다.
  async function migrateLocalToCloud(onProgress) {
    if (!cloudOn()) throw new Error('먼저 Supabase에 로그인해 주세요.');
    const have = new Set((await RC.cloud.allReviews()).map(sameKey));
    const todo = (await localAll()).filter(r => !have.has(sameKey(r)));
    let n = 0;
    for (const r of todo) {
      const copy = Object.assign({}, r); delete copy.id;
      await RC.cloud.putReview(copy);
      n++; if (onProgress) onProgress(n, todo.length);
    }
    return n;
  }
  const localCount = async () => (await localAll()).length;

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

  // 설정: 이 브라우저에 늘 저장하고, 로그인해 있으면 Supabase 값을 우선한다
  async function getSettings() {
    const rows = await tx('settings', 'readonly', s => s.getAll());
    const out = { threshold: 40, mailto: '', similarCount: 20 };
    for (const r of rows || []) out[r.key] = r.value;
    if (cloudOn()) Object.assign(out, await RC.cloud.getSettings() || {});
    return out;
  }
  async function setSetting(key, value) {
    await tx('settings', 'readwrite', s => s.put({ key, value }));
  }
  async function saveSettings(s) {
    for (const k of ['threshold', 'mailto', 'similarCount']) await setSetting(k, s[k]);
    if (cloudOn()) await RC.cloud.saveSettings(s);
  }

  // 백업: 검토 이력과 설정만 (API 캐시는 다시 받으면 되므로 뺀다)
  async function exportBackup() {
    const reviews = cloudOn() ? await RC.cloud.allReviewsFull() : await localAll();
    return JSON.stringify({ app: 'RefCheck', version: 1, exportedAt: new Date().toISOString(), settings: await getSettings(), reviews });
  }
  // 복원: 이미 있는 검토(같은 파일 해시 + 같은 검토 시각)는 건너뛴다. 추가된 개수를 돌려준다.
  async function importBackup(json) {
    const data = JSON.parse(json);
    if (data.app !== 'RefCheck' || !Array.isArray(data.reviews)) throw new Error('RefCheck 백업 파일이 아닙니다.');
    const have = new Set((await allReviews()).map(sameKey));
    let added = 0;
    for (const r of data.reviews) {
      if (have.has(sameKey(r))) continue;
      const copy = Object.assign({}, r); delete copy.id;
      await putReview(copy); added++;
    }
    if (data.settings) await saveSettings(Object.assign(await getSettings(), data.settings));
    return added;
  }

  return { requestPersist, putReview, getReview, allReviews, deleteReview, cacheGet, cacheSet, getSettings, setSetting, saveSettings,
    exportBackup, importBackup, migrateLocalToCloud, localCount };
})();
