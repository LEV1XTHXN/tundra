import { useEffect, useState } from "react";
import { twemojiUrl } from "./twemoji";

/** Renders a Twemoji SVG for a stored codepoint, resolved lazily (see `twemoji.ts`). */
export function TwemojiImg({ codepoint, className }: { codepoint: string; className?: string }) {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    void twemojiUrl(codepoint).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [codepoint]);

  if (!url) return null;
  return <img src={url} alt="" className={className} />;
}
