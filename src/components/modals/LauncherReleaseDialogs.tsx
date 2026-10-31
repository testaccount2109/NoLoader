import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import type { UpdateInfo } from "../../types/updater";
import { openExternalUrl } from "../../services/tauri-service";
import { useTranslation } from "react-i18next";

const dialogPanel =
  "w-full overflow-hidden rounded-2xl border border-white/10 bg-[#101114] shadow-2xl shadow-black/60";

export function LauncherUpdatePrompt({
  update,
  onClose,
}: {
  update: UpdateInfo;
  onClose: (suppressThisVersion: boolean) => void;
}) {
  const { t } = useTranslation();
  const [suppressThisVersion, setSuppressThisVersion] = useState(false);
  const version = update.version.replace(/^v/, "");
  const tag = update.version.startsWith("v") ? update.version : `v${version}`;
  const expectedReleaseUrl = `https://github.com/NoRiskClient/noriskclient-launcher/releases/tag/${encodeURIComponent(tag)}`;
  const releaseUrl = update.download_url?.startsWith(
    "https://github.com/NoRiskClient/noriskclient-launcher/releases/",
  )
    ? update.download_url
    : expectedReleaseUrl;

  const openInstallerPage = async () => {
    try {
      await openExternalUrl(releaseUrl);
      onClose(suppressThisVersion);
    } catch (error) {
      console.error("Failed to open the launcher installer page:", error);
      toast.error(t("header.update.open_failed"));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(suppressThisVersion);
      }}
    >
      <section
        className={`${dialogPanel} max-w-xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="launcher-update-title"
      >
        <header className="flex items-start gap-4 border-b border-white/10 px-6 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <Icon icon="solar:download-minimalistic-bold" className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-minecraft text-xs uppercase tracking-[0.18em] text-amber-300">
              NoRisk Launcher
            </p>
            <h2 id="launcher-update-title" className="mt-1 font-smallcaps text-2xl font-bold text-white">
              {t("header.update.prompt_title", { version })}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t("header.update.close")}
            onClick={() => onClose(suppressThisVersion)}
            className="rounded-lg p-2 text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            <Icon icon="solar:close-circle-bold" className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[48vh] overflow-y-auto px-6 py-5">
          <p className="font-minecraft text-sm leading-6 text-white/70">
            {t("header.update.prompt_description")}
          </p>
          {update.body?.trim() && (
            <div className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-white/70 [&_a]:text-sky-300 [&_h1]:mb-3 [&_h1]:font-smallcaps [&_h1]:text-xl [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-smallcaps [&_h2]:text-lg [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3 [&_strong]:font-semibold [&_strong]:text-white">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{update.body}</ReactMarkdown>
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-4 border-t border-white/10 bg-white/[0.025] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 font-minecraft text-xs text-white/60">
            <input
              type="checkbox"
              checked={suppressThisVersion}
              onChange={(event) => setSuppressThisVersion(event.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
            {t("header.update.dont_show_again")}
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose(suppressThisVersion)}
              className="rounded-lg border border-white/10 px-4 py-2.5 font-minecraft text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              {t("header.update.close")}
            </button>
            <button
              type="button"
              onClick={() => void openInstallerPage()}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 font-minecraft text-sm font-bold text-[#17130a] transition hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:ring-offset-2 focus:ring-offset-[#101114]"
            >
              <Icon icon="solar:share-bold" className="h-4 w-4" />
              {t("header.update.open_installer")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function LauncherChangelogDialog({
  version,
  markdown,
  onClose,
}: {
  version: string;
  markdown: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm">
      <section
        className={`${dialogPanel} flex max-h-[86vh] max-w-4xl flex-col`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="launcher-changelog-title"
      >
        <header className="flex items-center gap-4 border-b border-white/10 px-6 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
            <Icon icon="solar:document-text-bold" className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-minecraft text-xs uppercase tracking-[0.18em] text-sky-300">
              {t("header.changelog.eyebrow")}
            </p>
            <h2 id="launcher-changelog-title" className="mt-1 font-smallcaps text-2xl font-bold text-white">
              {t("header.changelog.title", { version })}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t("header.update.close")}
            onClick={onClose}
            className="rounded-lg p-2 text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            <Icon icon="solar:close-circle-bold" className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm leading-6 text-white/75 [&_a]:text-sky-300 [&_a:hover]:text-sky-200 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-4 [&_h1]:font-smallcaps [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:border-b [&_h2]:border-white/10 [&_h2]:pb-2 [&_h2]:font-smallcaps [&_h2]:text-xl [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-smallcaps [&_h3]:text-lg [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:mb-3 [&_strong]:font-semibold [&_strong]:text-white [&_ul]:mb-4">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (href?.startsWith("https://")) {
                      void openExternalUrl(href).catch((error) =>
                        console.error("Failed to open a changelog link:", error),
                      );
                    }
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {markdown}
          </ReactMarkdown>
        </div>

        <footer className="flex justify-end border-t border-white/10 bg-white/[0.025] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-sky-400 px-5 py-2.5 font-minecraft text-sm font-bold text-[#071217] transition hover:bg-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:ring-offset-2 focus:ring-offset-[#101114]"
          >
            {t("header.changelog.done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
