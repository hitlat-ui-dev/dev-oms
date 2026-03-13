"use client";
import { useState, useEffect } from "react";

export default function StockPage() {
  const [stock, setStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStock = async () => {
    try {
      const res = await fetch("/api/stock");
      const data = await res.json();
      setStock(data);
    } catch (err) {
      console.error("Failed to load stock");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStock(); }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto min-h-screen bg-slate-50/50">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">INVENTORY STOCK</h1>
        <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Live Warehouse Balance</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-900">
            <tr>
              <th className="py-4 px-8 text-[10px] font-black uppercase text-slate-400 tracking-widest">Item Name</th>
              <th className="py-4 px-8 text-[10px] font-black uppercase text-slate-400 tracking-widest text-center">Current Qty</th>
              <th className="py-4 px-8 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Rate Range</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stock.map((item, idx) => (
              <tr key={idx} className="hover:bg-slate-50/80 transition-all">
                <td className="py-4 px-8">
                  <span className="font-black text-slate-800 text-sm uppercase">{item.itemName}</span>
                </td>
                
                <td className="py-4 px-8 text-center">
                  <span className="bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full font-black text-sm">
                    {item.totalQty.toLocaleString()} {item.unit}
                  </span>
                </td>
                <td className="py-4 px-8 text-right">
                  <span className="text-slate-600 font-bold text-xs italic">
                    {item.rateDisplay}
                  </span>
                </td>
              </tr>
            ))}
            {stock.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="py-20 text-center text-slate-400 font-bold italic">
                  No stock items found in database.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}