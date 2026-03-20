"use client";
import { useState, useMemo } from "react";
import { FiSave, FiTrash2, FiChevronUp, FiChevronDown } from "react-icons/fi";

interface Props {
  data: any[];
  vendors: any[];
  stockData: any[];
  onInputChange: (id: string, field: string, value: any) => void;
  onSave: (req: any) => void;
  onDelete: (id: string) => void;
}

export default function PurchaseRequestTable({ data, vendors, stockData, onInputChange, onSave, onDelete }: Props) {
  //console.log("Current Stock List:", stockData);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'createdAt',
    direction: 'desc'
  });

  // Helper function to find stock for a specific item
const getStockInfo = (itemName: string, sku: string) => {
    // 1. Find the item in stockData using a clean comparison
    const stockItem = stockData?.find(s => 
      (s.sku && s.sku === sku) || 
      (s.itemName && s.itemName.trim().toLowerCase() === itemName.trim().toLowerCase())
    );

    // 2. Use 'totalQty' as seen in your console log
    const availableQty = stockItem?.totalQty; 
    const unit = stockItem?.unit || "";

    // 3. Return formatted string or default dash
    if (availableQty === undefined || availableQty === null) {
      return <span className="text-slate-400 font-normal italic">No stock</span>;
    }

    return (
      <span className="text-emerald-600 font-bold">{availableQty} {unit}</span>
    );
  };

  const sortedData = useMemo(() => {
    let sortableItems = [...data];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        // Handle potential null/undefined values and make sorting case-insensitive
        const aValue = (a[sortConfig.key] || "").toString().toLowerCase();
        const bValue = (b[sortConfig.key] || "").toString().toLowerCase();

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
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

  const renderSortIcon = (name: string) => {
    if (sortConfig?.key !== name) return <FiChevronDown className="text-slate-600 ml-auto" />;
    return sortConfig.direction === 'asc'
      ? <FiChevronUp className="text-blue-600 ml-auto" />
      : <FiChevronDown className="text-blue-600 ml-auto" />;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
      <table className="w-full text-left border-collapse table-fixed">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Date</th>

            <th
              onClick={() => requestSort('itemName')}
              className="w-56 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                Item Name {renderSortIcon('itemName')}
              </div>
            </th>

            {/* --- Category Sort Added Here --- */}
            <th
              onClick={() => requestSort('category')}
              className="w-28 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                Category {renderSortIcon('category')}
              </div>
            </th>

            <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">PR Qty</th>
            <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Order Qty</th>
            <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Rate</th>

            <th
              onClick={() => requestSort('vendor')}
              className="w-40 py-3 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                Vendor {renderSortIcon('vendor')}
              </div>
            </th>

            <th className="py-3 w-48 px-2 text-[10px] font-black uppercase text-slate-500 border-r border-slate-200">Remarks</th>
            <th className="w-20 py-3 px-2 text-[10px] font-black uppercase text-slate-500 text-right">Actions</th>
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
                  <div className="flex items-center mb-1">
                    <span className="text-[9px] font-bold text-blue-600 uppercase leading-none">{req.sku || "N/A"} - </span>
                    <span className="text-[9px] leading-none">{getStockInfo(req.itemName, req.sku)}</span>
                  </div>
                  <span className="font-bold text-slate-800 text-[12px] ">
                    {req.itemName}
                  </span>
                </div>
              </td>

              <td className="py-2 px-2 border-r border-slate-100 text-[10px] font-bold text-slate-600 uppercase">
                {req.category || "General"}
              </td>

              <td className="py-2 px-2 font-bold text-slate-700 text-[13px] border-r border-slate-100">
                {req.prQty} <span className="text-[9px] text-slate-400 font-normal">{req.unit}</span>
              </td>

              <td className="py-2 px-2 border-r border-slate-100">
                <input
                  type="number" defaultValue={req.prQty}
                  onChange={(e) => onInputChange(req._id, "orderQty", e.target.value)}
                  className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-[12px] font-bold text-center outline-none"
                />
              </td>

              <td className="py-2 px-2 border-r border-slate-100">
                <input
                  type="number" placeholder="0"
                  onChange={(e) => onInputChange(req._id, "rate", e.target.value)}
                  className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-[12px] font-bold text-center outline-none"
                />
              </td>

              <td className="py-2 px-2 border-r border-slate-100">
                <select
                  onChange={(e) => onInputChange(req._id, "vendor", e.target.value)}
                  className="w-full p-1 bg-slate-50 border border-slate-200 rounded font-bold text-[9px] uppercase outline-none focus:border-blue-500"
                >
                  <option value="">Select</option>
                  {vendors.map((v) => (
                    <option key={v._id} value={v.name}>{v.name}</option>
                  ))}
                </select>
              </td>

              <td className="py-2 px-2 text-[10px] text-slate-500 border-r border-slate-100 ">
                {req.remark || "---"}
              </td>

              <td className="py-2 px-2 text-right">
                <div className="flex justify-end gap-1">
                  <button onClick={() => onSave(req)} className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors">
                    <FiSave size={14} />
                  </button>
                  <button onClick={() => onDelete(req._id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors">
                    <FiTrash2 size={14} />
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