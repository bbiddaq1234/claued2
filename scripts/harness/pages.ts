// 9장 6.5-a 로컬 하네스 — 실제 네이버 대신 스마트에디터의 함정 지점만 흉내 낸
// 가짜 에디터 페이지. 목적은 셀렉터의 정확성이 아니라 "입력 순서"가 맞는지
// 검증하는 것이다(스스로 문서에 있는 경고: 하네스 결과를 실제 에디터의 증거로
// 쓰지 말 것 — 특히 서식 적용 자체의 시각적 정확성).
//
// 계측: window.__hnEvent(name, detail)를 Node 쪽에서 page.exposeFunction으로
// 바인딩해 받는다. 브라우저가 닫힌 뒤에도 Node 배열에 기록이 남는다.

const SHARED_STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: sans-serif; }
`;

// 안쪽 iframe(#mainFrame) 문서 — 제목/본문/툴바/팝업/사이드바/하단 검색바.
export function buildInnerHtml(opts: { breakBody?: boolean } = {}): string {
  const bodyBlock = opts.breakBody
    ? `
    <div id="notBody">
      <div class="not-a-match" contenteditable="true"></div>
    </div>`
    : `
    <div class="se-main-container">
      <div class="se-content" id="seContent">
        <div class="se-component se-text">
          <div class="se-section-text">
            <div class="se-component-content">
              <div class="se-text-paragraph" contenteditable="true" data-hn-role="body-initial"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>${SHARED_STYLE}
  .se-toolbar { padding: 6px; border-bottom: 1px solid #ccc; background:#fafafa; }
  .se-toolbar button { margin-right: 6px; }
  .se-format-dropdown, .se-color-dropdown { display:none; border:1px solid #ccc; padding:4px; background:#fff; }
  .se-help-container { padding:8px; background:#eef; }
  .se-popup-dim { position:fixed; inset:0; background:rgba(0,0,0,.3); z-index:50; }
  .se-popup-container { position:fixed; top:200px; left:400px; z-index:51; background:#fff; border:1px solid #999; padding:16px; }
  .se-sidebar { position:fixed; right:0; top:100px; width:300px; height:795px; background:#f5f5f5; border-left:1px solid #ccc; }
  .se-flayer-unified-toolbar-wrapper { position:fixed; left:0; right:0; top:300px; height:550px; }
  .se-flayer-unified-search-input { width:200px; }
  .se-caption[style*="width:0"] { overflow:hidden; }
  blockquote.se-quotation { border-left:4px solid #999; margin:8px 0; padding:4px 8px; }
</style></head>
<body>
  <div class="se-toolbar">
    <button class="se-image-toolbar-button" data-hn="image-btn">사진</button>
    <button class="se-text-format-toolbar-button" data-hn="format-open">문단서식</button>
    <div class="se-format-dropdown" id="formatDropdown">
      <button class="se-toolbar-option-text-format-sectionTitle-button" data-hn="fmt-heading">소제목</button>
      <button class="se-toolbar-option-text-format-text-button" data-hn="fmt-body">본문</button>
      <button class="se-toolbar-option-text-format-quotation-button" data-hn="fmt-quote">인용구</button>
    </div>
    <button class="se-insert-horizontal-line-default-toolbar-button" data-hn="divider-btn">구분선</button>
    <button class="se-bold-toolbar-button" data-hn="bold-btn">굵게</button>
    <button class="se-background-color-toolbar-button" data-hn="bgcolor-open">배경색</button>
    <div class="se-color-dropdown" id="colorDropdown">
      <button title="#fff8b2" data-hn="bgcolor-yellow">노랑</button>
      <button class="se-color-palette-no-color" data-hn="bgcolor-none">없음</button>
    </div>
    <!-- ⚠️ 7-1 decoy: has-text('취소')를 쓰면 이 버튼이 눌린다. 0회 클릭이어야 한다. -->
    <button class="se-strikethrough-decoy" data-hn="strikethrough">취소선</button>
  </div>

  <div class="se-help-container">
    <button class="se-help-panel-close-button" data-hn="help-close">도움말 닫기</button>
  </div>

  <div class="se-popup-dim" id="popupDim"></div>
  <div class="se-popup-container" id="restorePopup">
    <div class="se-popup-dialog">
      <p>작성 중인 글이 있습니다. 이어서 쓰시겠습니까?</p>
      <button class="se-popup-button-cancel" data-hn="popup-cancel">취소</button>
    </div>
  </div>

  <div class="se-section-documentTitle">
    <div class="se-text-paragraph" contenteditable="true" data-hn-role="title"></div>
  </div>
${bodyBlock}

  <aside class="se-sidebar se-sidebar-container-library" id="sidebar" style="display:none">
    <button class="se-sidebar-close-button" data-hn="sidebar-close">도크 닫기</button>
  </aside>

  <div class="se-flayer-unified-toolbar-wrapper">
    <input class="se-flayer-unified-search-input" id="bottomSearch" placeholder="글감 검색" />
  </div>

  <input type="file" id="fileInput" accept="image/*" style="display:none" />

  <script>
  function emit(name, detail) {
    if (window.__hnEvent) window.__hnEvent(name, detail === undefined ? '' : String(detail));
  }
  document.addEventListener('click', function (e) {
    emit('click-at', JSON.stringify({ x: e.clientX, y: e.clientY, cls: e.target && e.target.className }));
  }, true);

  function placeCaretAtEnd(el) {
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function appendNewParagraph() {
    var el = document.createElement('div');
    el.className = 'se-component se-text';
    el.innerHTML = '<div class="se-section-text"><div class="se-component-content"><div class="se-text-paragraph" contenteditable="true"></div></div></div>';
    document.getElementById('seContent').appendChild(el);
    var editable = el.querySelector('.se-text-paragraph');
    placeCaretAtEnd(editable);
    emit('new-paragraph-created');
    return editable;
  }

  // 실제 에디터는 편집 캔버스 전체가 "빈 영역 클릭 → 새 문단"을 받아준다.
  // #seContent 요소 자체의 높이는 자식 컴포넌트 높이의 합이라 "마지막 컴포넌트
  // 바로 아래"를 클릭하면 실제로는 문서 배경(빈 여백)을 때리는 경우가 많다 —
  // 그래서 document 레벨에서 받고, 툴바/팝업/제목/컴포넌트 내부만 제외한다.
  var EXCLUDE_SELECTOR =
    'button, input, .se-toolbar, .se-popup-container, .se-help-container, ' +
    '.se-sidebar, .se-flayer-unified-toolbar-wrapper, .se-section-documentTitle, .se-component';
  document.addEventListener('click', function (e) {
    if (e.target.closest(EXCLUDE_SELECTOR)) return;
    if (!document.getElementById('seContent')) return;
    appendNewParagraph();
  });

  document.querySelector('[data-hn="popup-cancel"]').addEventListener('click', function () {
    var popup = document.getElementById('restorePopup');
    var dim = document.getElementById('popupDim');
    if (popup) popup.remove();
    if (dim) dim.remove();
    emit('popup-cancelled');
  });

  document.querySelector('[data-hn="help-close"]').addEventListener('click', function () {
    document.querySelector('.se-help-container').style.display = 'none';
    emit('help-closed');
  });

  document.querySelector('[data-hn="sidebar-close"]').addEventListener('click', function () {
    document.getElementById('sidebar').style.display = 'none';
    emit('sidebar-closed');
  });

  document.querySelector('[data-hn="strikethrough"]').addEventListener('click', function () {
    emit('strikethrough-clicked');
  });

  document.querySelector('[data-hn="format-open"]').addEventListener('click', function () {
    var dd = document.getElementById('formatDropdown');
    dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
  });
  document.querySelector('[data-hn="bgcolor-open"]').addEventListener('click', function () {
    var dd = document.getElementById('colorDropdown');
    dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
  });
  document.querySelector('[data-hn="fmt-heading"]').addEventListener('click', function () {
    document.getElementById('formatDropdown').style.display = 'none';
    emit('format-heading');
  });
  document.querySelector('[data-hn="fmt-body"]').addEventListener('click', function () {
    document.getElementById('formatDropdown').style.display = 'none';
    emit('format-body');
  });
  document.querySelector('[data-hn="fmt-quote"]').addEventListener('click', function () {
    document.getElementById('formatDropdown').style.display = 'none';
    applyQuoteFormat();
  });
  document.querySelector('[data-hn="bgcolor-yellow"]').addEventListener('click', function () {
    document.getElementById('colorDropdown').style.display = 'none';
    emit('bgcolor-yellow');
  });
  document.querySelector('[data-hn="bgcolor-none"]').addEventListener('click', function () {
    document.getElementById('colorDropdown').style.display = 'none';
    emit('bgcolor-none');
  });
  document.querySelector('[data-hn="bold-btn"]').addEventListener('click', function () {
    emit('bold-toggle');
  });

  function applyQuoteFormat() {
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    var text = range.toString();
    var node = range.startContainer;
    var paraEl = node.nodeType === 3 ? node.parentElement : node;
    var component = paraEl.closest('.se-component') || paraEl;
    if (!text) text = component.textContent;
    var bq = document.createElement('blockquote');
    bq.className = 'se-component se-quotation';
    bq.setAttribute('contenteditable', 'true');
    bq.textContent = text;
    component.replaceWith(bq);
    // ⚠️ 7-5: 컴포넌트 안에서는 어떤 키로도 탈출되지 않는다 — Enter/화살표를 막는다.
    bq.addEventListener('keydown', function (e) { e.preventDefault(); });
    placeCaretAtEnd(bq);
    emit('quote-applied', bq.textContent);
  }

  document.querySelector('[data-hn="divider-btn"]').addEventListener('click', function () {
    var hr = document.createElement('hr');
    hr.className = 'se-component se-horizontal-line';
    document.getElementById('seContent').appendChild(hr);
    emit('divider-inserted');
  });

  document.querySelector('[data-hn="image-btn"]').addEventListener('click', function () {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    emit('file-uploaded', file ? file.name : '(none)');
    var wrap = document.createElement('div');
    wrap.className = 'se-component se-image';
    wrap.innerHTML =
      '<div class="se-image-resource">[이미지]</div>' +
      '<div class="se-caption se-module se-module-text se-is-empty" contenteditable="true" ' +
      'style="width:0;height:0;overflow:hidden;"></div>';
    document.getElementById('seContent').appendChild(wrap);
    var sidebar = document.getElementById('sidebar');
    sidebar.style.display = 'block'; // ⚠️ 7-21: 사진을 넣으면 우측 도크가 자동으로 열린다
    emit('sidebar-opened-by-image');

    wrap.addEventListener('click', function (ev) {
      var cap = wrap.querySelector('.se-caption');
      if (!cap.classList.contains('se-is-on')) {
        cap.classList.remove('se-is-empty');
        cap.classList.add('se-is-on');
        cap.style.width = '';
        cap.style.height = '';
        cap.style.overflow = '';
        emit('image-component-expanded');
      }
    });
  });

  var bottomSearch = document.getElementById('bottomSearch');
  bottomSearch.addEventListener('focus', function () { emit('bottom-search-focused'); });
  bottomSearch.addEventListener('input', function () { emit('bottom-search-input', bottomSearch.value); });
  </script>
</body></html>`;
}

// 바깥 문서 — 발행 버튼/공개 범위는 iframe "밖"에 둔다(6-9: 환경에 따라 밖일 수도
// 있다는 서술을 실제로 재현해 clickAnywhere의 폴백 경로를 검증한다).
export function buildOuterHtml(innerPath: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>${SHARED_STYLE}
  iframe#mainFrame { width: 1366px; height: 900px; border: 0; display: block; }
  #outerControls { padding: 8px; }
  #visibilityLayer { display: none; padding: 8px; border: 1px solid #ccc; margin-top: 8px; }
  #visibilityLayer label { display: inline-block; width: 90px; height: 20px; border: 1px solid #ddd; margin-right: 8px; cursor: pointer; }
  #visibilityLayer input[type="radio"] { opacity: 0; width: 13px; height: 13px; position: absolute; }
</style></head>
<body>
  <div id="outerControls">
    <button data-click-area="tpb.publish" class="publish_btn__m9KHH">발행</button>
    <button class="reserve-decoy" data-hn="reserve-decoy">예약 발행 0건</button>
    <div id="visibilityLayer">
      <input type="radio" name="open" id="open_public" value="2" checked />
      <label for="open_public">전체공개</label>
      <input type="radio" name="open" id="open_neighbor" value="3" />
      <label for="open_neighbor">이웃공개</label>
      <input type="radio" name="open" id="open_both_neighbor" value="1" />
      <label for="open_both_neighbor">서로이웃공개</label>
      <input type="radio" name="open" id="open_private" value="0" />
      <label for="open_private">비공개</label>
      <button data-click-area="tpb*i.publish" class="confirm_btn__WEaBq">확인</button>
    </div>
  </div>
  <iframe id="mainFrame" src="${innerPath}"></iframe>
  <script>
  function emit(name, detail) {
    if (window.__hnEvent) window.__hnEvent(name, detail === undefined ? '' : String(detail));
  }
  document.querySelector('[data-hn="reserve-decoy"]').addEventListener('click', function () {
    emit('reserve-decoy-clicked');
  });
  document.querySelector('[data-click-area="tpb.publish"]').addEventListener('click', function () {
    document.getElementById('visibilityLayer').style.display = 'block';
    emit('publish-open-clicked');
  });
  document.querySelector('[data-click-area="tpb*i.publish"]').addEventListener('click', function () {
    var checked = document.querySelector('input[name="open"]:checked');
    emit('confirm-clicked', JSON.stringify({ checkedId: checked ? checked.id : null }));
    if (checked) {
      history.pushState(null, '', '/testblogid/223456789012');
      emit('navigated-to-published', location.href);
    }
  });
  </script>
</body></html>`;
}
