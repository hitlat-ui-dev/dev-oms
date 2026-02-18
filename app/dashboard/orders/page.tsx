"use client";
import { FiUserPlus, FiPlusCircle, FiRotateCcw, FiArrowLeft } from "react-icons/fi";
import { useRouter } from "next/navigation";

export default function OrdersDashboard() {
  const router = useRouter();

  const actions = [
    {
      title: "Add Seller",
      desc: "Register new sales person",
      icon: <FiUserPlus size={24} />,
      path: "/dashboard/orders/add-seller",
      color: "bg-blue-600",
      shadow: "shadow-blue-200"
    },
    {
      title: "Add Order",
      desc: "Create new sales order",
      icon: <FiPlusCircle size={24} />,
      path: "/dashboard/orders/add-order",
      color: "bg-emerald-600",
      shadow: "shadow-emerald-200"
    },
    {
      title: "Sale Return",
      desc: "Manage product returns",
      icon: <FiRotateCcw size={24} />,
      path: "/dashboard/orders/sale-return",
      color: "bg-rose-600",
      shadow: "shadow-rose-200"
    }
  ];

  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {actions.map((item, index) => (
          <button
            key={index}
            onClick={() => router.push(item.path)}
            className="group relative bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 text-left overflow-hidden"
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

            <div className="mt-8 flex items-center text-[10px] font-black text-blue-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
              Open Module →
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}