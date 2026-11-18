import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getWebsites, addWebsite, syncWebsite, getSyncJobs } from "../../services/endpoints";
import { useWebsite } from "../../hooks/useAppContext";
import { useSession } from "../../hooks/useSession";
import QueryState from "../../components/ui/QueryState";

const EMPTY = { websiteName: "", domainName: "", ga4PropertyId: "", gscPropertyUrl: "", timezone: "UTC" };
const ACTIVE = ["queued", "running"];

export default function WebsitesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useSession();
  const { setWebsiteId } = useWebsite();
  const [form, setForm] = useState(EMPTY);
  const [formErr, setFormErr] = useState("");

  const sites = useQuery({ queryKey: ["websites"], queryFn: getWebsites });
  const jobs = useQuery({
    queryKey: ["sync-jobs"],
    queryFn: getSyncJobs,
    enabled: isAdmin,
    refetchInterval: (q) => (q.state.data?.jobs?.some((j) => ACTIVE.includes(j.status)) ? 5000 : false),
  });

  const add = useMutation({
    mutationFn: (body) => addWebsite(body),
    onSuccess: (res) => {
      setForm(EMPTY);
      setWebsiteId(res.website.website_id);
      qc.invalidateQueries({ queryKey: ["websites"] });
      qc.invalidateQueries({ queryKey: ["sync-jobs"] });
    },
  });
  const sync = useMutation({
    mutationFn: (id) => syncWebsite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-jobs"] }),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.websiteName.trim()) return setFormErr("Website name is required.");
    try { new URL(form.domainName); } catch { return setFormErr("Domain must be a full URL, e.g. https://example.com"); }
    if (!/^\d{4,20}$/.test(form.ga4PropertyId)) return setFormErr("GA4 property ID must be 4–20 digits.");
    setFormErr("");
    const body = { ...form, websiteName: form.websiteName.trim() };
    if (!body.gscPropertyUrl.trim()) delete body.gscPropertyUrl;
    add.mutate(body); 
  };

  const list = sites.data?.websites ?? [];
  const checkpoints = (id) => sites.data?.freshness?.find((f) => f.websiteId === id)?.checkpoints ?? [];
  const field = (name, label, ph) => (
    <label className="block text-sm">
      <span className="text-gray-600">{label}</span>
      <input value={form[name]} placeholder={ph} onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        className="mt-1 w-full rounded border px-3 py-1.5" />
    </label>
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-medium">Websites</h2>
        <QueryState query={sites} isEmpty={!list.length} emptyText={isAdmin ? "No websites yet. Add one below." : "No websites are assigned to your account."}>
          <table className="w-full rounded-lg border bg-white text-sm">
            <thead className="bg-gray-50 text-left"><tr>
              <th className="p-2">Name</th><th className="p-2">Domain</th><th className="p-2">GA4</th>
              <th className="p-2">GSC property</th><th className="p-2">Sync status</th>{isAdmin && <th className="p-2" />}
            </tr></thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.website_id} className="border-t align-top">
                  <td className="p-2">{w.website_name}</td><td className="p-2">{w.domain_name}</td>
                  <td className="p-2">{w.ga4_property_id}</td><td className="p-2">{w.gsc_property_url ?? "Not set"}</td>
                  <td className="p-2 text-xs">
                    {checkpoints(w.website_id).length === 0 && "No sync yet"}
                    {checkpoints(w.website_id).map((c) => (
                      <div key={c.source + c.report_type}>
                        {c.source.toUpperCase()}: {c.status}{c.last_successful_date ? ` · latest ${c.last_successful_date}` : ""}
                      </div>
                    ))}
                  </td>
                  {isAdmin && <td className="p-2">
                    <button onClick={() => sync.mutate(w.website_id)} disabled={sync.isPending}
                      className="rounded border px-2 py-1 text-xs">Sync now</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
          {sync.error && <p className="mt-2 text-sm text-red-700">{sync.error.message}</p>}
        </QueryState>
      </section>

      {isAdmin && <section>
        <h2 className="mb-3 text-lg font-medium">Add website</h2>
        <form onSubmit={submit} className="grid max-w-xl gap-3 rounded-lg border bg-white p-4">
          {field("websiteName", "Website name", "Example")}
          {field("domainName", "Domain URL", "https://example.com")}
          {field("ga4PropertyId", "GA4 property ID", "123456789")}
          {field("gscPropertyUrl", "GSC property (optional)", "sc-domain:example.com")}
          {field("timezone", "Timezone", "UTC")}
          {(formErr || add.error) && <p className="text-sm text-red-700">{formErr || add.error.message}</p>}
          {add.isSuccess && <p className="text-sm text-green-700">{add.data.message}</p>}
          <button disabled={add.isPending} className="w-fit rounded bg-blue-600 px-4 py-2 text-sm text-white">
            {add.isPending ? "Saving…" : "Add website"}
          </button>
        </form>
      </section>}

      {isAdmin && <section>
        <h2 className="mb-3 text-lg font-medium">Recent sync jobs</h2>
        <QueryState query={jobs} isEmpty={!jobs.data?.jobs?.length} emptyText="No sync jobs.">
          <table className="w-full rounded-lg border bg-white text-sm">
            <thead className="bg-gray-50 text-left"><tr>
              <th className="p-2">Source</th><th className="p-2">Report</th><th className="p-2">Status</th><th className="p-2">Error</th>
            </tr></thead>
            <tbody>
              {(jobs.data?.jobs ?? []).map((j, i) => (
                <tr key={j.job_id ?? j.id ?? i} className="border-t">
                  <td className="p-2">{j.source}</td><td className="p-2">{j.report_type ?? j.reportType}</td>
                  <td className="p-2">{j.status}</td><td className="p-2 text-red-700">{j.error_message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </QueryState>
      </section>}
    </div>
  );
}