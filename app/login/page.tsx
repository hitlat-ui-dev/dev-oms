"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If already logged in, send them to dashboard immediately
  useEffect(() => {
    if (localStorage.getItem("oms_user")) {
      router.push("/dashboard");
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok) {
        // MATCH KEY WITH LAYOUT
        localStorage.setItem("oms_user", JSON.stringify(data));
        router.push("/dashboard"); 
      } else {
        setError(data.error || "Login Failed");
        setLoading(false);
      }
    } catch (err) {
      setError("Server error");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-900/20 blur-[120px] rounded-full"></div>

      <div className="relative w-full max-w-md px-6">
        <form 
          onSubmit={handleLogin} 
          className="bg-white/5 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-white/10 w-full"
        >
          <div className="mb-10 text-center">
            <h1 className="text-white text-3xl font-extrabold tracking-tight">Dev OMS</h1>
            <p className="text-slate-400 mt-2 text-sm">Order Management system</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-2xl flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
              <p className="text-red-400 text-[11px] font-medium uppercase tracking-wider">{error}</p>
            </div>
          )}

          <div className="space-y-5">
            <div className="group">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Username</label>
              <input 
                type="text" 
                placeholder="Enter Username" 
                required
                className="w-full p-4 bg-white/5 text-white rounded-2xl border border-white/10 outline-none transition-all focus:border-blue-500 focus:bg-white/10 placeholder:text-slate-600"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="group">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Password</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                required
                className="w-full p-4 bg-white/5 text-white rounded-2xl border border-white/10 outline-none transition-all focus:border-blue-500 focus:bg-white/10 placeholder:text-slate-600"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            disabled={loading}
            className="w-full mt-10 bg-blue-600 text-white p-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl shadow-blue-900/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? "Authenticating..." : "Login to Workspace"}
          </button>

          <p className="mt-8 text-center text-slate-500 text-[9px] font-black uppercase tracking-widest">
            © 2026 Dev OMS Architecture
          </p>
        </form>
      </div>
    </div>
  );
}