"use client";
import { useRouter } from "next/navigation";
import BlockGuard from "@/components/BlockGuard";
import UrgentTaskManagerPanel from "@/components/UrgentTaskManagerPanel";
import { FiArrowLeft, FiAlertTriangle } from "react-icons/fi";

export default function UrgentTasksPage() {
  const router = useRouter();

  return (
    <BlockGuard
      permission="boss"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no access for this page.</p>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest w-fit">
            <FiArrowLeft /> Back
          </button>

          <div className="flex items-center gap-4">
            <div className="bg-[#dc2626] text-white p-4 rounded-2xl">
              <FiAlertTriangle size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Urgent Tasks</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Assign & Track</p>
            </div>
          </div>

          <UrgentTaskManagerPanel />
        </div>
      </div>
    </BlockGuard>
  );
}
