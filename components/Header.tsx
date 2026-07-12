"use client";
import { FiLogOut, FiSun, FiMoon } from "react-icons/fi";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Header() {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string, role: string } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // Read theme from cookies on mount
    const match = document.cookie.match(/(^| )oms_theme=([^;]+)/);
    const savedTheme = match ? (match[2] as "dark" | "light") : "dark";
    setTheme(savedTheme);
    if (savedTheme === "light") {
      document.documentElement.classList.add("theme-light");
    } else {
      document.documentElement.classList.remove("theme-light");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.cookie = `oms_theme=${newTheme}; path=/; max-age=31536000`;
    if (newTheme === "light") {
      document.documentElement.classList.add("theme-light");
    } else {
      document.documentElement.classList.remove("theme-light");
    }
  };

  useEffect(() => {
    // 1. Next.js Guard: Ensure window is available
    if (typeof window === "undefined") return;

    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
      return;
    }

    try {
      setUser(JSON.parse(session));
    } catch (e) {
      // Handles rare cases of corrupted local storage on mobile
      router.push("/login");
      return;
    }

    let logoutTimer: NodeJS.Timeout;

    const resetTimer = () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      
      // 30 Minutes
      logoutTimer = setTimeout(() => {
        handleLogout();
        alert("Session expired due to inactivity.");
      }, 30 * 60 * 1000); 
    };

    // 2. Optimized Mobile Events
    const activityEvents = ['touchstart', 'mousedown', 'click', 'keydown', 'scroll'];
    
    // 3. Add 'passive: true' for better mobile scrolling performance
    activityEvents.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    resetTimer();

    return () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("oms_user");
    setUser(null);
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
        </div>

        {/* Theme Switcher Toggle */}
        <button 
          onClick={toggleTheme}
          className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 transition-all rounded-full cursor-pointer flex items-center justify-center"
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
        >
          {theme === "dark" ? <FiSun size={20} /> : <FiMoon size={20} />}
        </button>

        <button 
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-all rounded-full cursor-pointer flex items-center justify-center"
          title="Logout"
        >
          <FiLogOut size={20} />
        </button>
      </div>
    </header>
  );
}