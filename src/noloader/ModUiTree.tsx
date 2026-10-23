import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ModPageDescriptor, ModUiNode } from "./core/ui-extension";

interface ModUiTreeProps {
  page: ModPageDescriptor;
  styles?: string;
  onAction(action: string): void;
}

const hostStyles = `
  :host { display: block; color: #e7edf7; font: 14px/1.55 Inter, system-ui, sans-serif; }
  *, *::before, *::after { box-sizing: border-box; }
  .noloader-page { display: grid; gap: 16px; }
  .noloader-stack { display: flex; gap: 12px; }
  .noloader-stack.column { flex-direction: column; }
  .noloader-stack.row { flex-direction: row; flex-wrap: wrap; align-items: center; }
  .noloader-card { display: grid; gap: 10px; padding: 18px; border: 1px solid rgba(186, 203, 226, .14); border-radius: 10px; background: rgba(10, 14, 21, .5); }
  .noloader-card-title { margin: 0; color: #f3f6fb; font-size: 15px; font-weight: 650; }
  .noloader-text { margin: 0; color: #c1cad8; white-space: pre-wrap; overflow-wrap: anywhere; }
  .noloader-heading { margin: 0; color: #f3f6fb; line-height: 1.25; }
  h1.noloader-heading { font-size: 25px; }
  h2.noloader-heading { font-size: 20px; }
  h3.noloader-heading { font-size: 16px; }
  .noloader-action { width: fit-content; min-height: 40px; padding: 8px 14px; border: 1px solid rgba(107, 166, 255, .55); border-radius: 7px; background: rgba(46, 110, 201, .18); color: #eff6ff; font: inherit; font-weight: 600; cursor: pointer; }
  .noloader-action:hover { background: rgba(46, 110, 201, .32); }
  .noloader-action:focus-visible { outline: 2px solid #8dbaff; outline-offset: 2px; }
`;

export function ModUiTree({ page, styles, onAction }: ModUiTreeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<Root>();
  const mountRef = useRef<HTMLDivElement>();
  const extensionStyleRef = useRef<HTMLStyleElement>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.attachShadow({ mode: "open" });
    const baseStyle = document.createElement("style");
    baseStyle.textContent = hostStyles;
    const extensionStyle = document.createElement("style");
    const mount = document.createElement("div");
    mount.className = "noloader-page";
    shadow.append(baseStyle, extensionStyle, mount);
    extensionStyleRef.current = extensionStyle;
    mountRef.current = mount;
    rootRef.current = createRoot(mount);
    return () => {
      rootRef.current?.unmount();
      rootRef.current = undefined;
      extensionStyleRef.current = undefined;
      mountRef.current = undefined;
      shadow.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!rootRef.current || !mountRef.current || !extensionStyleRef.current)
      return;
    extensionStyleRef.current.textContent = styles ?? "";
    rootRef.current.render(
      <>
        {page.content.map((node, index) => (
          <ModNode
            key={`${node.type}-${index}`}
            node={node}
            onAction={onAction}
          />
        ))}
      </>,
    );
  }, [page, styles, onAction]);

  return <div ref={hostRef} />;
}

function ModNode({
  node,
  onAction,
}: {
  node: ModUiNode;
  onAction(action: string): void;
}) {
  switch (node.type) {
    case "text":
      return <p className="noloader-text">{node.text}</p>;
    case "heading": {
      const Tag = `h${node.level}` as "h1" | "h2" | "h3";
      return <Tag className="noloader-heading">{node.text}</Tag>;
    }
    case "button":
      return (
        <button
          className="noloader-action"
          type="button"
          onClick={() => onAction(node.action)}
        >
          {node.label}
        </button>
      );
    case "stack":
      return (
        <div className={`noloader-stack ${node.direction}`}>
          {node.children.map((child, index) => (
            <ModNode
              key={`${child.type}-${index}`}
              node={child}
              onAction={onAction}
            />
          ))}
        </div>
      );
    case "card":
      return (
        <section className="noloader-card">
          {node.title ? (
            <h2 className="noloader-card-title">{node.title}</h2>
          ) : null}
          {node.children.map((child, index) => (
            <ModNode
              key={`${child.type}-${index}`}
              node={child}
              onAction={onAction}
            />
          ))}
        </section>
      );
  }
}
