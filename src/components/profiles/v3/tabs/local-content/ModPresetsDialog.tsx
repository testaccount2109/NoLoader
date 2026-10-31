"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import type { Profile } from "../../../../../types/profile";
import type { LocalContentItem } from "../../../../../hooks/useLocalContentManager";
import {
  buildPresetFromItems,
  decodePreset,
  deletePresetFromLibrary,
  encodePreset,
  installPreset,
  loadPresetLibrary,
  savePresetToLibrary,
  type ModPreset,
} from "../../../../../utils/mod-presets";

interface ModPresetsDialogProps {
  open: boolean;
  profile: Profile;
  items: LocalContentItem[];
  onClose: () => void;
  onImported: () => void;
}

type Tab = "export" | "import" | "library";

export function ModPresetsDialog({ open, profile, items, onClose, onImported }: ModPresetsDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("export");

  // Export state
  const [presetName, setPresetName] = useState("");
  const [exportCode, setExportCode] = useState<string | null>(null);

  // Import state
  const [importCode, setImportCode] = useState("");
  const [preview, setPreview] = useState<ModPreset | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);

  // Library state
  const [library, setLibrary] = useState<ModPreset[]>([]);

  useEffect(() => {
    if (open) {
      setTab("export");
      setPresetName(`${profile.name} Preset`);
      setExportCode(null);
      setImportCode("");
      setPreview(null);
      setProgress(null);
      setLibrary(loadPresetLibrary());
    }
  }, [open, profile.name]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const exportInfo = useMemo(
    () => (open ? buildPresetFromItems(presetName || profile.name, profile, items) : null),
    [open, presetName, profile, items]
  );

  if (!open) return null;

  const copyText = async (text: string, successKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t(successKey));
    } catch {
      toast.error(t("mod_presets.clipboard_failed"));
    }
  };

  const handleExport = () => {
    if (!exportInfo) return;
    if (exportInfo.preset.items.length === 0) {
      toast.error(t("mod_presets.export_empty"));
      return;
    }
    setExportCode(encodePreset(exportInfo.preset));
  };

  const handleSaveToLibrary = () => {
    if (!exportInfo || exportInfo.preset.items.length === 0) {
      toast.error(t("mod_presets.export_empty"));
      return;
    }
    setLibrary(savePresetToLibrary(exportInfo.preset));
    toast.success(t("mod_presets.saved_to_library"));
  };

  const handlePreviewImport = () => {
    try {
      const parsed = decodePreset(importCode);
      if (parsed.items.length === 0) throw new Error("invalid_preset");
      setPreview(parsed);
    } catch {
      setPreview(null);
      toast.error(t("mod_presets.invalid_code"));
    }
  };

  const runInstall = async (preset: ModPreset) => {
    setInstalling(true);
    setProgress({ done: 0, total: preset.items.length, name: "" });
    try {
      const result = await installPreset(profile, preset, items, (done, total, name) =>
        setProgress({ done, total, name })
      );
      const parts: string[] = [];
      if (result.installed.length > 0)
        parts.push(t("mod_presets.result_installed", { count: result.installed.length }));
      if (result.approximated.length > 0)
        parts.push(t("mod_presets.result_approximated", { count: result.approximated.length }));
      if (result.skipped.length > 0)
        parts.push(t("mod_presets.result_skipped", { count: result.skipped.length }));
      if (result.failed.length > 0)
        parts.push(t("mod_presets.result_failed", { count: result.failed.length }));
      if (result.installed.length > 0 || result.approximated.length > 0) {
        toast.success(parts.join(" · "));
        onImported();
      } else {
        toast(parts.join(" · ") || t("mod_presets.nothing_installed"));
      }
      if (result.failed.length > 0) {
        console.error(
          "[Presets] Failed installs:",
          result.failed.map((f) => `${f.name}: ${f.error}`).join(", ")
        );
      }
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  const versionMismatch =
    preview &&
    ((preview.game_version && preview.game_version !== profile.game_version) ||
      (preview.loader && preview.loader !== profile.loader));

  const tabs: { id: Tab; labelKey: string; icon: string }[] = [
    { id: "export", labelKey: "mod_presets.tab_export", icon: "solar:share-bold" },
    { id: "import", labelKey: "mod_presets.tab_import", icon: "solar:import-bold" },
    { id: "library", labelKey: "mod_presets.tab_library", icon: "solar:clipboard-list-bold" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#14141a] shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 pt-4 pb-3">
          <Icon icon="solar:share-bold" className="w-5 h-5 text-white/70" />
          <span className="font-minecraft text-sm text-white">{t("mod_presets.title")}</span>
        </div>

        <div className="flex gap-1 px-5 pb-3 border-b border-white/10">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-minecraft uppercase tracking-wider transition-colors ${
                tab === tb.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon icon={tb.icon} className="w-4 h-4" />
              {t(tb.labelKey)}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto">
          {tab === "export" && exportInfo && (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-minecraft text-white/60 uppercase tracking-wider">
                {t("mod_presets.preset_name")}
              </label>
              <input
                value={presetName}
                onChange={(e) => {
                  setPresetName(e.target.value);
                  setExportCode(null);
                }}
                maxLength={60}
                className="w-full h-9 px-3 rounded-md bg-white/5 border border-white/10 focus:border-white/25 outline-none text-sm text-white font-minecraft"
              />
              <div className="text-xs font-minecraft text-white/50">
                {t("mod_presets.export_summary", {
                  count: exportInfo.preset.items.length,
                  skipped: exportInfo.skipped.length,
                  version: profile.game_version,
                  loader: profile.loader,
                })}
              </div>
              {exportInfo.skipped.length > 0 && (
                <div className="text-[11px] font-minecraft text-white/35 break-words">
                  {t("mod_presets.export_skipped")}: {exportInfo.skipped.slice(0, 5).join(", ")}
                  {exportInfo.skipped.length > 5 ? " …" : ""}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="flex-1 h-9 rounded-md bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-minecraft uppercase tracking-wider text-white transition-colors"
                >
                  {t("mod_presets.generate_code")}
                </button>
                <button
                  onClick={handleSaveToLibrary}
                  className="flex-1 h-9 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-minecraft uppercase tracking-wider text-white/80 transition-colors"
                >
                  {t("mod_presets.save_to_library")}
                </button>
              </div>
              {exportCode && (
                <>
                  <textarea
                    readOnly
                    value={exportCode}
                    rows={4}
                    onFocus={(e) => e.target.select()}
                    className="w-full p-2 rounded-md bg-black/40 border border-white/10 text-[11px] text-white/70 font-mono break-all outline-none resize-none"
                  />
                  <button
                    onClick={() => void copyText(exportCode, "mod_presets.code_copied")}
                    className="h-9 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-xs font-minecraft uppercase tracking-wider text-emerald-100 transition-colors"
                  >
                    {t("mod_presets.copy_code")}
                  </button>
                </>
              )}
            </div>
          )}

          {tab === "import" && (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-minecraft text-white/60 uppercase tracking-wider">
                {t("mod_presets.paste_code")}
              </label>
              <textarea
                value={importCode}
                onChange={(e) => {
                  setImportCode(e.target.value);
                  setPreview(null);
                }}
                rows={4}
                placeholder={t("mod_presets.code_placeholder")}
                className="w-full p-2 rounded-md bg-white/5 border border-white/10 focus:border-white/25 outline-none text-[11px] text-white/80 font-mono break-all resize-none placeholder:text-white/25"
              />
              <button
                onClick={handlePreviewImport}
                disabled={!importCode.trim() || installing}
                className="h-9 rounded-md bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-minecraft uppercase tracking-wider text-white transition-colors disabled:opacity-50"
              >
                {t("mod_presets.check_code")}
              </button>
              {preview && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2">
                  <div className="font-minecraft text-sm text-white truncate" title={preview.name}>
                    {preview.name}
                  </div>
                  <div className="text-xs font-minecraft text-white/50">
                    {t("mod_presets.preview_summary", {
                      count: preview.items.length,
                      version: preview.game_version ?? "?",
                      loader: preview.loader ?? "?",
                    })}
                  </div>
                  {versionMismatch && (
                    <div className="text-[11px] font-minecraft text-amber-200/90">
                      {t("mod_presets.version_mismatch", {
                        version: profile.game_version,
                        loader: profile.loader,
                      })}
                    </div>
                  )}
                  {installing && progress ? (
                    <div className="flex flex-col gap-1">
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-emerald-400/70 transition-all"
                          style={{
                            width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <div className="text-[11px] font-minecraft text-white/50 truncate">
                        {progress.done}/{progress.total} · {progress.name}
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => void runInstall(preview)}
                      className="h-9 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-xs font-minecraft uppercase tracking-wider text-emerald-100 transition-colors"
                    >
                      {t("mod_presets.install_now", { count: preview.items.length })}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "library" && (
            <div className="flex flex-col gap-2">
              {library.length === 0 ? (
                <div className="text-xs font-minecraft text-white/40 py-6 text-center">
                  {t("mod_presets.library_empty")}
                </div>
              ) : (
                library.map((preset) => (
                  <div
                    key={`${preset.name}-${preset.created_at}`}
                    className="rounded-lg border border-white/10 bg-white/[0.03] p-3 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-minecraft text-sm text-white truncate" title={preset.name}>
                        {preset.name}
                      </div>
                      <div className="text-[11px] font-minecraft text-white/40">
                        {t("mod_presets.preview_summary", {
                          count: preset.items.length,
                          version: preset.game_version ?? "?",
                          loader: preset.loader ?? "?",
                        })}
                      </div>
                    </div>
                    <button
                      onClick={() => void copyText(encodePreset(preset), "mod_presets.code_copied")}
                      title={t("mod_presets.copy_code")}
                      className="p-2 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <Icon icon="solar:copy-bold" className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void runInstall(preset)}
                      disabled={installing}
                      title={t("mod_presets.install_now", { count: preset.items.length })}
                      className="h-8 px-3 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-xs font-minecraft uppercase tracking-wider text-emerald-100 transition-colors disabled:opacity-50"
                    >
                      {t("mod_presets.apply")}
                    </button>
                    <button
                      onClick={() => setLibrary(deletePresetFromLibrary(preset.name))}
                      title={t("mod_groups.delete")}
                      className="p-2 rounded-md text-white/40 hover:text-rose-300 hover:bg-white/10 transition-colors"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onClose}
            disabled={installing}
            className="h-8 px-4 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-minecraft uppercase tracking-wider text-white/70 transition-colors disabled:opacity-50"
          >
            {t("mod_presets.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
