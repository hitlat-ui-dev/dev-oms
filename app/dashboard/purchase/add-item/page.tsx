"use client";
import ItemForm from "@/components/ItemForm";
import { FiArrowLeft, FiBox } from "react-icons/fi";
import { useRouter } from "next/navigation";

export default function AddItemPage() {
  const router = useRouter();

  return (
    <div className="p-4 md:p-12 max-w-4xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 mb-6 font-bold text-xs uppercase tracking-widest hover:text-blue-600 transition-colors">
        <FiArrowLeft /> Back
      </button>

      <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-[#0f172a] p-8 text-white flex items-center gap-4">
          <div className="p-4 bg-blue-500/20 rounded-2xl text-blue-400"><FiBox size={32} /></div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Add New Item</h1>
            <p className="text-blue-400 text-[10px] font-black tracking-widest uppercase">Inventory System</p>
          </div>
        </div>
        <div className="p-8">
          <ItemForm />
        </div>
      </div>
    </div>
  );
}