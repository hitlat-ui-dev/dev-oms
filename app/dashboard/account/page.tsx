"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FiFileText, FiArrowLeft, FiList, FiBookOpen, FiCheckSquare, FiPrinter } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

export default function AccountPage() {
  const router = useRouter();

  const menuItems = [
    {
      name: "Generate Bill",
      path: "/dashboard/account/bills",
      sub: "TAX INVOICE / BILL OF SUPPLY",
      icon: <FiPrinter />,
      color: "bg-[#ea580c]",
    },
    {
      name: "Statement",
      path: "/dashboard/account/statement",
      sub: "UPLOAD & VIEW",
      icon: <FiFileText />,
      color: "bg-[#0891b2]",
    },
    {
      name: "Ledger",
      path: "/dashboard/account/ledger",
      sub: "INSTITUTE WISE ORDERS",
      icon: <FiList />,
      color: "bg-[#2563eb]",
    },
    {
      name: "Buyer Ledger",
      path: "/dashboard/account/buyer-ledger",
      sub: "RUNNING PARTY LEDGER",
      icon: <FiBookOpen />,
      color: "bg-[#7c3aed]",
    },
    {
      name: "Reconciliation",
      path: "/dashboard/account/reconciliation",
      sub: "MATCH & CONFIRM PAYMENTS",
      icon: <FiCheckSquare />,
      color: "bg-[#059669]",
    },
  ];

  return (
    <BlockGuard
      permission="accountStatements"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-12">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Dashboard
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Account</h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">Firm Bank Statements & Records</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {menuItems.map((item) => (
              <button
                key={item.name}
                onClick={() => router.push(item.path)}
                className={`${item.color} flex items-center p-6 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 text-left group`}
              >
                <div className="bg-white/20 p-4 rounded-xl text-white text-2xl mr-5">
                  {item.icon}
                </div>
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
