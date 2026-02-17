"use client";
import { FiLogOut } from "react-icons/fi";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Header() {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string, role: string } | null>(null);

  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    if (session) {
      setUser(JSON.parse(session));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("oms_user");
    router.push("/login");
  };

  if (!user) return null;

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-4 md:px-10 py-2 bg-[#0f172a] text-white shadow-lg">
      {/* Clickable Logo - Goes to Dashboard */}
      <Link href="/dashboard" className="flex items-baseline cursor-pointer group">
        <span className="text-2xl md:text-3xl font-black tracking-tighter text-white group-hover:text-blue-400 transition-colors">Dev</span>
        <span className="text-sm md:text-base font-bold tracking-tight text-blue-400 ml-1 uppercase">OMS</span>
      </Link>

      <div className="flex items-center gap-4 md:gap-8">
        <div className="text-right border-r border-slate-700 pr-4 md:pr-8">
          <h2 className="text-sm md:text-lg font-bold leading-none capitalize">{user.username}</h2>
          <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] block mt-0.5">{user.role}</span>
        </div>
        <button 
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-all rounded-full"
        >
          <FiLogOut size={22} />
        </button>
      </div>
    </header>
  );
}