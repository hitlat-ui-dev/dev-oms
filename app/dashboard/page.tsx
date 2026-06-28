"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FiPlusCircle,
  FiPackage,
  FiRefreshCw,
  FiFileText,
  FiBriefcase,
  FiSettings,
  FiPrinter,
  FiDatabase,
  FiSliders
} from "react-icons/fi";


export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
      return;
    }

    const parsedUser = JSON.parse(session);
    setUser(parsedUser);

    // Dynamic sync on dashboard load to capture changes immediately
    fetch(`/api/users?username=${encodeURIComponent(parsedUser.username)}`)
      .then(res => res.json())
      .then(updated => {
        if (updated && updated.permissions) {
          const freshSession = { ...parsedUser, permissions: updated.permissions };
          localStorage.setItem("oms_user", JSON.stringify(freshSession));
          setUser(freshSession);
        }
      })
      .catch(() => {});
  }, [router]);

  if (!user) return null;


  const menuItems = [
    { name: "Purchase", path: "/dashboard/purchase", sub: "MANAGE NOW", icon: <FiPlusCircle />, color: "bg-[#1d63ff]", role: ["Owner", "Manager"] },
    { name: "Stock", path: "/dashboard/stock", sub: "MANAGE NOW", icon: <FiPackage />, color: "bg-[#00a86b]", role: ["Owner", "Manager", "Storekeeper"] },
    { name: "Manage Stock", path: "/dashboard/stock/manage-stock", sub: "MANAGE NOW", icon: <FiSliders />, color: "bg-[#0ea5e9]", role: ["Owner", "Manager", "Storekeeper"] },
    { name: "Orders", path: "/dashboard/orders", sub: "MANAGE NOW", icon: <FiRefreshCw />, color: "bg-[#f20505]", role: ["Owner", "Manager", "Office"] },
    {
      name: "Print Label",
      path: "/dashboard/print-labels", // Update this to your actual route
      sub: "PRINT NOW",
      icon: <FiPrinter />,
      color: "bg-[#8b2ef5]",
      role: ["Owner", "Manager"]
    },
    // { name: "My Companies", path: "/dashboard/companies", sub: "MANAGE NOW", icon: <FiBriefcase />, color: "bg-[#ff5100]", role: ["Owner"] },
    { name: "Settings", path: "/dashboard/settings", sub: "MANAGE NOW", icon: <FiSettings />, color: "bg-[#5c5cf5]", role: ["Owner"], permissionKey: "users", },
    { name: "Backup", path: "/dashboard/admin/backup", sub: "DOWNLOAD JSON", icon: <FiDatabase />, color: "bg-[#d97706]", role: ["Owner"], permissionKey: "backup" }
  ];

  const usernameLower = user?.username?.trim().toLowerCase();
  const isSuperAdmin = ["chintan", "hitesh"].includes(usernameLower) || user?.permissions?.boss === true;

  const hasMenuItemAccess = (item: any) => {
    if (isSuperAdmin) return true;

    if (item.name === "Purchase") {
      return user?.permissions?.purchase === true;
    }
    if (item.name === "Stock") {
      return user?.permissions?.stock === true;
    }
    if (item.name === "Manage Stock") {
      return user?.permissions?.manageStock === true;
    }
    if (item.name === "Orders") {
      const p = user?.permissions || {};
      return p.addOrder === true || p.addSeller === true || p.addTransporter === true || p.addMyCompanies === true;
    }
    if (item.name === "Settings") {
      return user?.permissions?.users === true;
    }
    if (item.name === "Print Label") {
      return user?.permissions?.printLabels === true;
    }
    if (item.name === "Backup") {
      return user?.permissions?.backup === true;
    }
    return true; // default fallback
  };

  return (
    <div className="p-4 md:p-12">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {menuItems.map((item) => (
          hasMenuItemAccess(item) && (
            <button
              key={item.name}
              onClick={() => router.push(item.path)}
              className={`${item.color} flex items-center p-6 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 text-left group`}
            >
              {/* ... icon and text code stays the same ... */}
              <div className="bg-white/20 p-4 rounded-xl text-white text-2xl mr-5">
                {item.icon}
              </div>
              <div>
                <h3 className="text-white text-lg font-black uppercase">{item.name}</h3>
                <p className="text-white/70 text-[10px] font-bold mt-1 uppercase">{item.sub}</p>
              </div>
            </button>
          )
        ))}
        {/* {menuItems.map((item) => (
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
        ))} */}
      </div>
    </div>
  );
}