export type ModUiNode =
  | { type: "text"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "button"; id: string; label: string; action: string }
  | { type: "stack"; direction: "row" | "column"; children: ModUiNode[] }
  | { type: "card"; title?: string; children: ModUiNode[] };

export interface ModPageDescriptor {
  id: string;
  title: string;
  content: ModUiNode[];
}

export interface ModNavigationDescriptor {
  id: string;
  label: string;
  pageId: string;
  icon?: "puzzle" | "sparkles" | "info";
}

export type UiDescriptorResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const LOCAL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_NODE_COUNT = 256;
const MAX_CHILDREN = 100;
const MAX_DEPTH = 8;
const MAX_TEXT_LENGTH = 1000;

export function validateModPage(
  value: unknown,
): UiDescriptorResult<ModPageDescriptor> {
  if (!isRecord(value)) return invalid("Page descriptor must be an object.");
  if (!hasOnlyKeys(value, ["id", "title", "content"]))
    return invalid("Page has unknown fields.");
  if (!isLocalId(value.id)) return invalid("Page ID is invalid.");
  if (!isText(value.title, 80))
    return invalid("Page title must be 1–80 characters.");
  if (!Array.isArray(value.content) || value.content.length > MAX_CHILDREN) {
    return invalid(
      `Page content must contain at most ${MAX_CHILDREN} components.`,
    );
  }

  const budget = { remaining: MAX_NODE_COUNT };
  const content: ModUiNode[] = [];
  for (const node of value.content) {
    const parsed = validateNode(node, 0, budget);
    if (parsed.ok === false) return invalid(parsed.message);
    content.push(parsed.value);
  }
  return { ok: true, value: { id: value.id, title: value.title, content } };
}

export function validateModNavigation(
  value: unknown,
): UiDescriptorResult<ModNavigationDescriptor> {
  if (!isRecord(value))
    return invalid("Navigation descriptor must be an object.");
  if (!hasOnlyKeys(value, ["id", "label", "pageId", "icon"])) {
    return invalid("Navigation descriptor has unknown fields.");
  }
  if (!isLocalId(value.id) || !isLocalId(value.pageId)) {
    return invalid(
      "Navigation IDs must use lowercase letters, digits, `_`, or `-`.",
    );
  }
  if (!isText(value.label, 48))
    return invalid("Navigation label must be 1–48 characters.");
  if (
    value.icon !== undefined &&
    value.icon !== "puzzle" &&
    value.icon !== "sparkles" &&
    value.icon !== "info"
  ) {
    return invalid("Navigation icon is not supported.");
  }
  return {
    ok: true,
    value: {
      id: value.id,
      label: value.label,
      pageId: value.pageId,
      ...(value.icon === undefined
        ? {}
        : { icon: value.icon as ModNavigationDescriptor["icon"] }),
    },
  };
}

function validateNode(
  value: unknown,
  depth: number,
  budget: { remaining: number },
): UiDescriptorResult<ModUiNode> {
  budget.remaining -= 1;
  if (budget.remaining < 0)
    return invalid(`Page exceeds ${MAX_NODE_COUNT} components.`);
  if (depth > MAX_DEPTH)
    return invalid(`Page nesting exceeds ${MAX_DEPTH} levels.`);
  if (!isRecord(value) || typeof value.type !== "string") {
    return invalid("Page component must be an object with a type.");
  }

  if (value.type === "text" || value.type === "heading") {
    const keys =
      value.type === "text" ? ["type", "text"] : ["type", "text", "level"];
    if (!hasOnlyKeys(value, keys))
      return invalid("Text component has unknown fields.");
    if (!isText(value.text, MAX_TEXT_LENGTH))
      return invalid("Text must be 1–1,000 characters.");
    if (value.type === "text")
      return { ok: true, value: { type: "text", text: value.text } };
    if (value.level !== 1 && value.level !== 2 && value.level !== 3) {
      return invalid("Heading level must be 1, 2, or 3.");
    }
    return {
      ok: true,
      value: { type: "heading", level: value.level, text: value.text },
    };
  }

  if (value.type === "button") {
    if (!hasOnlyKeys(value, ["type", "id", "label", "action"])) {
      return invalid("Button component has unknown fields.");
    }
    if (!isLocalId(value.id) || !isLocalId(value.action)) {
      return invalid(
        "Button ID and action must use lowercase letters, digits, `_`, or `-`.",
      );
    }
    if (!isText(value.label, 80))
      return invalid("Button label must be 1–80 characters.");
    return {
      ok: true,
      value: {
        type: "button",
        id: value.id,
        label: value.label,
        action: value.action,
      },
    };
  }

  if (value.type === "stack" || value.type === "card") {
    const keys =
      value.type === "stack"
        ? ["type", "direction", "children"]
        : ["type", "title", "children"];
    if (!hasOnlyKeys(value, keys))
      return invalid("Container component has unknown fields.");
    if (
      value.type === "stack" &&
      value.direction !== "row" &&
      value.direction !== "column"
    ) {
      return invalid("Stack direction must be `row` or `column`.");
    }
    if (
      value.type === "card" &&
      value.title !== undefined &&
      !isText(value.title, 80)
    ) {
      return invalid("Card title must be 1–80 characters.");
    }
    if (
      !Array.isArray(value.children) ||
      value.children.length > MAX_CHILDREN
    ) {
      return invalid(
        `Container must contain at most ${MAX_CHILDREN} components.`,
      );
    }
    const children: ModUiNode[] = [];
    for (const child of value.children) {
      const parsed = validateNode(child, depth + 1, budget);
      if (parsed.ok === false) return invalid(parsed.message);
      children.push(parsed.value);
    }
    if (value.type === "stack") {
      return {
        ok: true,
        value: {
          type: "stack",
          direction: value.direction as "row" | "column",
          children,
        },
      };
    }
    return {
      ok: true,
      value: {
        type: "card",
        ...(value.title === undefined ? {} : { title: value.title as string }),
        children,
      },
    };
  }

  return invalid(`Unsupported page component type "${value.type}".`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isLocalId(value: unknown): value is string {
  return typeof value === "string" && LOCAL_ID_PATTERN.test(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim() &&
    value.length <= maxLength
  );
}

function invalid<T>(message: string): UiDescriptorResult<T> {
  return { ok: false, message };
}
