"use client";
import { useState, useEffect } from "react";

export default function ItemReportModal({ sku, onClose }: { sku: string, onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stock/report?sku=${sku}`)
      .then(res => res.json())
      .then(res => {
        setData(res);
        setLoading(false);
      });
  }, [sku]);

  if (loading) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="p-6 border-b flex justify-between items-center bg-slate-50 rounded-t-2xl">
          <div>
            <h2 className="text-xl font-black uppercase text-slate-800">{data?.itemName}</h2>
            <div className="flex gap-4 mt-1">
              <p className="text-slate-500 text-xs font-bold bg-white px-2 py-1 rounded border">SKU: {data?.sku}</p>
              <p className="text-blue-600 text-xs font-bold bg-blue-50 px-2 py-1 rounded border border-blue-100">
                CURRENT STOCK: <span className="text-red-600">{data.currentStock || "No Stock"}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="bg-white border w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 transition-all hover:shadow-md">✕</button>
        </div>

        {/* Ledger Table */}
        <div className="p-6 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[11px] font-black uppercase text-slate-400 border-b">
              <tr>
                <th className="pb-3">Date</th>
                <th className="pb-3">Type</th>
                <th className="pb-3 pl-4">Details</th>
                <th className="pb-3 text-center text-red-500 bg-red-50/50">Debit (-)</th>
                <th className="pb-3 text-center text-green-600 bg-green-50/50">Credit (+)</th>

              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.history.map((row: any, i: number) => {
                // Logic to decide if qty goes to Debit or Credit
                const isDebit = row.qty < 0;
                return (
                  <tr key={i} className="text-sm hover:bg-slate-50 transition-colors">
                    <td className="py-4 text-slate-500">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-black ${row.type === 'SELL' ? 'bg-orange-100 text-orange-700' :
                          row.type === 'Opening Stock' ? 'bg-purple-100 text-purple-700' :
                            'bg-green-100 text-green-700'
                        }`}>
                        {row.type}
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-xs text-slate-600">
                      {row.type === 'SELL' && (
                        <p><b>Order NO. :</b> {row.orderNo || 'N/A'} | <b>Market:</b> {row.sellerName || 'N/A'}</p>
                      )}
                      {/* {(row.type === 'PURCHASE' || row.type === 'PURCHASE_RETURN') && (
                        <p><b>Vendor:</b> {row.vendorName || 'N/A'} | <b>Inv:</b> {row.orderNo || 'N/A'}</p>
                      )} */}
                      {row.type === 'Opening Stock' && (
                        <p className="italic text-slate-800 font-bold">Initial Stock Entry</p>
                      )}
                      {(row.type.includes('PURCHASE') || row.type.includes('RETURN')) && (
                        <p><b>Vendor:</b> {row.vendorName || 'N/A'} | <b>Inv:</b> {row.orderNo || 'N/A'}</p>
                      )}
                    </td>
                    {/* Debit Column */}
                    <td className="py-4 text-center font-bold text-red-500 bg-red-50/20">
                      {isDebit ? Math.abs(row.qty) : ""}
                    </td>

                    {/* Credit Column */}
                    <td className="py-4 text-center font-bold text-green-600 bg-green-50/20">
                      {!isDebit ? row.qty : ""}
                    </td>


                  </tr>
                );
              })}
            </tbody>
          </table>

          {data?.history?.length === 0 && (
            <div className="py-20 text-center text-slate-400 italic">
              No transaction history found for this item.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}