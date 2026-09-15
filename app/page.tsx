"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const user = localStorage.getItem("oms_user");
    if (user) {
      // If session exists, go to dashboard
      router.push("/dashboard");
    } else {
      // Otherwise, go to login
      router.push("/login");
    }
  }, [router]);

  return (
    <div className="bg-[#f3f6f9] min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-slate-400 font-bold uppercase tracking-widest">
        Initializing Workspace...
      </div>
    </div>
  );
}