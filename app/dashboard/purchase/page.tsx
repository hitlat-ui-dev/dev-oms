"use client";
import { useRouter } from "next/navigation";
import { 
  FiPlusCircle, 
  FiUserPlus, 
  FiShoppingCart, 
  FiRotateCcw, 
  FiBox, 
  FiFileText,
  FiSend 
} from "react-icons/fi";

export default function PurchasePage() {
  const router = useRouter();

  // Menu items - No popup logic here, just standard routing
  const purchaseMenu = [
    { name: "Add Purchase", path: "/dashboard/purchase/add-purchase", icon: <FiShoppingCart />, color: "bg-[#1d63ff]" },
    { name: "Payment of Purchase", path: "/dashboard/purchase/payment", icon: <FiPlusCircle />, color: "bg-[#00a86b]" },
    { name: "Purchase Return", path: "/dashboard/purchase/return", icon: <FiRotateCcw />, color: "bg-[#f20505]" },
    { name: "Add Vendor", path: "/dashboard/purchase/add-vendor", icon: <FiUserPlus />, color: "bg-[#8b2ef5]" },
    { name: "Add Item", path: "/dashboard/purchase/add-item", icon: <FiBox />, color: "bg-[#ff5100]" },
    { name: "Purchase Reports", path: "/dashboard/purchase/reports", icon: <FiFileText />, color: "bg-[#5c5cf5]" },
    { name: "Purchase Request", path: "/dashboard/purchase/purchase-request", icon: <FiSend />, color: "bg-[#0f172a]" }, 
  ];

  return (
    <div className="p-4 md:p-12">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="mb-8 ml-2">
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Purchase</h1>
          <p className="text-slate-500 text-[10px] font-bold tracking-[0.2em] uppercase">Internal Management System</p>
        </div>

        {/* Grid Menu */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {purchaseMenu.map((item) => (
            <button
              key={item.name}
              onClick={() => router.push(item.path)} // Fixed: Simplified to only use router.push
              className={`${item.color} flex items-center p-5 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 text-left group`}
            >
              {/* White Translucent Icon Box */}
              <div className="bg-white/20 p-4 rounded-xl text-white text-2xl mr-5 group-hover:rotate-12 transition-transform">
                {item.icon}
              </div>
              
              <div>
                <h3 className="text-white text-lg font-black uppercase tracking-wider leading-none">
                  {item.name}
                </h3>
                <p className="text-white/70 text-[10px] font-bold mt-1 tracking-widest uppercase">
                  MANAGE NOW
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}