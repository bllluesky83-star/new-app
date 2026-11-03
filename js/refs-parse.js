// 참고문헌 블록의 줄들을 항목별로 나누고, 항목마다 DOI·연도·제1저자·제목 추정값을 뽑는다.
var RC = window.RC || (window.RC = {});

RC.refs = (function () {
  const RE_BRACKET = /^\s*\[(\d{1,3})\]\s*/;
  const RE_NUMDOT = /^\s*(\d{1,3})\.\s+(?=\S)/;
  // "Smith, J." / "Smith, John" / "van der Berg, A." / "Smith J," (Vancouver) 처럼 저자로 시작하는 줄
  const RE_AUTHOR_START = /^\s*((van|von|de|der|del|da|di|le|la)\s+)*[A-Z][A-Za-zÀ-ÿ'’\-]+,?\s+(([A-Z]\.\s?)+|[A-Z][a-zà-ÿ]+|[A-Z]{1,3}[,.])/;

  function parse(lines) {
    const clean = lines.filter(l => l.text && !/^\d{1,4}$/.test(l.text.trim()));
    if (!clean.length) return { style: 'none', entries: [] };

    const bracketN = clean.filter(l => RE_BRACKET.test(l.text)).length;
    let style, groups;
    if (bracketN >= 3) {
      style = 'bracket';
      groups = splitBy(clean, l => RE_BRACKET.test(l.text));
    } else if (countSequential(clean) >= 3) {
      style = 'numbered';
      let expect = null;
      groups = splitBy(clean, l => {
        const m = l.text.match(RE_NUMDOT);
        if (!m) return false;
        const n = +m[1];
        if (expect === null ? n <= 2 : n === expect) { expect = n + 1; return true; }
        return false;
      });
    } else {
      style = 'author-year';
      groups = splitAuthorYear(clean);
    }

    const entries = groups
      .map(g => RC.pdf.joinLines(g.map(l => l.text)))
      .map(t => t.replace(RE_BRACKET, '').replace(RE_NUMDOT, '').trim())
      .filter(t => t.length >= 20)
      .map((raw, i) => Object.assign({ idx: i + 1, raw }, fields(raw)));
    return { style, entries };
  }

  function countSequential(lines) {
    let expect = 1, n = 0;
    for (const l of lines) {
      const m = l.text.match(RE_NUMDOT);
      if (m && +m[1] === expect) { n++; expect++; }
    }
    return n;
  }

  function splitBy(lines, isStart) {
    const groups = [];
    for (const l of lines) {
      if (isStart(l) || !groups.length) groups.push([l]);
      else groups[groups.length - 1].push(l);
    }
    return groups;
  }

  // 번호 없는 형식: 내어쓰기(둘째 줄부터 들여씀)가 보이면 그것을, 아니면 "저자로 시작 + 앞줄이 마침표로 끝남"을 쓴다.
  function splitAuthorYear(lines) {
    const margin = {};
    for (const l of lines) {
      const k = l.page + ':' + l.col;
      margin[k] = Math.min(margin[k] === undefined ? Infinity : margin[k], l.x);
    }
    const indentOf = l => l.x - margin[l.page + ':' + l.col];
    const indented = lines.filter(l => indentOf(l) > 6 && indentOf(l) < 40).length;
    const hanging = indented > lines.length * 0.25 && indented < lines.length * 0.85;

    let prev = null;
    return splitBy(lines, l => {
      let start;
      if (hanging) start = indentOf(l) <= 3;
      else start = RE_AUTHOR_START.test(l.text) && (!prev || /[.)\]\d]\s*$/.test(prev.text));
      prev = l;
      return start;
    });
  }

  // ---- 항목 하나에서 대조용 정보 추출 ----
  function fields(raw) {
    const doiM = raw.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/i);
    let doi = doiM ? doiM[1].replace(/[.,;)\]]+$/, '') : '';
    const arxivM = raw.match(/arxiv[:\s]*(?:abs\/)?(\d{4}\.\d{4,5})/i);

    const noUrl = raw.replace(/https?:\/\/\S+/g, ' ').replace(/\b10\.\d{4,9}\/\S+/g, ' ');
    // 연도: "(2019)" 가 있으면 그것. "Smith, J., 2019, ..." 처럼 성이 먼저 오는 형식은 첫 연도(저자 바로 뒤),
    // "J. Smith, ..., 2019." 처럼 이니셜이 먼저 오는 형식(IEEE)은 마지막 연도.
    let year = null;
    const paren = noUrl.match(/\((19[5-9]\d|20[0-4]\d)[a-z]?(?:,[^)]*)?\)/);
    const all = noUrl.match(/\b(19[5-9]\d|20[0-4]\d)[a-z]?\b/g);
    if (paren) year = +paren[1];
    else if (all) year = parseInt(surnameFirst(raw) ? all[0] : all[all.length - 1], 10);

    return {
      doi,
      arxiv: arxivM ? arxivM[1] : '',
      year,
      firstAuthor: firstAuthor(raw),
      titleGuess: titleGuess(raw),
      isPreprint: /arxiv|preprint|corr\b|biorxiv|medrxiv|ssrn/i.test(raw)
    };
  }

  function firstAuthor(raw) {
    const seg = raw.split(/,|\band\b|&|\(/)[0].trim();
    const words = seg.split(/\s+/).filter(Boolean);
    const isInitial = w => /^([A-Z]\.?-?)+$/.test(w.replace(/\.$/, '') + '') && w.replace(/[.\-]/g, '').length <= 3;
    const names = words.filter(w => !isInitial(w) && /[A-Za-zÀ-ÿ]/.test(w));
    if (!names.length) return '';
    // "J. Smith" 처럼 이니셜이 앞에 오면 마지막 단어가 성, 아니면 첫 단어가 성
    const surname = isInitial(words[0]) ? names[names.length - 1] : names[0];
    return RC.text.normName(surname);
  }

  function surnameFirst(raw) {
    return /^\s*((van|von|de|der|del|da|di|le|la)\s+)*[A-Z][A-Za-zÀ-ÿ'’\-]+,\s*([A-Z]\.|[A-Z]{1,3}[,.])/.test(raw);
  }

  function titleGuess(raw) {
    const q = raw.match(/[“"]([^”"]{10,}?)[,.]?[”"]/);
    if (q) return q[1].trim();
    const apa = raw.match(/\((?:19|20)\d{2}[a-z]?(?:,[^)]*)?\)\.?\s*(.+?[.?!])(\s|$)/);
    if (apa && apa[1].split(/\s+/).length >= 3) return apa[1].replace(/[.]$/, '').trim();
    // "Smith, J. and Lee, K., 2019, Title of paper, Journal ..." (국내 학회지에 많은 형식)
    const ay = raw.match(/[.,]\s*(?:19|20)\d{2}[a-z]?[,.]\s+(.{10,250}?)(?:,\s*(?:Proc\.|Proceedings|In\s|Journal|IEEE|ACM|International|arXiv|Computer|Applied|Sensors|Remote|Pattern|Robotics|Transactions|[A-Z][a-z]+\s+(?:Journal|Transactions|Letters|Review))|\.\s|$)/);
    if (ay && ay[1].split(/\s+/).length >= 3) return ay[1].trim();
    // 마침표로 나눈 조각 중 저자 목록·연도·학회명이 아닌 첫 조각
    const segs = raw.split(/\.\s+/);
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i].trim();
      const words = s.split(/\s+/);
      if (words.length < 3) continue;
      if (/^(in|proc|proceedings|journal|vol|pp|ieee|acm)\b/i.test(s)) continue;
      if (/^(19|20)\d{2}[a-z]?$/.test(s)) continue;
      const initials = (s.match(/\b[A-Z]\b/g) || []).length;
      if (initials >= 2 && /,/.test(s)) continue; // 저자 목록
      return s.replace(/^(19|20)\d{2}[a-z]?\.?\s*/, '');
    }
    return '';
  }

  return { parse, fields };
})();
