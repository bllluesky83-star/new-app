// CrossRef / OpenAlex 호출. 동시 요청 수 제한, 재시도, IndexedDB 캐시, 응답을 공통 형태로 바꾸기.
// (Semantic Scholar는 API 키 없이 쓰는 공용 한도가 자주 차 있어서 MVP에서는 쓰지 않는다)
var RC = window.RC || (window.RC = {});

RC.api = (function () {
  let mailto = '';
  // 서버별 동시 요청 수와 요청 간격. CrossRef 공용 서버는 동시 요청을 1개로 제한하고 초과하면 연결을 끊는다
  // (이메일을 붙이면 3개까지 허용).
  const hosts = {
    'api.crossref.org': { max: 1, gap: 150 },
    'api.openalex.org': { max: 5, gap: 50 }
  };
  for (const h in hosts) Object.assign(hosts[h], { running: 0, queue: [], last: 0 });

  function setMailto(m) {
    mailto = (m || '').trim();
    hosts['api.crossref.org'].max = mailto ? 3 : 1;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function limited(url, fn) {
    const h = hosts[new URL(url).host] || hosts['api.openalex.org'];
    return new Promise((resolve, reject) => {
      const run = async () => {
        h.running++;
        const wait = h.last + h.gap - Date.now();
        if (wait > 0) await sleep(wait);
        h.last = Date.now();
        fn().then(resolve, reject).finally(() => { h.running--; if (h.queue.length && h.running < h.max) h.queue.shift()(); });
      };
      if (h.running < h.max) run(); else h.queue.push(run);
    });
  }

  // 결과: JSON, 없으면(404) null. 네트워크 실패가 계속되면 예외.
  async function getJSON(url) {
    const cached = await RC.store.cacheGet(url);
    if (cached !== undefined) return cached;
    const full = mailto ? url + (url.includes('?') ? '&' : '?') + 'mailto=' + encodeURIComponent(mailto) : url;
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await limited(full, async () => {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 10000);
          try { return await fetch(full, { signal: ctl.signal }); } finally { clearTimeout(timer); }
        });
        if (res.status === 404) { await RC.store.cacheSet(url, null); return null; }
        if (res.status === 429) { lastErr = new Error('호출 한도 초과(429)'); await sleep(3000 * (attempt + 1)); continue; }
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); await sleep(1000 * Math.pow(2, attempt)); continue; }
        const json = await res.json();
        await RC.store.cacheSet(url, json);
        return json;
      } catch (e) {
        // 한도 초과 응답에는 CORS 헤더가 없어 브라우저가 "Failed to fetch"로만 알려주므로 길게 기다렸다가 다시 시도
        lastErr = e.name === 'AbortError' ? new Error('응답 시간 초과') : new Error('연결 실패 또는 호출 한도 초과');
        await sleep(2000 * Math.pow(2, attempt));
      }
    }
    throw lastErr;
  }

  // ---- CrossRef ----
  const CR = 'https://api.crossref.org/works';
  const CR_SELECT = 'DOI,title,author,issued,published-print,published-online,container-title,type,URL,is-referenced-by-count';

  function fromCrossref(it) {
    const yearOf = k => (it[k] && it[k]['date-parts'] && it[k]['date-parts'][0] && it[k]['date-parts'][0][0]) || null;
    // 온라인 선공개 연도와 인쇄 연도가 다른 논문이 많아서 둘 다 기억해 둔다
    const years = [...new Set(['issued', 'published-print', 'published-online'].map(yearOf).filter(Boolean))];
    return {
      source: 'CrossRef',
      title: (it.title && it.title[0]) || '',
      authors: (it.author || []).map(a => ({ family: a.family || a.name || '', full: [a.given, a.family].filter(Boolean).join(' ') || a.name || '' })),
      year: yearOf('published-print') || yearOf('issued'),
      years,
      venue: (it['container-title'] && it['container-title'][0]) || '',
      doi: (it.DOI || '').toLowerCase(),
      url: it.DOI ? 'https://doi.org/' + it.DOI : (it.URL || ''),
      citations: it['is-referenced-by-count'] || 0,
      type: it.type || '',
      isPreprint: it.type === 'posted-content'
    };
  }
  async function crossrefSearch(raw, rows) {
    const q = raw.replace(/https?:\/\/\S+/g, ' ').slice(0, 400);
    const j = await getJSON(CR + '?rows=' + (rows || 3) + '&select=' + CR_SELECT + '&query.bibliographic=' + encodeURIComponent(q));
    return j && j.message && j.message.items ? j.message.items.map(fromCrossref) : [];
  }
  async function crossrefDoi(doi) {
    const j = await getJSON(CR + '/' + encodeURIComponent(doi));
    return j && j.message ? fromCrossref(j.message) : null;
  }

  // ---- OpenAlex ----
  const OA = 'https://api.openalex.org/works';
  const OA_SELECT = 'id,doi,display_name,publication_year,publication_date,authorships,primary_location,cited_by_count,abstract_inverted_index,type';

  function abstractFromIndex(inv) {
    if (!inv) return '';
    const pos = [];
    for (const w in inv) for (const p of inv[w]) pos[p] = w;
    return pos.filter(Boolean).join(' ');
  }
  function fromOpenAlex(it) {
    const src = it.primary_location && it.primary_location.source;
    const doi = (it.doi || '').replace('https://doi.org/', '').toLowerCase();
    return {
      source: 'OpenAlex',
      title: it.display_name || '',
      authors: (it.authorships || []).map(a => {
        const full = (a.author && a.author.display_name) || a.raw_author_name || '';
        return { family: full.split(' ').slice(-1)[0] || '', full };
      }),
      year: it.publication_year || null,
      date: it.publication_date || '',
      venue: (src && src.display_name) || '',
      doi,
      url: doi ? 'https://doi.org/' + doi : (it.id || ''),
      citations: it.cited_by_count || 0,
      type: it.type || '',
      isPreprint: it.type === 'preprint' || /arxiv|rxiv|ssrn/i.test((src && src.display_name) || ''),
      abstract: abstractFromIndex(it.abstract_inverted_index)
    };
  }
  function cleanQuery(s) {
    return (s || '').replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}\s\-]/gu, ' ').replace(/\s+/g, ' ').trim();
  }
  async function openalexSearch(query, opts) {
    opts = opts || {};
    const q = cleanQuery(query).split(' ').slice(0, 30).join(' ');
    if (!q) return [];
    let url = OA + '?per-page=' + (opts.perPage || 5) + '&select=' + OA_SELECT + '&search=' + encodeURIComponent(q);
    if (opts.filter) url += '&filter=' + opts.filter;
    const j = await getJSON(url);
    return j && j.results ? j.results.map(fromOpenAlex) : [];
  }
  async function openalexDoi(doi) {
    const j = await getJSON(OA + '/doi:' + encodeURIComponent(doi) + '?select=' + OA_SELECT);
    return j ? fromOpenAlex(j) : null;
  }

  return { setMailto, crossrefSearch, crossrefDoi, openalexSearch, openalexDoi, cleanQuery };
})();
