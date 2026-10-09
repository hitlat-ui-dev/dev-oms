"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FiArrowLeft, FiPercent } from "react-icons/fi";
import MetalCalculatorPanel from "@/components/MetalCalculatorPanel";

export default function MetalCalculatorPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("oms_user")) router.push("/login");
  }, [router]);

  return (
    <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest w-fit"
        >
          <FiArrowLeft /> Back
        </button>

        <div className="flex items-center gap-4">
          <div className="bg-[#ea580c] text-white p-4 rounded-2xl">
            <FiPercent size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Metal Calculator</h1>
            <p className="text-[#ea580c] text-[10px] font-black tracking-widest uppercase">Weight per Meter &amp; Total Weight</p>
          </div>
        </div>

        <MetalCalculatorPanel />
      </div>
    </div>
  );
}
