import { useEffect } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Activity, Search, Share2, KeyRound, Globe, FileText, ShieldCheck, LogOut } from "lucide-react";
import { useSession } from "../../hooks/useSession";
import { getWebsites, logout } from "../../services/endpoints";
import { useWebsite } from "../../hooks/useAppContext";
import DateRangeMenu from "./DateRangeMenu";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/ga4", label: "GA4 Analytics", icon: Activity },
  { to: "/gsc", label: "Search Console", icon: Search },
  { to: "/acquisition", label: "Acquisition", icon: Share2 },
  { to: "/keywords", label: "Keyword Tracking", icon: KeyRound },
  { to: "/websites", label: "Websites", icon: Globe },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/admin", label: "Administration", icon: ShieldCheck, adminOnly: true },
];
const EMPTY_WEBSITES = [];

export default function Layout() {
  const qc = useQueryClient();
  const { isAdmin } = useSession();
  const { pathname } = useLocation();
  const { websiteId, setWebsiteId } = useWebsite();
  const sites = useQuery({ queryKey: ["websites"], queryFn: getWebsites });
  const list = sites.data?.websites ?? EMPTY_WEBSITES;

  useEffect(() => {
    if (!sites.isSuccess) return;
    if (!list.length) {
      if (websiteId !== null) setWebsiteId(null);
      return;
    }
    if (!list.some((website) => Number(website.website_id) === Number(websiteId))) {
      setWebsiteId(Number(list[0].website_id));
    }
  }, [list, sites.isSuccess, websiteId, setWebsiteId]);

  const checkpoints = sites.data?.freshness?.find((f) => f.websiteId === websiteId)?.checkpoints ?? [];
  const lastSync = checkpoints.map((c) => c.last_sync_completed_at).filter(Boolean).sort().pop();

  const onSignOut = async () => {
    await logout();
    qc.setQueryData(["me"], { authenticated: false, user: null });
  };

  let content = <Outlet />;
  if (pathname !== "/websites") {
    if (sites.isLoading) content = <p className="text-sm text-gray-600">Loading websites…</p>;
    else if (sites.error) content = <p className="text-sm text-red-700">{sites.error.message}</p>;
    else if (!list.length && isAdmin)
      content = (
        <p className="text-sm text-gray-600">
          No websites yet. <Link to="/websites" className="text-blue-600 underline">Add one</Link> to get started.
        </p>
      );
    else if (!list.length)
      content = <p className="text-sm text-gray-600">No websites are assigned to your account. Contact your administrator.</p>;
    else if (!websiteId) content = <p className="text-sm text-gray-600">Select a website.</p>;
  }

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-800">
      <aside className="w-56 shrink-0 border-r bg-white p-3">
        <div className="mb-4 px-3 text-lg font-semibold">SEO Analytics</div>
        <nav className="space-y-1">
            {NAV.filter((n) => !n.adminOnly || isAdmin).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-r-full px-3 py-2 text-sm ${
                  isActive ? "bg-blue-50 font-medium text-blue-700" : "hover:bg-gray-100"}`}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1">
        <header className="space-y-3 border-b bg-white px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <select value={websiteId ?? ""} onChange={(e) => setWebsiteId(Number(e.target.value))}
              className="rounded border px-3 py-1.5 text-sm">
              {!list.length && <option value="">No websites</option>}
              {list.map((w) => (
                <option key={w.website_id} value={w.website_id}>{w.website_name}</option>
              ))}
            </select>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>{lastSync ? `Last synced: ${new Date(lastSync).toLocaleString()}` : "Not synced yet"}</span>
              <button onClick={onSignOut} className="flex items-center gap-1 text-gray-700 hover:underline">
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
          <DateRangeMenu />
        </header>
        <main className="p-6">{content}</main>
      </div>
    </div>
  );
}