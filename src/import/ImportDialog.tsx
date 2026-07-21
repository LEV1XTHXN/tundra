/**
 * "Import from Obsidian" (step 1 of the multi-app import feature). Always
 * imports into a NEW, empty Tundra vault — reuses the multi-vault flow's
 * `switchVault` to create/open the destination, then runs the generic
 * pipeline (`pipeline.ts`) with the Obsidian adapter. Never touches whatever
 * vault was open before this dialog opened.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { notes, pickVaultFolder, vault } from "@/services";
import type { VaultInfo } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { runImport } from "./pipeline";
import { obsidianAdapter } from "./obsidianAdapter";
import type { ImportProgress, ImportReport } from "./types";

type Step = "source" | "destination" | "confirm-nonempty" | "importing" | "report";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open (or create) the vault at `path` and make it active — from
   *  `useVaultSession`, the same function the sidebar's vault switcher uses. */
  onSwitchVault: (path: string) => Promise<void>;
  /** Called once import finishes and the dialog is dismissed, so the shell
   *  can refresh the nav tree to show the freshly-imported notes. */
  onImported: () => void;
}

function progressLabel(p: ImportProgress | null): string {
  if (!p) return "";
  switch (p.phase) {
    case "scanning":
      return "Scanning the Obsidian vault…";
    case "copying-attachments":
      return `Copying attachments… (${p.done}/${p.total})`;
    case "creating-notes":
      return `Creating notes… (${p.done}/${p.total})`;
    case "resolving-links":
      return `Resolving links… (${p.done}/${p.total})`;
    case "done":
      return "Done.";
  }
}

export function ImportDialog({ open, onOpenChange, onSwitchVault, onImported }: ImportDialogProps) {
  const [step, setStep] = useState<Step>("source");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [destVault, setDestVault] = useState<VaultInfo | null>(null);
  const [existingNoteCount, setExistingNoteCount] = useState(0);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep("source");
    setSourcePath(null);
    setDestVault(null);
    setExistingNoteCount(0);
    setProgress(null);
    setReport(null);
    setError(null);
    setBusy(false);
  };

  const close = (imported: boolean) => {
    onOpenChange(false);
    if (imported) onImported();
    reset();
  };

  const chooseSource = async () => {
    setError(null);
    const path = await pickVaultFolder("Choose your Obsidian vault folder");
    if (path) {
      setSourcePath(path);
      setStep("destination");
    }
  };

  const openDestination = async (title: string) => {
    setError(null);
    setBusy(true);
    try {
      const path = await pickVaultFolder(title);
      if (!path) return;
      await onSwitchVault(path);
      setDestVault(await vault.current());
      const existing = await notes.list();
      if (existing.length > 0) {
        setExistingNoteCount(existing.length);
        setStep("confirm-nonempty");
        return;
      }
      await beginImport();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const beginImport = async () => {
    if (!sourcePath) return;
    setStep("importing");
    setProgress({ phase: "scanning" });
    try {
      const result = await runImport(sourcePath, obsidianAdapter, setProgress);
      setReport(result);
      setStep("report");
    } catch (e) {
      setError(errorMessage(e));
      setStep("destination");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close(false))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Obsidian</DialogTitle>
          <DialogDescription>
            Always imports into a new, empty vault — your currently open vault is never touched.
          </DialogDescription>
        </DialogHeader>

        {step === "source" && (
          <div className="settings-section">
            <p className="muted settings-section-desc">
              First, choose the Obsidian vault folder you want to import.
            </p>
            <Button onClick={() => void chooseSource()}>Choose Obsidian vault folder…</Button>
          </div>
        )}

        {step === "destination" && (
          <div className="settings-section">
            <p className="muted settings-section-desc">
              Now choose (or create) the destination Tundra vault. It should be empty — a fresh
              vault, not one you're already using.
            </p>
            <div className="settings-actions">
              <Button disabled={busy} onClick={() => void openDestination("Choose or create a folder for the new vault")}>
                Create new vault…
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void openDestination("Open an empty vault folder")}>
                Open an existing empty vault…
              </Button>
            </div>
          </div>
        )}

        {step === "confirm-nonempty" && destVault && (
          <div className="settings-section">
            <p className="error">
              This vault already has {existingNoteCount} note{existingNoteCount === 1 ? "" : "s"}.
              Importing here will add the Obsidian notes alongside them, not into a clean vault.
            </p>
            <div className="settings-actions">
              <Button variant="destructive" onClick={() => void beginImport()}>
                Import anyway
              </Button>
              <Button variant="outline" onClick={() => setStep("destination")}>
                Choose a different vault
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="settings-section">
            <p className="muted">{progressLabel(progress)}</p>
          </div>
        )}

        {step === "report" && report && (
          <div className="settings-section import-report">
            <ul className="import-report-stats">
              <li>{report.notesImported} note{report.notesImported === 1 ? "" : "s"} imported</li>
              <li>{report.attachmentsCopied} attachment{report.attachmentsCopied === 1 ? "" : "s"} copied</li>
              {report.unresolvedLinks > 0 && (
                <li>{report.unresolvedLinks} link{report.unresolvedLinks === 1 ? "" : "s"} couldn't be resolved (kept as plain text)</li>
              )}
              {report.unresolvedAttachments > 0 && (
                <li>
                  {report.unresolvedAttachments} attachment reference{report.unresolvedAttachments === 1 ? "" : "s"} couldn't be
                  embedded (kept as plain text)
                </li>
              )}
              {report.pluginNotes.length > 0 && (
                <li>{report.pluginNotes.length} note{report.pluginNotes.length === 1 ? "" : "s"} used a plugin format (imported as plain headings/checklists)</li>
              )}
              {report.skippedFiles.length > 0 && (
                <li>{report.skippedFiles.length} file{report.skippedFiles.length === 1 ? "" : "s"} skipped entirely</li>
              )}
              {report.errors.length > 0 && (
                <li className="error">{report.errors.length} file{report.errors.length === 1 ? "" : "s"} failed to import</li>
              )}
            </ul>

            {report.skippedFiles.length > 0 && (
              <details>
                <summary>Skipped files</summary>
                <ul className="import-report-detail">
                  {report.skippedFiles.map((s) => (
                    <li key={s.relPath}>
                      {s.relPath} — {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {report.pluginNotes.length > 0 && (
              <details>
                <summary>Plugin-format notes</summary>
                <ul className="import-report-detail">
                  {report.pluginNotes.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </details>
            )}
            {report.errors.length > 0 && (
              <details>
                <summary>Errors</summary>
                <ul className="import-report-detail">
                  {report.errors.map((e) => (
                    <li key={e.relPath}>
                      {e.relPath} — {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="settings-actions">
              <Button onClick={() => close(true)}>Done</Button>
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
