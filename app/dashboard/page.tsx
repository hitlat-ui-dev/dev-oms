"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FiPlusCircle,
  FiPackage,
  FiRefreshCw,
  FiFileText,
  FiSettings,
  FiPrinter,
  FiDatabase,
  FiSliders,
  FiBarChart2,
  FiLayers,
  FiPlus,
  FiX
} from "react-icons/fi";
import SellerOrderForm from "@/components/SellerOrderForm";

interface DashboardStats {
  today: { todayOrderCount: number };
  totals: { pendingPaymentValue: number };
  bidsPendingAction: number;
  lowStockCount: number;
}

// Which existing full-page tiles also get a hover "+" quick-add shortcut —
// matches the reference mockup's card set.
const QUICKADD_ENABLED = new Set(["Orders", "Purchase", "Stock", "Manage Stock", "GeM Bids"]);

// Groups the same tiles used to render as one flat grid — purely a display
// grouping, doesn't change what's shown or who can see it.
const SECTIONS = [
  { label: "Daily Operations", items: ["Orders", "Purchase", "Stock", "Manage Stock", "Print Label", "Account"] },
  { label: "GeM", items: ["GeM Bids", "GeM Links"] },
  { label: "Admin & Tools", items: ["Summary", "Settings", "Backup"] }
];

function StatCard({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-3.5">
      <div className={`text-xl font-black ${alert ? "text-red-600" : "text-slate-900"}`}>{value}</div>
      <div className="text-[11px] font-bold text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);

  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
      return;
    }

    const parsedUser = JSON.parse(session);
    setUser(parsedUser);

    // Dynamic sync on dashboard load to capture changes immediately
    fetch(`/api/users?username=${encodeURIComponent(parsedUser.username)}`)
      .then(res => res.json())
      .then(updated => {
        if (updated && updated.permissions) {
          const freshSession = { ...parsedUser, permissions: updated.permissions };
          localStorage.setItem("oms_user", JSON.stringify(freshSession));
          setUser(freshSession);
        }
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    fetch("/api/dashboard-summary")
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error("Failed to load dashboard stats", err));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd+K jumps straight to the New Order form — the one Quick Add
      // shortcut that opens in-place today, so it's the one worth a key binding.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuickAddOpen(false);
        setShowOrderModal(true);
      }
      if (e.key === "Escape") {
        setQuickAddOpen(false);
        setShowOrderModal(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!user) return null;

  const menuItems = [
    { name: "Summary", path: "/dashboard/summary", sub: "BUSINESS OVERVIEW", icon: <FiBarChart2 />, color: "bg-[#0f172a]", role: ["Owner"], permissionKey: "dashboardSummary" },
    { name: "GeM Bids", path: "/dashboard/gem-bids", sub: "FETCH, TRACK & WORK BIDS", icon: <FiLayers />, color: "bg-[#be123c]", role: ["Owner", "Manager"], permissionKey: "gemBids" },
    { name: "Purchase", path: "/dashboard/purchase", sub: "MANAGE NOW", icon: <FiPlusCircle />, color: "bg-[#1d63ff]", role: ["Owner", "Manager"] },
    { name: "Stock", path: "/dashboard/stock", sub: "MANAGE NOW", icon: <FiPackage />, color: "bg-[#00a86b]", role: ["Owner", "Manager", "Storekeeper"] },
    { name: "Manage Stock", path: "/dashboard/stock/manage-stock", sub: "MANAGE NOW", icon: <FiSliders />, color: "bg-[#0ea5e9]", role: ["Owner", "Manager", "Storekeeper"] },
    { name: "Orders", path: "/dashboard/orders", sub: "MANAGE NOW", icon: <FiRefreshCw />, color: "bg-[#f20505]", role: ["Owner", "Manager", "Office"] },
    { name: "Print Label", path: "/dashboard/print-labels", sub: "PRINT NOW", icon: <FiPrinter />, color: "bg-[#8b2ef5]", role: ["Owner", "Manager"] },
    { name: "GeM Links", path: "/dashboard/gem-sync", sub: "UPLOAD & SYNC", icon: <FiRefreshCw />, color: "bg-[#f59e0b]", role: ["Owner", "Manager"] },
    { name: "Settings", path: "/dashboard/settings", sub: "MANAGE NOW", icon: <FiSettings />, color: "bg-[#5c5cf5]", role: ["Owner"], permissionKey: "users" },
    { name: "Backup", path: "/dashboard/admin/backup", sub: "DOWNLOAD JSON", icon: <FiDatabase />, color: "bg-[#d97706]", role: ["Owner"], permissionKey: "backup" },
    { name: "Account", path: "/dashboard/account", sub: "BANK STATEMENTS", icon: <FiFileText />, color: "bg-[#0891b2]", role: ["Owner"], permissionKey: "accountStatements" }
  ];

  const usernameLower = user?.username?.trim().toLowerCase();
  const isSuperAdmin = ["chintan", "hitesh"].includes(usernameLower) || user?.permissions?.boss === true;

  const hasMenuItemAccess = (item: any) => {
    if (isSuperAdmin) return true;

    if (item.name === "Purchase") return user?.permissions?.purchase === true;
    if (item.name === "Stock") return user?.permissions?.stock === true;
    if (item.name === "Manage Stock") return user?.permissions?.manageStock === true;
    if (item.name === "Orders") {
      const p = user?.permissions || {};
      return p.addOrder === true || p.addSeller === true || p.addTransporter === true || p.addMyCompanies === true;
    }
    if (item.name === "Settings") return user?.permissions?.users === true;
    if (item.name === "Print Label") return user?.permissions?.printLabels === true;
    if (item.name === "Backup") return user?.permissions?.backup === true;
    if (item.name === "GeM Links") return user?.permissions?.gemLinks === true;
    if (item.name === "Account") return user?.permissions?.accountStatements === true;
    if (item.name === "Summary") return user?.permissions?.dashboardSummary === true;
    if (item.name === "GeM Bids") return user?.permissions?.gemBids === true;
    return true; // default fallback
  };

  const quickAddItems = [
    {
      key: "order",
      title: "New Order",
      sub: "From Excel or manual · Ctrl K",
      icon: <FiRefreshCw />,
      action: () => {
        setQuickAddOpen(false);
        setShowOrderModal(true);
      }
    },
    {
      key: "purchase",
      title: "Purchase Entry",
      sub: "Log a purchase",
      icon: <FiPlusCircle />,
      action: () => {
        setQuickAddOpen(false);
        router.push("/dashboard/purchase");
      }
    },
    {
      key: "stock",
      title: "Stock Update",
      sub: "Add / adjust qty",
      icon: <FiPackage />,
      action: () => {
        setQuickAddOpen(false);
        router.push("/dashboard/stock/manage-stock");
      }
    },
    {
      key: "bid",
      title: "Track Bid",
      sub: "Add a GeM bid",
      icon: <FiLayers />,
      action: () => {
        setQuickAddOpen(false);
        router.push("/dashboard/gem-bids");
      }
    },
    {
      key: "print",
      title: "Print Label",
      sub: "Quick print job",
      icon: <FiPrinter />,
      action: () => {
        setQuickAddOpen(false);
        router.push("/dashboard/print-labels");
      }
    },
    {
      key: "statement",
      title: "Upload Statement",
      sub: "Bank reconciliation",
      icon: <FiFileText />,
      action: () => {
        setQuickAddOpen(false);
        router.push("/dashboard/account");
      }
    }
  ];

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-5">
        {/* Live stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Orders today" value={stats ? stats.today.todayOrderCount : "—"} />
          <StatCard label="Bids pending action" value={stats ? stats.bidsPendingAction : "—"} />
          <StatCard label="Low stock items" value={stats ? stats.lowStockCount : "—"} alert={!!stats && stats.lowStockCount > 0} />
          <StatCard label="Total Due" value={stats ? `₹${stats.totals.pendingPaymentValue.toLocaleString("en-IN")}` : "—"} />
        </div>

        {/* Grouped icon grid */}
        {SECTIONS.map(section => {
          const visibleItems = menuItems.filter(item => section.items.includes(item.name) && hasMenuItemAccess(item));
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label}>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2.5">{section.label}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleItems.map(item => (
                  <button
                    key={item.name}
                    onClick={() => router.push(item.path)}
                    className={`${item.color} group relative flex items-center p-6 rounded-2xl shadow-lg hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200 text-left`}
                  >
                    <div className="bg-white/20 p-4 rounded-xl text-white text-2xl mr-5">{item.icon}</div>
                    <div>
                      <h3 className="text-white text-lg font-black uppercase">{item.name}</h3>
                      <p className="text-white/70 text-[10px] font-bold mt-1 uppercase">{item.sub}</p>
                    </div>
                    {QUICKADD_ENABLED.has(item.name) && (
                      <span
                        onClick={e => {
                          e.stopPropagation();
                          setQuickAddOpen(true);
                        }}
                        className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-white/15 border border-white/30 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Quick add"
                      >
                        <FiPlus size={16} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating quick-add button */}
      <button
        onClick={() => setQuickAddOpen(true)}
        className="fixed right-7 bottom-7 w-14 h-14 rounded-full bg-amber-500 hover:scale-105 shadow-xl flex items-center justify-center text-white transition-transform z-40"
        title="Quick Add"
      >
        <FiPlus size={26} />
      </button>

      {/* Quick Add bottom sheet */}
      {quickAddOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-end justify-center" onClick={() => setQuickAddOpen(false)}>
          <div className="bg-white w-full max-w-xl rounded-t-3xl p-6 pb-8 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setQuickAddOpen(false)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-700">
              <FiX size={20} />
            </button>
            <h3 className="text-lg font-black text-slate-900">Quick Add</h3>
            <p className="text-xs text-slate-500 mb-4">Jump straight to adding something — no need to hunt through the grid.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {quickAddItems.map(qi => (
                <button
                  key={qi.key}
                  onClick={qi.action}
                  className="text-left border border-slate-200 rounded-xl p-3.5 hover:border-amber-400 hover:bg-amber-50 transition-colors"
                >
                  <span className="text-lg text-slate-600 block mb-2">{qi.icon}</span>
                  <span className="text-[13px] font-bold text-slate-800 block">{qi.title}</span>
                  <span className="text-[10.5px] text-slate-400">{qi.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New Order modal — the one Quick Add shortcut that genuinely avoids a page hop today */}
      {showOrderModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <SellerOrderForm isModal onClose={() => setShowOrderModal(false)} />
        </div>
      )}
    </div>
  );
}
