"use client";
import { FiSave, FiTrash2 } from "react-icons/fi";

interface Props {
  data: any[];
  onInputChange: (id: string, field: string, value: any) => void;
  onSave: (req: any) => void;
  onDelete: (id: string) => void;
}

export default function PurchaseRequestTable({ data, onInputChange, onSave, onDelete }: Props) {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50/50 border-b border-slate-100">
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400">Date</th>
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400">Item Name</th>
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400">PR Qty</th>
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400">Remarks</th>
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400">Order Qty</th>
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400">Rate</th>
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400">Vendor</th>
            <th className="py-5 px-6 text-[11px] font-black uppercase text-slate-400 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {data.map((req) => (
            <tr key={req._id} className="hover:bg-slate-50/80 transition-all group">
              <td className="py-5 px-6 text-[12px] font-bold text-slate-500">
                {new Date(req.createdAt).toLocaleDateString('en-GB')}
              </td>
              <td className="py-5 px-6 font-black text-slate-800 text-[15px] uppercase tracking-tight">
                {req.itemName}
              </td>
              <td className="py-5 px-6 font-black text-slate-700 text-lg">
                {req.prQty} <span className="text-[10px] text-slate-400 uppercase ml-1 font-bold">{req.unit}</span>
              </td>
              <td className="py-5 px-6 text-[11px] text-slate-500 italic max-w-36 truncate">
                {req.remark || "---"}
              </td>
              <td className="py-5 px-6">
                <input 
                  type="number" defaultValue={req.prQty} 
                  onChange={(e) => onInputChange(req._id, "orderQty", e.target.value)}
                  className="w-20 p-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-center outline-none focus:ring-2 focus:ring-blue-500/20" 
                />
              </td>
              <td className="py-5 px-6">
                <input 
                  type="number" placeholder="0" 
                  onChange={(e) => onInputChange(req._id, "rate", e.target.value)}
                  className="w-20 p-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-center outline-none focus:ring-2 focus:ring-green-500/20" 
                />
              </td>
              <td className="py-5 px-6">
                <select 
                  onChange={(e) => onInputChange(req._id, "vendor", e.target.value)}
                  className="p-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-[10px] uppercase outline-none"
                >
                  <option value="">Select Vendor</option>
                  <option value="Global Tech">Global Tech</option>
                  <option value="Apex Logistics">Apex Logistics</option>
                </select>
              </td>
              <td className="py-5 px-6 text-right">
                <div className="flex justify-end gap-2">
                  <button onClick={() => onSave(req)} className="p-2.5 bg-green-50 text-green-600 rounded-xl hover:bg-green-600 hover:text-white transition-all"><FiSave size={18}/></button>
                  <button onClick={() => onDelete(req._id)} className="p-2.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-600 hover:text-white transition-all"><FiTrash2 size={18}/></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}