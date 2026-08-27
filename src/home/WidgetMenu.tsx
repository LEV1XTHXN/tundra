/**
 * The per-widget `···` menu in a Home card's header.
 *
 * Removing a widget used to be an `×` that only appeared in Customize mode,
 * which made it the one card action you had to switch modes to find. The
 * mockups give every card a persistent overflow button instead, so the card's
 * actions live in one predictable place whether or not the board is being
 * rearranged.
 */
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function WidgetMenu({ onRemove }: { onRemove: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="widget-menu-trigger"
          title={t("home.widgetMenu")}
          aria-label={t("home.widgetMenu")}
          // The card header is react-grid-layout's drag handle; a click that
          // starts on this button must not also start a drag.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="widget-menu-popover" align="end">
        <button
          className="widget-menu-item"
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
        >
          {t("home.removeWidget")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
