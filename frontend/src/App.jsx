import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { useSession } from "./hooks/useSession";
import { LoginPage, ChangePasswordPage } from "./features/auth/LoginPage";
import AdminPage from "./features/admin/AdminPage";
import Layout from "./components/layout/Layout";
import OverviewPage from "./features/overview/OverviewPage";
import Ga4Page from "./features/ga4/Ga4Page";
import GscPage from "./features/gsc/GscPage";
import AcquisitionPage from "./features/acquisition/AcquisitionPage";
import KeywordsPage from "./features/keywords/KeywordsPage";
import WebsitesPage from "./features/websites/WebsitesPage";
import ReportsPage from "./features/reports/ReportsPage";

function AuthGate() {
  const me = useSession();
  if (me.isLoading) return <p className="p-6">Loading…</p>;
  if (me.error)
    return (
      <div className="p-6 text-sm">
        <p className="font-medium text-red-700">Can't reach the backend ({me.error.message}).</p>
        <p className="mt-1 text-gray-600">Make sure it is running on port 4000.</p>
        <button onClick={() => me.refetch()} className="mt-3 rounded border px-3 py-1">Retry</button>
      </div>
    );
  const s = me.session;
  if (!s?.authenticated) return <LoginPage />;
  if (s.mustChangePassword) return <ChangePasswordPage />;
  if (!s.membership)
    return <p className="p-6 text-sm text-red-700">This account has no organization access. Contact your administrator.</p>;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthGate />}>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="ga4" element={<Ga4Page />} />
            <Route path="gsc" element={<GscPage />} />
            <Route path="acquisition" element={<AcquisitionPage />} />
            <Route path="keywords" element={<KeywordsPage />} />
            <Route path="websites" element={<WebsitesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="admin" element={<AdminPage />} />          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}