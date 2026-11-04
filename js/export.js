// 검토 결과를 Excel(.xlsx)로 내보낸다. 시트 3개: 중복성 / Reference / 유사연구
var RC = window.RC || (window.RC = {});

RC.exporter = (function () {
  const pct = x => Math.round((x || 0) * 100);

  function toXlsx(review, opts) {
    const day = RC.localTime(review.createdAt, true);
    const head = [['논문 제목', review.title], ['검토일', day], ['파일명', review.filename], ['메모', review.memo || '']];

    const d = review.duplicate;
    const dup = head.concat([[], ['전체 유사도(%)', pct(d.score)], ['판정', pct(d.score) >= opts.threshold ? '주의 (기준 ' + opts.threshold + '% 이상)' : '정상 (기준 ' + opts.threshold + '% 미만)'],
      ['비교 대상', '외부 논문 초록 ' + d.compared.external + '편, 이전 투고 ' + d.compared.internal + '편'], [],
      ['순위', '구분', '제목', '연도/검토일', '유사도(%)', '링크', '겹치는 구절']]);
    d.top.forEach((m, i) => dup.push([i + 1, m.type === 'internal' ? '이전 투고' + (m.sameFile ? ' (동일 파일)' : '') : '외부 논문', m.title, m.year || '', pct(m.score), m.url || m.filename || '', m.phrases.join(' / ')]));

    const refs = review.references.slice().sort(refOrder);
    const o = refs.filter(r => r.verdict === 'O').length, x = refs.filter(r => r.verdict === 'X').length, q = refs.length - o - x;
    const ref = head.concat([[], ['요약', '전체 ' + refs.length + '건 중 O ' + o + '건 / X ' + x + '건' + (q ? ' / 확인 못 함 ' + q + '건' : '')], [],
      ['판정', '번호', '사유', '원문', '찾은 논문', '찾은 논문 연도', '링크']]);
    refs.forEach(r => ref.push([r.verdict === '?' ? '확인 못 함' : r.verdict, r.idx, r.reason || '', r.raw, r.candidate ? r.candidate.title : '', r.candidate ? r.candidate.year : '', r.candidate ? r.candidate.url : '']));

    const sim = head.concat([[], ['제목', '저자', '연도', '저널·학회', '인용 수', '유사도(%)', '링크']]);
    (opts.similarRows || review.similar).forEach(s => sim.push([s.title, s.authors, s.year, s.venue, s.citations, pct(s.similarity), s.url]));

    // 맨 앞 "요약" 시트: 요약 보고서와 같은 종합 판단·수치·의견
    const S = RC.report.summarize(review, opts.threshold);
    const sum = head.concat([[], ['종합 판단', S.verdict.text],
      ['I. 중복성', S.dup.pct + '% (' + (S.dup.warn ? '주의' : '기준 미만') + ', 기준 ' + opts.threshold + '%)'],
      ['II. 참고문헌', '전체 ' + S.refs.total + '건 · O ' + S.refs.o + ' · X ' + S.refs.x + (S.refs.q ? ' · 확인 못 함 ' + S.refs.q : '')],
      ['III. 유사 연구', S.sim.total + '편 (최근 3년 ' + S.sim.recent + '편)'], [], ['종합 의견 (자동 생성)']])
      .concat(S.lines.map((l, i) => [i + 1, l]));

    const wb = XLSX.utils.book_new();
    const add = (rows, name, widths) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = widths.map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add(sum, '요약', [16, 120]);
    add(dup, '중복성', [14, 16, 60, 12, 10, 40, 60]);
    add(ref, 'Reference', [10, 6, 50, 80, 60, 12, 40]);
    add(sim, '유사연구', [70, 40, 8, 40, 10, 10, 40]);

    const safe = (review.title || 'review').replace(/[\\/:*?"<>|]/g, '').slice(0, 40).trim();
    XLSX.writeFile(wb, 'RefCheck_' + safe + '_' + day + '.xlsx');
  }

  // X → 확인 못 함 → O 순서, 같은 판정 안에서는 번호순
  function refOrder(a, b) {
    const rank = v => (v === 'X' ? 0 : v === '?' ? 1 : 2);
    return rank(a.verdict) - rank(b.verdict) || a.idx - b.idx;
  }

  return { toXlsx, refOrder };
})();
