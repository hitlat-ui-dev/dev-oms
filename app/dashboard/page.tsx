"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  FiPlusCircle, 
  FiPackage, 
  FiRefreshCw, 
  FiFileText, 
  FiBriefcase, 
  FiSettings 
} from "react-icons/fi";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string, role: string } | null>(null);

  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
    } else {
      setUser(JSON.parse(session));
    }
  }, [router]);

  if (!user) return null;

  const menuItems = [
    { name: "Purchase", path: "/dashboard/purchase", sub: "MANAGE NOW", icon: <FiPlusCircle />, color: "bg-[#1d63ff]", role: ["Owner", "Manager"] },
    { name: "Stock", path: "/dashboard/stock", sub: "MANAGE NOW", icon: <FiPackage />, color: "bg-[#00a86b]", role: ["Owner", "Manager", "Storekeeper"] },
    { name: "Orders", path: "/dashboard/orders", sub: "MANAGE NOW", icon: <FiRefreshCw />, color: "bg-[#f20505]", role: ["Owner", "Manager", "Office"] },
    { name: "Reports", path: "/dashboard/reports", sub: "MANAGE NOW", icon: <FiFileText />, color: "bg-[#8b2ef5]", role: ["Owner", "Manager"] },
    { name: "My Companies", path: "/dashboard/companies", sub: "MANAGE NOW", icon: <FiBriefcase />, color: "bg-[#ff5100]", role: ["Owner"] },
    { name: "Settings", path: "/dashboard/settings", sub: "MANAGE NOW", icon: <FiSettings />, color: "bg-[#5c5cf5]", role: ["Owner"] },
  ];

  return (
    <div className="p-4 md:p-12">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {menuItems.map((item) => (
          item.role.includes(user.role) && (
            <button
              key={item.name}
              onClick={() => router.push(item.path)}
              className={`${item.color} flex items-center p-6 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 text-left group`}
            >
              <div className="bg-white/20 p-4 rounded-xl text-white text-2xl mr-5 group-hover:rotate-12 transition-transform">
                {item.icon}
              </div>
              <div>
                <h3 className="text-white text-lg font-black uppercase tracking-wider leading-none">
                  {item.name}
                </h3>
                <p className="text-white/70 text-[10px] font-bold mt-1 tracking-widest uppercase">
                  {item.sub}
                </p>
              </div>
            </button>
          )
        ))}
      </div>
    </div>
  );
}