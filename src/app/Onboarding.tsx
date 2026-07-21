interface OnboardingProps {
  onChooseFolder: () => void;
  onUseDefault: () => void;
  error: string | null;
}

/**
 * First-run / no-vault screen (CLAUDE.md §5.1): two onboarding paths — pick any
 * folder as the vault, or one-click a default vault under {Documents}/<AppName>.
 */
export function Onboarding({ onChooseFolder, onUseDefault, error }: OnboardingProps) {
  return (
    <div className="centered onboarding">
      <h1>Tundra</h1>
      <p className="muted">Choose where your notes live.</p>
      <div className="actions">
        <button onClick={onChooseFolder}>Choose a folder…</button>
        <button className="primary" onClick={onUseDefault}>
          Use default vault
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
