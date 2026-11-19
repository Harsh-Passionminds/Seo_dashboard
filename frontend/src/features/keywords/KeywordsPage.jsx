import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  getWebsites, getKeywordReport, addKeyword, deleteKeyword, getKeywordHistory, syncKeywordHistory
} from "../../services/endpoints";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import QueryState from "../../components/ui/QueryState";
import { toNum, fmtInt, fmtPct, fmtPos, downloadCsv } from "../../utils/format";
import { exportExcelReport } from "../../utils/excel-chart-export";

const LIMIT = 25;
const SORTABLE = [
  ["keyword", "Keyword"],
  ["averagePosition", "Latest position"],
  ["previousAveragePosition", "Previous position"],
  ["positionChange", "Position change"],
  ["clicks", "Clicks"],
  ["impressions", "Impressions"],
  ["ctr", "CTR"],
  ["lastUpdated", "Last updated"],
  ["trackingStatus", "Tracking status"]
];
const STATUS_LABELS = {
  updated: "Updated in range",
  not_recently_updated: "Not updated in range",
  no_history: "No ranking history"
};

export default function KeywordsPage() {
  const qc = useQueryClient();
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const { isAdmin, permissions } = useSession();
  const [selectedId, setSelectedId] = useState(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("keyword");
  const [order, setOrder] = useState("asc");
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const websites = useQuery({ queryKey: ["websites"], queryFn: getWebsites });
  const website = (websites.data?.websites ?? []).find((item) => Number(item.website_id) === Number(websiteId));

  const onExportXlsx = async () => {
    if (!selected) return;
    setExportingXlsx(true);
    try {
      await exportExcelReport({
        websiteId,
        websiteName: website?.website_name || "Website",
        source: "keyword_tracking",
        startDate: range.startDate,
        endDate: range.endDate,
        filters: { keywordId: selected.keyword_id, keyword: selected.keyword },
        reportResult: rows
      });
    } catch (e) {
      alert(e.message);
    } finally {
      setExportingXlsx(false);
    }
  };
  const report = useQuery({
    queryKey: ["keyword-report", websiteId, range, search, sort, order, page],
    queryFn: () => getKeywordReport(websiteId, { ...range, search, sort, order, page, limit: LIMIT }),
    enabled: !!websiteId
  });
  const keywords = report.data?.rows ?? [];
  const pagination = report.data?.pagination;
  const selected = keywords.find((k) => k.keywordId === selectedId);

  const history = useQuery({
    queryKey: ["kw-history", websiteId, selectedId, range],
    queryFn: () => getKeywordHistory(websiteId, selectedId, range),
    enabled: !!selected,
  });

  const add = useMutation({
    mutationFn: () => addKeyword(websiteId, text),
    onSuccess: (res) => {
      setText("");
      setSearch("");
      setPage(1);
      setSelectedId(Number(res.keyword.keyword_id));
      qc.invalidateQueries({ queryKey: ["keyword-report", websiteId] });
    },
  });
  const del = useMutation({
    mutationFn: (id) => deleteKeyword(websiteId, id),
    onSuccess: (_, id) => {
      if (id === selectedId) setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["keyword-report", websiteId] });
    },
  });
  const sync = useMutation({
    mutationFn: () => syncKeywordHistory(websiteId, selectedId, range),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kw-history", websiteId, selectedId] });
      qc.invalidateQueries({ queryKey: ["keyword-report", websiteId] });
    },
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
    if (window.confirm(`Delete "${k.keyword}" and all its stored history?`)) del.mutate(k.keywordId);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Unified keyword report</h2>
            <p className="mt-1 text-xs text-gray-500">
              {website?.website_name ?? "Selected website"} · {range.startDate} → {range.endDate}
            </p>
          </div>
        {isAdmin && <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }} className="mb-3 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a keyword"
            className="flex-1 rounded border px-3 py-1.5 text-sm" maxLength={500} />
          <button disabled={add.isPending} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Add</button>
        </form>}
        </div>
        {add.error && <p className="mb-2 text-sm text-red-700">{add.error.message}</p>}
        {del.error && <p className="mb-2 text-sm text-red-700">{del.error.message}</p>}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search keywords" className="w-full max-w-sm rounded border px-3 py-1.5 text-sm" />
          <p className="text-xs text-gray-500">
            {pagination ? `${pagination.total.toLocaleString()} matching keywords` : "Loading keyword count…"}
          </p>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Position change compares the latest observation in this date range with the latest observation before it.
          A lower position is an improvement; unavailable values are not treated as zero.
        </p>
        <QueryState query={report} isEmpty={!keywords.length} emptyText="No keywords match this website and date range.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] rounded-lg border bg-white text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2">
                    <button onClick={() => {
                      if (sort === "keyword") setOrder(order === "asc" ? "desc" : "asc");
                      else { setSort("keyword"); setOrder("asc"); }
                      setPage(1);
                    }} className="whitespace-nowrap">
                      Keyword{sort === "keyword" ? (order === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                  <th className="p-2">Website</th>
                  {SORTABLE.slice(1).map(([key, label]) => (
                    <th key={key} className="p-2">
                      <button onClick={() => {
                        if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
                        else { setSort(key); setOrder("asc"); }
                        setPage(1);
                      }} className="whitespace-nowrap">
                        {label}{sort === key ? (order === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                  {isAdmin && <th className="p-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => (
                  <tr key={k.keywordId} className={`border-t ${k.keywordId === selectedId ? "bg-blue-50" : ""}`}>
                    <td className="p-2">
                      <button onClick={() => setSelectedId(k.keywordId)} className="text-left text-blue-700 hover:underline">
                        {k.keyword}
                      </button>
                    </td>
                    <td className="p-2">{website?.website_name ?? "Selected website"}</td>
                    <td className="p-2">{fmtPos(k.averagePosition)}</td>
                    <td className="p-2">{fmtPos(k.previousAveragePosition)}</td>
                    <td className={`p-2 ${k.positionTrend === "improved" ? "text-green-700" : k.positionTrend === "declined" ? "text-red-700" : ""}`}>
                      {k.positionChange == null ? "No data" :
                        `${k.positionChange > 0 ? "+" : ""}${k.positionChange.toFixed(1)} (${k.positionTrend})`}
                    </td>
                    <td className="p-2">{fmtInt(k.clicks)}</td>
                    <td className="p-2">{fmtInt(k.impressions)}</td>
                    <td className="p-2">{fmtPct(k.ctr, 2)}</td>
                    <td className="p-2">{k.lastUpdated ?? "No data"}</td>
                    <td className="p-2">{STATUS_LABELS[k.trackingStatus] ?? k.trackingStatus}</td>
                    {isAdmin && <td className="p-2"><button onClick={() => onDelete(k)} className="text-xs text-red-600">Delete</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <button disabled={page <= 1 || report.isFetching} onClick={() => setPage(page - 1)}
                className="rounded border px-3 py-1 disabled:opacity-50">Previous</button>
              <span>Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span>
              <button disabled={page >= pagination.totalPages || report.isFetching} onClick={() => setPage(page + 1)}
                className="rounded border px-3 py-1 disabled:opacity-50">Next</button>
            </div>
          )}
        </QueryState>
      </section>

      <section>
        {!selected ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
            Select a keyword from the report to see its stored history.
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">{selected.keyword}</h2>
              <div className="flex gap-2">
                {isAdmin && <button onClick={() => sync.mutate()} disabled={sync.isPending} className="rounded border px-3 py-1 text-sm">
                  {sync.isPending ? "Syncing…" : "Fetch history for selected dates"}
                </button>}
                {permissions.canExportReports && (
                  <>
                    <button onClick={() => downloadCsv(`${selected.keyword}.csv`, rows)} className="rounded border px-3 py-1 text-sm">Export CSV</button>
                    <button onClick={onExportXlsx} disabled={exportingXlsx} className="rounded border px-3 py-1 text-sm disabled:opacity-50">
                      {exportingXlsx ? "Exporting…" : "Export Excel"}
                    </button>
                  </>
                )}
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
      </section>
    </div>
  );
}