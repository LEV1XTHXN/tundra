interface ErrorToastProps {
  error: string | null;
}

/** The shell's transient error toast — the single surface for `CoreError`
 *  messages bubbled up from any action. */
export function ErrorToast({ error }: ErrorToastProps) {
  if (!error) return null;
  return <div className="error toast">{error}</div>;
}
