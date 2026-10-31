"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../../../../store/useThemeStore";

interface ModGroupDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  initialName?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export function ModGroupDialog({
  open,
  title,
  confirmLabel,
  initialName = "",
  onClose,
  onConfirm,
}: ModGroupDialogProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) setName(initialName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = name.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#14141a] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Icon icon="solar:folder-bold-duotone" className="w-5 h-5 text-white/70" />
          <span className="font-minecraft text-sm text-white">{title}</span>
        </div>
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed) onConfirm(trimmed);
          }}
          placeholder={t("mod_groups.name_placeholder")}
          maxLength={40}
          className="w-full h-9 px-3 rounded-md bg-white/5 border border-white/10 focus:border-white/25 outline-none text-sm text-white placeholder:text-white/30 font-minecraft"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-minecraft uppercase tracking-wider text-white/70"
          >
            {t("profiles.v3.chips.cancel")}
          </button>
          <button
            onClick={() => trimmed && onConfirm(trimmed)}
            disabled={!trimmed}
            className="h-8 px-3 rounded-md border text-xs font-minecraft uppercase tracking-wider text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: `${accentColor.value}30`, borderColor: `${accentColor.value}60` }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
