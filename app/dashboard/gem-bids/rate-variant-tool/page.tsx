"use client";
import Link from "next/link";
import { FiArrowLeft, FiPercent } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

export default function RateVariantToolPage() {
  return (
    <BlockGuard
      permission="gemBids"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen flex flex-col gap-4">
        <div>
          <Link href="/dashboard/gem-bids" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
            <FiArrowLeft /> Back to GeM Bids
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
            <FiPercent className="text-blue-600" /> Rate Variant Tool
          </h1>
          <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
            Generate Fixed-₹ Rate Variants Or Percentage-Margin Prices From A Rate Sheet
          </p>
        </div>

        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" style={{ minHeight: "80vh" }}>
          <iframe
            src="/tools/rate-variant-tool.html"
            title="Rate Variant Tool"
            className="w-full h-full border-0"
            style={{ minHeight: "80vh" }}
          />
        </div>
      </div>
    </BlockGuard>
  );
}
