// PDF에서 읽는 순서대로 줄을 뽑고, 제목·초록·키워드·본문·참고문헌 블록을 나눈다.
var RC = window.RC || (window.RC = {});

RC.pdf = (function () {
  // file:// 에서는 별도 작업 스레드를 띄우지 못하므로, worker 스크립트를 일반 스크립트로 불러와
  // pdf.js가 화면 스레드에서 처리하게 한다 (window.pdfjsWorker 가 있으면 자동으로 그렇게 동작).
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  async function extract(arrayBuffer) {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let meta = {};
    try { meta = (await doc.getMetadata()).info || {}; } catch (e) { /* 메타데이터 없음 */ }

    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const [a, b, , d, e, f] = it.transform;
        if (Math.abs(b) > 0.01) continue; // 회전된 글자 (arXiv 옆면 도장 등)
        const size = Math.abs(d) || Math.abs(a) || it.height || 10;
        items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, size: size });
      }
      for (const ln of pageLines(items, vp.width)) { ln.page = p; ln.edge = ln.y < 80 || ln.y > vp.height - 70; lines.push(ln); }
    }
    const numPages = doc.numPages;
    await doc.destroy();
    return analyze(dropHeaders(lines, numPages), meta, numPages);
  }

  // 쪽 번호("- 542 -")와, 여러 쪽에 똑같이 반복되는 머리말·꼬리말 줄을 뺀다
  function dropHeaders(lines, numPages) {
    const key = l => l.text.replace(/\d+/g, '#').replace(/\s+/g, '');
    const pagesOf = new Map();
    for (const l of lines) {
      const k = key(l);
      if (!pagesOf.has(k)) pagesOf.set(k, new Set());
      pagesOf.get(k).add(l.page);
    }
    const minPages = Math.max(3, Math.ceil(numPages * 0.4));
    return lines.filter(l => !/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(l.text) && !(l.edge && pagesOf.get(key(l)).size >= minPages && l.text.length < 120));
  }

  // ---- 한 쪽의 글자 조각을 읽는 순서의 줄로 만든다 (2단 편집 처리 포함) ----
  function pageLines(items, width) {
    const split = findColumnSplit(items, width);
    const rows = groupRows(items);
    const out = [];
    let left = [], right = [];
    const flush = () => { out.push(...left, ...right); left = []; right = []; };
    for (const row of rows) {
      if (split === null) { out.push(makeLine(row, 0)); continue; }
      const L = row.filter(it => it.x + it.w / 2 < split);
      const R = row.filter(it => it.x + it.w / 2 >= split);
      // 가운데를 가로지르는 글자가 있거나, 좌우 사이 간격이 단 사이 여백보다 좁으면 1단 줄(제목·초록 등)
      const crosses = row.some(it => it.x < split - 2 && it.x + it.w > split + 2);
      const gap = (L.length && R.length) ? Math.min(...R.map(i => i.x)) - Math.max(...L.map(i => i.x + i.w)) : Infinity;
      if (crosses || gap < 8) { flush(); out.push(makeLine(row, 0)); continue; }
      if (L.length) left.push(makeLine(L, 0));
      if (R.length) right.push(makeLine(R, 1));
    }
    flush();
    return out;
  }

  // 가운데 근처에서 글자가 거의 지나가지 않는 세로 띠를 찾는다. 없으면 1단.
  function findColumnSplit(items, width) {
    if (items.length < 30) return null;
    let best = null, bestCount = Infinity;
    for (let x = width * 0.4; x <= width * 0.6; x += 2) {
      let c = 0;
      for (const it of items) if (it.x < x && it.x + it.w > x) c++;
      if (c < bestCount) { bestCount = c; best = x; }
    }
    const leftN = items.filter(it => it.x + it.w < best).length;
    const rightN = items.filter(it => it.x > best).length;
    if (bestCount <= items.length * 0.08 && leftN > items.length * 0.25 && rightN > items.length * 0.25) return best;
    return null;
  }

  function groupRows(items) {
    const sorted = items.slice().sort((p, q) => p.y - q.y || p.x - q.x);
    const rows = [];
    for (const it of sorted) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - it.y) <= Math.max(2, it.size * 0.4)) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    return rows.map(r => r.items);
  }

  function makeLine(items, col) {
    items.sort((p, q) => p.x - q.x);
    let text = '', prevEnd = null;
    for (const it of items) {
      if (prevEnd !== null && it.x - prevEnd > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      prevEnd = it.x + it.w;
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      x: items[0].x,
      y: items[0].y,
      size: Math.max(...items.map(i => i.size)),
      col: col
    };
  }

  // ---- 줄 목록에서 논문 항목을 나눈다 ----
  // 영어 논문 우선이지만, 영문 초록이 있는 국내 논문도 읽을 수 있게 한글 제목(요약, 참고문헌 등)도 인식한다.
  const NUM = '(\\d+|[IVX]+|[\\u2160-\\u216B])\\.?';
  const RE_ABSTRACT = /^\s*(a\s*b\s*s\s*t\s*r\s*a\s*c\s*t)\b\s*[:.—–-]?\s*/i;
  const RE_ABSTRACT_KO = /^\s*(국\s*문\s*)?(요\s*약|초\s*록|要\s*旨|要\s*約)\s*(:|\.|$)\s*/; // 제목 줄만 ("요약하면…" 같은 본문 제외)
  const RE_KEYWORDS = /^\s*(key\s*words?|index\s+terms|주\s*제\s*어|핵\s*심\s*어|키\s*워\s*드|핵심\s*용어)\s*[:.—–-]?\s*/i;
  const RE_INTRO = new RegExp('^\\s*(' + NUM + '\\s*)?(introduction|서\\s*론)\\b', 'i');
  const RE_REFS = new RegExp('^\\s*(' + NUM + '\\s*)?(references|bibliography|literature\\s+cited|works\\s+cited|reference\\s+list|참\\s*고\\s*문\\s*헌|參\\s*考\\s*文\\s*獻)\\s*:?\\s*$', 'i');
  const RE_APPENDIX = /^\s*(([A-Z]|\d+)\.?\s+)?(appendix|appendices|supplementary\s+material|부\s*록)\b/i;

  function analyze(lines, meta, numPages) {
    const textLen = lines.reduce((s, l) => s + l.text.length, 0);
    if (textLen < 500) {
      throw new Error('PDF에서 글자를 거의 읽지 못했습니다. 스캔 이미지 PDF는 지원하지 않습니다 (텍스트 기반 PDF만 가능).');
    }
    const { title, titleEn } = findTitles(lines, meta);

    // 초록: 영문 "Abstract"와 한글 "요약/초록"을 각각 찾는다. 대표 초록은 영문 (없으면 한글).
    // 한글 초록은 중복성 비교에 함께 쓴다 (국내 학술지는 DB에 한글 초록만 올라간 경우가 많음).
    let introIdx = lines.findIndex(l => RE_INTRO.test(l.text) && l.text.length < 60);
    const readAbs = re => {
      const start = lines.findIndex((l, i) => i < 300 && re.test(l.text));
      if (start < 0) return null;
      const buf = [lines[start].text.replace(re, '')];
      let i = start + 1;
      for (; i < lines.length && i < start + 80; i++) {
        const t = lines[i].text;
        if (RE_KEYWORDS.test(t) || (RE_INTRO.test(t) && t.length < 60) || (i > start + 1 && (RE_ABSTRACT.test(t) || RE_ABSTRACT_KO.test(t)) && t.length < 20) ||
          /^\s*(ccs concepts|acm reference format)/i.test(t)) break;
        buf.push(t);
      }
      return { text: joinLines(buf), end: i };
    };
    const en = readAbs(RE_ABSTRACT), ko = readAbs(RE_ABSTRACT_KO);
    let abstract = '', absEnd = -1;
    const abstractKo = ko && ko !== en ? ko.text.slice(0, 4000) : '';
    if (en || ko) {
      abstract = (en || ko).text;
      absEnd = Math.max(en ? en.end : -1, ko ? ko.end : -1, introIdx);
    } else if (introIdx > 0) {
      // "Abstract" 제목이 없는 논문: 제목 다음부터 서론 전까지를 초록으로 본다
      abstract = joinLines(lines.slice(Math.max(0, introIdx - 25), introIdx).map(l => l.text));
      absEnd = introIdx;
    }
    if (abstract.length > 4000) abstract = abstract.slice(0, 4000);

    // 키워드: 국문·영문 키워드가 둘 다 있으면 영문을 쓴다 (외부 검색이 영어 기준이라서)
    const kwLists = [];
    lines.forEach((l, kwIdx) => {
      if (kwIdx >= 300 || !RE_KEYWORDS.test(l.text)) return;
      let kw = l.text.replace(RE_KEYWORDS, '');
      // 다음 줄은 키워드가 쉼표로 끝나 이어지는 경우에만 붙인다
      for (let i = kwIdx + 1; i < kwIdx + 4 && i < lines.length; i++) {
        const t = lines[i].text;
        const cont = !kw.trim() || /[,;]\s*$/.test(kw) || (/^[a-z]/.test(t) && t.length < 30);
        if (!cont || RE_INTRO.test(t) || kw.length > 250) break;
        kw += ' ' + t;
      }
      const list = kw.split(/[,;·•]|\s—\s/).map(s => s.trim().replace(/\.$/, '')).filter(s => s && s.length < 60);
      if (list.length) kwLists.push(list);
    });
    const isEn = list => /^[\x00-\x7F]*$/.test(list.join(''));
    const keywords = kwLists.find(isEn) || kwLists[0] || [];

    // 참고문헌 블록: 마지막 "References" 제목부터 부록 전까지
    let refStart = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (RE_REFS.test(lines[i].text)) { refStart = i; break; }
    let refLines = [];
    if (refStart >= 0) {
      let end = lines.length;
      for (let i = refStart + 1; i < lines.length; i++) if (RE_APPENDIX.test(lines[i].text) && lines[i].text.length < 80) { end = i; break; }
      refLines = lines.slice(refStart + 1, end);
    }

    const bodyFrom = absEnd > 0 ? absEnd : 0;
    const bodyTo = refStart > 0 ? refStart : lines.length;
    const body = joinLines(lines.slice(bodyFrom, bodyTo).map(l => l.text));
    const bodyExcerpt = body.split(/\s+/).slice(0, 3000).join(' ');

    return { title, titleEn, abstract, abstractKo: abstractKo === abstract ? '' : abstractKo, keywords, bodyExcerpt, refLines, refHeadingFound: refStart >= 0, numPages, lines };
  }

  const HANGUL = /[가-힣]/;
  const NOT_TITLE = /arxiv|preprint|journal|proceedings|vol\.|doi|http|©|issn|@/i;

  // 1쪽 위쪽에서 글자가 가장 큰 줄들. 국내 논문은 한글 제목 아래에 (같거나 작은 크기로) 영문 제목이 있다.
  // 외부 검색에는 영문 제목(titleEn)을 쓴다.
  function findTitles(lines, meta) {
    const first = lines.filter(l => l.page === 1 && l.text.length > 3 && !NOT_TITLE.test(l.text));
    let title = '', titleEn = '';
    if (first.length) {
      const top = first.filter(l => l.y < 450);
      const pool = top.length ? top : first;
      const group = size => {
        const idx = pool.findIndex(l => Math.abs(l.size - size) < 0.6);
        const parts = [pool[idx]];
        for (let i = idx + 1; i < pool.length && Math.abs(pool[i].size - size) < 0.6 && parts.length < 6; i++) parts.push(pool[i]);
        return parts;
      };
      const parts = group(Math.max(...pool.map(l => l.size)));
      const ko = parts.filter(l => HANGUL.test(l.text)), en = parts.filter(l => !HANGUL.test(l.text));
      title = joinLines((ko.length ? ko : parts).map(l => l.text));
      if (!ko.length) titleEn = title;
      else if (en.length) titleEn = joinLines(en.map(l => l.text));
      else {
        // 영문 제목이 한글 제목보다 작은 글자로 따로 있는 경우
        const enPool = pool.filter(l => !HANGUL.test(l.text) && l.text.split(' ').length >= 2);
        if (enPool.length) {
          const g = enPool.filter(l => Math.abs(l.size - Math.max(...enPool.map(x => x.size))) < 0.6).slice(0, 4);
          const t = joinLines(g.map(l => l.text));
          if (t.split(' ').length >= 4) titleEn = t;
        }
      }
    }
    if (title.length < 8) {
      const mt = (meta.Title || '').trim();
      title = (mt.length > 8 && !/microsoft word|untitled|dbpia|\.docx?$/i.test(mt)) ? mt : '(제목을 찾지 못함)';
      if (!HANGUL.test(title)) titleEn = titleEn || title;
    }
    return { title, titleEn };
  }

  // 줄을 이어 붙이며 줄 끝 하이픈("connec-" + "tion")을 붙인다
  function joinLines(arr) {
    let s = '';
    for (const t of arr) {
      if (!t) continue;
      if (/[A-Za-z]-$/.test(s) && /^[a-z]/.test(t)) s = s.slice(0, -1) + t;
      else s += (s ? ' ' : '') + t;
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  return { extract, joinLines };
})();
