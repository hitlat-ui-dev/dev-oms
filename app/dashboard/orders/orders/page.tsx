"use client";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import SellerOrderForm from "@/components/SellerOrderForm";
import { useState, useEffect, useCallback, useMemo } from "react";
import { FiExternalLink, FiTruck, FiRotateCcw, FiEdit, FiRefreshCcw, FiCheckCircle, FiPlus, FiDownload } from "react-icons/fi";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LuRotateCcw } from "react-icons/lu";


const TABS = [
  "ALL", "TO CHECK", "HISAB",
  "READY TO SHIP", "DELIVERY", "CANCELL ORDER", "RETURN ORDER", "RETURN RECEIVED"
];

export default function OrdersListPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [transporters, setTransporters] = useState<any[]>([]);
  const [deliveryData, setDeliveryData] = useState({
    transportName: "",
    transportRemark: "",
    deliveryDate: new Date().toISOString().split('T')[0]
  });
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnQty, setReturnQty] = useState(0);
  const [showPartialShipModal, setShowPartialShipModal] = useState(false);
  const [shipQty, setShipQty] = useState(0);
  const [availableStock, setAvailableStock] = useState(0);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [stocks, setStocks] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    itemName: "",
    category: "",
    firm: "",
    buyerName: "",
    startDate: "", // Change from 'date' to 'startDate'
    endDate: ""
  });

  const [moveToCheck, setMoveToCheck] = useState(false);
  const [partialError, setPartialError] = useState("");

  const [companies, setCompanies] = useState<any[]>([]);
  const [sellers, setSellers] = useState<any[]>([]);

  const [stock, setStock] = useState<StockItem[]>([]);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isReceivedModalOpen, setIsReceivedModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  interface StockItem {
    _id: string;
    sku: string;
    itemName: string;
    lastUpdated?: string | Date;
    quantity: number;
    vendor?: string;
    category?: string;
    unit?: string;
    rate?: number;
  }

  useEffect(() => {
    fetchTabData();
  }, []);

  const fetchTabData = async () => {
    try {
      // 1. YOUR ORIGINAL STOCK LOGIC (Kept exactly the same)
      const stockRes = await fetch('/api/stock');
      const stockData = await stockRes.json();
      setStock(Array.isArray(stockData) ? stockData : stockData.items || []);

      // 2. YOUR ORIGINAL SELLERS LOGIC (Kept exactly the same)
      const sellerRes = await fetch('/api/sellers');
      const sellerData = await sellerRes.json();
      setSellers(Array.isArray(sellerData) ? sellerData : []);

      // 3. NEW COMPANY LOGIC (Added as a separate try-catch so it cannot break the others)
      try {
        const companyRes = await fetch('/api/companies');
        if (companyRes.ok) {
          const companyData = await companyRes.json();
          setCompanies(Array.isArray(companyData) ? companyData : []);
        }
      } catch (companyError) {
        console.error("Optional Companies fetch failed, but Stock/Sellers are safe.");
      }

    } catch (error) {
      // This maintains your existing error logging
      console.error("Failed to fetch dashboard data:", error);
    }
  };
  const sortedStock = useMemo(() => {
    if (!stock || !Array.isArray(stock)) return [];
    return [...stock].sort((a, b) => {
      // Use fallback date string for items missing the lastUpdated field
      const dateA = new Date(a.lastUpdated || '1970-01-01').getTime();
      const dateB = new Date(b.lastUpdated || '1970-01-01').getTime();
      return dateB - dateA; // Descending order
    });
  }, [stock]);



  const filteredOrders = orders.filter(order => {
    // 1. Tab Status must match
    const matchesTab = activeTab === "ALL" || (activeTab === "CANCEL" && order.status === "CANCELL ORDER") || order.status === activeTab;

    // 2. Safe and Trimmed Search Logic
    const matchesItem = (order.itemName || "").toLowerCase().trim()
      .includes(filters.itemName.toLowerCase().trim());

    const matchesCategory = (order.category || "").toLowerCase().trim()
      .includes(filters.category.toLowerCase().trim());

    // Check both 'firmName' and 'firm' fields just in case
    const matchesFirm = (order.firmCode || "").toLowerCase().trim()
      .includes(filters.firm.toLowerCase().trim());

    const matchesBuyer = (order.instituteName || "").toLowerCase().trim()
      .includes(filters.buyerName.toLowerCase().trim());

    // 3. Date check
    const orderDateStr = order.orderDate || order.createdAt || "";
    const orderTime = orderDateStr ? new Date(orderDateStr).setHours(0, 0, 0, 0) : null;

    // Convert filter inputs to timestamps for comparison
    const start = filters.startDate ? new Date(filters.startDate).setHours(0, 0, 0, 0) : null;
    const end = filters.endDate ? new Date(filters.endDate).setHours(23, 59, 59, 999) : null;

    let matchesDate = true;
    if (orderTime) {
      if (start && end) {
        matchesDate = orderTime >= start && orderTime <= end;
      } else if (start) {
        matchesDate = orderTime >= start;
      } else if (end) {
        matchesDate = orderTime <= end;
      }
    } else if (start || end) {
      // If user is filtering by date but order has no date, hide it
      matchesDate = false;
    }

    return matchesTab && matchesItem && matchesCategory && matchesFirm && matchesBuyer && matchesDate;
  });
  const clearFilters = () => {
    setFilters({
      itemName: "",
      category: "",
      firm: "",
      buyerName: "",
      startDate: "",
      endDate: ""
    });
  };


  // 1. Move fetchOrders outside of useEffect so other functions can call it
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/seller-orders");
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Fetch Transporters
  useEffect(() => {
    const loadTransporters = async () => {
      try {
        const res = await fetch("/api/transporters");
        const data = await res.json();
        setTransporters(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load transporters", err);
      }
    };
    loadTransporters();
  }, []);
  // Add this to your existing useEffect that fetches orders
  const fetchStocks = async () => {
    const res = await fetch("/api/stock");
    const data = await res.json();
    setStocks(Array.isArray(data) ? data : []);
  };

  const grandTotal = orders.reduce((sum, order) => {
    // Use the total field from your DB or calculate: price * quantity
    return sum + (order.totalAmount || 0);
  }, 0);
  useEffect(() => {
    fetchOrders();
    fetchStocks(); // Load stocks so we can look up quantities
  }, []);

  const handlePaymentToggle = async (orderId: string, currentStatus: boolean) => {
    try {
      setOrders(prev => prev.map(o => o._id === orderId ? { ...o, isPaid: !currentStatus } : o));
      const res = await fetch(`/api/seller-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: !currentStatus }),
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch (err) {
      alert("Payment status failed to save. Reverting...");
      fetchOrders();
    }
  };


  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    const orderToUpdate = orders.find(o => o._id === orderId);
    if (!orderToUpdate) return;

    // --- NEW LOGIC FOR PARTIAL SHIPMENT CHECK ---
    if (newStatus === "READY TO SHIP" && activeTab === "TO CHECK") {
      try {
        // Fetch current stock for this item
        const stockRes = await fetch(`/api/stock?search=${orderToUpdate.itemName}`);
        const stocks = await stockRes.json();
        const currentStock = stocks.find((s: any) => s.itemName === orderToUpdate.itemName)?.quantity || 0;


        if (currentStock < orderToUpdate.reQty) {
          setSelectedOrderId(orderId);
          setAvailableStock(currentStock);
          setShipQty(currentStock); // Pre-fill with what we have
          setShowPartialShipModal(true);
          return; // Stop standard update and wait for modal
        }
      } catch (err) {
        console.error("Stock check failed", err);
      }
    }

    // Standard Logic remains below...
    if (newStatus === "DELIVERY") {
      setSelectedOrderId(orderId);
      setShowDeliveryModal(true);
      return;
    }
    if (newStatus === "RETURN ORDER") {
      setSelectedOrderId(orderId);
      setReturnQty(orderToUpdate.reQty);
      setShowReturnModal(true);
      return;
    }

    if (!window.confirm(`Change status to ${newStatus}?`)) return;

    try {
      const res = await fetch(`/api/seller-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          activeTab: activeTab,
          itemName: orderToUpdate.itemName,
          reQty: orderToUpdate.reQty,
        }),
      });

      if (res.ok) {
        fetchOrders();
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Something went wrong");
        fetchOrders();
      }
    } catch (err) {
      alert("Error updating status.");
      fetchOrders();
    }
  };
  // const submitPartialShipment = async () => {
  //   const orderToUpdate = orders.find(o => o._id === selectedOrderId);
  //   if (!orderToUpdate) return;

  //   if (shipQty <= 0) return alert("Shipping quantity must be greater than 0");
  //   if (shipQty >= orderToUpdate.reQty) return alert("For full quantity, use standard update");

  //   try {
  //     const res = await fetch(`/api/seller-orders/${selectedOrderId}`, {
  //       method: "PATCH",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({
  //         status: "READY TO SHIP",
  //         isPartialFulfillment: true,
  //         shipQty: shipQty,
  //         itemName: orderToUpdate.itemName
  //       }),
  //     });

  //     if (res.ok) {
  //       setShowPartialShipModal(false);
  //       setSelectedOrderId(null);
  //       fetchOrders();
  //       alert(`Split Successful: ${shipQty} moved to Ready to Ship. Remaining kept in To Check.`);
  //     }
  //   } catch (err) {
  //     alert("Error processing partial shipment");
  //   }
  // };

  const submitPartialShipment = async () => {
    if (shipQty <= 0) {
      setPartialError("Please add quantity to ship!");
      return;
    }
    setPartialError("");
    const orderToUpdate = orders.find(o => o._id === selectedOrderId);
    if (!orderToUpdate) return;

    const stockData = stocks.find(s => s._id === orderToUpdate.itemId);
    const avStock = stockData?.totalQty ?? 0;

    if (shipQty > orderToUpdate.reQty) return alert("Quantity exceeds order limit");

    const shipQtyNum = Number(shipQty);

    if (shipQtyNum > avStock) {
      alert(`Available quantity is low! You only have ${avStock} in stock.`);
      return; // Stop the execution here
    }
    const isFullQty = shipQtyNum === orderToUpdate.reQty;

    try {
      const res = await fetch(`/api/seller-orders/${selectedOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "READY TO SHIP",
          // Only trigger split logic if it's actually less than the total
          isPartialFulfillment: !isFullQty,
          shipQty: shipQtyNum,
          itemName: orderToUpdate.itemName,
          activeTab: "TO CHECK" // Explicitly pass the tab for stock logic
        }),
      });

      if (res.ok) {
        setShowPartialShipModal(false);
        setSelectedOrderId(null);
        fetchOrders();
      }
      else {
        const errorData = await res.json();
        alert(errorData.error || "Stock Check Failed"); // This will tell you EXACTLY why it's 400
      }
    } catch (err) {
      alert("Error processing shipment");
    }
  };

  const submitDelivery = async () => {
    if (!deliveryData.transportName) return alert("Please select a transporter");
    try {
      const res = await fetch(`/api/seller-orders/${selectedOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "DELIVERY",
          activeTab: "READY TO SHIP",
          transportName: deliveryData.transportName,
          transportRemark: deliveryData.transportRemark,
          deliveryDate: deliveryData.deliveryDate
        }),
      });

      if (res.ok) {
        setShowDeliveryModal(false);
        setDeliveryData({
          transportName: "", transportRemark: "",
          deliveryDate: new Date().toISOString().split('T')[0]
        });
        setSelectedOrderId(null);
        fetchOrders();
      }
    } catch (err) {
      alert("Error saving delivery details");
    }
  };

  const handleEditDelivery = (order: any) => {
    setSelectedOrderId(order._id);
    setDeliveryData({
      transportName: order.transportName || "",
      transportRemark: order.transportRemark || "",
      deliveryDate: order.deliveryDate || new Date().toISOString().split('T')[0]
    });
    setShowDeliveryModal(true);
  };

  const submitReturn = async () => {
    const orderToUpdate = orders.find(o => o._id === selectedOrderId);
    if (!orderToUpdate) return;

    // Safety check: Don't allow returning more than available
    if (returnQty > orderToUpdate.reQty) {
      return alert("Return quantity cannot exceed order quantity");
    }

    const isPartial = returnQty < orderToUpdate.reQty;

    try {
      const res = await fetch(`/api/seller-orders/${selectedOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "RETURN ORDER",
          activeTab: "READY TO SHIP", // Tab context for stock logic
          reQty: returnQty,
          isPartial: isPartial,
          itemName: orderToUpdate.itemName,
          moveToCheck: moveToCheck
        }),
      });

      if (res.ok) {
        setShowReturnModal(false);
        setSelectedOrderId(null);
        setMoveToCheck(false);
        fetchOrders();
        //alert(isPartial ? `Split Successful: ${returnQty} returned, ${orderToUpdate.reQty - returnQty} remains delivered.` : "Order fully returned.");

        const statusMessage = isPartial
          ? `Split Successful: ${returnQty} returned.`
          : "Order fully returned.";
        alert(moveToCheck ? `${statusMessage} New order created in TO CHECK.` : statusMessage);
      }
    } catch (err) {
      alert("Error processing return");
    }
  };

  const handleMarkAsReceived = async (order: any) => {
    if (!window.confirm(`Add ${order.reQty} units of ${order.itemName} back to stock?`)) return;

    try {
      const res = await fetch(`/api/seller-orders/${order._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "RETURN RECEIVED", // This status triggers the stock add
          activeTab: "RETURN ORDER",
          reQty: order.reQty,
          itemName: order.itemName
        }),
      });

      if (res.ok) {
        alert("Stock updated successfully!");
        fetchOrders(); // Refresh to show the updated status
      }
    } catch (error) {
      alert("System error");
    }
  };

  interface Seller {
    _id?: string;
    buyerName?: string;
    instituteName?: string;
    mobile?: string;
    address?: string;
    place?: string;
  }

  const downloadDeliveryChallan = (filteredOrders: any[], sellers: any[], companies: any[]) => {
    const doc = new jsPDF();
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yy = String(today.getFullYear()).slice(-2);
    const formattedDate = `${dd}-${mm}-${yy}`;

    // 1. Group by sellerId
    const groupedBySeller = filteredOrders.reduce((acc: any, order) => {
      const key = order.sellerId || "unknown";
      if (!acc[key]) acc[key] = [];
      acc[key].push(order);
      return acc;
    }, {});

    // Variable to store the name for the final filename
    let fileNameBase = "Challan";

    Object.keys(groupedBySeller).forEach((sellerId, index) => {
      if (index > 0) doc.addPage();

      const items = groupedBySeller[sellerId];
      // Fix: Cast the found seller to the Seller interface to remove red lines
      const sellerInfo = (sellers.find(s => s._id === sellerId) as Seller) || {};

      // Capture the name of the first seller for the filename
      if (index === 0) {
        fileNameBase = sellerInfo.instituteName || sellerInfo.buyerName || "Challan";
      }

      // --- Header ---
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.text("DELIVERY CHALLAN", 105, 20, { align: "center" });

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Date: ${formattedDate}`, 105, 26, { align: "center" });

      // --- Buyer Details ---
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text("To,", 14, 35);
      doc.setFont("helvetica", "bold");
      doc.text(`${sellerInfo.buyerName || items[0].buyerName || 'Valued Customer'}`, 14, 42);

      doc.setFont("helvetica", "normal");
      doc.text([
        `Institute: ${sellerInfo.instituteName || items[0].instituteName || 'N/A'}`,
        `Address: ${sellerInfo.address || '---'}`,
        `Place: ${sellerInfo.place || '---'}`,
        `Mobile: ${sellerInfo.mobile || '---'}`
      ], 14, 48);

      // --- Items Table ---
      autoTable(doc, {
        startY: 75,
        head: [['Sr.', 'Order No.', 'Item Name', 'Firm Name', 'Qty', 'Contract Info', 'Transport Details']],
        body: items.map((order: any, i: number) => {
          const company = companies.find(c => c.firmCode === order.firmCode);

          const orderDisplay = `${order.orderNo}\n${order.createdAt
            ? new Date(order.createdAt).toLocaleDateString('en-GB').replace(/\//g, '-')
            : "N/A"}`;

          const contractDisplay = order.contractNo && order.contractNo !== 'N/A'
            ? `${order.contractNo}\n(${order.contractDate || ''})`
            : '---';

          const transportDetails = order.transportName
            ? `${order.transportName}\nDate: ${order.deliveryDate || '---'}`
            : 'Direct Delivery';

          return [
            i + 1,
            orderDisplay,
            order.itemName,
            company?.firmName || order.firm || 'N/A',
            `${order.reQty} ${order.unit || ''}`,
            contractDisplay,
            transportDetails
          ];
        }),
        theme: 'grid',
        headStyles: { textColor: 20, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2, valign: 'middle' },
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === 5) {
            const order = items[data.row.index];
            if (order.contractUrl) {
              doc.setTextColor(0, 0, 255);
              doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: order.contractUrl });
            }
          }
        }
      });

      // --- Footer Section ---
      const finalY = (doc as any).lastAutoTable.finalY + 15;
      if (finalY > 240) doc.addPage();
      doc.line(140, finalY + 15, 190, finalY + 15);
      doc.setFont("helvetica", "bold");
      doc.text("Sign for Receiver", 165, finalY + 20, { align: "center" });
    });

    // Final Save Logic
    const safeName = fileNameBase.replace(/[^a-z0-9]/gi, '_');
    doc.save(`Challan_${safeName}_${formattedDate}.pdf`);
  };
  if (loading) return <div className="p-12 text-center font-black animate-pulse text-slate-400 uppercase">Loading Data...</div>;

  return (
    <div className="p-4 max-w-full mx-auto space-y-6">
      {/* Search and Header */}
      <div className="flex flex-col gap-6 mb-6">
        {/* Row 1: Title and Add Button */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800">Orders Management</h1>
            <p className="text-blue-600 text-[10px] font-black tracking-widest uppercase">Sales Control Panel</p>
          </div>
          <div>
            <button
              onClick={() => setIsRequestModalOpen(true)}
              className="bg-blue-600 mr-2 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-200"
            >Add Purchase Req</button>
            <button
              onClick={() => setShowOrderModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-200"
            >
              Add New Order
            </button>
          </div>
        </div>

        {/* Row 2: The New Filter Grid */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">Item Name</label>
            <input
              type="text" placeholder="Filter Item..."
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.itemName}
              onChange={(e) => setFilters({ ...filters, itemName: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">Category</label>
            <input
              type="text" placeholder="Filter Category..."
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">Firm</label>
            <input
              type="text" placeholder="Filter Firm..."
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.firm}
              onChange={(e) => setFilters({ ...filters, firm: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">Buyer Name</label>
            <input
              type="text" placeholder="Filter Buyer..."
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.buyerName}
              onChange={(e) => setFilters({ ...filters, buyerName: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">Order Date</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="From Date"
              />
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="To Date"
              />
            </div>

          </div>
          <button
            onClick={clearFilters}
            className="ml-auto flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-95"
          >
            <LuRotateCcw />
            <span className="text-[10px] font-black uppercase">Reset</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1 no-scrollbar border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 rounded-t-xl text-[12px] font-black tracking-wide transition-all whitespace-nowrap ${activeTab === tab ? "bg-slate-900 text-white shadow-md" : "bg-slate-50 text-slate-500 hover:bg-slate-200"}`}
          >
            {tab}
          </button>
        ))}
        {activeTab === "DELIVERY" && (
          <button
            onClick={() => downloadDeliveryChallan(filteredOrders, sellers as any[], companies as any[])}
            className="flex items-center px-4 justify-end py-2 bg-red-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-red-700 transition-all active:scale-95 mb-1"
          >
            <FiDownload className="text-xl" /> Download Challan
          </button>
        )}
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-full">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr className="divide-x divide-slate-200">
              {activeTab === "ALL" && <th className="px-2 py-3 text-[12px] font-bold uppercase text-slate-600 w-10 text-center">Paid</th>}
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Order No</th>
              {/* <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Date</th> */}
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Firm</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Buyer</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Cat.</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Item Details</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600">Contract</th>

              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-center">O-Qty</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-right">Rate</th>
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-right">Total</th>
              <th className="px-3 py-3 text-[11px] font-bold uppercase text-slate-600 text-left">Remark</th>
              {activeTab === "DELIVERY" && <th className="px-3 py-3 text-[12px] font-bold uppercase text-emerald-600">Delivery Info</th>}
              <th className="px-3 py-3 text-[12px] font-bold uppercase text-slate-600 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[11px]">
            {filteredOrders.map((order) => (
              <tr key={order._id} className="hover:bg-slate-50 transition-colors divide-x divide-slate-100">
                {activeTab === "ALL" && (
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer" checked={order.isPaid || false} onChange={() => handlePaymentToggle(order._id, order.isPaid)} />
                  </td>
                )}
                <td className="px-3 py-2 font-black text-blue-600 max-w-20">{order.orderNo}
                  <span className="text-[9px] font-bold text-slate-800 block">
                    {order.createdAt
                      ? new Date(order.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit'
                      }).replace(/\//g, '-')
                      : "N/A"}
                  </span>
                </td>

                <td className="px-3 py-2 max-w-28">
                  <div className="font-black text-slate-800 uppercase truncate leading-tight">{order.firmCode}</div>
                </td>
                <td className="px-3 py-2 max-w-28">
                  <div className="text-[9px] font-bold text-slate-800 uppercase truncate">{order.instituteName}</div>
                </td>
                <td className="px-3 py-2 font-black text-blue-800/60 uppercase">{order.category}</td>
                <td className="px-3 py-2 max-w-44">
                  <div className="font-bold text-slate-900 truncate">{order.itemName}</div>
                  <div className="text-[9px] text-slate-800">SKU: {order.sku},
                    <b className="text-green-500">Stock: </b>
                    <span className="font-bold text-slate-700">
                      {stocks.find(s => s._id === order.itemId)?.totalQty ?? 0}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className=" inline-block text-[10px] text-slate-600 font-bold">
                    {order.contractNo || "N/A"},
                    {order.contractUrl && <a href={order.contractUrl} target="_blank" className="text-blue-500 inline-block ml-1"><FiExternalLink size={11} /></a>}
                  </div>
                  <div className="text-[9px] text-slate-800">
                    {/* {order.contractDate || "N/A"} */}
                    {order.contractDate
                      ? new Date(order.contractDate).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit'
                      }).replace(/\//g, '-')
                      : "N/A"}
                  </div>
                </td>

                <td className="px-3 py-2 text-center leading-tight">
                  <div className="font-black text-[12px]">{order.reQty} <span className="lowercase">{order.unit}</span></div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">
                    <span className="text-orange-500">PR-{order.prQty}</span>
                    <span className="text-blue-600 ml-2">OP-{order.opQty}</span>
                  </div>
                </td>
                <td className="px-3 py-2 font-bold text-slate-500 text-right">₹{order.rate}</td>
                <td className="px-3 py-2 font-black text-slate-900 text-right">₹{order.totalAmount?.toLocaleString()}</td>
                <td className="px-3 py-2  text-[10px] text-gray-500 max-w-44">
                  {order.remark || "No Remark"}
                </td>
                {/* {activeTab === "DELIVERY" && (
                  <td className="px-3 py-2 min-w-[180px]">
                    <div className="flex flex-col gap-0.5">
                      <div className="font-black text-slate-800 uppercase flex items-center gap-1.5">
                        <FiTruck className="text-emerald-500" size={12} />
                        {order.transportName || "No Transport"}
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 italic truncate max-w-[200px]">
                        {order.transportRemark ? `Note: ${order.transportRemark}` : "No remark"}
                      </div>
                    </div>
                  </td>
                )} */}
                {activeTab === "DELIVERY" && (
                  <td className="px-3 py-2 min-w-[200px]">
                    <div className="flex items-center justify-between group">
                      <div className="flex flex-col gap-0.5">
                        <div className="font-black text-slate-800 uppercase flex items-center gap-1.5 text-[11px]">
                          <FiTruck className="text-emerald-500" size={12} />
                          {order.transportName || "No Transport"}
                        </div>
                        {/* Added Delivery Date Display */}
                        <div className="text-[9px] font-black text-emerald-600">{order.deliveryDate || "No Date"}</div>
                        <div className="text-[9px] font-bold text-slate-400 truncate max-w-[150px]">
                          {order.transportRemark ? `${order.transportRemark}` : "No remark"}
                        </div>
                      </div>

                      {/* Edit Button - Visible on Hover */}
                      <button
                        onClick={() => handleEditDelivery(order)}
                        className="p-2 bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-400 rounded-lg transition-all ml-2"
                        title="Edit Delivery Details"
                      >
                        <FiEdit size={14} />
                      </button>
                    </div>
                  </td>
                )}

                {/* {activeTab === "CANCELL ORDER" && (
                  <td className="px-3 py-2">
                    <button
                      onClick={() => handleRestoreOrder(order)}
                      className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 text-amber-600 rounded-xl font-black text-[10px] uppercase hover:bg-amber-500 hover:text-white transition-all"
                    >
                      <FiRefreshCcw size={14} />
                      Move to To Check
                    </button>
                  </td>
                )} */}
                <td className="px-3 py-2 text-center">
                  {["TO CHECK", "READY TO SHIP", "DELIVERY", "CANCELL ORDER", "HISAB"].includes(activeTab) ? (
                    <select
                      className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border cursor-pointer outline-none ${getStatusColor(order.status)}`}
                      value={order.status}
                      onChange={(e) => handleStatusUpdate(order._id, e.target.value)}
                    >
                      {activeTab === "TO CHECK" && (
                        <>
                          <option value="TO CHECK">TO CHECK</option>
                          <option value="HISAB">HISAB</option>
                          <option value="READY TO SHIP">READY TO SHIP</option>
                          <option value="CANCELL ORDER">CANCELL</option>
                        </>
                      )}
                      {activeTab === "READY TO SHIP" && (
                        <>
                          <option value="READY TO SHIP">READY TO SHIP</option>
                          <option value="DELIVERY">DELIVERY</option>
                          <option value="HISAB">HISAB</option>
                          <option value="CANCELL ORDER">CANCEL</option>
                        </>
                      )}
                      {activeTab === "DELIVERY" && (
                        <>
                          <option value="DELIVERY">DELIVERY</option>
                          <option value="RETURN ORDER">RETURN ORDER</option>
                        </>
                      )}
                      {activeTab === "CANCELL ORDER" && (
                        <>
                          <option value="CANCELL ORDER">CANCELL</option>
                          <option value="TO CHECK">TO CHECK</option>
                        </>
                      )}
                      {activeTab === "HISAB" && (
                        <>
                          <option value="HISAB">HISAB</option>
                          <option value="TO CHECK">TO CHECK</option>
                        </>
                      )}
                    </select>
                  ) : (
                    activeTab !== "RETURN ORDER" && (
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${getStatusColor(order.status)}`}>
                        {order.status || "PENDING"}
                      </span>
                    )
                  )}
                  {activeTab === "TO CHECK" && (
                    <button onClick={() => { setEditingOrder(order); setShowOrderModal(true); }} className="hover:underline hover:text-blue-800 float-right text-xs transition-all text-red-600">
                      <FiEdit />
                    </button>
                  )}
                  {activeTab === "RETURN ORDER" && (
                    <button
                      onClick={() => handleMarkAsReceived(order)}
                      // Check if status is already RECEIVED to disable the button
                      disabled={order.status === "RETURN RECEIVED"}
                      className={`flex items-center gap-2 p-2 rounded-xl transition-all font-black text-[10px] uppercase ${order.status === "RETURN RECEIVED"
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed" // Disabled Style
                        : "bg-green-50 text-green-600 hover:bg-green-600 hover:text-white" // Active Style
                        }`}
                    >
                      {order.status === "RETURN RECEIVED" ? (
                        <>
                          <FiCheckCircle size={16} />
                          Stock Added
                        </>
                      ) : (
                        <>
                          <FiCheckCircle size={16} />
                          Received Stock
                        </>
                      )}
                    </button>
                  )}

                </td>
              </tr>
            ))}

          </tbody>
        </table>
        {filteredOrders.length > 0 && (
          <div className="sticky bottom-0 w-full bg-slate-900 p-5 mt-4 border-t-2 border-blue-500 flex items-center justify-end shadow-[0_-10px_20px_rgba(0,0,0,0.1)] z-10">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">
                Grand Total
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded">
                  {filteredOrders.length} ORDERS
                </span>
                <span className="text-2xl font-black text-white tabular-nums">
                  ₹ {filteredOrders
                    .reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0)
                    .toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {showOrderModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <SellerOrderForm
            isModal={true}
            onClose={() => {
              setShowOrderModal(false);
              setEditingOrder(null); // Clear data after closing
              fetchOrders();
            }}
            //onSuccess={() => fetchOrders()}
            initialData={editingOrder} // Pass the order to the form
          />
        </div>
      )}

      {/* --- MODALS --- */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border border-slate-100">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-emerald-500 text-white rounded-2xl">
                <FiTruck size={24} />
              </div>
              <h2 className="text-xl font-black uppercase tracking-tight">Delivery Details</h2>
            </div>
            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Select Transport</label>
                <select
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                  value={deliveryData.transportName}
                  onChange={(e) => setDeliveryData({ ...deliveryData, transportName: e.target.value })}
                >
                  <option value="">Choose Transporter...</option>
                  {transporters.map(t => <option key={t._id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Delivery Date</label>
                <input
                  type="date"
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                  value={deliveryData.deliveryDate}
                  onChange={(e) => setDeliveryData({ ...deliveryData, deliveryDate: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Remark</label>
                <textarea
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none min-h-[100px] resize-none"
                  placeholder="LR No, Vehicle No, etc."
                  value={deliveryData.transportRemark}
                  onChange={(e) => setDeliveryData({ ...deliveryData, transportRemark: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowDeliveryModal(false)} className="flex-1 p-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px]">Cancel</button>
                <button onClick={submitDelivery} className="flex-1 p-4 bg-emerald-500 text-white rounded-2xl font-black uppercase text-[10px]">Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl border border-rose-100">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-rose-500 text-white rounded-2xl"><FiRotateCcw size={24} /></div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-slate-800">Return Order</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Stock Restoration</p>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl mb-6 flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase">Current Order Qty</span>
              <span className="font-black text-slate-800 text-lg">
                {orders.find(o => o._id === selectedOrderId)?.reQty}
              </span>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Qty to Return</label>
                <input
                  type="number"
                  className="w-full p-4 bg-slate-100 border-none rounded-2xl font-black text-xl text-center outline-none focus:ring-2 focus:ring-rose-500"
                  value={returnQty}
                  onChange={(e) => setReturnQty(Number(e.target.value))}
                />
              </div>

              {/* NEW: Move to To Check Checkbox */}
              <div
                className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl cursor-pointer hover:bg-slate-100 transition-all"
                onClick={() => setMoveToCheck(!moveToCheck)}
              >
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-rose-500 rounded-lg cursor-pointer"
                  checked={moveToCheck}
                  onChange={() => setMoveToCheck(!moveToCheck)}
                />
                <div>
                  <p className="text-[11px] font-black text-slate-700 uppercase">Move to "To Check" Tabs?</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Creates a new order for checking</p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowReturnModal(false)} className="flex-1 p-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px]">Cancel</button>
                <button onClick={submitReturn} className="flex-1 p-4 bg-rose-500 text-white rounded-2xl font-black uppercase text-[10px]">Confirm Return</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* --- PARTIAL SHIPMENT MODAL --- */}
      {showPartialShipModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl border border-blue-100">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-blue-600 text-white rounded-2xl"><FiTruck size={24} /></div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-slate-800">Partial Ship</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Insufficient Stock Split</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-slate-50 p-3 rounded-2xl">
                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Order Qty</p>
                <p className="font-black text-slate-800 text-lg">{orders.find(o => o._id === selectedOrderId)?.reQty}</p>
              </div>
              <div className="bg-blue-50 p-3 rounded-2xl">
                <p className="text-[9px] font-black text-blue-400 uppercase mb-1">In Stock</p>
                <p className="font-black text-blue-800 text-lg">
                  {(() => {
                    // 1. Find the order object using the ID you stored when clicking "Ship"
                    const currentOrder = orders.find(o => o._id === selectedOrderId);

                    // 2. Use the EXACT logic from your <td>
                    if (currentOrder) {
                      return stocks.find(s => s._id === currentOrder.itemId)?.totalQty ?? 0;
                    }

                    return 0;
                  })()}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Qty to Ship Now</label>
                <input
                  type="number"
                  className="w-full p-4 bg-slate-100 border-none rounded-2xl font-black text-xl text-center outline-none focus:ring-2 focus:ring-blue-500"
                  value={shipQty}
                  onChange={(e) => setShipQty(Number(e.target.value))}
                />
                <p className="text-[9px] text-left text-slate-400 mt-2 font-bold uppercase">
                  The remaining will stay in "TO CHECK"
                </p>
                {partialError ? (
                  <p className="text-[10px] text-center text-red-500 mt-2 font-black uppercase italic animate-pulse">
                    {partialError}
                  </p>
                ) : (
                  <p></p>
                )}

              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowPartialShipModal(false)} className="flex-1 p-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px]">Cancel</button>
                <button onClick={submitPartialShipment} className="flex-1 p-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-[10px]">Ship Partial</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <PurchaseRequestModal
        isOpen={isRequestModalOpen}
        stockData={sortedStock} // <--- Add this
        onClose={() => {
          setIsRequestModalOpen(false);
          fetchTabData(); // or fetchRequests() depending on your function name
        }}
      />
    </div>

  );
}

function getStatusColor(status: string) {
  switch (status) {
    case "DELIVERY": return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "CANCELL ORDER": return "bg-rose-50 text-rose-700 border-rose-100";
    case "READY TO SHIP": return "bg-blue-50 text-blue-700 border-blue-100";
    case "TO CHECK": return "bg-amber-50 text-amber-700 border-amber-100";
    case "RETURN ORDER": return "bg-purple-50 text-purple-700 border-purple-100";
    default: return "bg-slate-50 text-slate-600 border-slate-100";
  }
}