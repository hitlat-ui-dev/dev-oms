"use client";
import Link from "next/link";
import { FiTool } from "react-icons/fi";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#f3f6f9] flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-white p-10 rounded-3xl shadow-xl border border-slate-200 max-w-md w-full">
        <div className="w-20 h-20 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <FiTool size={40} />
        </div>
        
        <h1 className="text-3xl font-black text-slate-800 mb-2">UNDER DEVELOPMENT</h1>
        <p className="text-slate-500 font-medium mb-8">
          This section is currently being built by our team. Please check back soon!
        </p>

        <Link 
          href="/dashboard"
          className="inline-block w-full bg-[#0f172a] text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all"
        >
          Back to Dashboard
        </Link>
      </div>
      
      <p className="mt-8 text-[10px] text-slate-400 font-black tracking-[0.3em] uppercase">
        Dev OMS Internal System
      </p>
    </div>
  );
}