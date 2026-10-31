/** Flash message from ?notice= / ?error= query params (set by server actions before redirecting). */
export function Notice({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <div className="mb-4 space-y-2">
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-[var(--radius-control)] bg-ok-soft px-3 py-2 text-sm text-ok">{notice}</p>}
    </div>
  );
}
