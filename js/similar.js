// 기능 3: OpenAlex에서 비슷한 주제의 논문을 찾아 투고 논문과의 TF-IDF 유사도를 매긴다.
var RC = window.RC || (window.RC = {});

RC.similar = (function () {
  const T = RC.text;

  // paper: { title, titleEn, abstract, keywords }
  async function find(paper, count) {
    count = count || 20;
    const title = paper.titleEn || paper.title;
    const kw = (paper.keywords || []).filter(k => /^[\x00-\x7F]+$/.test(k));
    const base = [paper.title, paper.titleEn, paper.abstract, paper.abstractKo, (paper.keywords || []).join(' ')].join(' ');

    // 검색어는 짧을수록 결과가 많이 나온다: ① 제목 핵심어 ② 키워드 ③ 초록 핵심어 순으로 모은다
    const titleTerms = T.words(title).filter(w => !T.STOP.has(w) && w.length > 2).slice(0, 8).join(' ');
    const queries = [titleTerms];
    if (kw.length) queries.push(kw.slice(0, 4).join(' '));
    queries.push(T.topTerms(paper.abstract || title, 6).join(' '));

    const seen = new Map();
    for (const q of queries) {
      if (!q.trim()) continue;
      const res = await RC.api.openalexSearch(q, { perPage: 50, filter: 'has_abstract:true' });
      for (const w of res) if (w.title && !seen.has(w.title.toLowerCase())) seen.set(w.title.toLowerCase(), w);
      if (seen.size >= 60) break;
    }
    const list = [...seen.values()];
    if (!list.length) return [];
    const sims = T.similarities(base, list.map(w => w.title + ' ' + (w.abstract || '')));
    list.forEach((w, i) => { w.similarity = sims[i]; });
    return list.sort((a, b) => b.similarity - a.similarity).slice(0, count).map(w => ({
      title: w.title, authors: w.authors.slice(0, 4).map(a => a.full).join(', ') + (w.authors.length > 4 ? ' 외' : ''),
      year: w.year, date: w.date, venue: w.venue, citations: w.citations, similarity: w.similarity, url: w.url, abstract: w.abstract
    }));
  }

  return { find };
})();
