// 기능 2: 참고문헌마다 CrossRef → OpenAlex 순서로 찾아 O/X 판정과 사유를 만든다.
var RC = window.RC || (window.RC = {});

RC.verify = (function () {
  const T = RC.text;
  const MATCH = 85;     // 이 이상이면 같은 논문으로 본다
  const NOT_FOUND = 70; // 모든 DB에서 이보다 낮으면 "존재 확인 불가"
  const HANGUL = /[가-힣]/;

  async function verifyAll(entries, onProgress) {
    let done = 0;
    return Promise.all(entries.map(async e => {
      let r;
      try { r = await verifyOne(e); }
      catch (err) { r = { verdict: '?', reason: '조회 실패 (' + err.message + ') — 다시 검토해 주세요' }; }
      done++;
      if (onProgress) onProgress(done, entries.length);
      return Object.assign({ idx: e.idx, raw: e.raw }, r);
    }));
  }

  async function verifyOne(e) {
    const cands = [];
    let doiNote = '';

    if (e.doi) {
      let w = null;
      try { w = await RC.api.crossrefDoi(e.doi); } catch (err) { }
      if (!w) { try { w = await RC.api.openalexDoi(e.doi); } catch (err) { } }
      if (w) {
        const s = score(w, e);
        if (s.title >= MATCH) return judge(w, e, s, '');
        doiNote = 'DOI 오류: 이 DOI는 다른 논문(“' + short(w.title) + '”)을 가리킴';
      } else doiNote = 'DOI 오류: DOI를 찾을 수 없음';
    }

    const query = e.raw;
    const cr = await RC.api.crossrefSearch(query, 3);
    cands.push(...cr);
    let best = pick(cands, e);
    if (!best || !best.ok) {
      const oaQuery = (e.titleGuess && e.titleGuess.split(' ').length >= 3) ? e.titleGuess : stripAuthors(e.raw);
      const oa = await RC.api.openalexSearch(oaQuery, { perPage: 5 });
      cands.push(...oa);
      best = pick(cands, e);
    }

    if (!best || best.s.title < NOT_FOUND) {
      if (!e.doi && /https?:\/\/|github|www\./i.test(e.raw) && !/journal|proc|conference|transactions|vol\.|pp\./i.test(e.raw)) {
        return { verdict: '?', reason: '웹 자료(데이터셋·코드·홈페이지 등)로 보여 학술 DB 대상이 아님 — 링크를 직접 확인해 주세요', candidate: null };
      }
      if (HANGUL.test(e.raw)) return { verdict: '?', reason: '한글 문헌: 국내 DB(KCI 등)는 아직 연동하지 않아 확인하지 못함', candidate: best ? brief(best.w) : null };
      const domestic = /korea|kiise|kips|kics|kcc\d*|ksii|kiit|\bkorean\b/i.test(e.raw) ? ' (국내 학술대회·학술지 자료는 두 DB에 없는 경우가 많아 직접 확인 권장)' : '';
      return { verdict: 'X', reason: doiNote || '존재 확인 불가: CrossRef·OpenAlex에서 일치하는 논문을 찾지 못함' + domestic, candidate: best ? brief(best.w) : null };
    }
    if (best.s.title < MATCH) {
      return { verdict: 'X', reason: '제목 불일치: 가장 비슷한 논문은 “' + short(best.w.title) + '”', candidate: brief(best.w) };
    }
    return judge(best.w, e, best.s, doiNote);
  }

  // 후보마다 제목 점수와 불일치 개수를 매겨, 제목이 맞는 것 중 불일치가 가장 적은 후보를 고른다
  function pick(cands, e) {
    let best = null;
    for (const w of cands) {
      const s = score(w, e);
      const key = (s.title >= MATCH ? 1000 : 0) - s.mismatches * 100 + s.title;
      if (!best || key > best.key) best = { w, s, key, ok: s.title >= MATCH && s.mismatches === 0 };
    }
    return best;
  }

  function score(w, e) {
    const title = T.titleScore(w.title, e.titleGuess, e.raw);
    const ys = (w.years && w.years.length) ? w.years : [w.year];
    const yearDiff = (e.year && w.year) ? Math.min(...ys.map(y => Math.abs(e.year - y))) : 0;
    const author = authorOk(w, e);
    return { title, yearDiff, author, mismatches: (yearDiff ? 1 : 0) + (author === false ? 1 : 0) };
  }

  // true: 일치, false: 불일치, null: 비교 불가
  function authorOk(w, e) {
    const fam = w.authors && w.authors[0] && T.normName(w.authors[0].family);
    if (!fam) return null;
    const head = T.norm(e.raw.slice(0, 120));
    if (e.firstAuthor && (e.firstAuthor === fam || e.firstAuthor.includes(fam) || fam.includes(e.firstAuthor))) return true;
    if (head.includes(fam)) return true; // 성 추출이 틀렸어도 원문 앞부분에 있으면 일치로 본다
    // 중국·한국 이름은 성/이름 순서가 DB마다 뒤바뀌는 경우가 있어 첫 저자 전체 이름의 단어도 확인
    const fullWords = T.words(w.authors[0].full);
    if (fullWords.some(x => x.length > 1 && e.firstAuthor && x === e.firstAuthor)) return true;
    return e.firstAuthor ? false : null;
  }

  function judge(w, e, s, doiNote) {
    const reasons = [];
    let verdict = 'O';
    if (doiNote) { verdict = 'X'; reasons.push(doiNote); }
    if (s.yearDiff) {
      verdict = 'X';
      const minor = s.yearDiff === 1 && (e.isPreprint || w.isPreprint);
      reasons.push((minor ? '(경미) ' : '') + '연도 불일치 ' + e.year + '→' + w.year + (minor ? ' (프리프린트와 출판본 차이로 보임)' : ''));
    }
    if (s.author === false) {
      verdict = 'X';
      reasons.push('제1저자 불일치 ' + e.firstAuthor + '→' + (w.authors[0].family || w.authors[0].full));
    }
    // 기관 저장소·프리프린트 서버(arXiv, SSRN, 대학 리포지토리 등)는 원문에 적힌 학회명과 원래 다르므로 비교하지 않는다
    const repo = w.isPreprint || /arxiv|rxiv|ssrn|repository|universit|dare|zenodo|hal\b|research ?gate|semantic scholar|europe pmc|pubmed/i.test(w.venue || '');
    if (w.venue && !repo && !venueOk(w.venue, e.raw)) reasons.push('(참고) 저널·학회명 표기가 DB와 다름: ' + w.venue);
    return { verdict, reason: reasons.join(' / '), candidate: brief(w) };
  }

  // DB의 저널명 단어 대부분이 원문에 (약어 포함) 나오면 일치로 본다. 약어 표기 차이가 흔해서 판정에는 쓰지 않고 참고로만 표시.
  function venueOk(venue, raw) {
    const vw = T.words(venue).filter(x => !T.STOP.has(x) && x.length > 2);
    if (!vw.length) return true;
    const rw = T.words(raw);
    const hit = vw.filter(v => rw.some(r => r === v || (r.length >= 3 && v.startsWith(r)))).length;
    return hit / vw.length >= 0.5;
  }

  function stripAuthors(raw) {
    return raw.replace(/\b[A-Z]\.\s?/g, ' ').replace(/\b(19|20)\d{2}[a-z]?\b/g, ' ').replace(/\b(vol|no|pp|proc|in)\b\.?/gi, ' ')
      .replace(/\d+/g, ' ').split(/\s+/).slice(0, 25).join(' ');
  }
  const short = t => (t || '').length > 80 ? t.slice(0, 77) + '…' : (t || '');
  const brief = w => ({ title: w.title, year: w.year, authors: (w.authors || []).slice(0, 3).map(a => a.full).join(', '), venue: w.venue, url: w.url, source: w.source });

  return { verifyAll, verifyOne };
})();
