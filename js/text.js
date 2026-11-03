// 문자열 정규화, 제목 비교 점수, TF-IDF 코사인 유사도, 겹치는 구절 찾기.
var RC = window.RC || (window.RC = {});

// 저장은 UTC(ISO)로 하고, 화면·Excel에는 이 PC의 시간대로 "YYYY-MM-DD HH:MM" 표시
RC.localTime = function (iso, dateOnly) {
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  const day = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  return dateOnly ? day : day + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

RC.text = (function () {
  const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being ' +
    'below between both but by can could did do does doing down during each few for from further had has have having he her ' +
    'here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our ours ' +
    'out over own same she should so some such than that the their theirs them then there these they this those through to too ' +
    'under until up very was we were what when where which while who whom why will with would you your yours via using based ' +
    'use used new paper study propose proposed approach method methods results show shows shown however thus therefore et al ' +
    'within without may might must one two three also well first second toward towards among across upon').split(/\s+/));

  function norm(s) {
    return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function normName(s) {
    return norm(s).replace(/[^a-z\-' ]/g, '').trim();
  }
  function words(s) {
    return norm(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1);
  }

  // 찾은 논문 제목(cand)이 참고문헌의 제목 추정값(guess) 또는 원문(raw)과 얼마나 맞는지 0~100
  // 줄 끝 하이픈이 지워진 경우("Cross-" + "modality" → "Crossmodality")도 맞도록 하이픈을 붙인 형태로도 비교한다
  function titleScore(cand, guess, raw) {
    const a = titleScore1(cand, guess, raw);
    return /-/.test(cand || '') ? Math.max(a, titleScore1(cand.replace(/-/g, ''), guess, raw)) : a;
  }
  function titleScore1(cand, guess, raw) {
    const C = new Set(words(cand));
    if (!C.size) return 0;
    // 한글 조판 PDF는 영어 단어를 줄 끝에서 하이픈 없이 자르기도 한다("usi" + "ng").
    // 그래서 띄어쓰기를 모두 뺀 문자열에 4글자 이상 단어가 들어 있으면 그것도 일치로 센다.
    const has = (set, compact, w) => set.has(w) || (w.length >= 4 && compact.includes(w));
    let best = 0;
    if (guess) {
      const gw = words(guess), G = new Set(gw), gc = gw.join('');
      let inter = 0; C.forEach(w => { if (has(G, gc, w)) inter++; });
      best = 100 * inter / Math.max(C.size, G.size * 0.8);
    }
    if (raw) {
      const rw = words(raw), R = new Set(rw), rc = rw.join('');
      let inter = 0; C.forEach(w => { if (has(R, rc, w)) inter++; });
      let s = 100 * inter / C.size * 0.95;
      if (C.size < 4) s *= 0.8; // 짧은 제목은 우연히 포함되기 쉬움
      best = Math.max(best, s);
    }
    return Math.min(100, Math.round(best));
  }

  // ---- TF-IDF ----
  function stem(w) {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }
  function terms(s) {
    // 한글은 NFKD로 자모가 분리되므로 먼저 뽑아 둔다. 조사가 붙어 단어가 달라지는 문제를 피하려고 두 글자씩 끊는다.
    const out = [];
    for (const h of (s || '').match(/[가-힣]{2,}/g) || []) for (let i = 0; i + 1 < h.length; i++) out.push(h.slice(i, i + 2));
    const ws = norm(s).replace(/[^a-z0-9\-]+/g, ' ').split(' ')
      .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
    out.push(...ws);
    for (let i = 0; i + 1 < ws.length; i++) out.push(ws[i] + '_' + ws[i + 1]);
    return out;
  }
  // docs: 문자열 배열 → 정규화된 벡터(Map) 배열
  function tfidf(docs) {
    const tfs = docs.map(d => {
      const m = new Map();
      for (const t of terms(d)) m.set(t, (m.get(t) || 0) + 1);
      return m;
    });
    const df = new Map();
    for (const m of tfs) for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
    const N = docs.length;
    return tfs.map(m => {
      const v = new Map();
      let sq = 0;
      for (const [t, c] of m) {
        const w = (1 + Math.log(c)) * (Math.log((1 + N) / (1 + df.get(t))) + 1);
        v.set(t, w); sq += w * w;
      }
      const n = Math.sqrt(sq) || 1;
      for (const [t, w] of v) v.set(t, w / n);
      return v;
    });
  }
  function cosine(a, b) {
    if (a.size > b.size) [a, b] = [b, a];
    let s = 0;
    for (const [t, w] of a) { const x = b.get(t); if (x) s += w * x; }
    return s;
  }
  // 기준 문서(base) 하나와 대상 문서들의 유사도 (0~1)
  function similarities(base, targets) {
    const vecs = tfidf([base, ...targets]);
    return targets.map((_, i) => cosine(vecs[0], vecs[i + 1]));
  }
  function topTerms(s, n) {
    const m = new Map();
    for (const t of terms(s)) if (!t.includes('_')) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  }

  // ---- 겹치는 구절: 단어 n개 연속이 같은 구간 ----
  function tokenize(s) {
    const out = [];
    const re = /[A-Za-zÀ-ÿ0-9가-힣]+(?:[-'][A-Za-zÀ-ÿ0-9가-힣]+)*/g;
    let m;
    while ((m = re.exec(s))) out.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    return out;
  }
  // base와 target에서 겹치는 구간을 target 기준으로 돌려준다: { phrases: [문자열], spans: [[start,end]] }
  function overlaps(base, target, n) {
    n = n || 5;
    const bt = tokenize(base), tt = tokenize(target);
    const set = new Set();
    for (let i = 0; i + n <= bt.length; i++) set.add(bt.slice(i, i + n).map(t => t.w).join(' '));
    const covered = new Array(tt.length).fill(false);
    for (let i = 0; i + n <= tt.length; i++) {
      if (set.has(tt.slice(i, i + n).map(t => t.w).join(' '))) for (let k = i; k < i + n; k++) covered[k] = true;
    }
    const spans = [];
    for (let i = 0; i < tt.length; i++) {
      if (!covered[i]) continue;
      let j = i;
      while (j + 1 < tt.length && covered[j + 1]) j++;
      spans.push([tt[i].start, tt[j].end]);
      i = j;
    }
    const phrases = spans.map(([a, b]) => target.slice(a, b)).sort((a, b) => b.length - a.length);
    return { phrases, spans };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function highlight(text, spans) {
    let out = '', pos = 0;
    for (const [a, b] of spans) { out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; pos = b; }
    return out + esc(text.slice(pos));
  }

  return { norm, normName, words, titleScore, similarities, topTerms, overlaps, esc, highlight, STOP };
})();
