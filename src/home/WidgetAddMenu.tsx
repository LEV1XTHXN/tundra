/**
 * The Home dashboard's "add a widget" menu — a small popover listing every
 * widget not already on the board, each with an icon + one-line description,
 * mirroring `VaultSwitcher`'s list-item pattern (`.vault-switcher-*` classes
 * reused under a `.widget-add-*` prefix). Purely presentational: `Home.tsx`
 * still owns the widget catalog and the actual add.
 */
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface AddableWidget {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export function WidgetAddMenu({
  trigger,
  available,
  onAdd,
}: {
  trigger: React.ReactNode;
  available: AddableWidget[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="widget-add-popover" align="start">
        <div className="widget-add-heading">Add a widget</div>
        {available.length === 0 ? (
          <p className="widget-add-empty muted">Every widget is already on your dashboard.</p>
        ) : (
          <div className="widget-add-list">
            {available.map((w) => {
              const Icon = w.icon;
              return (
                <button
                  key={w.id}
                  className="widget-add-item"
                  onClick={() => {
                    onAdd(w.id);
                    setOpen(false);
                  }}
                >
                  <span className="widget-add-item-icon">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="widget-add-item-info">
                    <span className="widget-add-item-title">{w.title}</span>
                    <span className="widget-add-item-description">{w.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
