export type StylesheetResult =
  | { ok: true; css: string }
  | { ok: false; message: string };

const MAX_STYLESHEET_LENGTH = 2 * 1024 * 1024;
const UNSUPPORTED_STYLESHEET_FEATURES =
  /@import\b|url\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i;

export function validateModStyles(value: unknown): StylesheetResult {
  if (typeof value !== "string") {
    return { ok: false, message: "Stylesheet must be text." };
  }
  if (value.length > MAX_STYLESHEET_LENGTH) {
    return {
      ok: false,
      message: `Stylesheet exceeds the ${MAX_STYLESHEET_LENGTH}-character limit.`,
    };
  }
  if (UNSUPPORTED_STYLESHEET_FEATURES.test(value)) {
    return {
      ok: false,
      message:
        "Styles may not import external resources or use browser-specific executable CSS.",
    };
  }
  return { ok: true, css: value };
}
