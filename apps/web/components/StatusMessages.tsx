export function StatusMessages({
  error,
  notice,
  loading,
}: {
  error?: string | null;
  notice?: string | null;
  loading?: string | null;
}) {
  return (
    <div className="status-stack">
      {error && (
        <p className="status-message form-error" role="alert">
          <span className="status-icon" aria-hidden="true">!</span>
          {error}
        </p>
      )}
      {notice && (
        <p className="status-message form-success" role="status" aria-live="polite">
          <span className="status-icon" aria-hidden="true">✓</span>
          {notice}
        </p>
      )}
      {loading && (
        <p className="status-message loading-status" role="status" aria-live="polite">
          <span className="status-spinner" aria-hidden="true" />
          {loading}
        </p>
      )}
    </div>
  );
}
