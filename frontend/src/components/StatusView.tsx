import PlaneLoader from "./PlaneLoader";

type LoadingProps = {
  label?: string;
  /** Fill the screen (page-level) or sit inline inside a card. */
  inline?: boolean;
};

export function Loading({ label = "読み込み中…", inline = false }: LoadingProps) {
  const body = (
    <div className="status-view" role="status" aria-live="polite">
      <PlaneLoader size={inline ? "sm" : "md"} />
      <p className="status-label">{label}</p>
    </div>
  );
  return inline ? body : <div className="center-screen">{body}</div>;
}

type ErrorProps = {
  message?: string;
  onRetry?: () => void;
  inline?: boolean;
};

export function ErrorView({
  message = "うまくいきませんでした",
  onRetry,
  inline = false,
}: ErrorProps) {
  const body = (
    <div className="status-view status-view-error" role="alert">
      <PlaneLoader state="error" size={inline ? "sm" : "md"} />
      <p className="status-label">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          もう一度試す
        </button>
      )}
    </div>
  );
  return inline ? body : <div className="center-screen">{body}</div>;
}
