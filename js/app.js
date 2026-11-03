// 화면 연결: 업로드 → 분석 → 저장 → 탭 3개 표시, 검토 이력, 메모, 설정, 내보내기, 백업/복원.
(function () {
  const T = RC.text, esc = T.esc;
  const $ = id => document.getElementById(id);
  const icon = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let settings = { threshold: 40, mailto: '', similarCount: 20 };
  let current = null; // 지금 화면에 보이는 검토
  const simView = { sort: 'date', period: 'all' };

  init();
  RC.app = { analyze }; // 점검 페이지(tests/)에서 파일 선택 없이 분석을 돌리기 위해 노출

  async function init() {
    RC.store.requestPersist();
    settings = await RC.store.getSettings();
    RC.api.setMailto(settings.mailto);
    await refreshHistory();

    for (const id of ['fileInput', 'fileInput2']) {
      $(id).addEventListener('change', e => { if (e.target.files[0]) analyze(e.target.files[0]); e.target.value = ''; });
    }
    // 아이콘 버튼으로 만든 <label>은 키보드(Enter·Space)로도 파일 선택이 열리게 한다
    document.querySelectorAll('label.btn[tabindex]').forEach(l => l.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); l.querySelector('input').click(); }
    }));
    document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
    document.addEventListener('drop', e => {
      e.preventDefault(); document.body.classList.remove('dragging');
      const f = [...e.dataTransfer.files].find(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
      if (f) analyze(f);
    });
    $('historySelect').addEventListener('change', async e => {
      if (!e.target.value) return;
      const r = await RC.store.getReview(+e.target.value);
      if (r) show(r);
    });
    // 초록·추출 정보·메모 팝업: 하나를 열면 나머지는 닫고, 바깥을 누르면 닫는다
    const pops = [...document.querySelectorAll('details.pop')];
    pops.forEach(p => p.addEventListener('toggle', () => { if (p.open) pops.forEach(q => { if (q !== p) q.open = false; }); }));
    document.addEventListener('click', e => { if (!e.target.closest('details.pop')) pops.forEach(p => { p.open = false; }); });
    let memoTimer;
    $('memo').addEventListener('input', () => {
      if (!current) return;
      current.memo = $('memo').value;
      clearTimeout(memoTimer);
      memoTimer = setTimeout(() => RC.store.putReview(current), 400);
    });
    $('exportBtn').addEventListener('click', () => current && RC.exporter.toXlsx(current, { threshold: settings.threshold, similarRows: filteredSimilar(current) }));
    $('backupBtn').addEventListener('click', backup);
    $('restoreInput').addEventListener('change', restore);
    $('settingsBtn').addEventListener('click', openSettings);
    $('settingsDlg').addEventListener('close', saveSettings);
  }

  // ---------------- 분석 ----------------
  async function analyze(file) {
    hideError();
    $('exportBtn').disabled = true;
    const started = performance.now();
    try {
      progress('PDF 읽는 중…', 5);
      const buf = await file.arrayBuffer();
      const fileHash = await hash(buf);
      const ex = await RC.pdf.extract(buf.slice(0));
      progress('참고문헌 나누는 중…', 15);
      const parsed = RC.refs.parse(ex.refLines);

      const paper = { title: ex.title, titleEn: ex.titleEn, abstract: ex.abstract, abstractKo: ex.abstractKo, keywords: ex.keywords, bodyExcerpt: ex.bodyExcerpt, fileHash };
      let refDone = 0, refTotal = parsed.entries.length, simDone = false;
      const tick = () => progress('참고문헌 검증 ' + refDone + '/' + refTotal + ' · 유사 논문 검색 ' + (simDone ? '완료' : '중…'),
        15 + 70 * ((refTotal ? refDone / refTotal : 1) * 0.7 + (simDone ? 0.3 : 0)));
      tick();

      const [references, similar] = await Promise.all([
        RC.verify.verifyAll(parsed.entries, (d) => { refDone = d; tick(); }),
        RC.similar.find(paper, settings.similarCount).catch(e => { console.warn(e); return null; }).finally(() => { simDone = true; tick(); })
      ]);

      progress('중복성 계산 중…', 90);
      const previous = await RC.store.allReviews();
      const duplicate = RC.duplicate.check(paper, similar || [], previous);

      const review = {
        createdAt: new Date().toISOString(), filename: file.name, fileHash,
        title: ex.title, titleEn: ex.titleEn, abstract: ex.abstract, abstractKo: ex.abstractKo, keywords: ex.keywords, bodyExcerpt: ex.bodyExcerpt,
        numPages: ex.numPages, refStyle: parsed.style, refHeadingFound: ex.refHeadingFound,
        refBlock: ex.refLines.map(l => l.text).join('\n'),
        references, similar: similar || [], similarError: similar ? '' : '유사 논문 검색에 실패했습니다 (네트워크 확인)',
        duplicate, memo: '', elapsedSec: Math.round((performance.now() - started) / 100) / 10
      };
      review.id = await RC.store.putReview(review);
      $('progress').hidden = true;
      await refreshHistory(review.id);
      show(review);
    } catch (e) {
      console.error(e);
      $('progress').hidden = true;
      showError(e.message || String(e));
    }
  }

  async function hash(buf) {
    try {
      const d = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // crypto.subtle 을 못 쓰는 환경: FNV-1a 로 대신
      const a = new Uint8Array(buf); let h = 0x811c9dc5;
      for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      return 'fnv' + h.toString(16) + '-' + a.length;
    }
  }

  // ---------------- 표시 ----------------
  function show(r) {
    current = r;
    $('empty').hidden = true;
    $('result').hidden = false;
    $('exportBtn').disabled = false;
    $('memo').value = r.memo || '';
    $('historySelect').value = String(r.id);
    renderManuscript(r);
    renderExtract(r);
    renderDup(r);
    renderRef(r);
    renderSim(r);
  }

  const pct = x => Math.round((x || 0) * 100);
  const extLink = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="ext">${esc(text)}${icon('link')}</a>` : esc(text);

  // 원고 표제부: 제목·영문 제목·서지 정보 한 줄. 초록은 "초록" 팝업에.
  function renderManuscript(r) {
    $('manuscript').innerHTML = `
      <p class="kicker">Manuscript under review</p>
      <h1>${esc(r.title)}</h1>
      ${r.titleEn && r.titleEn !== r.title ? `<p class="title-en">${esc(r.titleEn)}</p>` : ''}
      <div class="meta">
        <span>${esc(r.filename)}</span><span>${r.numPages}쪽</span><span>참고문헌 ${r.references.length}건</span>
        <span>검토 ${esc(RC.localTime(r.createdAt))}</span><span>분석 ${r.elapsedSec}초</span>
        ${(r.keywords || []).length ? `<span>Keywords: ${esc(r.keywords.join(', '))}</span>` : ''}
      </div>`;
    $('abstractBody').innerHTML = r.abstract
      ? `<p style="margin:0"><span class="abs-label">Abstract</span>${esc(r.abstract)}</p>${r.abstractKo ? `<p style="margin:10px 0 0"><span class="abs-label">국문 요약</span>${esc(r.abstractKo)}</p>` : ''}`
      : '<span class="muted">초록을 찾지 못했습니다.</span>';
  }

  function renderExtract(r) {
    $('extractBody').innerHTML = `<dl class="kv">
      <dt>키워드</dt><dd>${esc((r.keywords || []).join(', ')) || '<span class="muted">못 찾음</span>'}</dd>
      <dt>참고문헌</dt><dd>${r.references.length}건 추출 (${esc(styleName(r.refStyle))})${r.refHeadingFound ? '' : ' — <b>참고문헌 제목을 찾지 못했습니다</b>'}</dd>
    </dl>
    <details><summary>참고문헌 원문 블록 보기 (추출 개수가 맞는지 확인용)</summary><pre class="raw">${esc(r.refBlock || '')}</pre></details>`;
  }
  const styleName = s => ({ bracket: '[1] 번호형', numbered: '1. 번호형', 'author-year': '저자-연도형', none: '형식 판별 불가' }[s] || s);

  // I. 중복성
  function renderDup(r) {
    const d = r.duplicate, score = pct(d.score), warn = score >= settings.threshold;
    const same = d.sameFileReviewIds && d.sameFileReviewIds.length;
    const items = d.top.map(m => `
      <li>
        <div class="cite">
          ${m.type === 'internal' ? '<span class="badge warn">이전 투고</span>' : '<span class="badge plain">외부 논문</span>'}
          <span class="title">${extLink(m.url, m.title)}</span>${m.year ? ` (${m.type === 'internal' ? '검토일 ' : ''}${esc(m.year)})` : ''}
        </div>
        <div class="metrics">
          <span><span class="simbar"><span style="width:${Math.min(100, pct(m.score))}%"></span></span>유사도 <b>${pct(m.score)}%</b></span>
          ${m.sameFile ? '<span class="badge bad">동일 파일</span>' : ''}
          <span>겹치는 구절 ${m.phrases.length}개</span>
        </div>
        ${m.phrases.length ? `<details><summary>겹치는 구절 보기</summary>
          <ul class="phrases">${m.phrases.map(p => `<li>${esc(p.length > 240 ? p.slice(0, 240) + '…' : p)}</li>`).join('')}</ul>
          <div class="excerpt">${T.highlight(m.excerpt, m.spans)}${m.excerpt.length >= 1500 ? '…' : ''}</div></details>` : ''}
      </li>`).join('');
    $('tab-dup').innerHTML = `
      <div class="verdict-box">
        ${gaugeSvg(score, warn)}
        <div>
          <p class="headline">전체 유사도 ${score}% ${warn ? '<span class="badge bad">주의</span>' : '<span class="badge ok">기준 미만</span>'}</p>
          <div class="scale ${warn ? 'warn' : ''}" aria-hidden="true"><span class="fill" style="width:${Math.min(100, score)}%"></span><span class="th" style="left:${settings.threshold}%"></span></div>
          <div class="scale-labels" aria-hidden="true"><span>0%</span><span>기준 ${settings.threshold}%</span><span>100%</span></div>
          <p>가장 비슷한 1편 기준 · 외부 초록 ${d.compared.external}편, 이전 투고 ${d.compared.internal}편과 비교</p>
          ${same ? '<p><span class="badge warn">이전에 검토한 파일과 동일</span></p>' : ''}
        </div>
      </div>
      <p class="section-note">외부 논문은 초록 단위로만 비교합니다 (TF-IDF 코사인 유사도).</p>
      <h3>유사도 상위 5편</h3>
      ${items ? `<ol class="biblio">${items}</ol>` : '<p class="muted">비교할 대상이 없습니다.</p>'}`;
  }

  function gaugeSvg(score, warn) {
    const a = Math.PI * Math.min(score, 100) / 100;
    const x = 84 - 66 * Math.cos(a), y = 84 - 66 * Math.sin(a);
    const color = warn ? 'var(--bad)' : 'var(--ok)';
    return `<svg class="gauge" viewBox="0 0 168 100" role="img" aria-label="유사도 ${score}%">
      <path d="M18 84 A66 66 0 0 1 150 84" fill="none" stroke="var(--rule)" stroke-width="10"/>
      ${score > 0 ? `<path d="M18 84 A66 66 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="10"/>` : ''}
      <text x="84" y="80" text-anchor="middle" font-size="30" font-weight="600">${score}<tspan font-size="16">%</tspan></text></svg>`;
  }

  // II. 참고문헌 검증
  function renderRef(r) {
    const refs = r.references.slice().sort(RC.exporter.refOrder);
    const o = refs.filter(x => x.verdict === 'O').length, xn = refs.filter(x => x.verdict === 'X').length, q = refs.length - o - xn;
    const vIcon = v => v === 'O' ? icon('check') + '<span class="sr">O</span>' : v === 'X' ? icon('cross') + '<span class="sr">X</span>' : icon('question') + '<span class="sr">확인 못 함</span>';
    const rows = refs.map(x => `
      <tr class="${x.verdict === '?' ? 'Q' : x.verdict}">
        <td class="verdict" title="${x.verdict === '?' ? '확인 못 함' : x.verdict}">${vIcon(x.verdict)}</td>
        <td class="idx">${x.idx}</td>
        <td class="raw">${esc(x.raw)}${x.reason ? `<span class="reason">${esc(x.reason)}</span>` : ''}</td>
        <td class="found">${x.candidate ? `${/^(존재 확인 불가|제목 불일치)/.test(x.reason || '') ? '<div class="sub">일치하지 않음 · 가장 가까운 후보</div>' : ''}${extLink(x.candidate.url, x.candidate.title)}<div class="sub">${esc(x.candidate.authors || '')} · ${esc(x.candidate.year || '')} · ${esc(x.candidate.source)}</div>` : '<span class="muted">—</span>'}</td>
      </tr>`).join('');
    $('tab-ref').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="label">전체</div><div class="value">${refs.length}</div></div>
        <div class="stat ok"><div class="label">O 일치</div><div class="value">${o}</div></div>
        <div class="stat bad"><div class="label">X 이상</div><div class="value">${xn}</div></div>
        ${q ? `<div class="stat warn"><div class="label">– 확인 못 함</div><div class="value">${q}</div></div>` : ''}
      </div>
      <p class="caption"><b>표 1.</b>참고문헌 검증 결과. X 항목을 위에 둡니다. "(경미)", "(참고)"는 사람이 판단할 정도의 작은 차이입니다.</p>
      <table>
        <thead><tr><th>판정</th><th>번호</th><th>원문 · 사유</th><th>DB에서 찾은 논문</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">참고문헌을 찾지 못했습니다.</td></tr>'}</tbody>
      </table>`;
  }

  function filteredSimilar(r) {
    const now = new Date().getFullYear();
    let list = r.similar.slice();
    if (simView.period !== 'all') list = list.filter(s => s.year && s.year >= now - (+simView.period));
    const by = {
      date: (a, b) => (b.date || String(b.year || '')).localeCompare(a.date || String(a.year || '')),
      sim: (a, b) => b.similarity - a.similarity,
      cite: (a, b) => b.citations - a.citations
    }[simView.sort];
    return list.sort(by);
  }

  // III. 유사 주제 연구: 참고문헌 목록 형식
  function renderSim(r) {
    const list = filteredSimilar(r);
    const sel = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
    $('tab-sim').innerHTML = `
      <div class="toolbar">
        <label>정렬 <select id="simSort">${sel('date', simView.sort, '최신순')}${sel('sim', simView.sort, '유사도순')}${sel('cite', simView.sort, '인용순')}</select></label>
        <label>기간 <select id="simPeriod">${sel('3', simView.period, '최근 3년')}${sel('5', simView.period, '최근 5년')}${sel('all', simView.period, '전체')}</select></label>
        <span class="count">${list.length}/${r.similar.length}편 · OpenAlex</span>
      </div>
      ${r.similarError ? `<p class="error">${esc(r.similarError)}</p>` : ''}
      ${list.length ? `<ol class="biblio">${list.map(s => `
        <li>
          <div class="cite">${esc(s.authors || '저자 미상')} (${esc(s.year || 'n.d.')}). <span class="title">${extLink(s.url, s.title)}</span>.${s.venue ? ` <span class="venue">${esc(s.venue)}</span>.` : ''}</div>
          <div class="metrics">
            <span><span class="simbar"><span style="width:${Math.min(100, pct(s.similarity))}%"></span></span>유사도 <b>${pct(s.similarity)}%</b></span>
            <span>인용 <b>${s.citations}</b></span>
            ${s.date ? `<span>출판일 ${esc(s.date)}</span>` : ''}
          </div>
          ${s.abstract ? `<details><summary>초록</summary><div class="excerpt">${esc(s.abstract)}</div></details>` : ''}
        </li>`).join('')}</ol>` : '<p class="muted">조건에 맞는 논문이 없습니다.</p>'}`;
    $('simSort').addEventListener('change', e => { simView.sort = e.target.value; renderSim(r); });
    $('simPeriod').addEventListener('change', e => { simView.period = e.target.value; renderSim(r); });
  }

  // ---------------- 이력·백업·설정 ----------------
  async function refreshHistory(selectId) {
    const all = (await RC.store.allReviews()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $('historySelect').innerHTML = `<option value="">검토 이력 (${all.length}건)</option>` +
      all.map(r => `<option value="${r.id}">${esc(RC.localTime(r.createdAt))} · ${esc(r.title.slice(0, 40))}</option>`).join('');
    if (selectId) $('historySelect').value = String(selectId);
  }

  async function backup() {
    const json = await RC.store.exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'RefCheck_backup_' + RC.localTime(new Date().toISOString(), true) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function restore(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const n = await RC.store.importBackup(await f.text());
      settings = await RC.store.getSettings(); RC.api.setMailto(settings.mailto);
      await refreshHistory(current && current.id);
      alert('검토 ' + n + '건을 되살렸습니다.');
    } catch (err) { showError('복원 실패: ' + err.message); }
  }

  function openSettings() {
    $('setThreshold').value = settings.threshold;
    $('setCount').value = settings.similarCount;
    $('setMailto').value = settings.mailto;
    $('settingsDlg').showModal();
  }
  async function saveSettings() {
    if ($('settingsDlg').returnValue !== 'ok') return;
    settings.threshold = Math.min(100, Math.max(1, +$('setThreshold').value || 40));
    settings.similarCount = Math.min(50, Math.max(10, +$('setCount').value || 20));
    settings.mailto = $('setMailto').value.trim();
    for (const k of ['threshold', 'similarCount', 'mailto']) await RC.store.setSetting(k, settings[k]);
    RC.api.setMailto(settings.mailto);
    if (current) renderDup(current);
  }

  function progress(text, p) {
    $('progress').hidden = false;
    $('progressText').textContent = text;
    $('progressBar').style.width = Math.round(p) + '%';
  }
  function showError(msg) { $('error').hidden = false; $('error').textContent = msg; }
  function hideError() { $('error').hidden = true; }
})();
