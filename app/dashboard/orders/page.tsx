"use client";
import { FiUserPlus, FiPlusCircle, FiArrowLeft, FiBriefcase, FiList, FiTruck, FiLink } from "react-icons/fi";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export default function OrdersDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    if (session) {
      const parsedUser = JSON.parse(session);
      setUser(parsedUser);

      // Dynamically fetch and sync permissions on loading the orders dashboard
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
    }
  }, []);

  const actions = [
    {
      title: "Orders",
      desc: "View all sales orders",
      icon: <FiList size={24} />,
      path: "/dashboard/orders/orders", // Path for the list page
      color: "bg-indigo-600",
      shadow: "shadow-indigo-200",
      permissionKey: "addOrder"
    },
    {
      title: "Add Seller",
      desc: "Register new sales person",
      icon: <FiUserPlus size={24} />,
      path: "/dashboard/orders/add-seller",
      color: "bg-blue-600",
      shadow: "shadow-blue-200",
      permissionKey: "addSeller"
    },
    {
      title: "Transpoter",
      desc: "Register logistics partner",
      icon: <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" height="24" width="24" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>,
      path: "/dashboard/orders/add-transporter",
      color: "bg-fuchsia-600", // Distinct purple/pink color
      shadow: "shadow-fuchsia-200",
      permissionKey: "addTransporter"
    },
    {
      title: "Fetch GeM Orders",
      desc: "Verify raw orders from GeM extension",
      icon: <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" height="24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>,
      path: "/dashboard/orders/fetch-gem-orders",
      color: "bg-emerald-600",
      shadow: "shadow-emerald-200",
      permissionKey: "addOrder"
    },
    {
      title: "My Companies",
      desc: "Manage corporate profiles",
      icon: <FiBriefcase size={24} />,
      path: "/dashboard/orders/companies",
      color: "bg-slate-800",
      shadow: "shadow-slate-200",
      permissionKey: "addMyCompanies"
    },
    {
      title: "Advance Order Tracker",
      desc: "Track GeM orders covering advance deliveries",
      icon: <FiLink size={24} />,
      path: "/dashboard/orders/advance-tracker",
      color: "bg-amber-600",
      shadow: "shadow-amber-200",
      permissionKey: "advanceOrderTracker"
    }
  ];

  return (
    <div className="p-4 md:p-12 max-w-7xl mx-auto">
      {/* Navigation Header */}
      <button 
        onClick={() => router.push("/dashboard")} 
        className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-8 font-bold text-xs uppercase tracking-[0.2em]"
      >
        <FiArrowLeft /> Back to Dashboard
      </button>

      {/* Main Title Section */}
      <div className="mb-12">
        <h1 className="text-3xl font-black uppercase tracking-tight text-slate-800">Order Management</h1>
        <p className="text-blue-600 text-[10px] font-black tracking-[0.3em] uppercase mt-1">Sales & Distribution Control</p>
      </div>

      {/* Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {actions
          .filter((item) => {
            const usernameLower = user?.username?.trim().toLowerCase();
            const isSuperAdmin = ["chintan", "hitesh"].includes(usernameLower) || user?.permissions?.boss === true;
            if (isSuperAdmin) return true;
            return user?.permissions?.[item.permissionKey] === true;
          })
          .map((item, index) => (
            <button
              key={index}
              onClick={() => router.push(item.path)}
              className="group relative bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 text-left overflow-hidden"
            >
            {/* Background Decoration */}
            <div className={`absolute -right-4 -top-4 w-24 h-24 ${item.color} opacity-[0.03] rounded-full group-hover:scale-150 transition-transform duration-500`} />
            
            <div className={`inline-flex p-5 ${item.color} text-white rounded-2xl shadow-lg ${item.shadow} mb-6 group-hover:rotate-6 transition-transform`}>
              {item.icon}
            </div>
            
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight text-slate-800 leading-tight">
                {item.title}
              </h3>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mt-2 group-hover:text-slate-600 transition-colors">
                {item.desc}
              </p>
            </div>

            {/* <div className="mt-8 flex items-center text-[10px] font-black text-blue-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
              Open Module →
            </div> */}
          </button>
        ))}
      </div>
    </div>
  );
}