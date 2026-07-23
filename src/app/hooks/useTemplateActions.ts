import { useCallback, useRef } from "react";
import { templates as templatesService } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { useViewState, type AppView } from "@/store/viewState";
import { useTemplates } from "@/store/templates";

interface Params {
  setError: (msg: string | null) => void;
}

export interface TemplateActions {
  /** Open a template for editing (returns to the prior view on Done). */
  onOpenTemplate: (id: string) => void;
  onNewTemplate: () => Promise<void>;
  onDoneEditingTemplate: () => void;
  /** Leave the template view back to wherever editing was launched from — used
   *  when the open template is deleted. */
  returnFromTemplate: () => void;
}

/**
 * Template authoring flow. Editing a template opens it in the main editor pane
 * (template mode); we remember where the user came from so "Done" returns there
 * — normally the Templates view, which is where templates are managed.
 */
export function useTemplateActions({ setError }: Params): TemplateActions {
  const openTemplate = useViewState((s) => s.openTemplate);
  const setView = useViewState((s) => s.setView);

  const templateReturn = useRef<AppView>("templates");

  const onOpenTemplate = useCallback(
    (id: string) => {
      const current = useViewState.getState().view;
      // Re-editing from within the template view must not make "Done" a no-op.
      templateReturn.current = current === "template" ? "templates" : current;
      openTemplate(id);
    },
    [openTemplate],
  );

  const onDoneEditingTemplate = useCallback(() => {
    setView(templateReturn.current);
    // A rename/edit may have changed the title — refresh the manager's list.
    void useTemplates.getState().refresh();
  }, [setView]);

  const onNewTemplate = useCallback(async () => {
    try {
      const tpl = await templatesService.create("Untitled template");
      await useTemplates.getState().refresh();
      onOpenTemplate(tpl.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [onOpenTemplate, setError]);

  const returnFromTemplate = useCallback(() => {
    setView(templateReturn.current);
  }, [setView]);

  return {
    onOpenTemplate,
    onNewTemplate,
    onDoneEditingTemplate,
    returnFromTemplate,
  };
}
