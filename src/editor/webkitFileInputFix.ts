// WebKitGTK (Linux) file-picker workaround.
//
// BlockNote's generic *file* block renders a file input whose `accept` is the
// wildcard `"*/*"` (its `fileBlockAccept` defaults to that). On WebKitGTK the
// wildcard accept is turned into a GTK file-chooser MIME filter that matches
// nothing AND offers no "All Files" fallback, so the dialog looks empty — the
// user can't pick a PDF or any other file. Image/video/audio blocks use real
// `image/*`-style filters, which map to valid GTK filters and work, so only the
// file block breaks, and only on Linux (WebView2/WebKit on Windows/macOS honour
// the wildcard correctly).
//
// Fix: on Linux, when a `type="file"` input whose accept is the wildcard is about
// to open its chooser, drop the attribute. We do it in the capture phase of the
// click — which runs before the browser's default "open the file dialog" action —
// so the chooser opens unfiltered and shows every file. We only touch the bare
// wildcard, never the specific media filters.
//
// Installed once at startup (see `main.tsx`); a no-op off Linux.

const WILDCARD_ACCEPT = "*/*";

let installed = false;

export function installWebkitFileInputFix(): void {
  if (installed) return;
  if (typeof navigator === "undefined" || !navigator.userAgent.includes("Linux")) return;
  installed = true;

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "file") return;
      // Only the wildcard filter is broken; leave real media filters
      // (image, video, audio) alone — those work on WebKitGTK.
      const accept = target.getAttribute("accept")?.replace(/\s/g, "");
      if (accept === WILDCARD_ACCEPT) target.removeAttribute("accept");
    },
    true, // capture: run before the input's default dialog-opening action
  );
}
