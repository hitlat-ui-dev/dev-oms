"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";

const TABS = [
  { key: "search", label: "Search & Tag", href: "/dashboard/purchase/pricelist" },
  { key: "upload", label: "Upload", href: "/dashboard/purchase/pricelist/upload" },
  { key: "tags", label: "Tag Manager", href: "/dashboard/purchase/pricelist/tags" },
  { key: "received", label: "Received Purchase", href: "/dashboard/purchase/pricelist/received" },
];

export interface PricelistUser {
  username: string;
  isAdmin: boolean;
}

// Shared header + sub-tabs for the Purchase > Pricelist module. Gated on the `purchase`
// permission (or boss); `isAdmin` (permissions.boss) unlocks upload / tag delete / merge.
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

  useEffect(() => {
    const raw = localStorage.getItem("oms_user");
    if (!raw) {
      router.push("/login");
      return;
    }
    const u = JSON.parse(raw);
    const p = u.permissions || {};
    if (!p.purchase && !p.boss) {
      setDenied(true);
      return;
    }
    setUser({ username: u.username, isAdmin: !!p.boss });
  }, [router]);

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => router.push("/dashboard/purchase")}
          className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-4 font-bold text-xs uppercase tracking-[0.2em]"
        >
          <FiArrowLeft /> Back to Purchase
        </button>
        <div className="mb-4 ml-1">
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Pricelist</h1>
          <p className="text-slate-500 text-[10px] font-bold tracking-[0.2em] uppercase">Supplier catalogue &amp; item-name tags</p>
        </div>
        <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
          {TABS.map((t) => (
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
          <div className="p-8 text-center text-sm font-bold text-rose-600">You do not have access to Purchase.</div>
        ) : user ? (
          children(user)
        ) : null}
      </div>
    </div>
  );
}
