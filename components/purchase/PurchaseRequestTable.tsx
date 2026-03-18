"use client";
import { useState, useMemo } from "react";
import { FiSave, FiTrash2, FiChevronUp, FiChevronDown } from "react-icons/fi";

interface Props {
  data: any[];
  onInputChange: (id: string, field: string, value: any) => void;
  onSave: (req: any) => void;
  onDelete: (id: string) => void;
}

export default function PurchaseRequestTable({ data, onInputChange, onSave, onDelete }: Props) {
  // 1. Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'createdAt',
    direction: 'desc' // Default to newest first
  });

  // 2. Sorting Logic
  const sortedData = useMemo(() => {
    let sortableItems = [...data];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key] || "";
        const bValue = b[sortConfig.key] || "";

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [data, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Helper to show sort icon
  const getSortIcon = (name: string) => {
    if (sortConfig?.key !== name) return <FiChevronDown />;
    return sortConfig.direction === 'asc' ? <FiChevronUp /> : <FiChevronDown />;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Date</th>
            
            {/* 3. Sortable Item Name Header */}
            <th 
              onClick={() => requestSort('itemName')}
              className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center gap-1">
                Item Name {getSortIcon('itemName')}
              </div>
            </th>

            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Category</th>
            {/* <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Location</th> */}
            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">PR Qty</th>
            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Remarks</th>
            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Order Qty</th>
            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Rate</th>
            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Vendor</th>
            <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-500 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedData.map((req) => (
            <tr key={req._id} className="hover:bg-slate-50 transition-colors">
              <td className="py-2 px-2 text-[11px] font-medium text-slate-500 border-r border-slate-100">
                {new Date(req.createdAt).toLocaleDateString('en-GB')}
              </td>

              <td className="py-2 px-2 border-r border-slate-100">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-blue-600 uppercase leading-none mb-1">
                    {req.sku || "N/A"}
                  </span>
                  <span className="font-bold text-slate-800 text-[13px] uppercase truncate max-w-40">
                    {req.itemName}
                  </span>
                </div>
              </td>

              <td className="py-2 px-2 border-r border-slate-100">
                <span className="text-[10px] font-bold text-slate-600 uppercase">
                  {req.category || "General"}
                </span>
              </td>

              {/* <td className="py-2 px-2 text-[10px] font-bold text-slate-400 uppercase border-r border-slate-100">
                {req.location || "---"}
              </td> */}

              <td className="py-2 px-2 font-bold text-slate-700 text-[14px] border-r border-slate-100">
                {req.prQty} <span className="text-[9px] text-slate-400">{req.unit}</span>
              </td>

              <td className="py-2 px-2 text-[10px] text-slate-500 border-r border-slate-100 truncate max-w-28">
                {req.remark || "---"}
              </td>
              
              <td className="py-2 px-2 border-r border-slate-100">
                <input 
                  type="number" defaultValue={req.prQty} 
                  onChange={(e) => onInputChange(req._id, "orderQty", e.target.value)}
                  className="w-16 p-1 bg-slate-50 border border-slate-200 rounded text-[12px] font-bold text-center outline-none" 
                />
              </td>
              
              <td className="py-2 px-2 border-r border-slate-100">
                <input 
                  type="number" placeholder="0" 
                  onChange={(e) => onInputChange(req._id, "rate", e.target.value)}
                  className="w-16 p-1 bg-slate-50 border border-slate-200 rounded text-[12px] font-bold text-center outline-none" 
                />
              </td>

              <td className="py-2 px-2 border-r border-slate-100">
                <select 
                  onChange={(e) => onInputChange(req._id, "vendor", e.target.value)}
                  className="w-24 p-1 bg-slate-50 border border-slate-200 rounded font-bold text-[9px] uppercase outline-none"
                >
                  <option value="">Select</option>
                  <option value="Global Tech">Global Tech</option>
                  <option value="Apex Logistics">Apex Logistics</option>
                </select>
              </td>

              <td className="py-2 px-2 text-right">
                <div className="flex justify-end gap-1">
                  <button onClick={() => onSave(req)} className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors">
                    <FiSave size={14}/>
                  </button>
                  <button onClick={() => onDelete(req._id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors">
                    <FiTrash2 size={14}/>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}