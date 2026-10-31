"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useDebounce } from "../../hooks/useDebounce";
import {
  MinecraftSkinService,
  type SkinCatalogEntry,
} from "../../services/minecraft-skin-service";
import type { SkinVariant } from "../../types/localSkin";

export function SkindexBrowserModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (skin: SkinCatalogEntry, variant: SkinVariant) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [skins, setSkins] = useState<SkinCatalogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [variant, setVariant] = useState<SkinVariant>("classic");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingIds, setImportingIds] = useState<Set<string>>(() => new Set());
  const [retryKey, setRetryKey] = useState(0);
  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void MinecraftSkinService.browseSkindexSkins(debouncedSearch.trim(), page)
      .then((result) => {
        if (cancelled) return;
        setSkins(result.skins);
        setHasMore(result.hasMore);
      })
      .catch((requestError) => {
        if (cancelled) return;
        console.error("Failed to load The Skindex skin catalog:", requestError);
        setError(t("launcher_mods.skin_api.load_failed"));
        setSkins([]);
        setHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, page, retryKey, t]);

  const importSkin = async (skin: SkinCatalogEntry) => {
    setImportingIds((current) => new Set(current).add(skin.id));
    try {
      await onImport(skin, variant);
    } finally {
      setImportingIds((current) => {
        const next = new Set(current);
        next.delete(skin.id);
        return next;
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm">
      <section
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101114] shadow-2xl shadow-black/60"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skin-api-title"
      >
        <header className="flex items-center gap-4 border-b border-white/10 px-6 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fuchsia-400/10 text-fuchsia-200">
            <Icon icon="solar:emoji-funny-circle-bold" className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-minecraft text-[10px] uppercase tracking-[0.18em] text-fuchsia-200/75">
              The Skindex
            </p>
            <h2 id="skin-api-title" className="font-smallcaps text-2xl font-bold text-white">
              SkinAPI
            </h2>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-lg p-2 text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            <Icon icon="solar:close-circle-bold" className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-col gap-4 border-b border-white/10 bg-white/[0.025] px-6 py-4 lg:flex-row lg:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 focus-within:border-fuchsia-300/50">
            <Icon icon="solar:magnifer-linear" className="h-5 w-5 shrink-0 text-white/45" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t("launcher_mods.skin_api.search_placeholder")}
              className="min-w-0 flex-1 bg-transparent font-minecraft text-sm text-white outline-none placeholder:text-white/35"
              aria-label={t("launcher_mods.skin_api.search_placeholder")}
            />
            {search && (
              <button
                type="button"
                aria-label={t("launcher_mods.skin_api.clear_search")}
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
              >
                <Icon icon="solar:close-circle-linear" className="h-4 w-4" />
              </button>
            )}
          </label>

          <div className="flex shrink-0 items-center gap-2">
            <span className="mr-1 font-minecraft text-xs text-white/50">
              {t("launcher_mods.skin_api.model")}
            </span>
            {(["classic", "slim"] as const).map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => setVariant(model)}
                aria-pressed={variant === model}
                className={`rounded-lg border px-3 py-2 font-minecraft text-xs transition ${
                  variant === model
                    ? "border-fuchsia-300/50 bg-fuchsia-300/10 text-fuchsia-100"
                    : "border-white/10 text-white/55 hover:bg-white/5 hover:text-white"
                }`}
              >
                {t(`skins.${model}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex min-h-52 items-center justify-center gap-3 font-minecraft text-sm text-white/60">
              <Icon icon="svg-spinners:ring-resize" className="h-5 w-5" />
              {t("launcher_mods.skin_api.loading")}
            </div>
          ) : error ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
              <Icon icon="solar:cloud-cross-bold" className="h-8 w-8 text-rose-300/80" />
              <p className="max-w-md font-minecraft text-sm text-white/65">{error}</p>
              <button
                type="button"
                onClick={() => setRetryKey((current) => current + 1)}
                className="rounded-lg border border-white/10 px-4 py-2 font-minecraft text-xs text-white/75 hover:bg-white/5"
              >
                {t("launcher_mods.skin_api.retry")}
              </button>
            </div>
          ) : skins.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 font-minecraft text-sm text-white/50">
              <Icon icon="solar:ghost-bold" className="h-8 w-8 text-white/30" />
              {t("launcher_mods.skin_api.no_results")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {skins.map((skin) => {
                const isImporting = importingIds.has(skin.id);
                return (
                  <article
                    key={skin.id}
                    className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.035] transition hover:border-white/20 hover:bg-white/[0.06]"
                  >
                    <div className="relative aspect-[1.18] overflow-hidden bg-black/30">
                      <img
                        src={skin.previewUrl}
                        alt={skin.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        onError={(event) => {
                          event.currentTarget.classList.add("hidden");
                        }}
                      />
                      <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 font-minecraft text-[9px] text-white/70">
                        {t("launcher_mods.skin_api.community_skin")}
                      </span>
                    </div>
                    <div className="space-y-2.5 p-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-minecraft text-xs font-semibold text-white" title={skin.name}>
                          {skin.name}
                        </h3>
                        <p className="mt-1 truncate font-minecraft text-[10px] text-white/40">
                          {t("launcher_mods.skin_api.by_author", { author: skin.author || t("launcher_mods.skin_api.unknown_author") })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void importSkin(skin)}
                        disabled={isImporting}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-2 font-minecraft text-[11px] font-semibold text-white/80 transition hover:border-fuchsia-200/30 hover:bg-fuchsia-300/10 hover:text-white disabled:cursor-wait disabled:opacity-55"
                      >
                        <Icon
                          icon={isImporting ? "svg-spinners:ring-resize" : "solar:add-circle-bold"}
                          className="h-4 w-4"
                        />
                        {isImporting
                          ? t("launcher_mods.skin_api.adding")
                          : t("launcher_mods.skin_api.add_to_library")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-white/10 bg-white/[0.025] px-6 py-4">
          <p className="hidden font-minecraft text-[10px] text-white/35 sm:block">
            {t("launcher_mods.skin_api.footer_note")}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 font-minecraft text-xs text-white/70 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Icon icon="solar:alt-arrow-left-linear" className="h-4 w-4" />
              {t("launcher_mods.skin_api.previous")}
            </button>
            <span className="min-w-10 text-center font-minecraft text-xs tabular-nums text-white/45">
              {page}
            </span>
            <button
              type="button"
              disabled={!hasMore || loading}
              onClick={() => setPage((current) => current + 1)}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 font-minecraft text-xs text-white/70 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
            >
              {t("launcher_mods.skin_api.next")}
              <Icon icon="solar:alt-arrow-right-linear" className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
