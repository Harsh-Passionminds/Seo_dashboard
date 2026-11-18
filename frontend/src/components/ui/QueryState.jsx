const Box = ({ children, tone = "text-gray-600" }) => (
  <div className={`rounded-lg border bg-white p-6 text-sm ${tone}`}>{children}</div>
);

export default function QueryState({ query, isEmpty, emptyText = "No data stored for this period.", children }) {
  if (query.isLoading) return <Box>Loading…</Box>;
  if (query.error) {
    const e = query.error;
    const hint =
      e.status === 401 ? "Please sign in again."
      : e.status >= 500 || !e.status ? "The backend may not be reachable (is it running on port 4000?)."
      : "";
    return (
      <Box tone="text-red-700">
        <p className="font-medium">{e.message}</p>
        {hint && <p className="mt-1">{hint}</p>}
        <button onClick={() => query.refetch()} className="mt-3 rounded border px-3 py-1 text-gray-700">
          Retry
        </button>
      </Box>
    );
  }
  if (isEmpty) return <Box>{emptyText}</Box>;
  return children;
}