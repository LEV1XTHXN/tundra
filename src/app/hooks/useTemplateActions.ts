import { useCallback, useRef } from "react";
import { templates as templatesService } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { useViewState, type AppView } from "@/store/viewState";
import { useTemplates } from "@/store/templates";

interface Params {
  setSettingsOpen: (open: boolean) => void;
  setError: (msg: string | null) => void;
}

export interface TemplateActions {
  /** From the sidebar Templates section (returns to the prior view on Done). */
  onOpenTemplate: (id: string) => void;
  /** From Settings ▸ Templates manager (returns to Settings on Done). */
  onEditTemplateFromSettings: (id: string) => void;
  onNewTemplate: () => Promise<void>;
  onDoneEditingTemplate: () => void;
  /** Leave the template view back to wherever editing was launched from — used
   *  when the open template is deleted. */
  returnFromTemplate: () => void;
}

/**
 * Template authoring flow. Editing a template opens it in the main editor pane
 * (template mode); we remember where the user came from so "Done" returns there,
 * and reopens Settings only when the edit was launched from the Templates
 * manager (not the sidebar Templates section).
 */
export function useTemplateActions({ setSettingsOpen, setError }: Params): TemplateActions {
  const openTemplate = useViewState((s) => s.openTemplate);
  const setView = useViewState((s) => s.setView);

  const templateReturn = useRef<{ view: AppView; settings: boolean }>({
    view: "home",
    settings: false,
  });

  const openTemplateForEdit = useCallback(
    (id: string, fromSettings: boolean) => {
      const current = useViewState.getState().view;
      templateReturn.current = {
        view: current === "template" ? "home" : current,
        settings: fromSettings,
      };
      setSettingsOpen(false);
      openTemplate(id);
    },
    [openTemplate, setSettingsOpen],
  );

  const onEditTemplateFromSettings = useCallback(
    (id: string) => openTemplateForEdit(id, true),
    [openTemplateForEdit],
  );

  const onOpenTemplate = useCallback(
    (id: string) => openTemplateForEdit(id, false),
    [openTemplateForEdit],
  );

  const onDoneEditingTemplate = useCallback(() => {
    setView(templateReturn.current.view);
    if (templateReturn.current.settings) setSettingsOpen(true);
    // A rename/edit may have changed the title — refresh the sidebar list.
    void useTemplates.getState().refresh();
  }, [setView, setSettingsOpen]);

  const onNewTemplate = useCallback(async () => {
    try {
      const tpl = await templatesService.create("Untitled template");
      await useTemplates.getState().refresh();
      openTemplateForEdit(tpl.id, false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [openTemplateForEdit, setError]);

  const returnFromTemplate = useCallback(() => {
    setView(templateReturn.current.view);
  }, [setView]);

  return {
    onOpenTemplate,
    onEditTemplateFromSettings,
    onNewTemplate,
    onDoneEditingTemplate,
    returnFromTemplate,
  };
}
