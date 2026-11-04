# RefCheck 소개 발표자료를 PowerPoint 자동화로 만든다 (이 PC의 PowerPoint 사용).
# 실행: powershell -ExecutionPolicy Bypass -File docs\make-deck.ps1
# 결과: docs\RefCheck_소개.pptx, 점검용 슬라이드 이미지 docs\preview\slide-N.png
param([switch]$NoPreview)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'docs\RefCheck_소개.pptx'
$shot = Join-Path $root 'docs\capture\app-screen.png'
$logo = Join-Path $root 'img\logo.svg'
$previewDir = Join-Path $root 'docs\preview'

# ---------- 색 (앱과 같은 팔레트) ----------
function RGBx([string]$hex) { [int]('0x' + $hex.Substring(0, 2)) + 256 * [int]('0x' + $hex.Substring(2, 2)) + 65536 * [int]('0x' + $hex.Substring(4, 2)) }
$NAVY = '1F4E79'; $DEEP = '15385A'; $SKY = 'E6F2FB'; $SKY2 = 'D6E9F8'; $WHITE = 'FFFFFF'; $SHEET2 = 'F4F9FD'
$INK = '18232E'; $INK2 = '3E4C5A'; $MUTED = '6C7B8A'; $RULE = 'CFE0EE'
$OK = '2D6A4A'; $OKS = 'E3F3EA'; $BAD = '9B2335'; $BADS = 'FBE9EC'; $WARN = '8A5A12'; $WARNS = 'FBF0DB'; $ICE = '9CC7EF'
$FONT_SERIF = 'Noto Serif KR'; $FONT_SANS = 'Noto Sans KR'

# ---------- 도우미 ----------
function Txt($s, [string]$text, $x, $y, $w, $h, $size = 14, [string]$color = $INK, [switch]$Serif, [switch]$Bold, [string]$align = 'left', [string]$name = '', [string]$anchor = 'top') {
  $sh = $s.Shapes.AddTextbox(1, $x, $y, $w, $h)
  if ($name) { $sh.Name = $name }
  $tf = $sh.TextFrame2
  $tf.WordWrap = -1; $tf.AutoSize = 0
  $tf.MarginLeft = 0; $tf.MarginRight = 0; $tf.MarginTop = 0; $tf.MarginBottom = 0
  $tf.VerticalAnchor = @{ top = 1; middle = 3; bottom = 4 }[$anchor]
  $tr = $tf.TextRange
  $tr.Text = $text
  [string]$fn = $FONT_SANS
  if ($Serif) { $fn = $FONT_SERIF }
  $tr.Font.Name = $fn; $tr.Font.NameFarEast = $fn
  $tr.Font.Size = $size
  $tr.Font.Bold = $(if ($Bold) { -1 } else { 0 })
  $tr.Font.Fill.ForeColor.RGB = (RGBx $color)
  $tr.ParagraphFormat.Alignment = @{ left = 1; center = 2; right = 3 }[$align]
  # 한국어를 글자 단위가 아니라 단어(어절) 단위로 줄바꿈
  $tr.ParagraphFormat.WordWrap = -1
  # 세로 정렬은 글자를 넣은 뒤에 지정해야 유지된다
  $sh.TextFrame.AutoSize = 0
  $sh.TextFrame.VerticalAnchor = @{ top = 1; middle = 3; bottom = 4 }[$anchor]
  $sh.Height = $h
  return $sh
}
function Box($s, $x, $y, $w, $h, [string]$fill = $WHITE, [string]$line = '', [int]$type = 5, [double]$radius = 0.06, [switch]$Shadow, [string]$name = '') {
  $sh = $s.Shapes.AddShape($type, $x, $y, $w, $h)
  if ($name) { $sh.Name = $name }
  if ($type -eq 5) { $sh.Adjustments.Item(1) = $radius }
  $sh.Fill.Solid(); $sh.Fill.ForeColor.RGB = (RGBx $fill)
  if ($line) { $sh.Line.Visible = -1; $sh.Line.ForeColor.RGB = (RGBx $line); $sh.Line.Weight = 1 } else { $sh.Line.Visible = 0 }
  if ($Shadow) {
    $sh.Shadow.Visible = -1; $sh.Shadow.ForeColor.RGB = (RGBx $DEEP); $sh.Shadow.Transparency = 0.86
    $sh.Shadow.Blur = 14; $sh.Shadow.OffsetX = 0; $sh.Shadow.OffsetY = 4
  } else { $sh.Shadow.Visible = 0 }
  $sh.TextFrame2.TextRange.Text = ''
  return $sh
}
# 남색 원 안의 로마 숫자 (반복 모티프)
function Numeral($s, [string]$n, $x, $y, $d = 40, [string]$fill = $NAVY, [string]$color = $WHITE) {
  $c = Box $s $x $y $d $d $fill '' 9
  $tf = $c.TextFrame2; $tf.MarginLeft = 0; $tf.MarginRight = 0; $tf.MarginTop = 0; $tf.MarginBottom = 0; $tf.VerticalAnchor = 3; $tf.WordWrap = 0
  $tr = $tf.TextRange; $tr.Text = $n
  $tr.Font.Name = $FONT_SERIF; $tr.Font.NameFarEast = $FONT_SERIF; $tr.Font.Size = [single][math]::Round($d * 0.38); $tr.Font.Bold = -1
  $tr.Font.Fill.ForeColor.RGB = (RGBx $color); $tr.ParagraphFormat.Alignment = 2
  $c.Name = "Numeral $n"
  return $c
}
function Bullets($sh, [double]$after = 8) {
  $p = $sh.TextFrame2.TextRange.ParagraphFormat
  $p.Bullet.Visible = -1; $p.Bullet.Character = 8226; $p.Bullet.Font.Fill.ForeColor.RGB = (RGBx $NAVY)
  $p.LeftIndent = 16; $p.FirstLineIndent = -16; $p.SpaceAfter = $after
}
function Arrow($s, $x1, $y1, $x2, $y2) {
  $c = $s.Shapes.AddConnector(1, $x1, $y1, $x2, $y2)
  $c.Line.ForeColor.RGB = (RGBx $NAVY); $c.Line.Weight = 2; $c.Line.EndArrowheadStyle = 2
  return $c
}
function Bg($s, [string]$hex) { $s.FollowMasterBackground = 0; $s.Background.Fill.Solid(); $s.Background.Fill.ForeColor.RGB = (RGBx $hex) }
# 본문 슬라이드 공통: 장 표시 + 제목 + 꼬리말 + 쪽 번호 (모든 슬라이드에서 같은 위치)
function Content($pres, [string]$kicker, [string]$title, [string]$notes) {
  $s = $pres.Slides.Add($pres.Slides.Count + 1, 12)
  Bg $s $SKY
  $k = Txt $s $kicker 48 26 700 18 12 $NAVY -Bold -name 'Kicker'
  $k.TextFrame2.TextRange.Font.Spacing = 1.5
  [void](Txt $s $title 48 46 864 48 30 $INK -Serif -Bold -name 'Title')
  [void](Txt $s 'RefCheck · 연구결과 검토 도우미' 48 510 400 16 10 $MUTED -name 'Footer')
  [void](Txt $s ([string]$s.SlideIndex) 832 510 80 16 10 $MUTED -align right -name 'Page number')
  $s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = $notes
  return $s
}

# ---------- 시작 ----------
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Add(0)
$pres.PageSetup.SlideWidth = 960; $pres.PageSetup.SlideHeight = 540
try {
  $fs = $pres.SlideMaster.Theme.ThemeFontScheme
  foreach ($i in 1, 3) { $fs.MajorFont.Item($i).Name = $FONT_SERIF; $fs.MinorFont.Item($i).Name = $FONT_SANS }
} catch { }

# ===== 1. 표지 =====
$s = $pres.Slides.Add(1, 12); Bg $s $DEEP
try { $lg = $s.Shapes.AddPicture($logo, 0, -1, 64, 58, 44, 44); $lg.Name = 'Logo'; $lg.AlternativeText = 'RefCheck 로고' } catch { }
[void](Txt $s 'RefCheck' 118 66 300 30 22 $SKY -Serif -Bold)
$k = Txt $s 'MANUSCRIPT REVIEW ASSISTANT' 64 168 400 18 12 $ICE -Bold; $k.TextFrame2.TextRange.Font.Spacing = 2
$t = Txt $s "연구결과`r검토 도우미" 64 192 420 140 50 $WHITE -Serif -Bold -name 'Title'
$t.TextFrame2.TextRange.ParagraphFormat.SpaceWithin = 1.0
[void](Txt $s '논문 PDF 한 편으로 참고문헌 검증, 중복성, 유사 연구를 한 화면에서 확인합니다' 64 344 400 56 17 $SKY2)
[void](Txt $s 'new-app-phi-peach.vercel.app' 64 468 300 18 13 $ICE -Bold)
[void](Txt $s '2026. 11. 04' 64 488 300 18 12 $ICE)
$p = $s.Shapes.AddPicture($shot, 0, -1, 500, 140, 420, 236.25); $p.Name = 'App screenshot'
$p.AlternativeText = 'RefCheck 결과 화면: 중복성, 참고문헌 검증, 유사 주제 연구가 한 화면에 나란히 있다 (가상 데이터)'
$p.Line.Visible = -1; $p.Line.ForeColor.RGB = (RGBx $NAVY); $p.Line.Weight = 1
$p.Shadow.Visible = -1; $p.Shadow.ForeColor.RGB = 0; $p.Shadow.Transparency = 0.6; $p.Shadow.Blur = 24; $p.Shadow.OffsetX = 0; $p.Shadow.OffsetY = 10
[void](Txt $s '화면의 논문·수치는 예시용 가상 데이터' 500 384 420 14 10 $ICE -align right)
$s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = 'RefCheck는 학회 투고 원고를 검토할 때 반복하던 참고문헌 확인, 중복성 검토, 유사 연구 찾기를 PDF 한 편으로 한 번에 처리하는 도구입니다. 오른쪽은 실제 결과 화면입니다.'

# ===== 2. 문제 =====
$s = Content $pres '왜 필요한가' '논문 검토의 대부분은 검색과 대조입니다' '검토 담당자는 원고마다 같은 세 가지 일을 손으로 반복합니다. 판단보다 검색과 대조가 대부분이라 자동화 효과가 큰 일입니다.'
# 좁은 칸의 한국어는 PowerPoint가 어절 중간에서 끊으므로 줄바꿈(`v)을 직접 넣는다
$cards = @(
  @('I', '중복성 검토', "투고 원고가 기존 연구나`v이전에 투고된 원고와`v내용이 겹치는지 확인"),
  @('II', '참고문헌 확인', "참고문헌을 하나씩 검색해`v실제로 있는지, 저자·연도·`v제목이 맞는지 대조"),
  @('III', '유사 주제 점검', "비슷한 주제로 최근 어떤`v연구가 나왔는지 찾아`v검토 의견에 반영"))
for ($i = 0; $i -lt 3; $i++) {
  $x = 48 + $i * 296
  [void](Box $s $x 116 272 248 $WHITE '' 5 0.05 -Shadow -name "Card $($i+1)")
  [void](Numeral $s $cards[$i][0] ($x + 24) 140 44)
  [void](Txt $s $cards[$i][1] ($x + 24) 204 224 30 20 $INK -Bold)
  [void](Txt $s $cards[$i][2] ($x + 24) 244 224 96 14 $INK2)
}
$cb = Box $s 48 392 864 76 $SKY2 '' 5 0.12 -name 'Callout'
$ct = Txt $s '판단보다 검색·대조가 대부분인 반복 작업 — 자동화하면 검토자는 판단에만 집중할 수 있습니다' 76 392 808 76 17 $DEEP -Bold -anchor middle

# ===== 3. 해결 흐름 =====
$s = Content $pres '어떻게 동작하나' 'PDF 한 편이면 세 가지 결과가 한 화면에' 'PDF를 올리면 텍스트와 참고문헌을 뽑고, 참고문헌 검증과 유사 연구 검색을 동시에 돌린 뒤, 그 결과로 중복성을 계산합니다. 결과는 자동 저장되고 Excel로 내보낼 수 있습니다.'
function Step($s, $x, $y, $w, $h, [string]$head, [string]$sub, [string]$fill = $WHITE, [string]$hc = $INK, [string]$sc = $MUTED) {
  [void](Box $s $x $y $w $h $fill '' 5 0.1 -Shadow)
  [void](Txt $s $head ($x + 14) ($y + 14) ($w - 28) 24 16 $hc -Bold)
  [void](Txt $s $sub ($x + 14) ($y + 42) ($w - 28) ($h - 50) 12 $sc)
}
Step $s 48 196 132 96 'PDF 업로드' "끌어다 놓기`v또는 버튼"
Step $s 212 196 160 96 '텍스트 추출' "제목·초록·키워드·`v참고문헌"
Step $s 404 134 196 96 'II. 참고문헌 검증' "CrossRef → OpenAlex`vO/X와 사유" $SKY2 $DEEP $INK2
Step $s 404 258 196 96 'III. 유사 연구 검색' "OpenAlex 50편 →`v유사도 상위 20편" $SKY2 $DEEP $INK2
Step $s 632 196 150 96 'I. 중복성 계산' "TF-IDF`v외부 초록 + 이전 투고" $SKY2 $DEEP $INK2
Step $s 814 196 98 96 '저장' "Supabase`vExcel" $NAVY $WHITE $SKY2
[void](Arrow $s 180 244 212 244)
[void](Arrow $s 372 244 404 182)
[void](Arrow $s 372 244 404 306)
[void](Arrow $s 600 182 632 228)
[void](Arrow $s 600 306 632 260)
[void](Arrow $s 782 244 814 244)
$chips = @('설치 없이 브라우저에서 바로 실행', '논문 1편 분석 10~30초', '결과 자동 저장 · Excel 3시트')
for ($i = 0; $i -lt 3; $i++) {
  $x = 48 + $i * 296
  [void](Box $s $x 400 272 52 $WHITE $RULE 5 0.2)
  [void](Txt $s $chips[$i] ($x + 16) 400 240 52 14 $INK2 -Bold -anchor middle -align center)
}

# ===== 4. 화면 =====
$s = Content $pres '화면 구성' '한 화면에서 세 가지 결과를 함께 봅니다' '넓은 화면에서는 세 영역이 나란히 놓이고, 내용이 길면 영역마다 안에서 스크롤됩니다. 좁은 화면과 휴대폰에서는 위아래로 쌓입니다.'
$p = $s.Shapes.AddPicture($shot, 0, -1, 48, 112, 640, 360); $p.Name = 'App screenshot'
$p.AlternativeText = 'RefCheck 결과 화면 (가상 데이터): 왼쪽 중복성 게이지 46%, 가운데 참고문헌 O/X 표, 오른쪽 유사 주제 연구 목록'
$p.Line.Visible = -1; $p.Line.ForeColor.RGB = (RGBx $RULE); $p.Line.Weight = 1
$p.Shadow.Visible = -1; $p.Shadow.ForeColor.RGB = (RGBx $DEEP); $p.Shadow.Transparency = 0.85; $p.Shadow.Blur = 16; $p.Shadow.OffsetX = 0; $p.Shadow.OffsetY = 6
[void](Txt $s '화면 속 논문·저자·수치는 모두 예시용 가상 데이터입니다' 48 480 640 16 10 $MUTED)
$notes4 = @(@('I', '중복성', "유사도 게이지와 기준선,`v상위 5편, 겹치는 구절"), @('II', '참고문헌 검증', "O/X 표, X가 맨 위,`v원문 아래에 사유"), @('III', '유사 주제 연구', "정렬·기간 필터,`v논문 목록"))
for ($i = 0; $i -lt 3; $i++) {
  $y = 120 + $i * 118
  [void](Numeral $s $notes4[$i][0] 716 $y 36)
  [void](Txt $s $notes4[$i][1] 764 ($y + 2) 148 24 16 $INK -Bold)
  [void](Txt $s $notes4[$i][2] 764 ($y + 30) 148 70 13 $INK2)
}

# ===== 5. I 중복성 =====
$s = Content $pres 'I. 중복성 검토' '기존 연구·이전 투고와 얼마나 겹치는지' '외부 논문은 초록만 받을 수 있어서 초록끼리 비교하고, 이전에 검토한 원고와는 본문 앞부분까지 비교합니다. 샘플 원고는 이미 출판된 같은 논문(국문 초록)과 82%로 나와 주의가 떴습니다.'
[void](Box $s 48 116 330 340 $WHITE '' 5 0.05 -Shadow -name 'Gauge card')
$bg = $s.Shapes.AddShape(20, 89, 156, 248, 248); $bg.Adjustments.Item(1) = 180; $bg.Adjustments.Item(2) = 0; $bg.Adjustments.Item(3) = 0.14
$bg.Fill.Solid(); $bg.Fill.ForeColor.RGB = (RGBx $RULE); $bg.Line.Visible = 0; $bg.Name = 'Gauge track'
$fg = $s.Shapes.AddShape(20, 89, 156, 248, 248); $fg.Adjustments.Item(1) = 180; $fg.Adjustments.Item(2) = 327.6; $fg.Adjustments.Item(3) = 0.14
$fg.Fill.Solid(); $fg.Fill.ForeColor.RGB = (RGBx $BAD); $fg.Line.Visible = 0; $fg.Name = 'Gauge value 82%'
[void](Txt $s '82%' 89 220 248 60 48 $INK -Serif -Bold -align center)
$bd = Box $s 179 292 68 24 $BADS $BAD 5 0.3 -name 'Badge'
[void](Txt $s '주의' 179 292 68 24 13 $BAD -Bold -align center -anchor middle)
[void](Txt $s "실제 사례: 투고 원고가 이미 출판된`v같은 논문(국문 초록)과 82%" 72 338 282 60 14 $INK2 -align center)
[void](Txt $s '기준 40% 이상이면 "주의"' 72 406 282 24 12 $MUTED -align center)
$b = Txt $s ("비교 대상: OpenAlex 유사 논문 초록 20편 + 이전에 검토한 투고 원고`r" +
  "방법: TF-IDF 코사인 유사도 (한글은 두 글자 단위로 비교)`r" +
  "전체 점수 = 가장 비슷한 1편의 점수, 기준값은 설정에서 변경`r" +
  "단어 5개 이상 연속으로 겹치는 구절을 하이라이트`r" +
  "같은 파일을 다시 올리면 `"동일 파일`"로 표시") 410 124 502 280 16 $INK
Bullets $b 12
[void](Txt $s '1차 걸러내기 용도 — iThenticate·KCI 문헌유사도 검사를 대신하지 않습니다' 410 420 502 36 12 $MUTED)

# ===== 6. II 참고문헌 =====
$s = Content $pres 'II. 참고문헌 검증' '참고문헌마다 O/X와 사유를 붙입니다' '참고문헌을 항목별로 나눈 뒤 CrossRef, OpenAlex 순서로 찾아 제목·제1저자·연도를 대조합니다. 샘플 3편의 참고문헌 38건을 모두 인식했고, 일부러 틀리게 쓴 가짜 참고문헌 3건은 모두 X로 잡았습니다.'
$st = @(@('100%', '참고문헌 인식률', '샘플 3편 38건 (29·7·2건)'), @('3 / 3', '가짜 참고문헌을 X로', '없는 논문·연도 오류·저자 오류'))
for ($i = 0; $i -lt 2; $i++) {
  $y = 116 + $i * 176
  [void](Box $s 48 $y 250 160 $WHITE '' 5 0.06 -Shadow)
  [void](Txt $s $st[$i][0] 72 ($y + 18) 210 60 44 $NAVY -Serif -Bold)
  [void](Txt $s $st[$i][1] 72 ($y + 86) 210 24 16 $INK -Bold)
  [void](Txt $s $st[$i][2] 72 ($y + 114) 210 36 12 $MUTED)
}
$tb = $s.Shapes.AddTable(5, 2, 330, 116, 582, 250); $tb.Name = 'Verdict rules'
$tbl = $tb.Table
$tbl.Columns.Item(1).Width = 96; $tbl.Columns.Item(2).Width = 486
$rows = @(@('판정', '조건'), @('O', 'CrossRef·OpenAlex에서 찾았고 제목 85점 이상, 제1저자·연도 일치'), @('X', 'DB에 없음 · 제목만 비슷함 · 연도/저자 불일치 · DOI 오류 (사유 표시)'), @('(경미)', '프리프린트와 출판본 연도 1년 차이 — X로 두되 구분'), @('–', '웹 자료(데이터셋·코드), 한글 문헌 (KCI 미연동) — 확인 못 함'))
$vc = @($INK2, $OK, $BAD, $WARN, $MUTED)
for ($r = 1; $r -le 5; $r++) {
  for ($c = 1; $c -le 2; $c++) {
    $cell = $tbl.Cell($r, $c)
    $cell.Shape.Fill.Solid(); $cell.Shape.Fill.ForeColor.RGB = (RGBx $(if ($r -eq 1) { $DEEP } elseif ($r % 2 -eq 0) { $WHITE } else { $SHEET2 }))
    $tf = $cell.Shape.TextFrame2; $tf.MarginLeft = 12; $tf.MarginRight = 12; $tf.MarginTop = 6; $tf.MarginBottom = 6; $tf.VerticalAnchor = 3
    $tr = $tf.TextRange; $tr.Text = $rows[$r - 1][$c - 1]
    $tr.Font.Name = $FONT_SANS; $tr.Font.NameFarEast = $FONT_SANS
    if ($r -eq 1) { $tr.Font.Size = 13; $tr.Font.Bold = -1; $tr.Font.Fill.ForeColor.RGB = (RGBx $WHITE) }
    elseif ($c -eq 1) { $tr.Font.Size = 18; $tr.Font.Bold = -1; $tr.Font.Name = $FONT_SERIF; $tr.Font.NameFarEast = $FONT_SERIF; $tr.Font.Fill.ForeColor.RGB = (RGBx $vc[$r - 1]); $tr.ParagraphFormat.Alignment = 2 }
    else { $tr.Font.Size = 14; $tr.Font.Bold = 0; $tr.Font.Fill.ForeColor.RGB = (RGBx $INK) }
  }
}
for ($r = 1; $r -le 5; $r++) { $tbl.Rows.Item($r).Height = 44 }
[void](Box $s 330 396 582 60 $BADS '' 5 0.12)
[void](Txt $s "샘플에서 찾은 실제 오기`v제1저자 철자 (Zang → Zhang) · 발표 연도 (2011 → 2013)" 350 396 542 60 14 $BAD -Bold -anchor middle)

# ===== 7. III 유사 연구 =====
$s = Content $pres 'III. 유사 주제 연구' '비슷한 주제의 최신 연구를 바로 확인합니다' '원고의 영문 제목, 키워드, 초록 핵심어로 OpenAlex를 검색하고, 투고 원고 초록과 유사도를 매겨 상위 20편을 보여 줍니다. 기본은 최신순입니다.'
[void](Box $s 48 116 440 340 $WHITE '' 5 0.05 -Shadow -name 'List card')
[void](Txt $s '최신순 · 전체 기간 · 20편' 72 132 392 18 12 $MUTED -Bold)
$items = @(@('Retinex-Guided Enhancement for Night Vision', 'Jung, Han, Oh (2026) · 인용 14', 0.21), @('Multispectral Fusion under Low Light', 'Seo, Kang (2025) · 인용 31', 0.17), @('Benchmarking Feature Matching in the Dark', 'Bae, Song (2025) · 인용 9', 0.14), @('Night-Time Pedestrian Detection', 'Lim, Shin (2024) · 인용 22', 0.12))
for ($i = 0; $i -lt 4; $i++) {
  $y = 160 + $i * 70
  [void](Txt $s "[$($i+1)]" 72 $y 30 20 13 $MUTED -Serif)
  [void](Txt $s $items[$i][0] 104 $y 360 22 15 $NAVY -Serif -Bold)
  [void](Txt $s $items[$i][1] 104 ($y + 24) 220 18 12 $MUTED)
  [void](Box $s 330 ($y + 30) 70 5 $RULE '' 1)
  [void](Box $s 330 ($y + 30) (70 * $items[$i][2] * 3) 5 $NAVY '' 1)
  [void](Txt $s ("유사도 {0}%" -f [math]::Round($items[$i][2] * 100)) 408 ($y + 23) 70 18 12 $INK -Bold)
}
[void](Txt $s '예시 화면 · 가상 데이터' 72 430 392 16 10 $MUTED)
$steps = @(@('1', '검색', '제목·키워드·초록 핵심어로 OpenAlex 검색 (최대 50편씩)'), @('2', '선별', '투고 원고 초록과 TF-IDF 유사도 → 상위 20편'), @('3', '정렬', '최신순(기본) · 유사도순 · 인용순'), @('4', '기간', '최근 3년 · 5년 · 전체, 초록 펼쳐 보기'))
for ($i = 0; $i -lt 4; $i++) {
  $y = 120 + $i * 86
  [void](Numeral $s $steps[$i][0] 520 $y 36 $WHITE $NAVY)
  [void](Txt $s $steps[$i][1] 570 ($y + 2) 342 24 17 $INK -Bold)
  [void](Txt $s $steps[$i][2] 570 ($y + 30) 342 44 14 $INK2)
}

# ===== 8. 검증 결과 =====
$s = Content $pres '검증 결과' '완료 기준 9개를 모두 통과했습니다' 'PRD에 정한 완료 기준 9개를 샘플 논문과 자동 점검 페이지로 확인했습니다. 스캔 이미지 PDF는 범위 밖이라 안내 문구를 띄우고 멈춥니다.'
$kp = @(@('100%', '참고문헌 인식', '샘플 3편 38건'), @('3 / 3', '가짜 참고문헌 X 판정', '진짜 참고문헌은 O'), @('25초', '논문 1편 분석', '참고문헌 29건 · 기준 3분'), @('15 / 15', '자동 점검 통과', '파일로 연 Chrome에서'))
for ($i = 0; $i -lt 4; $i++) {
  $x = 48 + $i * 222
  [void](Box $s $x 116 198 176 $WHITE '' 5 0.06 -Shadow)
  [void](Txt $s $kp[$i][0] ($x + 20) 136 158 60 40 $NAVY -Serif -Bold)
  [void](Txt $s $kp[$i][1] ($x + 20) 204 158 24 16 $INK -Bold)
  [void](Txt $s $kp[$i][2] ($x + 20) 232 158 40 12 $MUTED)
}
[void](Box $s 48 316 864 140 $WHITE $RULE 5 0.06)
$c1 = Txt $s ("같은 논문을 다시 올리면 이전 투고분이 100%로 1위`r유사 주제 연구 최신순 20편`r중복성 점수와 상위 5편 표시") 76 316 400 140 15 $INK -anchor middle
Bullets $c1 10
$c2 = Txt $s ("브라우저를 껐다 켜도 검토 이력 유지`rExcel 내보내기 (시트 3개)`r샘플 3편 모두 오류 없이 결과 표시") 496 316 400 140 15 $INK -anchor middle
Bullets $c2 10

# ===== 9. 기술 구성 =====
$s = Content $pres '기술 구성과 보안' '설치 없이 브라우저에서, 데이터는 본인만' '앱은 브라우저에서 바로 돌고, 학술 검색은 CrossRef와 OpenAlex를 직접 부릅니다. 로그인하면 Supabase에 저장되는데, RLS로 본인 행만 다룰 수 있고 로그인하지 않은 요청에는 권한이 없습니다. GitHub에 올리면 Vercel이 자동 배포합니다.'
[void](Box $s 48 116 230 236 $NAVY '' 5 0.06 -Shadow)
[void](Txt $s '브라우저' 70 134 186 26 18 $WHITE -Bold)
$bt = Txt $s ("RefCheck.html`rpdf.js — PDF 읽기`rTF-IDF — 유사도`rSheetJS — Excel") 70 170 186 160 14 $SKY2
Bullets $bt 8
$bt.TextFrame2.TextRange.ParagraphFormat.Bullet.Font.Fill.ForeColor.RGB = (RGBx $ICE)
$ext = @(@('CrossRef · OpenAlex', '참고문헌 검증·유사 연구 (학술 API)', 116), @('Supabase', '로그인 · 검토 이력 저장 (RLS)', 204), @('GitHub → Vercel', 'push하면 자동 배포', 292))
foreach ($e in $ext) {
  [void](Box $s 330 $e[2] 240 60 $WHITE '' 5 0.1 -Shadow)
  [void](Txt $s $e[0] 348 ($e[2] + 9) 210 22 15 $DEEP -Bold)
  [void](Txt $s $e[1] 348 ($e[2] + 33) 210 20 12 $MUTED)
  [void](Arrow $s 278 ($e[2] + 30) 330 ($e[2] + 30))
}
[void](Box $s 602 116 310 236 $SKY2 '' 5 0.06)
[void](Txt $s '보안' 624 134 266 26 18 $DEEP -Bold)
$sb = Txt $s ("로그인한 본인 행만 (RLS 정책)`r로그인 전 요청에는 권한 없음`r수정은 칸 단위 권한으로 제한`r브라우저엔 공개용 키만, 비밀 키 없음`r.env.local은 저장소에서 제외") 624 170 270 170 14 $INK
Bullets $sb 7
[void](Box $s 48 380 864 76 $WHITE $RULE 5 0.12)
[void](Txt $s '로그인하지 않으면 이 브라우저에만 저장 · 로그인하면 다른 PC·휴대폰에서도 같은 이력' 76 380 808 76 16 $INK2 -Bold -anchor middle -align center)

# ===== 10. 한계와 다음 단계 =====
$s = Content $pres '한계와 다음 단계' '1차 걸러내기 도구, 다음은 국내 DB 연동' '지금은 영어 논문과 영문 초록이 있는 국내 논문을 대상으로 합니다. 다음 버전에서는 KCI·RISS 연동과 본문 인용 대조를 우선 검토합니다.'
[void](Box $s 48 116 420 252 $WHITE '' 5 0.06 -Shadow)
[void](Txt $s '현재 한계' 76 136 364 28 20 $BAD -Bold)
$l1 = Txt $s ("스캔 이미지 PDF는 읽지 못함 (OCR 없음)`r한글 참고문헌은 확인 못 함 (KCI 미연동)`r외부 논문은 초록 단위로만 비교`rSemantic Scholar는 API 키가 있어야 사용") 76 180 364 170 15 $INK
Bullets $l1 14
[void](Box $s 492 116 420 252 $NAVY '' 5 0.06 -Shadow)
[void](Txt $s '다음 단계 (v2)' 520 136 364 28 20 $WHITE -Bold)
$l2 = Txt $s ("KCI · RISS · DBpia 연동 (한글 논문)`r본문 인용과 참고문헌 목록 대조`r철회(retracted) 논문 인용 표시`r여러 편 일괄 업로드, AI 차별점 요약") 520 180 364 170 15 $WHITE
Bullets $l2 14
[void](Box $s 48 392 864 64 $SKY2 '' 5 0.14)
[void](Txt $s '역할 분담: 검색·대조는 RefCheck가, 최종 판단은 검토자가' 76 392 808 64 17 $DEEP -Bold -anchor middle -align center)
$l2.TextFrame2.TextRange.ParagraphFormat.Bullet.Font.Fill.ForeColor.RGB = (RGBx $ICE)

# ===== 11. 마무리 =====
$s = $pres.Slides.Add($pres.Slides.Count + 1, 12); Bg $s $DEEP
try { $lg = $s.Shapes.AddPicture($logo, 0, -1, 444, 96, 72, 72); $lg.Name = 'Logo'; $lg.AlternativeText = 'RefCheck 로고' } catch { }
[void](Txt $s '지금 바로 써 보세요' 80 190 800 60 40 $WHITE -Serif -Bold -align center -name 'Title')
[void](Txt $s 'new-app-phi-peach.vercel.app' 80 262 800 36 24 $ICE -Bold -align center)
[void](Txt $s '소스 코드  github.com/bllluesky83-star/new-app' 80 306 800 22 14 $SKY2 -align center)
[void](Box $s 330 360 300 44 $NAVY '' 5 0.5)
[void](Txt $s 'PDF 한 편 → 세 가지 결과' 330 360 300 44 16 $WHITE -Bold -align center -anchor middle)
[void](Txt $s '감사합니다' 80 440 800 30 18 $SKY2 -Serif -align center)
$s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = '공개 주소에서 바로 써 볼 수 있습니다. 로그인하지 않으면 이 브라우저에만 저장되고, 로그인하면 다른 기기에서도 이력을 볼 수 있습니다.'

# ---------- 구역(섹션) ----------
$sec = $pres.SectionProperties
[void]$sec.AddBeforeSlide(1, '소개')
[void]$sec.AddBeforeSlide(3, '해결 방법')
[void]$sec.AddBeforeSlide(5, '기능')
[void]$sec.AddBeforeSlide(8, '결과와 구성')
[void]$sec.AddBeforeSlide(10, '마무리')

# ---------- 저장 ----------
if (Test-Path $out) { Remove-Item $out -Force }
$pres.SaveAs($out, 24)
$n = $pres.Slides.Count
$pres.Close()

# 한국어 어절이 줄 끝에서 둘로 쪼개지지 않게: 모든 문단에 eaLnBrk="0" (PowerPoint 자동화로는 설정할 수 없어 XML을 직접 고친다)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Update')
foreach ($e in @($zip.Entries | Where-Object { $_.FullName -like 'ppt/slides/slide*.xml' })) {
  $sr = New-Object IO.StreamReader($e.Open(), [Text.Encoding]::UTF8); $xml = $sr.ReadToEnd(); $sr.Close()
  $xml = [regex]::Replace($xml, '<a:pPr(?![^>]*eaLnBrk)', '<a:pPr eaLnBrk="0"')
  $xml = [regex]::Replace($xml, '<a:p>(?!<a:pPr)', '<a:p><a:pPr eaLnBrk="0"/>')
  $name = $e.FullName; $e.Delete()
  $ne = $zip.CreateEntry($name)
  $sw = New-Object IO.StreamWriter($ne.Open(), (New-Object Text.UTF8Encoding($false))); $sw.Write($xml); $sw.Close()
}
$zip.Dispose()

if (-not $NoPreview) {
  New-Item -ItemType Directory -Force $previewDir | Out-Null
  Get-ChildItem $previewDir -Filter 'slide-*.png' | Remove-Item -Force
  $pres = $pp.Presentations.Open($out, -1, 0, 0)
  foreach ($sl in $pres.Slides) { $sl.Export((Join-Path $previewDir ("slide-{0:D2}.png" -f $sl.SlideIndex)), 'PNG', 1600, 900) }
  $pres.Close()
}
$pp.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp) | Out-Null
Write-Output "Saved $out ($n slides)"
