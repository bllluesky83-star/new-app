// Supabase 연결: 로그인/로그아웃, 검토 이력·설정을 Supabase 테이블에 저장·조회.
// 테이블과 접근 규칙(RLS)은 supabase/schema.sql 참고. 로그인한 본인 행만 다룰 수 있다.
// 설정 파일(js/config.local.js)이 없으면 꺼진 상태로 두고, 앱은 브라우저 저장소만 쓴다.
var RC = window.RC || (window.RC = {});

RC.cloud = (function () {
  const cfg = window.RC_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  let user = null;
  const listeners = [];

  async function init() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((_event, session) => {
      const next = session ? session.user : null;
      if ((next && next.id) === (user && user.id)) return;
      user = next;
      listeners.forEach(fn => fn(user));
    });
    return user;
  }
  const onChange = fn => listeners.push(fn);
  const active = () => !!(sb && user);

  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authMessage(error));
  }
  async function signOut() { await sb.auth.signOut(); }

  function authMessage(e) {
    if (/invalid login credentials/i.test(e.message)) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (/email not confirmed/i.test(e.message)) return '이메일 인증이 끝나지 않은 계정입니다. 받은 메일의 인증 링크를 먼저 눌러 주세요.';
    return e.message;
  }
  // 테이블이 아직 없을 때(SQL 미실행) 알아보기 쉬운 문구로 바꾼다
  function check(res) {
    if (res.error) {
      const e = res.error;
      if (e.code === 'PGRST205' || e.code === '42P01') throw new Error('Supabase에 테이블이 없습니다. supabase/schema.sql 을 SQL Editor에서 먼저 실행해 주세요.');
      if (e.code === '42501') throw new Error('Supabase 접근 권한이 없습니다 (로그인 상태와 RLS 정책을 확인해 주세요).');
      throw new Error('Supabase 오류: ' + e.message);
    }
    return res.data;
  }

  // ---- 앱 객체(camelCase) ↔ 테이블 행(snake_case) ----
  function toRow(r) {
    return {
      created_at: r.createdAt, filename: r.filename, file_hash: r.fileHash, title: r.title, title_en: r.titleEn || null,
      abstract: r.abstract || null, abstract_ko: r.abstractKo || null, keywords: r.keywords || [], body_excerpt: r.bodyExcerpt || null,
      num_pages: r.numPages ?? null, ref_style: r.refStyle || null, ref_heading_found: !!r.refHeadingFound, ref_block: r.refBlock || null,
      duplicate: r.duplicate || {}, similar_papers: r.similar || [], similar_error: r.similarError || null, elapsed_sec: r.elapsedSec ?? null, memo: r.memo || ''
    };
  }
  function fromRow(row) {
    return {
      id: row.id, createdAt: row.created_at, filename: row.filename, fileHash: row.file_hash, title: row.title, titleEn: row.title_en || '',
      abstract: row.abstract || '', abstractKo: row.abstract_ko || '', keywords: row.keywords || [], bodyExcerpt: row.body_excerpt || '',
      numPages: row.num_pages, refStyle: row.ref_style, refHeadingFound: row.ref_heading_found, refBlock: row.ref_block || '',
      duplicate: row.duplicate, similar: row.similar_papers || [], similarError: row.similar_error || '', elapsedSec: row.elapsed_sec != null ? +row.elapsed_sec : null,
      memo: row.memo || '',
      references: (row.review_references || []).sort((a, b) => a.idx - b.idx)
        .map(x => ({ idx: x.idx, raw: x.raw, verdict: x.verdict, reason: x.reason || '', candidate: x.candidate || null }))
    };
  }
  const isCloudId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);

  // 새 검토는 검토 1행 + 참고문헌 여러 행을 넣고 id 를 돌려준다.
  // 이미 저장된 검토(메모 수정 등)는 검토 행만 고친다. 참고문헌은 만든 뒤 바뀌지 않는다.
  async function putReview(r) {
    if (isCloudId(r.id)) {
      const row = toRow(r);
      delete row.created_at; // 만든 시각은 바꿀 수 없다 (칸 단위 UPDATE 권한에 없음)
      check(await sb.from('reviews').update(row).eq('id', r.id));
      return r.id;
    }
    const { id } = check(await sb.from('reviews').insert(toRow(r)).select('id').single());
    const refs = (r.references || []).map(x => ({ review_id: id, idx: x.idx, raw: x.raw, verdict: x.verdict, reason: x.reason || null, candidate: x.candidate || null }));
    if (refs.length) {
      const res = await sb.from('review_references').insert(refs);
      if (res.error) { await sb.from('reviews').delete().eq('id', id); check(res); } // 반쯤 저장된 검토를 남기지 않는다
    }
    return id;
  }

  async function getReview(id) {
    const row = check(await sb.from('reviews').select('*, review_references(*)').eq('id', id).maybeSingle());
    return row ? fromRow(row) : undefined;
  }

  // 이력 목록·중복성 비교에 필요한 칸만 (jsonb 결과는 빼서 가볍게)
  async function allReviews() {
    const rows = check(await sb.from('reviews')
      .select('id, created_at, filename, file_hash, title, title_en, abstract, abstract_ko, body_excerpt')
      .order('created_at', { ascending: false }));
    return rows.map(fromRow);
  }
  // 백업용: 결과까지 모두
  async function allReviewsFull() {
    const rows = check(await sb.from('reviews').select('*, review_references(*)').order('created_at', { ascending: false }));
    return rows.map(fromRow);
  }
  async function deleteReview(id) { check(await sb.from('reviews').delete().eq('id', id)); }

  async function getSettings() {
    const row = check(await sb.from('user_settings').select('threshold, similar_count, mailto').maybeSingle());
    return row ? { threshold: row.threshold, similarCount: row.similar_count, mailto: row.mailto } : null;
  }
  async function saveSettings(s) {
    // owner_id 는 보내지 않는다: 새 행이면 기본값 auth.uid() 가 들어가고, 있으면 그 행의 설정 칸만 고친다
    check(await sb.from('user_settings').upsert({ threshold: s.threshold, similar_count: s.similarCount, mailto: s.mailto || '' }, { onConflict: 'owner_id' }));
  }

  return {
    configured, init, onChange, active, signIn, signOut, user: () => user,
    putReview, getReview, allReviews, allReviewsFull, deleteReview, getSettings, saveSettings, isCloudId
  };
})();
