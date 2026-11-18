import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getKeywords, addKeyword, deleteKeyword, getKeywordHistory, syncKeywordHistory } from "../../services/endpoints";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import QueryState from "../../components/ui/QueryState";
import { toNum, fmtInt, fmtPct, fmtPos, downloadCsv } from "../../utils/format";

export default function KeywordsPage() {
  const qc = useQueryClient();
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { isAdmin, permissions } = useSession();
  const [selectedId, setSelectedId] = useState(null);
  const [text, setText] = useState("");

  const list = useQuery({ queryKey: ["keywords", websiteId], queryFn: () => getKeywords(websiteId) });
  const keywords = list.data?.keywords ?? [];
  const selected = keywords.find((k) => k.keyword_id === selectedId);

  const history = useQuery({
    queryKey: ["kw-history", websiteId, selectedId, range],
    queryFn: () => getKeywordHistory(websiteId, selectedId, range),
    enabled: !!selected,
  });

  const add = useMutation({
    mutationFn: () => addKeyword(websiteId, text),
    onSuccess: (res) => {
      setText("");
      setSelectedId(res.keyword.keyword_id);
      qc.invalidateQueries({ queryKey: ["keywords", websiteId] });
    },
  });
  const del = useMutation({
    mutationFn: (id) => deleteKeyword(websiteId, id),
    onSuccess: (_, id) => {
      if (id === selectedId) setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["keywords", websiteId] });
    },
  });
  const sync = useMutation({
    mutationFn: () => syncKeywordHistory(websiteId, selectedId, range),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kw-history", websiteId, selectedId] }),
  });

  const rows = (history.data?.rows ?? []).map((r) => ({
    date: r.report_date,
    clicks: toNum(r.clicks),
    impressions: toNum(r.impressions),
    ctr: toNum(r.ctr),
    average_position: toNum(r.average_position),
  }));
  const tc = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const ti = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const positions = rows.map((r) => r.average_position).filter((x) => x != null);

  const onDelete = (k) => {
    if (window.confirm(`Delete "${k.keyword}" and all its stored history?`)) del.mutate(k.keyword_id);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div>
        {isAdmin && <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }} className="mb-3 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a keyword"
            className="flex-1 rounded border px-3 py-1.5 text-sm" maxLength={500} />
          <button disabled={add.isPending} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Add</button>
        </form>}
        {add.error && <p className="mb-2 text-sm text-red-700">{add.error.message}</p>}
        {del.error && <p className="mb-2 text-sm text-red-700">{del.error.message}</p>}

        <QueryState query={list} isEmpty={!keywords.length} emptyText="No tracked keywords yet.">
          <ul className="rounded-lg border bg-white">
            {keywords.map((k) => (
              <li key={k.keyword_id}
                className={`flex items-center justify-between border-b px-3 py-2 text-sm last:border-b-0 ${
                  k.keyword_id === selectedId ? "bg-blue-50" : ""}`}>
                <button onClick={() => setSelectedId(k.keyword_id)} className="flex-1 text-left">{k.keyword}</button>
                {isAdmin && <button onClick={() => onDelete(k)} className="text-xs text-red-600">Delete</button>}
              </li>
            ))}
          </ul>
        </QueryState>
      </div>

      <div>
        {!selected ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">Select a keyword to see its stored history.</div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">{selected.keyword}</h2>
              <div className="flex gap-2">
                {isAdmin && <button onClick={() => sync.mutate()} disabled={sync.isPending} className="rounded border px-3 py-1 text-sm">
                  {sync.isPending ? "Syncing…" : "Fetch history for selected dates"}
                </button>}
                {permissions.canExportReports && <button onClick={() => downloadCsv(`${selected.keyword}.csv`, rows)} className="rounded border px-3 py-1 text-sm">Export CSV</button>}
              </div>
            </div>
            {sync.error && <p className="mb-2 text-sm text-red-700">{sync.error.message}</p>}

            <QueryState query={history} isEmpty={!rows.length}
              emptyText="No ranking data stored for this period. Use “Fetch history” to import it.">
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  ["Clicks", fmtInt(tc)],
                  ["Impressions", fmtInt(ti)],
                  ["Combined CTR", ti ? fmtPct(tc / ti) : "No data"],
                  ["Latest position", fmtPos(positions[positions.length - 1])],
                  ["Best / worst", positions.length ? `${fmtPos(Math.min(...positions))} / ${fmtPos(Math.max(...positions))}` : "No data"],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-lg border bg-white p-3">
                    <div className="text-xs text-gray-500">{l}</div><div className="text-lg font-semibold">{v}</div>
                  </div>
                ))}
              </div>
              <p className="mb-2 text-xs text-gray-500">Google Search Console average position (not a live rank). Lower is better.</p>
              <div className="h-72 rounded-lg border bg-white p-3">
                <ResponsiveContainer>
                  <LineChart data={rows}>
                    <CartesianGrid vertical={false} stroke="#eee" />
                    <XAxis dataKey="date" />
                    <YAxis reversed domain={["auto", "auto"]} />
                    <Tooltip />
                    <Line dataKey="average_position" name="Avg position" stroke="#e8710a" strokeWidth={2} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-4 w-full rounded-lg border bg-white text-sm">
                <thead className="bg-gray-50 text-left"><tr>
                  <th className="p-2">Date</th><th className="p-2">Clicks</th><th className="p-2">Impressions</th>
                  <th className="p-2">CTR</th><th className="p-2">Avg position</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date} className="border-t">
                      <td className="p-2">{r.date}</td><td className="p-2">{fmtInt(r.clicks)}</td>
                      <td className="p-2">{fmtInt(r.impressions)}</td><td className="p-2">{fmtPct(r.ctr, 2)}</td>
                      <td className="p-2">{fmtPos(r.average_position)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </QueryState>
          </>
        )}
      </div>
    </div>
  );
}