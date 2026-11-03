// 기능 1: 투고 논문을 ① 유사 논문 초록(외부) ② 이전에 검토한 투고 논문(내부)과 비교한다.
var RC = window.RC || (window.RC = {});

RC.duplicate = (function () {
  const T = RC.text;

  // paper: 현재 논문, similar: 기능 3 결과, previous: 저장된 이전 검토들
  function check(paper, similar, previous) {
    const absText = [paper.title, paper.titleEn !== paper.title ? paper.titleEn : '', paper.abstract, paper.abstractKo].join(' ');
    const fullText = [paper.title, paper.abstract, paper.abstractKo, paper.bodyExcerpt].join(' ');
    const matches = [];

    // 외부 논문은 초록만 있으므로 제목+초록끼리 비교
    if (similar.length) {
      const sims = T.similarities(absText, similar.map(s => s.title + ' ' + (s.abstract || '')));
      similar.forEach((s, i) => matches.push({
        type: 'external', title: s.title, year: s.year, url: s.url, score: sims[i], text: s.abstract || ''
      }));
    }
    // 이전 투고 논문은 본문 앞부분까지 비교
    if (previous.length) {
      const sims = T.similarities(fullText, previous.map(p => [p.title, p.abstract, p.abstractKo, p.bodyExcerpt].join(' ')));
      previous.forEach((p, i) => matches.push({
        type: 'internal', reviewId: p.id, title: p.title, year: p.createdAt ? RC.localTime(p.createdAt, true) : '', filename: p.filename,
        sameFile: p.fileHash === paper.fileHash, score: sims[i], text: [p.abstract, p.abstractKo, p.bodyExcerpt].filter(Boolean).join(' ')
      }));
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, 5).map(m => {
      const base = m.type === 'internal' ? fullText : absText;
      const ov = T.overlaps(base, m.text, 5);
      return {
        type: m.type, reviewId: m.reviewId, title: m.title, year: m.year, url: m.url, filename: m.filename, sameFile: !!m.sameFile,
        score: m.score, phrases: ov.phrases.slice(0, 8), excerpt: m.text.slice(0, 1500),
        spans: ov.spans.filter(([a]) => a < 1500).map(([a, b]) => [a, Math.min(b, 1500)])
      };
    });
    return {
      score: top.length ? top[0].score : 0,
      compared: { external: similar.length, internal: previous.length },
      sameFileReviewIds: previous.filter(p => p.fileHash === paper.fileHash).map(p => p.id),
      top
    };
  }

  return { check };
})();
