// 네이버 셀렉터 중앙 관리 (6-9, 13장).
//
// ⚠️ 아래 값들은 살아 있는 스마트에디터 ONE에서 클릭까지 확인한 실측값이다.
// 추론으로 다시 만들 수 없다 — 그대로 쓴다. 더 우아해 보이는 대안으로 바꾸지 마라.
// 네이버 DOM이 바뀌어 셀렉터가 깨지면 이 파일 하나만 고치면 되도록,
// 셀렉터를 코드 여기저기에 흩뿌리지 않는다(13장).
//
// 각 항목은 "후보 배열"이다. 위에서부터 순서대로 isVisible인 첫 번째를 쓴다.
// 9장 6.5-b에서 실제 에디터로 새 값이 확인되면, 기존 값을 지우지 말고
// 배열 "앞에" 추가한다 — 다른 계정·시점·A/B에서는 기존 값이 맞을 수 있다.

export const FRAME_SELECTOR = "iframe#mainFrame";

export const EDITOR = {
  restorePopup: [".se-popup-container", ".se-popup-dialog", ".se-popup", "[class*='popup_container']"],

  // ⚠️ 7-1: 여기에 절대 :has-text('취소') 를 쓰지 마라 — '취소선' 버튼에 부분일치해서
  // 글 전체에 취소선이 켜진 채로 타이핑된다. 클래스 기반을 먼저, 텍스트는 팝업
  // 안으로 스코프한 :text-is 정확일치만 쓴다.
  restoreCancel: [
    "button.se-popup-button-cancel",
    ".se-popup-button-cancel",
    ".se-popup-container button:text-is('취소')",
    ".se-popup-dialog button:text-is('취소')",
  ],

  title: [
    ".se-section-documentTitle .se-text-paragraph",
    ".se-documentTitle .se-text-paragraph",
    ".se-title-text",
  ],
  body: [
    ".se-section-text .se-text-paragraph",
    ".se-component-content .se-text-paragraph",
    ".se-main-container",
  ],

  imageButton: [
    "button.se-image-toolbar-button",
    "button[data-name='image']",
    "button[data-log='sti.image']",
    "button.se-toolbar-item-image",
  ],

  helpPanel: [".se-help-container", ".se-help-panel"],
  helpClose: [".se-help-panel-close-button", ".se-help-header button"],
  popupDim: [".se-popup-dim"],

  textFormatOpen: [".se-text-format-toolbar-button"],
  optHeading: [".se-toolbar-option-text-format-sectionTitle-button"],
  optBody: [".se-toolbar-option-text-format-text-button"],
  optQuote: [".se-toolbar-option-text-format-quotation-button"],
  dividerInsert: [".se-insert-horizontal-line-default-toolbar-button"],
  bold: [".se-bold-toolbar-button"],
  bgColorOpen: [".se-background-color-toolbar-button"],
  bgColorYellow: ["button[title='#fff8b2']", ".se-color-palette[title='#fff8b2']"],
  bgColorNone: [".se-color-palette-no-color"],
  contentComponents: [".se-content .se-component"],

  // ⚠️ 7-2: 여기도 :has-text('발행') 을 쓰면 '예약 발행 0건'을 누른다.
  // data-click-area 속성으로만 찾는다. 확인 버튼 값에는 '*'가 들어간 게 맞다.
  publishOpen: ["button[data-click-area='tpb.publish']", "button.publish_btn__m9KHH"],
  publishConfirm: ["button[data-click-area='tpb*i.publish']", "button.confirm_btn__WEaBq"],

  // 공개 범위 — radio input은 opacity:0이라 클릭되지 않는다. label을 눌러야 한다(7-19).
  visibility: {
    public: { label: 'label[for="open_public"]', input: "#open_public" },
    neighbor: { label: 'label[for="open_neighbor"]', input: "#open_neighbor" },
    both: { label: 'label[for="open_both_neighbor"]', input: "#open_both_neighbor" },
    private: { label: 'label[for="open_private"]', input: "#open_private" },
  },

  caption: [".se-caption"], // 펼쳐지면 se-is-on 클래스가 붙는다(7-18)
  imageComponent: [".se-content .se-component.se-image"],

  // 우측 도크 — 환경에 따라 계열이 다르다(7-21). 둘 다 시도한다.
  sidebarClose: [".se-help-panel-close-button", ".se-sidebar-close-button"],
  sidebar: [".se-sidebar", ".se-sidebar-container-library"],

  // 하단 글감 검색바 — 여기로 타이핑이 샌다(7-6).
  bottomToolbar: [".se-flayer-unified-toolbar-wrapper"],
  bottomSearchInput: [".se-flayer-unified-search-input"],
} as const;

export type VisibilityKey = keyof typeof EDITOR.visibility;
