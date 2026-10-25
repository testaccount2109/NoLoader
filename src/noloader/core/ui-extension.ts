export type ModUiNode =
  | { type: "text"; text: string }
  | { type: "image"; src: string; alt: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "button"; id: string; label: string; action: string }
  | { type: "toggle"; id: string; label: string; checked: boolean; action: string; disabled?: boolean }
  | { type: "input"; id: string; label: string; value: string; action: string; placeholder?: string; maxLength?: number; disabled?: boolean }
  | { type: "select"; id: string; label: string; value: string; options: Array<{ label: string; value: string }>; action: string; disabled?: boolean }
  | { type: "progress"; value: number; label?: string }
  | { type: "stack"; direction: "row" | "column"; children: ModUiNode[] }
  | { type: "card"; title?: string; children: ModUiNode[] };

export interface ModPageDescriptor {
  id: string;
  title: string;
  content: ModUiNode[];
}

export type ModHomeWidgetPosition = "before-play" | "after-play";

export interface ModHomeWidgetDescriptor extends ModPageDescriptor {
  position: ModHomeWidgetPosition;
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

export function validateModHomeWidget(
  value: unknown,
): UiDescriptorResult<ModHomeWidgetDescriptor> {
  if (!isRecord(value)) return invalid("Home widget descriptor must be an object.");
  if (!hasOnlyKeys(value, ["id", "title", "content", "position"])) {
    return invalid("Home widget has unknown fields.");
  }
  if (
    value.position !== undefined &&
    value.position !== "before-play" &&
    value.position !== "after-play"
  ) {
    return invalid("Home widget position must be `before-play` or `after-play`.");
  }

  const parsedPage = validateModPage({
    id: value.id,
    title: value.title,
    content: value.content,
  });
  if (parsedPage.ok === false) return invalid(parsedPage.message);
  return {
    ok: true,
    value: {
      ...parsedPage.value,
      position: (value.position ?? "before-play") as ModHomeWidgetPosition,
    },
  };
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

  if (value.type === "image") {
    if (!hasOnlyKeys(value, ["type", "src", "alt"])) {
      return invalid("Image component has unknown fields.");
    }
    if (typeof value.src !== "string" || value.src.length > 128 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.src)) {
      return invalid("Image source must be a PNG data URL no larger than 128 KiB.");
    }
    if (!isText(value.alt, 120)) return invalid("Image alt text must be 1–120 characters.");
    return { ok: true, value: { type: "image", src: value.src, alt: value.alt } };
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

  if (value.type === "toggle") {
    if (!hasOnlyKeys(value, ["type", "id", "label", "checked", "action", "disabled"])) {
      return invalid("Toggle component has unknown fields.");
    }
    if (!isLocalId(value.id) || !isLocalId(value.action)) {
      return invalid("Toggle ID and action must use lowercase letters, digits, `_`, or `-`.");
    }
    if (!isText(value.label, 80) || typeof value.checked !== "boolean") {
      return invalid("Toggle needs a label and a boolean checked value.");
    }
    if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
      return invalid("Toggle disabled must be a boolean.");
    }
    return {
      ok: true,
      value: {
        type: "toggle",
        id: value.id,
        label: value.label,
        checked: value.checked,
        action: value.action,
        ...(value.disabled === undefined ? {} : { disabled: value.disabled as boolean }),
      },
    };
  }

  if (value.type === "input") {
    if (!hasOnlyKeys(value, ["type", "id", "label", "value", "action", "placeholder", "maxLength", "disabled"])) {
      return invalid("Input component has unknown fields.");
    }
    if (!isLocalId(value.id) || !isLocalId(value.action)) {
      return invalid("Input ID and action must use lowercase letters, digits, `_`, or `-`.");
    }
    if (!isText(value.label, 80) || typeof value.value !== "string" || value.value.length > 1000) {
      return invalid("Input needs a label and a value no longer than 1,000 characters.");
    }
    if (value.placeholder !== undefined && (typeof value.placeholder !== "string" || value.placeholder.length > 120)) {
      return invalid("Input placeholder must be no longer than 120 characters.");
    }
    if (value.maxLength !== undefined && (typeof value.maxLength !== "number" || !Number.isInteger(value.maxLength) || value.maxLength < 1 || value.maxLength > 1000)) {
      return invalid("Input maxLength must be between 1 and 1,000.");
    }
    if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
      return invalid("Input disabled must be a boolean.");
    }
    return {
      ok: true,
      value: {
        type: "input",
        id: value.id,
        label: value.label,
        value: value.value,
        action: value.action,
        ...(value.placeholder === undefined ? {} : { placeholder: value.placeholder as string }),
        ...(value.maxLength === undefined ? {} : { maxLength: value.maxLength as number }),
        ...(value.disabled === undefined ? {} : { disabled: value.disabled as boolean }),
      },
    };
  }

  if (value.type === "select") {
    if (!hasOnlyKeys(value, ["type", "id", "label", "value", "options", "action", "disabled"])) {
      return invalid("Select component has unknown fields.");
    }
    if (!isLocalId(value.id) || !isLocalId(value.action)) {
      return invalid("Select ID and action must use lowercase letters, digits, `_`, or `-`.");
    }
    if (!isText(value.label, 80) || typeof value.value !== "string" || !Array.isArray(value.options) || value.options.length < 1 || value.options.length > 32) {
      return invalid("Select needs a label, a value, and 1–32 options.");
    }
    const options: Array<{ label: string; value: string }> = [];
    const optionValues = new Set<string>();
    for (const option of value.options) {
      if (!isRecord(option) || !hasOnlyKeys(option, ["label", "value"]) || !isText(option.label, 80) || !isText(option.value, 120) || optionValues.has(option.value)) {
        return invalid("Select options need unique values and labels.");
      }
      options.push({ label: option.label, value: option.value });
      optionValues.add(option.value);
    }
    if (!optionValues.has(value.value)) return invalid("Select value must match one of its options.");
    if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
      return invalid("Select disabled must be a boolean.");
    }
    return {
      ok: true,
      value: {
        type: "select",
        id: value.id,
        label: value.label,
        value: value.value,
        options,
        action: value.action,
        ...(value.disabled === undefined ? {} : { disabled: value.disabled as boolean }),
      },
    };
  }

  if (value.type === "progress") {
    if (!hasOnlyKeys(value, ["type", "value", "label"]) || typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0 || value.value > 100) {
      return invalid("Progress value must be a number between 0 and 100.");
    }
    if (value.label !== undefined && !isText(value.label, 80)) {
      return invalid("Progress label must be 1–80 characters.");
    }
    return {
      ok: true,
      value: { type: "progress", value: value.value, ...(value.label === undefined ? {} : { label: value.label as string }) },
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
