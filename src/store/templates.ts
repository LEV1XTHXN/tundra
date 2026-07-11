import { create } from "zustand";
import { templates as templatesService } from "@/services";
import type { TemplateSummary } from "@/services";

/**
 * The vault's template list — a lightweight listing (id/title/icon), the same
 * class of derived-from-services state as `linkTitles` (never note content).
 * Held in a store so the sidebar Templates section, the Settings manager, and
 * the editor's "Save as template" all read one list and refresh it together.
 * Reload it whenever the open vault changes (App) and after any create/edit/delete.
 */
interface TemplatesState {
  list: TemplateSummary[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useTemplates = create<TemplatesState>((set) => ({
  list: [],
  loaded: false,
  refresh: async () => {
    try {
      const list = await templatesService.list();
      set({ list, loaded: true });
    } catch {
      // A failed listing falls back to empty — templates are non-critical UI.
      set({ list: [], loaded: true });
    }
  },
}));
