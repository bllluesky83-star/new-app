-- RefCheck: Supabase 스키마 + RLS 정책 + 권한(GRANT)
--
-- 실행: Supabase 대시보드 → SQL Editor 에 붙여 넣고 Run. 여러 번 실행해도 되도록 작성했다.
--
-- 전제: 로그인한 사용자(authenticated)만 자기 데이터에 접근한다.
--   publishable(anon) 키는 공개용이라 누구나 쓸 수 있으므로, 로그인하지 않은 요청(anon)에는 아무 권한도 주지 않는다.
--   혼자 쓰는 도구라면 계정을 하나 만든 뒤 Authentication → Sign In / Providers 에서
--   "Allow new users to sign up" 을 꺼 두면 다른 사람이 계정을 만들 수 없다.
--
-- 테이블
--   reviews            검토 1건 (앱의 review 객체). 중복성·유사 연구 결과는 jsonb 로 통째 저장
--   review_references  참고문헌 판정 (검토 1건에 여러 행). X 건수 등을 SQL 로 바로 집계할 수 있게 따로 둔다
--   user_settings      사용자별 설정 (기준값, 유사 논문 수, API 연락용 이메일)
-- API 응답 캐시는 공개 학술 데이터라 지금처럼 브라우저(IndexedDB)에 두고 여기에는 만들지 않는다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  filename           text not null,
  file_hash          text not null,
  title              text not null,
  title_en           text,
  abstract           text,
  abstract_ko        text,
  keywords           text[] not null default '{}',
  body_excerpt       text,
  num_pages          integer check (num_pages >= 0),
  ref_style          text check (ref_style in ('bracket', 'numbered', 'author-year', 'none')),
  ref_heading_found  boolean not null default false,
  ref_block          text,
  duplicate          jsonb not null default '{}'::jsonb,   -- { score, compared, sameFileReviewIds, top[] }
  similar_papers     jsonb not null default '[]'::jsonb,   -- [{ title, authors, year, date, venue, citations, similarity, url, abstract }] ("similar" 은 예약어라 못 씀)
  similar_error      text,
  elapsed_sec        numeric(6, 1),
  memo               text not null default '',
  -- review_references 가 (review_id, owner_id) 로 참조할 수 있게
  unique (id, owner_id)
);

create table if not exists public.review_references (
  review_id   uuid not null,
  owner_id    uuid not null default auth.uid(),
  idx         integer not null check (idx > 0),
  raw         text not null,
  verdict     text not null check (verdict in ('O', 'X', '?')),
  reason      text,
  candidate   jsonb,                                       -- { title, year, authors, venue, url, source }
  primary key (review_id, idx),
  -- 참고문헌의 주인이 검토의 주인과 반드시 같도록 (남의 검토에 행을 끼워 넣지 못하게)
  foreign key (review_id, owner_id) references public.reviews (id, owner_id) on delete cascade
);

create table if not exists public.user_settings (
  owner_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  threshold      integer not null default 40 check (threshold between 1 and 100),
  similar_count  integer not null default 20 check (similar_count between 10 and 50),
  mailto         text not null default '',
  updated_at     timestamptz not null default now()
);

create index if not exists reviews_owner_created_idx on public.reviews (owner_id, created_at desc);
create index if not exists reviews_owner_hash_idx    on public.reviews (owner_id, file_hash);
create index if not exists review_references_owner_idx on public.review_references (owner_id);
create index if not exists review_references_x_idx on public.review_references (review_id) where verdict = 'X';

-- updated_at 자동 갱신 (메모 수정 등)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. 권한 (GRANT)
--    Supabase 는 public 스키마의 새 테이블에 anon·authenticated 모두 전체 권한을 기본으로 준다.
--    먼저 모두 거두고, 로그인한 사용자에게 필요한 것만 다시 준다. 실제 행 단위 제한은 아래 RLS 가 한다.
-- ---------------------------------------------------------------------------

revoke all on table public.reviews, public.review_references, public.user_settings from public, anon, authenticated;

grant select, insert, delete on table public.reviews           to authenticated;
grant select, insert, delete on table public.review_references to authenticated;
grant select, insert         on table public.user_settings     to authenticated;

-- UPDATE 는 칸 단위로만 준다. id·owner_id·created_at 은 만든 뒤 바꿀 수 없고, updated_at 은 트리거가 채운다.
grant update (filename, file_hash, title, title_en, abstract, abstract_ko, keywords, body_excerpt, num_pages,
              ref_style, ref_heading_found, ref_block, duplicate, similar_papers, similar_error, elapsed_sec, memo)
  on table public.reviews to authenticated;
grant update (raw, verdict, reason, candidate) on table public.review_references to authenticated;
grant update (threshold, similar_count, mailto) on table public.user_settings to authenticated;

-- 트리거 함수는 직접 호출할 일이 없으므로 실행 권한을 거둔다
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS (행 단위 보안): 자기 행(owner_id = 로그인한 사용자)만 보고·쓰고·지울 수 있다
--    (select auth.uid()) 로 감싸면 행마다가 아니라 쿼리마다 한 번만 계산되어 빠르다.
-- ---------------------------------------------------------------------------

alter table public.reviews           enable row level security;
alter table public.review_references enable row level security;
alter table public.user_settings     enable row level security;

-- reviews
drop policy if exists "reviews: 본인 조회" on public.reviews;
drop policy if exists "reviews: 본인 추가" on public.reviews;
drop policy if exists "reviews: 본인 수정" on public.reviews;
drop policy if exists "reviews: 본인 삭제" on public.reviews;

create policy "reviews: 본인 조회" on public.reviews
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "reviews: 본인 추가" on public.reviews
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "reviews: 본인 수정" on public.reviews
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "reviews: 본인 삭제" on public.reviews
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- review_references (외래 키가 검토 주인과 같은지 보장하므로 owner_id 만 확인하면 된다)
drop policy if exists "review_references: 본인 조회" on public.review_references;
drop policy if exists "review_references: 본인 추가" on public.review_references;
drop policy if exists "review_references: 본인 수정" on public.review_references;
drop policy if exists "review_references: 본인 삭제" on public.review_references;

create policy "review_references: 본인 조회" on public.review_references
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "review_references: 본인 추가" on public.review_references
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "review_references: 본인 수정" on public.review_references
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "review_references: 본인 삭제" on public.review_references
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- user_settings (지울 일은 없으므로 삭제 정책·권한 없음. 계정을 지우면 함께 지워진다)
drop policy if exists "user_settings: 본인 조회" on public.user_settings;
drop policy if exists "user_settings: 본인 추가" on public.user_settings;
drop policy if exists "user_settings: 본인 수정" on public.user_settings;

create policy "user_settings: 본인 조회" on public.user_settings
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "user_settings: 본인 추가" on public.user_settings
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "user_settings: 본인 수정" on public.user_settings
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

commit;

-- ---------------------------------------------------------------------------
-- 점검용 (선택): 실행 뒤 아래를 돌려 RLS 가 켜졌는지, anon 권한이 없는지 확인
-- ---------------------------------------------------------------------------
-- select relname, relrowsecurity from pg_class
--  where relnamespace = 'public'::regnamespace and relname in ('reviews', 'review_references', 'user_settings');
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name in ('reviews', 'review_references', 'user_settings')
--  order by table_name, grantee;
