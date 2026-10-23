"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";

// perm: which permission opens the tab (boss always can). Keys are set on the Settings > user access page.
const TABS = [
  { key: "search", label: "Search & Tag", href: "/dashboard/purchase/pricelist", perm: ["pricelist", "pricelistManage"] },
  { key: "upload", label: "Upload", href: "/dashboard/purchase/pricelist/upload", perm: ["pricelistManage"] },
  { key: "tags", label: "Tag Manager", href: "/dashboard/purchase/pricelist/tags", perm: ["pricelist", "pricelistManage"] },
  { key: "received", label: "Received Purchase", href: "/dashboard/purchase/pricelist/received", perm: ["pricelistReceived"] },
];
const canOpen = (p: any, perm: string[]) => !!p.boss || perm.some((k) => p[k]);

export interface PricelistUser {
  username: string;
  isAdmin: boolean;
}

// Shared header + sub-tabs for the Pricelist module (opened from Settings). Each tab is gated by the
// pricelist* permissions (or boss); `isAdmin` (boss or pricelistManage) unlocks upload / manual add / tag delete & merge.
export default function PricelistShell({
  active,
  children,
}: {
  active: "search" | "upload" | "tags" | "received";
  children: (user: PricelistUser) => React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<PricelistUser | null>(null);
  const [denied, setDenied] = useState(false);
  const [perms, setPerms] = useState<any>({});

  useEffect(() => {
    const raw = localStorage.getItem("oms_user");
    if (!raw) {
      router.push("/login");
      return;
    }
    const u = JSON.parse(raw);
    const p = u.permissions || {};
    const current = TABS.find((t) => t.key === active);
    setPerms(p);
    if (!current || !canOpen(p, current.perm)) {
      setDenied(true);
      return;
    }
    // isAdmin unlocks upload / manual add / tag delete & merge
    setUser({ username: u.username, isAdmin: !!p.boss || !!p.pricelistManage });
  }, [router, active]);

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-4 font-bold text-xs uppercase tracking-[0.2em]"
        >
          <FiArrowLeft /> Back
        </button>
        <div className="mb-4 ml-1">
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Pricelist</h1>
          <p className="text-slate-500 text-[10px] font-bold tracking-[0.2em] uppercase">Supplier catalogue &amp; item-name tags</p>
        </div>
        <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
          {TABS.filter((t) => canOpen(perms, t.perm)).map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={`px-4 py-2 text-xs font-black uppercase tracking-wider whitespace-nowrap border-b-2 -mb-px ${
                active === t.key ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        {denied ? (
          <div className="p-8 text-center text-sm font-bold text-rose-600">You do not have access to this Pricelist section. Ask an admin to enable it in Settings.</div>
        ) : user ? (
          children(user)
        ) : null}
      </div>
    </div>
  );
}
