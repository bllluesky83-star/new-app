// 결과 요약 보고서: 검토 결과에서 핵심 수치와 종합 의견 문장을 자동으로 뽑아
// A4 한 장짜리 보고서(인쇄·PDF 저장), Markdown, Excel "요약" 시트로 내보낸다.
var RC = window.RC || (window.RC = {});

RC.report = (function () {
  const T = RC.text, esc = T.esc;
  const pct = x => Math.round((x || 0) * 100);
  const cut = (s, n) => (s || '').length > n ? s.slice(0, n - 1) + '…' : (s || '');

  // 사유 문구를 종류별로 묶는다 ("(참고)"는 판정에 영향이 없어 뺀다)
  const KINDS = [
    ['존재 확인 불가', /^존재 확인 불가/], ['제목 불일치', /^제목 불일치/], ['DOI 오류', /^DOI 오류/],
    ['연도 불일치(경미)', /^\(경미\) 연도 불일치/], ['연도 불일치', /^연도 불일치/], ['제1저자 불일치', /^제1저자 불일치/]
  ];
  function reasonKinds(reason) {
    return (reason || '').split(' / ').map(p => p.trim()).filter(p => p && !p.startsWith('(참고)'))
      .map(p => (KINDS.find(k => k[1].test(p)) || [p.split(':')[0]])[0]);
  }

  function summarize(r, threshold) {
    const refs = r.references || [];
    const o = refs.filter(x => x.verdict === 'O').length;
    const xs = refs.filter(x => x.verdict === 'X');
    const qs = refs.filter(x => x.verdict === '?');
    const kinds = {};
    xs.forEach(x => reasonKinds(x.reason).forEach(k => { kinds[k] = (kinds[k] || 0) + 1; }));

    const d = r.duplicate || { score: 0, top: [], compared: { external: 0, internal: 0 } };
    const dupPct = pct(d.score), warn = dupPct >= threshold;
    const best = (d.top || [])[0];

    const now = new Date().getFullYear();
    const sim = (r.similar || []).slice();
    const recent = sim.filter(s => s.year && s.year >= now - 3);
    const simTop = sim.slice().sort((a, b) => b.similarity - a.similarity).slice(0, 5);

    // ---- 종합 의견 문장 ----
    const lines = [];
    if (best) {
      const who = best.type === 'internal' ? '이전에 검토한 투고 원고' : '외부 논문';
      // 제목 끝 글자에 따라 조사가 달라지지 않도록 "대상은 …인 「제목」이며" 형태로 쓴다
      lines.push(warn
        ? `중복성: 가장 비슷한 대상은 ${who}인 「${cut(best.title, 60)}」이며, 유사도 ${dupPct}%로 기준(${threshold}%)을 넘습니다.` +
          (best.sameFile ? ' 이전에 검토한 파일과 동일한 파일입니다.' : best.phrases && best.phrases.length ? ` 겹치는 구절 ${best.phrases.length}곳을 확인해 주세요.` : '')
        : `중복성: 가장 높은 유사도는 ${dupPct}%(${who} 「${cut(best.title, 60)}」)로 기준(${threshold}%) 미만입니다.`);
    } else lines.push('중복성: 비교할 대상이 없어 유사도를 계산하지 못했습니다.');

    if (refs.length) {
      const kindText = Object.entries(kinds).map(([k, n]) => `${k} ${n}건`).join(', ');
      lines.push(`참고문헌: 전체 ${refs.length}건 중 ${o}건을 확인(O)했고, ` +
        (xs.length ? `${xs.length}건에 이상(X)이 있습니다 (${kindText}).` : '이상(X)은 없습니다.') +
        (qs.length ? ` ${qs.length}건은 자동으로 확인하지 못해 직접 확인이 필요합니다.` : ''));
    } else lines.push('참고문헌: 원고에서 참고문헌 목록을 찾지 못했습니다.');

    if (sim.length) {
      const top = simTop[0];
      lines.push(`유사 연구: 비슷한 주제의 논문 ${sim.length}편을 찾았고 그중 최근 3년 이내가 ${recent.length}편입니다. ` +
        `가장 유사한 논문은 「${cut(top.title, 60)}」(${top.year || '연도 미상'}, 유사도 ${pct(top.similarity)}%)입니다.`);
    } else lines.push('유사 연구: 검색 결과가 없습니다' + (r.similarError ? ' (검색 실패)' : '') + '.');

    // 종합 판단: 중복성 주의 또는 참고문헌 X가 있으면 "확인 필요"
    const needs = [];
    if (warn) needs.push('중복성');
    if (xs.length) needs.push('참고문헌 ' + xs.length + '건');
    if (qs.length) needs.push('미확인 참고문헌 ' + qs.length + '건');
    const verdict = needs.length ? { level: 'check', text: '확인 필요 — ' + needs.join(', ') } : { level: 'ok', text: '특이사항 없음' };

    return { refs: { total: refs.length, o, x: xs.length, q: qs.length, kinds, xs, qs }, dup: { pct: dupPct, warn, threshold, top: d.top || [], compared: d.compared || {} },
      sim: { total: sim.length, recent: recent.length, top: simTop }, lines, verdict };
  }

  // ---- A4 보고서 (새 창으로 열어 인쇄·PDF 저장) ----
  function html(r, threshold) {
    const S = summarize(r, threshold);
    const day = RC.localTime(r.createdAt);
    const xrows = S.refs.xs.concat(S.refs.qs).map(x => `<tr class="${x.verdict === 'X' ? 'x' : 'q'}"><td class="c">${x.verdict === '?' ? '–' : 'X'}</td><td class="c">${x.idx}</td><td>${esc(cut(x.raw, 140))}</td><td>${esc(x.reason || '')}</td></tr>`).join('');
    const drows = S.dup.top.map((m, i) => `<tr><td class="c">${i + 1}</td><td class="c">${m.type === 'internal' ? '이전 투고' : '외부 논문'}</td><td>${esc(cut(m.title, 90))}</td><td class="c">${esc(m.year || '')}</td><td class="c"><b>${pct(m.score)}%</b></td></tr>`).join('');
    const srows = S.sim.top.map((s, i) => `<tr><td class="c">${i + 1}</td><td>${esc(cut(s.title, 90))}<div class="sub">${esc(cut(s.authors, 60))}${s.venue ? ' · ' + esc(cut(s.venue, 40)) : ''}</div></td><td class="c">${esc(s.year || '')}</td><td class="c">${s.citations}</td><td class="c"><b>${pct(s.similarity)}%</b></td></tr>`).join('');
    const md = markdown(r, threshold);
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>검토 요약 보고서 - ${esc(cut(r.title, 40))}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700&family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  :root { --ink:#18232e; --ink2:#3e4c5a; --muted:#6c7b8a; --rule:#cfe0ee; --navy:#1f4e79; --deep:#15385a; --bad:#9b2335; --bads:#fbe9ec; --ok:#2d6a4a; --oks:#e3f3ea; --warn:#8a5a12; --sky:#e6f2fb; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #dfe9f2; color: var(--ink); font: 10.5pt/1.6 "Noto Sans KR", "Malgun Gothic", sans-serif; word-break: keep-all; }
  .bar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: center; padding: 10px; background: var(--deep); }
  .bar button { font: 600 13px "Noto Sans KR", sans-serif; border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; background: #fff; color: var(--deep); }
  .bar button.primary { background: #9cc7ef; }
  .page { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; padding: 14mm; box-shadow: 0 6px 24px rgba(21,56,90,.18); }
  h1, h2 { font-family: "Noto Serif KR", "Batang", serif; margin: 0; }
  .kicker { font: 700 8.5pt "Noto Sans KR", sans-serif; letter-spacing: .18em; color: var(--navy); }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 8px; margin-bottom: 12px; }
  header h1 { font-size: 17pt; margin: 4px 0 2px; }
  .title-en { font-family: "Noto Serif KR", serif; font-style: italic; color: var(--ink2); }
  .meta { color: var(--muted); font-size: 9pt; margin-top: 4px; }
  .verdict { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 8px; margin: 10px 0 12px; font-weight: 700; }
  .verdict.check { background: var(--bads); color: var(--bad); } .verdict.ok { background: var(--oks); color: var(--ok); }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; margin-bottom: 12px; }
  .stat { padding: 8px 12px; border-right: 1px solid var(--rule); background: #f4f9fd; }
  .stat:last-child { border-right: 0; }
  .stat .l { font: 700 8pt "Noto Sans KR", sans-serif; color: var(--muted); letter-spacing: .06em; }
  .stat .v { font: 700 18pt/1.3 "Noto Serif KR", serif; }
  .stat .s { font-size: 8.5pt; color: var(--ink2); }
  .bad { color: var(--bad); } .good { color: var(--ok); }
  h2 { font-size: 12pt; margin: 14px 0 6px; } h2 .n { color: var(--navy); margin-right: 6px; }
  ol.opinion { margin: 0; padding-left: 18px; } ol.opinion li { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; border-top: 1.5px solid var(--ink); border-bottom: 1.5px solid var(--ink); font-size: 9pt; }
  th { text-align: left; font-weight: 700; color: var(--ink2); padding: 4px 6px; border-bottom: 1px solid var(--ink); }
  td { padding: 4px 6px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  tr:last-child td { border-bottom: 0; } td.c { text-align: center; white-space: nowrap; }
  tr.x td { background: var(--bads); } tr.x td:first-child { color: var(--bad); font-weight: 700; } tr.q td:first-child { color: var(--warn); font-weight: 700; }
  .sub { color: var(--muted); font-size: 8pt; }
  .memo { white-space: pre-wrap; border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; min-height: 40px; }
  .none { color: var(--muted); }
  footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 8pt; }
  @media print { body { background: #fff; } .bar { display: none; } .page { margin: 0; box-shadow: none; width: auto; min-height: 0; padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head><body>
<div class="bar"><button class="primary" onclick="window.print()">인쇄 / PDF로 저장</button><button id="mdBtn">Markdown 저장</button><button id="copyBtn">종합 의견 복사</button></div>
<div class="page">
  <header>
    <div class="kicker">REFCHECK · 검토 요약 보고서</div>
    <h1>${esc(r.title)}</h1>
    ${r.titleEn && r.titleEn !== r.title ? `<div class="title-en">${esc(r.titleEn)}</div>` : ''}
    <div class="meta">${esc(r.filename)} · ${r.numPages || '?'}쪽 · 검토 ${esc(day)}${(r.keywords || []).length ? ' · Keywords: ' + esc(r.keywords.join(', ')) : ''}</div>
  </header>
  <div class="verdict ${S.verdict.level}">종합 판단: ${esc(S.verdict.text)}</div>
  <div class="stats">
    <div class="stat"><div class="l">I. 중복성</div><div class="v ${S.dup.warn ? 'bad' : 'good'}">${S.dup.pct}%</div><div class="s">${S.dup.warn ? '주의' : '기준 미만'} (기준 ${threshold}%)</div></div>
    <div class="stat"><div class="l">II. 참고문헌</div><div class="v"><span class="good">O ${S.refs.o}</span> / <span class="bad">X ${S.refs.x}</span></div><div class="s">전체 ${S.refs.total}건${S.refs.q ? ' · 확인 못 함 ' + S.refs.q + '건' : ''}</div></div>
    <div class="stat"><div class="l">III. 유사 연구</div><div class="v">${S.sim.total}편</div><div class="s">최근 3년 ${S.sim.recent}편</div></div>
  </div>
  <h2>종합 의견 <span class="sub">(자동 생성)</span></h2>
  <ol class="opinion">${S.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>
  <h2><span class="n">I.</span>유사도 상위 대상</h2>
  ${drows ? `<table><thead><tr><th>순위</th><th>구분</th><th>제목</th><th>연도/검토일</th><th>유사도</th></tr></thead><tbody>${drows}</tbody></table>` : '<p class="none">비교한 대상이 없습니다.</p>'}
  <h2><span class="n">II.</span>확인이 필요한 참고문헌</h2>
  ${xrows ? `<table><thead><tr><th>판정</th><th>번호</th><th>원문</th><th>사유</th></tr></thead><tbody>${xrows}</tbody></table>` : '<p class="none">이상이 있는 참고문헌이 없습니다.</p>'}
  <h2><span class="n">III.</span>유사 주제 연구 (유사도 상위 5편)</h2>
  ${srows ? `<table><thead><tr><th>#</th><th>논문</th><th>연도</th><th>인용</th><th>유사도</th></tr></thead><tbody>${srows}</tbody></table>` : '<p class="none">검색 결과가 없습니다.</p>'}
  <h2>검토자 메모</h2>
  <div class="memo">${r.memo ? esc(r.memo) : '<span class="none">(없음)</span>'}</div>
  <footer>RefCheck 자동 생성 · 외부 조회: CrossRef, OpenAlex · 중복성은 초록 단위 1차 걸러내기이며 공식 표절 검사(iThenticate, KCI 문헌유사도 검사)를 대신하지 않습니다. 최종 판단은 검토자가 합니다.</footer>
</div>
<script>
  var MD = ${JSON.stringify(md).replace(/</g, '\\u003c')};
  var OPINION = ${JSON.stringify(S.lines.join('\n')).replace(/</g, '\\u003c')};
  document.getElementById('mdBtn').onclick = function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([MD], { type: 'text/markdown' }));
    a.download = ${JSON.stringify(fileBase(r) + '.md')};
    a.click();
  };
  document.getElementById('copyBtn').onclick = function () {
    var b = this;
    function done() { b.textContent = '복사했습니다'; setTimeout(function () { b.textContent = '종합 의견 복사'; }, 1500); }
    if (navigator.clipboard) navigator.clipboard.writeText(OPINION).then(done, fallback); else fallback();
    function fallback() { var t = document.createElement('textarea'); t.value = OPINION; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); }
  };
</script></body></html>`;
  }

  function markdown(r, threshold) {
    const S = summarize(r, threshold);
    const L = [];
    L.push(`# 검토 요약 보고서: ${r.title}`, '');
    if (r.titleEn && r.titleEn !== r.title) L.push(`*${r.titleEn}*`, '');
    L.push(`- 파일: ${r.filename} (${r.numPages || '?'}쪽)`, `- 검토일: ${RC.localTime(r.createdAt)}`);
    if ((r.keywords || []).length) L.push(`- 키워드: ${r.keywords.join(', ')}`);
    L.push('', `**종합 판단: ${S.verdict.text}**`, '', '| 항목 | 결과 |', '|---|---|',
      `| I. 중복성 | ${S.dup.pct}% (${S.dup.warn ? '주의' : '기준 미만'}, 기준 ${threshold}%) |`,
      `| II. 참고문헌 | 전체 ${S.refs.total}건 · O ${S.refs.o} · X ${S.refs.x}${S.refs.q ? ' · 확인 못 함 ' + S.refs.q : ''} |`,
      `| III. 유사 연구 | ${S.sim.total}편 (최근 3년 ${S.sim.recent}편) |`, '', '## 종합 의견', '');
    S.lines.forEach((l, i) => L.push(`${i + 1}. ${l}`));
    L.push('', '## I. 유사도 상위 대상', '');
    if (S.dup.top.length) { L.push('| 순위 | 구분 | 제목 | 유사도 |', '|---|---|---|---|'); S.dup.top.forEach((m, i) => L.push(`| ${i + 1} | ${m.type === 'internal' ? '이전 투고' : '외부 논문'} | ${mdCell(m.title)} | ${pct(m.score)}% |`)); }
    else L.push('비교한 대상이 없습니다.');
    L.push('', '## II. 확인이 필요한 참고문헌', '');
    const xq = S.refs.xs.concat(S.refs.qs);
    if (xq.length) { L.push('| 판정 | 번호 | 원문 | 사유 |', '|---|---|---|---|'); xq.forEach(x => L.push(`| ${x.verdict === '?' ? '–' : 'X'} | ${x.idx} | ${mdCell(cut(x.raw, 140))} | ${mdCell(x.reason)} |`)); }
    else L.push('이상이 있는 참고문헌이 없습니다.');
    L.push('', '## III. 유사 주제 연구 (유사도 상위 5편)', '');
    if (S.sim.top.length) { L.push('| # | 논문 | 연도 | 인용 | 유사도 |', '|---|---|---|---|---|'); S.sim.top.forEach((s, i) => L.push(`| ${i + 1} | ${mdCell(s.title)} | ${s.year || ''} | ${s.citations} | ${pct(s.similarity)}% |`)); }
    else L.push('검색 결과가 없습니다.');
    L.push('', '## 검토자 메모', '', r.memo || '(없음)', '', '---', '*RefCheck 자동 생성. 중복성은 초록 단위 1차 걸러내기이며 공식 표절 검사를 대신하지 않습니다.*', '');
    return L.join('\n');
  }
  const mdCell = s => (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  function fileBase(r) {
    return 'RefCheck_요약_' + (r.title || 'review').replace(/[\\/:*?"<>|]/g, '').slice(0, 40).trim() + '_' + RC.localTime(r.createdAt, true);
  }

  // 새 창에 보고서를 연다 (팝업이 막히면 HTML 파일로 내려받는다)
  function open(r, threshold) {
    const doc = html(r, threshold);
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(doc); w.document.close(); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    a.download = fileBase(r) + '.html';
    a.click();
  }

  return { summarize, html, markdown, open };
})();
