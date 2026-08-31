"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FiArrowLeft, FiPlusCircle, FiBookOpen, FiAlertTriangle, FiLink, FiDollarSign, FiSettings } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

export default function DDTrackingPage() {
  const router = useRouter();

  const menuItems = [
    {
      name: "New DD Entry",
      path: "/dashboard/account/dd-tracking/new",
      sub: "SCAN & ADD DEMAND DRAFT",
      icon: <FiPlusCircle />,
      color: "bg-[#0f172a]",
    },
    {
      name: "DD Ledger",
      path: "/dashboard/account/dd-tracking/ledger",
      sub: "ALL DD ENTRIES",
      icon: <FiBookOpen />,
      color: "bg-[#2563eb]",
    },
    {
      name: "Pending Return Report",
      path: "/dashboard/account/dd-tracking/pending-return",
      sub: "TENDER ENDED, DD NOT BACK YET",
      icon: <FiAlertTriangle />,
      color: "bg-[#dc2626]",
    },
    {
      name: "Bank Match",
      path: "/dashboard/account/dd-tracking/bank-match",
      sub: "MATCH REFUND CREDITS",
      icon: <FiLink />,
      color: "bg-[#059669]",
    },
    {
      name: "Charges Summary",
      path: "/dashboard/account/dd-tracking/charges-summary",
      sub: "BANK CHARGES REPORT",
      icon: <FiDollarSign />,
      color: "bg-[#ea580c]",
    },
    {
      name: "Firm Bank Accounts",
      path: "/dashboard/account/dd-tracking/firm-bank-accounts",
      sub: "FIRM ↔ BANK ACCOUNT MASTER",
      icon: <FiSettings />,
      color: "bg-[#7c3aed]",
    },
  ];

  return (
    <BlockGuard
      permission="accountStatements"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard/account" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Go to Account
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-12">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard/account" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Account
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">DD Tracking</h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Tender Security Deposit Demand Draft Lifecycle
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {menuItems.map((item) => (
              <button
                key={item.name}
                onClick={() => router.push(item.path)}
                className={`${item.color} flex items-center p-6 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 text-left group`}
              >
                <div className="bg-white/20 p-4 rounded-xl text-white text-2xl mr-5">{item.icon}</div>
                <div>
                  <h3 className="text-white text-lg font-black uppercase">{item.name}</h3>
                  <p className="text-white/70 text-[10px] font-bold mt-1 uppercase">{item.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
