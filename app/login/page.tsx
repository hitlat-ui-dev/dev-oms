"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (res.ok) {
      localStorage.setItem("oms_user", JSON.stringify(data));
      router.push("/dashboard");
    } else {
      setError(data.error);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] relative overflow-hidden">
      {/* Background Decorative Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-900/20 blur-[120px] rounded-full"></div>

      <div className="relative w-full max-w-md px-6">
        <form 
          onSubmit={handleLogin} 
          className="bg-white/5 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-white/10 w-full"
        >
          {/* Logo/Brand Section */}
          <div className="mb-10 text-center">
            <h1 className="text-white text-3xl font-extrabold tracking-tight">Dev OMS</h1>
            <p className="text-slate-400 mt-2 text-sm">Order Management system</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-2xl flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
              <p className="text-red-400 text-xs font-medium">{error}</p>
            </div>
          )}

          {/* Input Fields */}
          <div className="space-y-5">
            <div className="group">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">Username</label>
              <input 
                type="text" 
                placeholder="Hitesh" 
                required
                className="w-full p-4 bg-white/5 text-white rounded-2xl border border-white/10 outline-none transition-all focus:border-blue-500 focus:bg-white/10 focus:ring-4 focus:ring-blue-500/10 placeholder:text-slate-600"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="group">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">Password</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                required
                className="w-full p-4 bg-white/5 text-white rounded-2xl border border-white/10 outline-none transition-all focus:border-blue-500 focus:bg-white/10 focus:ring-4 focus:ring-blue-500/10 placeholder:text-slate-600"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {/* Action Button */}
          <button 
            disabled={loading}
            className="w-full mt-10 bg-blue-500 text-white p-4 rounded-2xl font-bold shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? "Authenticating..." : "Login to Workspace"}
          </button>

          <p className="mt-8 text-center text-slate-500 text-xs">
            © 2026 Dev OMS Architecture
          </p>
        </form>
      </div>
    </div>
  );
}