"use client";
import { useState, useEffect } from "react";

export default function ManageStockPage() {
  const [itemsDb, setItemsDb] = useState([]);
  
  // Authorization States
  const [isAuthorized, setIsAuthorized] = useState(null); // null means 'checking'
  const [username, setUsername] = useState("");

  // UI Form States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [quantityInput, setQuantityInput] = useState("");
  const [historyType, setHistoryType] = useState("Stock Add");
  const [status, setStatus] = useState({ type: "", text: "" });

  // 1. Correctly parse 'oms_user' from localStorage on component mount
  useEffect(() => {
    try {
      const omsUserData = localStorage.getItem("oms_user"); 
      
      if (omsUserData) {
        // Parse the JSON string stored in localStorage
        const parsedData = JSON.parse(omsUserData);
        const loggedInUser = parsedData?.username;

        if (loggedInUser) {
          const lowerUser = loggedInUser.trim().toLowerCase();
          
          // Only allow 'chintan' or 'hitesh'
          if (lowerUser === "chintan" || lowerUser === "hitesh") {
            setIsAuthorized(true);
            setUsername(loggedInUser); // Keeps the original case casing (e.g., "Hitesh")
            return; // Exit successfully
          }
        }
      }
      
      // If no valid user or doesn't match names, restrict access
      setIsAuthorized(false);

    } catch (err) {
      console.error("Error reading authentication data:", err);
      setIsAuthorized(false);
    }
  }, []);

  // 2. Load initial array lists from your main stock endpoint
  useEffect(() => {
    // Stop API requests if user is not verified or explicitly unauthorized
    if (isAuthorized !== true) return;

    fetch("/api/stock") 
      .then((res) => res.json())
      .then((data) => {
        const itemsList = data.item_db || data.stock_db || data || [];
        setItemsDb(itemsList);
      })
      .catch((err) => console.error("Error loading item configurations:", err));
  }, [isAuthorized]);

  // Filters results instantly as you type
  const filteredItems = searchQuery && !selectedItem
    ? itemsDb.filter((item) => 
        item.itemName?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const handleSelectItem = (item) => {
    setSelectedItem(item);
    setSearchQuery(item.itemName);
  };

  // Submit transaction directly to your nested API path
  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: "", text: "" });

    if (!selectedItem) {
      setStatus({ type: "error", text: "Please use the item lookup and select an item." });
      return;
    }

    if (!quantityInput || parseInt(quantityInput, 10) <= 0) {
      setStatus({ type: "error", text: "Please enter a valid quantity greater than 0." });
      return;
    }

    try {
      const response = await fetch("/api/stock/manage-stock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: selectedItem.sku,
          quantityInput: quantityInput,
          historyType: historyType,
          updatedBy: username, // Log who performed this inventory action
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to execute document update operation.");
      }

      // Success Response Reset
      setStatus({ 
        type: "success", 
        text: `Transaction updated completely for SKU: ${selectedItem.sku}` 
      });
      setSearchQuery("");
      setSelectedItem(null);
      setQuantityInput("");
      setHistoryType("Stock Add");

    } catch (err) {
      setStatus({ type: "error", text: err.message });
    }
  };

  // --- RENDERING LOGIC ---

  // A. Loading State (Prevents UI flashing while parsing localStorage)
  if (isAuthorized === null) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <p className="text-gray-500 text-sm animate-pulse font-medium">Verifying internal management credentials...</p>
      </div>
    );
  }

  // B. Not Authorized Block View
  if (isAuthorized === false) {
    return (
      <div className="max-w-md mx-auto p-6 bg-red-50 rounded-lg shadow-sm border border-red-200 mt-20 text-center">
        <svg className="w-12 h-12 text-red-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <h2 className="text-lg font-bold text-red-800 mb-1">Not Authorized</h2>
        <p className="text-sm text-red-600 mb-4">You do not have permission to view or manage stock operations on this page.</p>
        <button 
          onClick={() => window.location.href = "/"} // Redirects to system home dashboard
          className="text-xs bg-white text-red-700 font-semibold px-3 py-1.5 border border-red-300 rounded shadow-sm hover:bg-red-100 transition cursor-pointer"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  // C. Authorized View (Original Page Content)
  return (
    <div className="max-w-xl mx-auto p-6 bg-white rounded-lg shadow-sm border border-gray-200 mt-10">
      <div className="flex justify-between items-center mb-6 pb-2 border-b">
        <h2 className="text-xl font-bold text-gray-800">Manage Inventory Stock</h2>
        <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full border border-blue-100">
          Operator: {username}
        </span>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Step 1: Lookup Filter Text Box */}
        <div className="relative">
          <label className="block text-sm font-semibold text-gray-700 mb-1">Item Name Lookup</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            placeholder="Type item name to search..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (selectedItem) setSelectedItem(null); 
            }}
          />
          
          {/* Item Match Results List Overlay */}
          {filteredItems.length > 0 && (
            <ul className="absolute z-10 w-full bg-white border border-gray-300 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
              {filteredItems.map((item) => (
                <li
                  key={item.sku}
                  onClick={() => handleSelectItem(item)}
                  className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm flex justify-between items-center border-b last:border-0 border-gray-100"
                >
                  <span className="text-gray-900 font-medium">{item.itemName}</span>
                  <span className="text-gray-400 font-mono text-xs bg-gray-50 px-2 py-0.5 rounded border">SKU: {item.sku}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Step 2: SKU Presenter Element */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Linked SKU Number</label>
          <input
            type="text"
            readOnly
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm font-mono text-gray-600 outline-none select-all"
            value={selectedItem ? selectedItem.sku : ""}
            placeholder="Auto-retrieved SKU field value"
          />
        </div>

        {/* Step 3: Transaction Action Select Switcher */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">History Action Type</label>
          <select
            value={historyType}
            onChange={(e) => setHistoryType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
          >
            <option value="Stock Add">Stock Add (Inward Entry)</option>
            <option value="Stock Remove">Stock Remove (Outward Dispatch)</option>
            <option value="Damage">Damage / Scrap </option>
          </select>
        </div>

        {/* Step 4: Text input box for incremental addition fields */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Stock Quantity Amount</label>
          <input
            type="number"
            min="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
            placeholder="Enter absolute total units"
          />
        </div>

        {/* Execution Submit Control */}
        <button 
          type="submit" 
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-md text-sm transition-colors cursor-pointer"
        >
          Submit Database updates
        </button>
      </form>

      {/* Response Messages */}
      {status.text && (
        <div className={`mt-4 p-3 rounded-md text-sm font-medium border ${
          status.type === "success" 
            ? "bg-green-50 text-green-700 border-green-200" 
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {status.text}
        </div>
      )}
    </div>
  );
}