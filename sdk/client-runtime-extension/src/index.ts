import type { ModPage, NoLoaderActivation, NoLoaderApi } from "../../types/no-loader";

export function activate(api: NoLoaderApi): NoLoaderActivation {
  let status = "Choose an action to try a capability.";
  const page = (): ModPage => ({
    id: "runtime-demo",
    title: "Client Runtime Example",
    content: [
      { type: "text", text: "This sample has powerful access to the NoRisk Client renderer and your PC. Only enable code you trust." },
      { type: "text", text: status },
      { type: "button", id: "window", label: "Open custom window", action: "window" },
      { type: "button", id: "client", label: "Render custom client UI", action: "client" },
      { type: "button", id: "file", label: "Choose a file to save", action: "file" },
      { type: "button", id: "process", label: "Run whoami", action: "process" },
    ],
  });
  const removePage = api.registerPage(page());
  const removeNavigation = api.registerNavigationItem({ id: "runtime-demo", label: "Runtime API", pageId: "runtime-demo", icon: "sparkles" });
  const removeAction = api.onAction(async (action) => {
    try {
      if (action === "window") {
        const id = await api.windows.open({ id: "custom-window", title: "Extension Window", width: 720, height: 520 });
        await api.client.execute(`
          const root = document.querySelector("#noloader-extension-root");
          root.innerHTML = "<main style='font:16px system-ui;padding:32px;color:#f4f7fb'><h1>Own extension UI</h1><p>This view is rendered by an extension ES module in a separate NoRisk Client window.</p><button id='count'>Add counter</button><output id='value' style='margin-left:12px'>0</output></main>";
          let count = 0;
          root.querySelector("#count").addEventListener("click", () => { document.querySelector("#value").textContent = String(++count); });
        `, id);
        status = "Custom extension window opened and rendered.";
      } else if (action === "client") {
        await api.client.execute(`
          let badge = document.getElementById("client-runtime-example-badge");
          if (!badge) { badge = document.createElement("div"); badge.id = "client-runtime-example-badge"; badge.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:14px 18px;border-radius:12px;background:#174c78;color:white;font:14px system-ui;box-shadow:0 8px 30px #0008"; document.body.append(badge); }
          badge.textContent = "Client UI added by an extension";
        `);
        status = "Custom code ran inside the main NoRisk Client webview.";
      } else if (action === "file") {
        const path = await api.dialogs.saveFile({ defaultPath: "noloader-extension-note.txt", filters: [{ name: "Text file", extensions: ["txt"] }] });
        if (path) { await api.system.files.writeText(path, "Written by a NoRisk Client extension.\\n"); status = `Saved a file: ${path}`; }
        else status = "File save cancelled.";
      } else if (action === "process") {
        const result = await api.system.process.run({ program: "whoami" });
        status = `Process exit ${result.code}: ${result.stdout.trim() || result.stderr.trim()}`;
      } else return;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
    api.updatePage("runtime-demo", page());
  });
  return () => { removeAction(); removeNavigation(); removePage(); };
}
