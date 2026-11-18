import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getOverview } from "../../services/endpoints";
import { useWebsite, useDateRange } from "../../hooks/useAppContext";
import QueryState from "../../components/ui/QueryState";
import { toNum, fmtInt, fmtPct, fmtPos, previousRange, change } from "../../utils/format";

const sumKey = (rows, key) => {
  const v = rows.map((r) => toNum(r[key])).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

function summarize(ov) {
  const gsc = ov?.data?.googleSearchConsole ?? [];
  const ga = ov?.data?.googleAnalytics ?? [];
  const clicks = sumKey(gsc, "clicks");
  const impressions = sumKey(gsc, "impressions");
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null, // summed clicks / summed impressions
    position: gsc.length ? toNum(gsc[gsc.length - 1].average_position) : null,
    sessions: sumKey(ga, "organic_sessions"),
    forms: sumKey(ga, "total_form_conversions"),
    hasData: gsc.length > 0 || ga.length > 0,
  };
}

const CARDS = [
  { key: "clicks", label: "GSC clicks", fmt: fmtInt, to: "/gsc" },
  { key: "impressions", label: "GSC impressions", fmt: fmtInt, to: "/gsc" },
  { key: "ctr", label: "GSC average CTR", fmt: fmtPct, to: "/gsc" },
  { key: "position", label: "GSC avg position (latest day)", fmt: fmtPos, to: "/gsc", lowerBetter: true },
  { key: "sessions", label: "GA4 organic sessions", fmt: fmtInt, to: "/ga4" },
  { key: "forms", label: "GA4 form submissions", fmt: fmtInt, to: "/ga4" },
];

export default function OverviewPage() {
  const { websiteId } = useWebsite();
  const { range } = useDateRange();
  const prev = previousRange(range);

  const cur = useQuery({ queryKey: ["overview", websiteId, range], queryFn: () => getOverview(websiteId, range) });
  const old = useQuery({ queryKey: ["overview", websiteId, prev], queryFn: () => getOverview(websiteId, prev) });

  const c = summarize(cur.data);
  const p = summarize(old.data);

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        {range.startDate} → {range.endDate} · compared with {prev.startDate} → {prev.endDate}
      </p>
      <QueryState query={cur} isEmpty={!c.hasData}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CARDS.map((card) => {
            const ch = change(c[card.key], p[card.key]);
            const good = ch.abs == null || ch.abs === 0 ? null : card.lowerBetter ? ch.abs < 0 : ch.abs > 0;
            return (
              <Link key={card.key} to={card.to} className="rounded-lg border bg-white p-4 hover:shadow">
                <div className="text-sm text-gray-500">{card.label}</div>
                <div className="my-1 text-2xl font-semibold">{card.fmt(c[card.key])}</div>
                <div className="text-xs text-gray-500">
                  Previous: {old.isLoading ? "…" : card.fmt(p[card.key])}
                  {ch.abs != null && (
                    <span className={`ml-2 ${good == null ? "" : good ? "text-green-700" : "text-red-700"}`}>
                      {ch.abs > 0 ? "+" : ""}{card.key === "ctr" ? (ch.abs * 100).toFixed(2) + " pp" : ch.abs.toFixed(card.key === "position" ? 1 : 0)}
                      {" "}({ch.pct == null ? "—" : (ch.pct * 100).toFixed(1) + "%"})
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-gray-500">
          GSC clicks and GA4 sessions measure different things and are shown separately, not added together.
        </p>
      </QueryState>
    </div>
  );
}