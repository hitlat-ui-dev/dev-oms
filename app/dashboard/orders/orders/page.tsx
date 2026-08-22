"use client";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";
import SellerOrderForm from "@/components/SellerOrderForm";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiExternalLink, FiTruck, FiRotateCcw, FiEdit, FiRefreshCcw, FiCheckCircle, FiPlus, FiDownload, FiTrash2, FiX, FiArrowLeft } from "react-icons/fi";
import { LuRotateCcw, LuRefreshCw } from "react-icons/lu";
// jspdf, jspdf-autotable and xlsx are all heavy (500KB+) and only ever needed
// when the user actually clicks an Export/Download button - dynamically
// imported inside those handlers below instead of bundled into every load
// of this page.

const TABS = [
  "ALL", "TO CHECK", "READY TO SHIP", "DELIVERY", "CANCELL ORDER", "RETURN ORDER", "RETURN RECEIVED", "FULFILLED", "HISAB"
];

// Module level cache for static directories so navigation stays instant
let sellersCache: any[] | null = null;
let companiesCache: any[] | null = null;
let transportersCache: any[] | null = null;

export default function OrdersListPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [displayLimit, setDisplayLimit] = useState(50);
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
  const [partialDeliveryState, setPartialDeliveryState] = useState<{
    selectedOrderId: string;
    shipQty: number;
    isPartialFulfillment: boolean;
  } | null>(null);
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [isBulkDelivery, setIsBulkDelivery] = useState(false);

  const [isShipping, setIsShipping] = useState(false);
  const [reloading, setReloading] = useState(false);

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
    fetchOrders();
  }, []);

  const sortedStock = useMemo(() => {
    if (!stock || !Array.isArray(stock)) return [];
    return [...stock].sort((a, b) => {
      // Use fallback date string for items missing the lastUpdated field
      const dateA = new Date(a.lastUpdated || '1970-01-01').getTime();
      const dateB = new Date(b.lastUpdated || '1970-01-01').getTime();
      return dateB - dateA; // Descending order
    });
  }, [stock]);

  // Filters + sorts the whole orders array (up to 2,500 with "Load All") - memoized
  // so it only re-runs when orders/filters/tab actually change, not on every render
  // this large component does (opening a modal, toggling a row, etc. all re-render it).
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
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
    })
      .sort((a, b) => {
        // Check if your key name is 'orderNumber' or 'orderNo' based on your schema
        const numA = parseInt(a.orderNumber || a.orderNo || 0, 10) || 0;
        const numB = parseInt(b.orderNumber || b.orderNo || 0, 10) || 0;

        return numB - numA; // High numbers first (e.g. 098, 097...)
      });
  }, [orders, activeTab, filters]);

  // Reset display limit when filters or tab change
  useEffect(() => {
    setDisplayLimit(50);
  }, [filters, activeTab]);

  const visibleOrders = useMemo(() => {
    return filteredOrders.slice(0, displayLimit);
  }, [filteredOrders, displayLimit]);

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

  const [ordersLoadedAll, setOrdersLoadedAll] = useState(false);
  const [loadingAllOrders, setLoadingAllOrders] = useState(false);

  const fetchOrders = useCallback(async (all: boolean = false) => {
    try {
      setReloading(true);
      if (all) setLoadingAllOrders(true);
      const timestamp = Date.now();
      const ordersUrl = all ? `/api/seller-orders?all=1&t=${timestamp}` : `/api/seller-orders?t=${timestamp}`;

      // Fast path: reuse cached static directories if already loaded in component session
      if (sellersCache) setSellers(sellersCache);
      if (companiesCache) setCompanies(companiesCache);
      if (transportersCache) setTransporters(transportersCache);

      const [ordersRes, sellerRes, companyRes, transporterRes] = await Promise.all([
        fetch(ordersUrl).catch(() => null),
        !sellersCache ? fetch(`/api/sellers?t=${timestamp}`).catch(() => null) : Promise.resolve(null),
        !companiesCache ? fetch(`/api/companies?t=${timestamp}`).catch(() => null) : Promise.resolve(null),
        !transportersCache ? fetch(`/api/transporters`).catch(() => null) : Promise.resolve(null),
      ]);

      if (ordersRes && ordersRes.ok) {
        const data = await ordersRes.json();
        setOrders(Array.isArray(data) ? data : []);
        setOrdersLoadedAll(all);
      }
      if (sellerRes && sellerRes.ok) {
        const sellerData = await sellerRes.json();
        const arr = Array.isArray(sellerData) ? sellerData : [];
        sellersCache = arr;
        setSellers(arr);
      }
      if (companyRes && companyRes.ok) {
        const companyData = await companyRes.json();
        const arr = Array.isArray(companyData) ? companyData : [];
        companiesCache = arr;
        setCompanies(arr);
      }
      if (transporterRes && transporterRes.ok) {
        const transporterData = await transporterRes.json();
        const arr = Array.isArray(transporterData) ? transporterData : [];
        transportersCache = arr;
        setTransporters(arr);
      }
    } catch (err) {
      console.error("Fetch error", err);
    } finally {
      setLoading(false);
      setReloading(false);
      setLoadingAllOrders(false);
    }
  }, []);

  const fetchTabData = useCallback(async () => {
    await fetchOrders(ordersLoadedAll);
  }, [fetchOrders, ordersLoadedAll]);

  const handleRefreshAll = useCallback(async () => {
    await fetchOrders(ordersLoadedAll);
  }, [fetchOrders, ordersLoadedAll]);

  // Background refresh every 15 minutes so orders/status changes made by
  // someone else show up without a manual reload. fetchOrders already only
  // toggles the small `reloading` spinner (not the full-page `loading`
  // state) past the first load, so this doesn't flash the page.
  useEffect(() => {
    const interval = setInterval(() => fetchOrders(ordersLoadedAll), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchOrders, ordersLoadedAll]);

  useEffect(() => {
    setSelectedOrderIds([]);
  }, [activeTab]);

  // Same Ctrl/Cmd+K quick-add shortcut as the Dashboard's "New Order" tile -
  // works here too so it doesn't only exist one click away.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowOrderModal(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const grandTotal = orders.reduce((sum, order) => {
    // Use the total field from your DB or calculate: price * quantity
    return sum + (order.totalAmount || 0);
  }, 0);
  // Note: orders and stock are already loaded on mount by the fetchOrders
  // effect above and fetchTabData's own effect respectively — an extra
  // duplicate fetch of both used to happen here on every page load.

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
    //console.log(orderToUpdate.instituteName);

    // Ready-to-ship always goes through the Partial Ship modal so the user
    // picks/confirms the exact ship qty themselves - never silently falls
    // through to the generic window.confirm below, regardless of stock level.
    if (newStatus === "READY TO SHIP" && activeTab === "TO CHECK") {
      const currentStock = orderToUpdate.stockQty ?? 0;
      setSelectedOrderId(orderId);
      setAvailableStock(currentStock);
      setShipQty(Math.min(currentStock, orderToUpdate.reQty)); // Pre-fill with what we have
      setShowPartialShipModal(true);
      return; // Stop standard update and wait for modal
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
    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    const Login_user = userData?.username || "Unknown User";


    try {
      const res = await fetch(`/api/seller-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          activeTab: activeTab,
          itemName: orderToUpdate.itemName,
          reQty: orderToUpdate.reQty,
          userName: Login_user,
          sellerName: orderToUpdate.instituteName,
        }),
      });


      if (res.ok) {
        // Patch just this row locally instead of re-fetching the whole
        // ~250-order list + sellers/companies/transporters from scratch -
        // that full re-fetch on every status click was what looked like the
        // whole page reloading.
        setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: newStatus } : o));
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
const shippingLock = useRef(false);
  const submitPartialShipment = async () => {
    if (!selectedOrderId || isShipping || shippingLock.current) return;
    shippingLock.current = true;
    setIsShipping(true);

    if (shipQty <= 0) {
      setPartialError("Please add quantity to ship!");
      setIsShipping(false);
      shippingLock.current = false;
      return;
    }
    setPartialError("");
    const orderToUpdate = orders.find(o => o._id === selectedOrderId);
    if (!orderToUpdate) {
      setIsShipping(false);
      shippingLock.current = false;
      return;
    }

    const avStock = orderToUpdate.stockQty ?? 0;

    if (shipQty > orderToUpdate.reQty) {
      alert("Quantity exceeds order limit");
      setIsShipping(false);
      shippingLock.current = false;
      return;
    }

    const shipQtyNum = Number(shipQty);

    if (shipQtyNum > avStock) {
      alert(`Available quantity is low! You only have ${avStock} in stock.`);
      setIsShipping(false);
      shippingLock.current = false;
      return; // Stop the execution here
    }
    const isFullQty = shipQtyNum === orderToUpdate.reQty;

    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    const Login_user = userData?.username || "Unknown User";

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
          activeTab: "TO CHECK", // Explicitly pass the tab for stock logic
          userName: Login_user,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setShowPartialShipModal(false);
        setSelectedOrderId(null);

        if (result?.newShippedOrder?._id) {
          // Partial ship: the original order's reQty shrank to the leftover
          // amount, and a new "-P1"/"-P2" READY TO SHIP order was created
          // for the shipped qty (see LOGIC C in the PATCH route) - patch
          // both locally instead of refetching the whole list.
          const updatedOriginal = result.updatedOriginal;
          setOrders(prev => {
            const withOriginalPatched = updatedOriginal
              ? prev.map(o => (o._id === updatedOriginal._id ? { ...o, ...updatedOriginal } : o))
              : prev;
            return [{ prQty: 0, opQty: 0, stockQty: 0, ...result.newShippedOrder }, ...withOriginalPatched];
          });
        } else if (result?._id) {
          // Full ship: same order flips straight to READY TO SHIP, no split.
          setOrders(prev => prev.map(o => (o._id === result._id ? { ...o, ...result } : o)));
        } else {
          fetchOrders(); // unexpected response shape - fall back to a full refresh
        }
      }
      else {
        const errorData = await res.json();
        alert(errorData.error || "Stock Check Failed"); // This will tell you EXACTLY why it's 400
        setIsShipping(false);
        shippingLock.current = false;
      }
    } catch (err) {
      alert("Error processing shipment");
      setIsShipping(false);
      shippingLock.current = false;
    }
    finally {
      setIsShipping(false);
      if (selectedOrderId) {
        shippingLock.current = false;
      }
    }
  };

  const handleDeleteOrder = async (orderId: string, orderNo: string) => {
    if (!window.confirm(`Are you sure you want to DELETE order ${orderNo}?\nThis will remove the order and restore the stock reQty.`)) return;

    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    const userName = userData?.username || "Unknown User";

    try {
      const res = await fetch(`/api/seller-orders/${orderId}?userName=${encodeURIComponent(userName)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const result = await res.json();
        alert(result.message || "Order deleted successfully.");
        setOrders(prev => prev.filter(o => o._id !== orderId));
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Failed to delete order.");
      }
    } catch (err) {
      alert("Error deleting order.");
    }
  };

  const handleDirectDeliverClick = () => {
    if (!selectedOrderId) return;
    const orderToUpdate = orders.find(o => o._id === selectedOrderId);
    if (!orderToUpdate) return;

    if (shipQty <= 0) {
      setPartialError("Please add quantity to ship!");
      return;
    }

    const avStock = orderToUpdate.stockQty ?? 0;

    if (shipQty > orderToUpdate.reQty) {
      alert("Quantity exceeds order limit");
      return;
    }

    const shipQtyNum = Number(shipQty);

    if (shipQtyNum > avStock) {
      alert(`Available quantity is low! You only have ${avStock} in stock.`);
      return;
    }

    const isFullQty = shipQtyNum === orderToUpdate.reQty;

    setPartialDeliveryState({
      selectedOrderId,
      shipQty: shipQtyNum,
      isPartialFulfillment: !isFullQty
    });

    setShowPartialShipModal(false);
    setShowDeliveryModal(true);
  };

  const submitDelivery = async () => {
    if (!deliveryData.transportName) return alert("Please select a transporter");
    setIsSubmitting(true);
    try {
      if (isBulkDelivery) {
        const promises = selectedOrderIds.map(orderId => {
          return fetch(`/api/seller-orders/${orderId}`, {
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
        });

        const results = await Promise.all(promises);
        const failed = results.filter(r => !r.ok);
        if (failed.length > 0) {
          alert(`Bulk delivery completed: ${results.length - failed.length} succeeded, ${failed.length} failed.`);
        } else {
          alert("All selected orders marked as delivered successfully!");
        }

        setShowDeliveryModal(false);
        setDeliveryData({
          transportName: "", transportRemark: "",
          deliveryDate: new Date().toISOString().split('T')[0]
        });
        setSelectedOrderIds([]);
        setIsBulkDelivery(false);
        fetchOrders();
      } else if (partialDeliveryState) {
        const res = await fetch(`/api/seller-orders/${partialDeliveryState.selectedOrderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "DELIVERY",
            isPartialFulfillment: partialDeliveryState.isPartialFulfillment,
            shipQty: partialDeliveryState.shipQty,
            itemName: orders.find(o => o._id === partialDeliveryState.selectedOrderId)?.itemName,
            activeTab: "TO CHECK",
            userName: JSON.parse(localStorage.getItem("oms_user") || "{}")?.username || "Unknown User",
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
          setPartialDeliveryState(null);
          setSelectedOrderId(null);
          fetchOrders();
        } else {
          const errorData = await res.json();
          alert(errorData.error || "Split delivery failed");
        }
      } else {
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
      }
    } catch (err) {
      alert("Error saving delivery details");
    } finally {
      setIsSubmitting(false);
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
    if (isSubmitting) return;
    const orderToUpdate = orders.find(o => o._id === selectedOrderId);
    if (!orderToUpdate) return;

    // Safety check: Don't allow returning more than available
    if (returnQty > orderToUpdate.reQty) {
      return alert("Return quantity cannot exceed order quantity");
    }

    const isPartial = returnQty < orderToUpdate.reQty;
    setIsSubmitting(true);
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

        const statusMessage = isPartial
          ? `Split Successful: ${returnQty} returned.`
          : "Order fully returned.";
        alert(moveToCheck ? `${statusMessage} New order created in TO CHECK.` : statusMessage);
      }
    } catch (err) {
      alert("Error processing return");
    }
    finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkAsReceived = async (order: any) => {
    if (!window.confirm(`Add ${order.reQty} units of ${order.itemName} back to stock?`)) return;

    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    const Login_user = userData?.username || "Unknown User";

    try {
      const res = await fetch(`/api/seller-orders/${order._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "RETURN RECEIVED", // This status triggers the stock add
          activeTab: "RETURN ORDER",
          reQty: order.reQty,
          itemName: order.itemName,
          userName: Login_user,
          sellerName: order.instituteName
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

  // Draws one buyer's challan (header, items table, transporter contact,
  // footer/terms) onto a given jsPDF doc at its current page. autoTable is
  // passed in rather than imported here since it's loaded on demand by the
  // caller (downloadDeliveryChallan) to keep it out of the page's main bundle.
  const drawChallanPage = (doc: any, autoTable: any, sellerInfo: any, items: any[], companies: any[], formattedDate: string, transporters: any[]) => {
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("DELIVERY CHALLAN", 105, 20, { align: "center" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${formattedDate}`, 105, 26, { align: "center" });

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text("To,", 14, 35);
    doc.setFont("helvetica", "bold");

    const displayName = sellerInfo.buyerName || items[0]?.buyerName || 'Valued Customer';
    doc.text(`${displayName}`, 14, 42);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text([
      `Institute: ${sellerInfo.instituteName || items[0]?.instituteName || 'N/A'}`,
      `Address: ${sellerInfo.address || '---'}`,
      `Place: ${sellerInfo.place || '---'}`,
      `Mobile: ${sellerInfo.mobile || '---'}`
    ], 14, 48);

    autoTable(doc, {
      startY: 75,
      head: [['Sr.', 'Order No.', 'Item Name', 'Firm Name', 'Qty', 'Contract Info', 'Transport Details']],
      body: items.map((order: any, i: number) => {
        const company = companies.find(c => c.firmCode === order.firmCode);

        const orderDisplay = `${order.orderNo || 'N/A'}\n${order.createdAt
          ? new Date(order.createdAt).toLocaleDateString('en-GB').replace(/\//g, '-')
          : "N/A"}`;

        const contractDisplay = order.contractNo && order.contractNo !== 'N/A'
          ? `${order.contractNo}\n(${order.contractDate || ''})`
          : '---';

        const transportDetails = order.transportName
          ? `${order.transportName}\nDate: ${order.deliveryDate || '---'}\nRemark: ${order.transportRemark || ''}`
          : 'Direct Delivery';

        return [
          i + 1,
          orderDisplay,
          order.itemName || 'N/A',
          company?.firmName || order.firm || 'N/A',
          `${order.reQty || 0} ${order.unit || ''}`,
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
          if (order?.contractUrl) {
            doc.setTextColor(0, 0, 255);
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: order.contractUrl });
          }
        }
      }
    });

    const tableBottomY = (doc as any).lastAutoTable.finalY || 75;

    const checkPageSpace = (currentY: number, requiredSpace: number) => {
      if (currentY + requiredSpace > 270) {
        doc.addPage();
        return 20;
      }
      return currentY;
    };

    // Transporter used for this delivery (order.transportName), with its
    // phone number(s) looked up from the Transporter directory.
    let afterTableY = checkPageSpace(tableBottomY + 10, 20);
    const transportName = items.find((o: any) => o.transportName)?.transportName;
    if (transportName) {
      const transporterDoc = transporters.find((t: any) => t.name === transportName);
      const contactLines = (transporterDoc?.contacts || [])
        .filter((c: any) => c.mobile)
        .map((c: any) => (c.person ? `${c.person}: ${c.mobile}` : c.mobile));

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`Transporter: ${transportName}`, 14, afterTableY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Contact: ${contactLines.length > 0 ? contactLines.join(",  ") : "N/A"}`, 14, afterTableY + 5);
      afterTableY += 12;
    }

    let footerY = checkPageSpace(afterTableY + 3, 25);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.line(140, footerY + 15, 190, footerY + 15);
    doc.text("Sign for Receiver", 165, footerY + 20, { align: "center" });

    footerY = checkPageSpace(footerY + 30, 40);

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Terms & Conditions:", 14, footerY);

    doc.setFont("helvetica", "normal");
    const terms = [
      "1. The goods must be checked compulsorily within 2 days of receipt. Any defect or complaint must be reported within this period.",
      "2. Damage or defects must be reported immediately.",
      "3. Communication for replacement must be immediate.",
      "4. Dispatch Dept Contact: +91 8200093336"
    ];

    doc.text(terms, 14, footerY + 5, { maxWidth: 180 });
  };

  const downloadDeliveryChallan = async (filteredOrders: any[], sellers: any[], companies: any[], selectedOrderIds: string[] = []) => {
    // if (!filteredOrders || filteredOrders.length === 0) {
    //   alert("No orders selected to download.");
    //   return;
    // }

    const activeOrders = selectedOrderIds.length > 0
      ? filteredOrders.filter(order => selectedOrderIds.includes(order._id))
      : filteredOrders;

    if (!activeOrders || activeOrders.length === 0) {
      alert("No orders selected to download.");
      return;
    }

    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);

    const doc = new jsPDF();
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yy = String(today.getFullYear()).slice(-2);
    const formattedDate = `${dd}-${mm}-${yy}`;

    const groupedBySeller = activeOrders.reduce((acc: any, order) => {
      const key = order.sellerId || "unknown_seller";
      if (!acc[key]) acc[key] = [];
      acc[key].push(order);
      return acc;
    }, {});

    let fileNameBase = "Delivery_Challan";

    Object.keys(groupedBySeller).forEach((sellerId, index) => {
      const items = groupedBySeller[sellerId];

      if (!items || items.length === 0) return;

      if (index > 0) doc.addPage();

      const sellerInfo = sellers.find(s => s._id === sellerId) || {};

      if (index === 0) {
        fileNameBase = sellerInfo.instituteName || sellerInfo.buyerName || items[0].buyerName || "Challan";
      }

      drawChallanPage(doc, autoTable, sellerInfo, items, companies, formattedDate, transporters);
    });

    const safeName = fileNameBase.replace(/[^a-z0-9]/gi, '_');
    doc.save(`Challan_${safeName}_${formattedDate}.pdf`);
  };

  const handleExportSellingReport = async () => {
    const reportData = filteredOrders.map((order) => {
      return {
        "Order No": order.orderNo,
        "Order Date": order.createdAt
          ? new Date(order.createdAt).toLocaleDateString('en-GB', {
            day: '2-digit', month: '2-digit', year: 'numeric'
          }).replace(/\//g, '-')
          : "N/A",
        "Firm Name": order.firmCode || "N/A",
        "Buyer Name": order.instituteName || "N/A",
        "Category": order.category || "N/A",
        "Item Name": order.itemName || "N/A",
        "SKU": order.sku || "N/A",
        "Order Qty": order.reQty || 0,
        "Unit": order.unit || "",
        "Rate": order.rate || 0,
        "Total Amount": order.totalAmount || 0,
        "Payment Status": order.isPaid ? "PAID" : "UNPAID",
        "Order Status": order.status || "PENDING",
        "Remark": order.remark || ""
      };
    });

    if (reportData.length === 0) {
      alert("No data available to export with current filters.");
      return;
    }

    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Selling Report");

    const fileName = `Selling_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  if (loading) return <div className="p-12 text-center font-black animate-pulse text-slate-400 uppercase">Loading Data...</div>;

  return (
    <BlockGuard
      permission="addOrder"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 max-w-full mx-auto space-y-6">
      {/* Search and Header */}
      <div className="flex flex-col gap-6 mb-6">
        {/* Row 1: Title and Add Button */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              title="Go Back"
              className="p-3 text-slate-500 hover:text-blue-600 transition-all bg-slate-100 hover:bg-blue-50 rounded-xl border border-slate-200 shadow-sm active:scale-95 flex items-center justify-center"
            >
              <FiArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800">Orders Management</h1>
              <p className="text-blue-600 text-[10px] font-black tracking-widest uppercase">Sales Control Panel</p>
            </div>
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

        {!ordersLoadedAll && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[11px] text-amber-800 font-bold">
            <span>Showing orders from the last 45 days ({orders.length} orders loaded). Search/filters look within these — older history needs Load All.</span>
            <button
              onClick={() => fetchOrders(true)}
              disabled={loadingAllOrders}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-black uppercase tracking-widest text-[10px] px-4 py-2 rounded-lg transition-all shrink-0"
            >
              {loadingAllOrders ? "Loading..." : "Load All Orders"}
            </button>
          </div>
        )}

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
          {/* Secured horizontal row container without forcing structural off-screen floating */}
          {/* This wrapper ensures the buttons stay grouped together and aligns them to the far right */}
          <div className="w-full flex flex-row items-center justify-end gap-2 mt-2 md:mt-0">
            
            <div className="flex flex-row items-center gap-2 border border-slate-100 bg-slate-50/50 p-1 rounded-xl">
              {/* Reset Filter Button */}
              <button
                onClick={clearFilters}
                type="button"
                className="flex items-center justify-center px-4 py-2 text-xs font-black uppercase tracking-wider text-red-600 bg-white hover:bg-red-50 border border-red-100 rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm"
              >
                Reset
              </button>

              {/* Live Data Reload Button */}
              <button
                type="button"
                disabled={reloading}
                onClick={handleRefreshAll}
                className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider text-blue-600 bg-white hover:bg-blue-50 border border-blue-100 disabled:opacity-40 rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm"
                title="Refresh Live Orders"
              >
                <LuRefreshCw className={`w-3.5 h-3.5 ${reloading ? "animate-spin text-blue-500" : "text-blue-600"}`} />
                
              </button>
            </div>

          </div>
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
        <div className="flex-1" />
        {activeTab === "ALL" && (
          <button
            onClick={handleExportSellingReport}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-sm font-black text-[10px] uppercase tracking-widest hover:bg-green-700 transition-all active:scale-95"
          >
            <FiDownload className="mr-2 text-sm" /> Selling Report
          </button>
        )}
        {activeTab === "DELIVERY" && (
          // <button
          //   onClick={() => downloadDeliveryChallan(filteredOrders, sellers as any[], companies as any[])}
          //   className="flex items-center px-4 justify-end py-2 bg-red-600 text-white rounded-sm font-black text-[10px] uppercase tracking-widest hover:bg-red-700 transition-all active:scale-95 mb-1"
          // >
          //   <FiDownload className="text-xl" /> Download Challan
          // </button>
          <button
            onClick={() => downloadDeliveryChallan(filteredOrders, sellers as any[], companies as any[], selectedOrderIds)}
            className="flex items-center px-4 justify-end py-2 bg-red-600 text-white rounded-sm font-black text-[10px] uppercase tracking-widest hover:bg-red-700 transition-all active:scale-95 mb-1"
          >
            <FiDownload className="text-xl mr-1" />
            {selectedOrderIds.length > 0
              ? `Download Checked (${selectedOrderIds.length}) Items`
              : `Download All (${filteredOrders.length}) Items`
            }
          </button>
        )}
        {activeTab === "READY TO SHIP" && selectedOrderIds.length > 0 && (
          <button
            onClick={() => {
              setIsBulkDelivery(true);
              setDeliveryData({
                transportName: "",
                transportRemark: "",
                deliveryDate: new Date().toISOString().split('T')[0]
              });
              setShowDeliveryModal(true);
            }}
            className="flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 mb-1 mr-2 cursor-pointer"
          >
            <FiTruck className="text-sm mr-1.5" /> Bulk Deliver ({selectedOrderIds.length})
          </button>
        )}
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-full">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr className="divide-x divide-slate-200">
              {activeTab === "ALL" && <th className="px-2 py-3 text-[12px] font-bold uppercase text-slate-600 w-10 text-center">Paid</th>}
              {activeTab === "DELIVERY" && <th className="px-2 py-3 text-[12px] font-bold uppercase text-slate-600 w-10 text-center"> </th>}
              {activeTab === "READY TO SHIP" && (
                <th className="px-2 py-3 text-[12px] font-bold uppercase text-slate-600 w-10 text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                    checked={visibleOrders.length > 0 && visibleOrders.every(o => selectedOrderIds.includes(o._id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const visibleIds = visibleOrders.map(o => o._id);
                        setSelectedOrderIds(prev => Array.from(new Set([...prev, ...visibleIds])));
                      } else {
                        const visibleIds = visibleOrders.map(o => o._id);
                        setSelectedOrderIds(prev => prev.filter(id => !visibleIds.includes(id)));
                      }
                    }}
                  />
                </th>
              )}
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
            {visibleOrders.map((order) => (
              <tr key={order._id} className="hover:bg-slate-50 transition-colors divide-x divide-slate-100">
                {activeTab === "ALL" && (
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer" checked={order.isPaid || false} onChange={() => handlePaymentToggle(order._id, order.isPaid)} />
                  </td>
                )}
                {activeTab === "DELIVERY" && (
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                      checked={selectedOrderIds.includes(order._id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedOrderIds([...selectedOrderIds, order._id]);
                        } else {
                          setSelectedOrderIds(selectedOrderIds.filter(id => id !== order._id));
                        }
                      }}
                    />
                  </td>
                )}
                {activeTab === "READY TO SHIP" && (
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                      checked={selectedOrderIds.includes(order._id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedOrderIds([...selectedOrderIds, order._id]);
                        } else {
                          setSelectedOrderIds(selectedOrderIds.filter(id => id !== order._id));
                        }
                      }}
                    />
                  </td>
                )}

                <td className="px-3 py-2 font-black text-blue-600 max-w-20">{order.orderNo}
                  <span className="text-[9px] font-bold text-slate-800 block">
                    {order.createdAt
                      ? new Date(order.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
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
                <td className="px-3 py-2 max-w-24 font-black text-blue-800/60 uppercase">{order.category}</td>
                <td className="px-3 py-2 max-w-72">
                  <div className="font-bold text-slate-900 truncate">{order.itemName}</div>
                  <div className="text-[9px] text-slate-800">SKU: {order.sku},
                    <b className="text-green-500">Stock: </b>
                    <span className="font-bold text-slate-700 mr-1">
                      {order.stockQty ?? stocks.find(s => s._id === order.itemId)?.totalQty ?? 0}
                    </span>
                    <b className="text-amber-500">Re-Qty: </b>
                    <span className="font-bold text-slate-700">
                      {order.stockReQty ?? stocks.find(s => s._id === order.itemId)?.reQty ?? 0}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className=" inline-block text-[10px] text-slate-600 font-bold">
                    {order.contractNo || "N/A"},
                    {order.contractUrl && <a href={order.contractUrl} target="_blank" className="text-blue-500 inline-block ml-1"><FiExternalLink size={11} /></a>}
                  </div>
                  <div className="text-[9px] text-slate-800">
                    {order.contractDate
                      ? new Date(order.contractDate).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
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
                {activeTab === "DELIVERY" && (
                  <td className="px-3 py-2 min-w-[200px]">
                    <div className="flex items-center justify-between group">
                      <div className="flex flex-col gap-0.5">
                        <div className="font-black text-slate-800 uppercase flex items-center gap-1.5 text-[11px]">
                          <FiTruck className="text-emerald-500" size={12} />
                          {order.transportName || "No Transport"}
                        </div>
                        <div className="text-[9px] font-black text-emerald-600">
                          {order.deliveryDate
                            ? new Date(order.deliveryDate).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric'
                            }).replace(/\//g, '-')
                            : "N/A"}
                        </div>
                        <div className="text-[9px] font-bold text-slate-400 truncate max-w-[150px]">
                          {order.transportRemark ? `${order.transportRemark}` : "No remark"}
                        </div>
                      </div>

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
                          <option value="FULFILLED">FULFILLED</option>
                        </>
                      )}
                      {activeTab === "READY TO SHIP" && (
                        <>
                          <option value="READY TO SHIP">READY TO SHIP</option>
                          <option value="DELIVERY">DELIVERY</option>
                          <option value="FULFILLED">FULFILLED</option>
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
                    <div className="inline-flex items-center gap-1 float-right">
                      <button
                        onClick={() => handleDeleteOrder(order._id, order.orderNo)}
                        title="Delete this order"
                        className="p-1.5 rounded-lg text-red-400 hover:text-white hover:bg-red-500 transition-all"
                      >
                        <FiTrash2 size={14} />
                      </button>
                      <button
                        onClick={() => { setEditingOrder(order); setShowOrderModal(true); }}
                        title="Edit this order"
                        className="p-1.5 rounded-lg text-blue-500 hover:text-white hover:bg-blue-500 transition-all"
                      >
                        <FiEdit size={14} />
                      </button>
                    </div>
                  )}
                  {activeTab === "RETURN ORDER" && (
                    <button
                      onClick={() => handleMarkAsReceived(order)}
                      disabled={order.status === "RETURN RECEIVED"}
                      className={`flex items-center gap-2 p-2 rounded-xl transition-all font-black text-[10px] uppercase ${order.status === "RETURN RECEIVED"
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-green-50 text-green-600 hover:bg-green-600 hover:text-white"
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

        {filteredOrders.length > displayLimit && (
          <div className="flex justify-center p-6 bg-slate-50 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDisplayLimit((prev) => prev + 50)}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
            >
              Load More Orders ({filteredOrders.length - displayLimit} Remaining)
            </button>
          </div>
        )}
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
            onClose={(savedOrders) => {
              setShowOrderModal(false);
              setEditingOrder(null);
              if (savedOrders && savedOrders.length > 0) {
                setOrders(prev => {
                  let next = prev;
                  for (const saved of savedOrders) {
                    const exists = next.some(o => o._id === saved._id);
                    // Spread the previous row first so computed/joined columns
                    // this response doesn't carry (stockQty/prQty/opQty - only
                    // ever set by the list GET's cross-collection aggregation,
                    // see app/api/seller-orders/route.ts) keep showing their
                    // last-known value instead of going blank until the next
                    // natural refresh, rather than refetching the whole list.
                    next = exists
                      ? next.map(o => (o._id === saved._id ? { ...o, ...saved } : o))
                      : [{ prQty: 0, opQty: 0, stockQty: 0, ...saved }, ...next];
                  }
                  return next;
                });
              }
            }}
            initialData={editingOrder}
          />
        </div>
      )}

      {/* --- MODALS --- */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 relative">
            <button
              onClick={() => {
                setShowDeliveryModal(false);
                setPartialDeliveryState(null);
              }}
              className="absolute right-6 top-6 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <FiX size={20} />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-emerald-500 text-white rounded-2xl">
                <FiTruck size={24} />
              </div>
              <h2 className="text-xl font-black uppercase tracking-tight">Delivery Details</h2>
            </div>
            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Select Transport</label>
                <input
                  type="text"
                  list="transporter-options"
                  placeholder="Search or choose transporter..."
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                  value={deliveryData.transportName}
                  onChange={(e) => setDeliveryData({ ...deliveryData, transportName: e.target.value })}
                />
                <datalist id="transporter-options">
                  {transporters.map(t => (
                    <option key={t._id} value={t.name} />
                  ))}
                </datalist>
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
                <button
                  onClick={() => {
                    setShowDeliveryModal(false);
                    setPartialDeliveryState(null);
                  }}
                  className="flex-1 p-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px]"
                >
                  Cancel
                </button>
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
                <button onClick={submitReturn} disabled={isSubmitting} className="flex-1 p-4 bg-rose-500 text-white rounded-2xl font-black uppercase text-[10px]">
                  {isSubmitting ? 'Processing...' : 'Confirm Return'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPartialShipModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl border border-blue-100 relative">
            <button
              onClick={() => setShowPartialShipModal(false)}
              className="absolute right-6 top-6 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <FiX size={20} />
            </button>
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
                  {orders.find(o => o._id === selectedOrderId)?.stockQty ?? 0}
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
                <button
                  type="button"
                  onClick={handleDirectDeliverClick}
                  className="flex-1 p-4 bg-emerald-500 text-white rounded-2xl font-black uppercase text-[10px] hover:bg-emerald-600 active:scale-[0.98] transition-all"
                >
                  Direct Deliver
                </button>
                <button
                  disabled={isShipping}
                  onClick={submitPartialShipment}
                  className={`flex-1 p-4 rounded-2xl font-black uppercase text-[10px] transition-all ${isShipping
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed animate-pulse"
                    : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]"
                    }`}>
                  {isShipping ? "Shipping..." : "Ship Partial"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PurchaseRequestModal
        isOpen={isRequestModalOpen}
        stockData={sortedStock}
        onClose={() => {
          setIsRequestModalOpen(false);
          fetchTabData();
        }}
      />
      </div>
    </BlockGuard>
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