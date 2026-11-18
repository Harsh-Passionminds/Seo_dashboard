import { useState } from "react";
import { format, subDays, parseISO, differenceInCalendarDays } from "date-fns";
import { useDateRange } from "../../hooks/useAppContext";

const iso = (d) => format(d, "yyyy-MM-dd");

export default function DateRangeMenu() {
  const { range, setRange } = useDateRange();
  const [draft, setDraft] = useState(range);
  const [err, setErr] = useState("");

  const preset = (days) => {
    const end = subDays(new Date(), 1);
    const next = { startDate: iso(subDays(end, days - 1)), endDate: iso(end) };
    setDraft(next);
    setRange(next);
  };

  const apply = () => {
    if (!draft.startDate || !draft.endDate) return setErr("Both dates are required.");
    const days = differenceInCalendarDays(parseISO(draft.endDate), parseISO(draft.startDate)) + 1;
    if (days < 1) return setErr("Start date must be on or before end date.");
    if (days > 550) return setErr("Maximum range is 550 days.");
    setErr("");
    setRange(draft);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {[7, 28, 90].map((d) => (
        <button key={d} onClick={() => preset(d)} className="rounded-full border px-3 py-1 hover:bg-gray-50">
          Last {d} days
        </button>
      ))}
      <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
        className="rounded border px-2 py-1" />
      <span>–</span>
      <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
        className="rounded border px-2 py-1" />
      <button onClick={apply} className="rounded bg-blue-600 px-3 py-1 text-white">Apply</button>
      {err && <span className="text-red-600">{err}</span>}
    </div>
  );
} 