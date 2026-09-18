"use client";
import { useRouter } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";
import GemCredentialsPanel from "@/components/GemCredentialsPanel";

export default function GemCredentialsPage() {
  const router = useRouter();

  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto space-y-4">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back
      </button>

      <GemCredentialsPanel />
    </div>
  );
}
