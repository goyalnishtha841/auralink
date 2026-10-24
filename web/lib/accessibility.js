// Accessibility profiles a passenger can set (hub/main.py: ACCESSIBILITY_PROFILES). Each one
// switches the passenger UI and shows the crew a badge, so crew know *how* to help, not just
// what was asked. Keep this list in sync with hub/main.py's ACCESSIBILITY_PROFILES.
export const ACCESSIBILITY_META = {
  deaf_hoh: { icon: "ear", en: "Deaf / hard of hearing", ja: "聴覚に障がいがあります" },
  low_vision: { icon: "eye", en: "Low vision", ja: "視覚に障がいがあります" },
  mobility: { icon: "wheelchair", en: "Reduced mobility", ja: "移動に介助が必要です" },
  cognitive: { icon: "brain", en: "Prefers simple, picture-first screens", ja: "わかりやすい表示を希望" },
};
