"use client";
import * as XLSX from "xlsx";
import XLSXStyle from "xlsx-js-style";
import Link from "next/link";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  FiUploadCloud,
  FiDownload,
  FiPlus,
  FiSearch,
  FiEdit,
  FiClock,
  FiUsers,
  FiCheckCircle,
  FiAlertTriangle,
  FiExternalLink,
  FiArrowLeft,
  FiTrash2,
  FiDatabase,
  FiList,
  FiCopy,
  FiInfo,
  FiChevronDown,
  FiCheck,
  FiX
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

// Types definition
interface Buyer {
  id: string;
  name: string;
  createdAt: string;
}

interface SavedSheet {
  id: string;
  fileName: string;
  uploadedRows: UploadedRow[];
  originalExcelData: any[];
  selectedBuyerId: string;
  isCompleted?: boolean;
  updatedAt: string;
}

interface FirmItemListing {
  id: string;
  firmCode: string;
  itemId: string;
  itemName: string;
  gemLink: string;
  rate: number;
  availGemStock?: number;
  minQty: number;
  status: "Synced" | "Pending";
  buyerId: string;
  date: string;
}

interface RateHistory {
  id: string;
  listingId: string;
  itemName: string;
  buyerId: string;
  buyerName: string;
  oldRate: number;
  newRate: number;
  oldMinQty: number;
  newMinQty: number;
  reason: string;
  timestamp: string;
}

interface UploadedRow {
  index: number;
  originalName: string;
  qty: number;
  rate: number;
  mappedItemId: string;
  firmCode: string;
  gemLink: string;
  availGemStock: number;
  minQty: number;
}

export default function GeMSyncPage() {
  // Database state (fetched from real API)
  const [companies, setCompanies] = useState<any[]>([]);
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [sellers, setSellers] = useState<any[]>([]);

  // Local state (persisted in localStorage)
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [listings, setListings] = useState<FirmItemListing[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);
  const [customItems, setCustomItems] = useState<any[]>([]);

  // Page active tabs/modes
  const [activeTab, setActiveTab] = useState<"dashboard" | "upload" | "checklist" | "buyers" | "sheets" | "master">("dashboard");
  const [showAllSynced, setShowAllSynced] = useState<boolean>(false);

  // Excel Upload states
  const [sheets, setSheets] = useState<SavedSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>("");

  const [selectedBuyerId, setSelectedBuyerId] = useState<string>("");
  const [newBuyerName, setNewBuyerName] = useState<string>("");
  const [uploadedRows, setUploadedRows] = useState<UploadedRow[]>([]);
  const [originalExcelData, setOriginalExcelData] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string>("");

  // Search/Filters states
  const [buyerSearchQuery, setBuyerSearchQuery] = useState<string>("");
  const [selectedHistoryBuyerId, setSelectedHistoryBuyerId] = useState<string>("");
  const [masterItemSearch, setMasterItemSearch] = useState<string>("");
  const [masterFirmSearch, setMasterFirmSearch] = useState<string>("");
  const [masterUrlSearch, setMasterUrlSearch] = useState<string>("");
  const [librarySearchQuery, setLibrarySearchQuery] = useState<string>("");

  // Modal / Revision states
  const [isRevisionOpen, setIsRevisionOpen] = useState(false);
  const [selectedListingForRevision, setSelectedListingForRevision] = useState<FirmItemListing | null>(null);
  const [newRateValue, setNewRateValue] = useState<string>("");
  const [newMinQtyValue, setNewMinQtyValue] = useState<string>("");
  const [newGemLinkValue, setNewGemLinkValue] = useState<string>("");
  const [newAvailGemStockValue, setNewAvailGemStockValue] = useState<string>("");
  const [revisionReason, setRevisionReason] = useState<string>("negotiated revision");

  // Unmatched Resolution states
  const [unmatchedIndex, setUnmatchedIndex] = useState<number | null>(null);
  const [newUnmatchedItem, setNewUnmatchedItem] = useState({
    name: "",
    firmCode: "",
    gemLink: "",
    rate: "",
    minQty: "1"
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load backend and MongoDB shared data
  useEffect(() => {
    // 1. Fetch Firms
    fetch("/api/companies")
      .then(res => res.json())
      .then(data => setCompanies(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching companies", err));

    // 2. Fetch Inventory Items
    fetch("/api/stock")
      .then(res => res.json())
      .then(data => setStockItems(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching stock", err));

    // 3. Fetch Sellers (Deliver / Buyer Directory)
    fetch("/api/sellers")
      .then(res => res.json())
      .then(data => setSellers(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching sellers", err));

    // 4. Fetch Shared GeM Sync State from MongoDB
    fetch("/api/gem-sync")
      .then(res => res.json())
      .then(state => {
        if (state) {
          if (Array.isArray(state.buyers)) setBuyers(state.buyers);
          if (Array.isArray(state.listings)) setListings(state.listings);
          if (Array.isArray(state.rateHistory)) setRateHistory(state.rateHistory);
          if (Array.isArray(state.customItems)) setCustomItems(state.customItems);
          if (Array.isArray(state.sheets)) {
            setSheets(state.sheets);
            // Default load the latest active sheet
            if (state.sheets.length > 0) {
              const sorted = [...state.sheets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
              const latest = sorted[0];
              setActiveSheetId(latest.id);
              setFileName(latest.fileName);
              setUploadedRows(latest.uploadedRows);
              setOriginalExcelData(latest.originalExcelData);
              setSelectedBuyerId(latest.selectedBuyerId);
            }
          }
        }
      })
      .catch(err => console.error("Error loading shared MongoDB state:", err));
  }, []);

  // Combined options list of buyers from Sellers API and GeM Buyers
  const allBuyerOptions = useMemo(() => {
    const list: { id: string; name: string }[] = [];

    // 1. Add from sellers directory (/api/sellers)
    sellers.forEach((s: any) => {
      const name = s.instituteName || s.buyerName;
      if (name && !list.some(l => l.name.toLowerCase() === name.toLowerCase())) {
        list.push({ id: s._id || name, name });
      }
    });

    // 2. Add from gem-sync buyers state
    buyers.forEach(b => {
      if (b.name && !list.some(l => l.name.toLowerCase() === b.name.toLowerCase())) {
        list.push({ id: b.id || b.name, name: b.name });
      }
    });

    return list;
  }, [sellers, buyers]);

  // Search filter state for the buyer selector popover
  const [openBuyerSelectSheetId, setOpenBuyerSelectSheetId] = useState<string | null>(null);
  const [buyerSearchFilter, setBuyerSearchFilter] = useState<string>("");

  const filteredBuyerOptions = useMemo(() => {
    if (!buyerSearchFilter.trim()) return allBuyerOptions;
    const q = buyerSearchFilter.toLowerCase().trim();
    return allBuyerOptions.filter(b => b.name.toLowerCase().includes(q));
  }, [allBuyerOptions, buyerSearchFilter]);

  // Handler to change and auto-save buyer associated with a sheet
  const handleChangeSheetBuyer = async (sheetId: string, newBuyerId: string) => {
    const updatedSheets = sheets.map(s =>
      s.id === sheetId ? { ...s, selectedBuyerId: newBuyerId, updatedAt: new Date().toISOString() } : s
    );
    setSheets(updatedSheets);

    if (activeSheetId === sheetId) {
      setSelectedBuyerId(newBuyerId);
    }

    const targetSheet = updatedSheets.find(s => s.id === sheetId);
    if (targetSheet) {
      try {
        await fetch("/api/gem-sync?action=save_sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: targetSheet.id,
            fileName: targetSheet.fileName,
            uploadedRows: targetSheet.uploadedRows,
            originalExcelData: targetSheet.originalExcelData,
            selectedBuyerId: newBuyerId
          })
        });

        // Ensure newly selected buyer exists in local buyers list for historical tracking
        const matchedOpt = allBuyerOptions.find(b => b.id === newBuyerId);
        if (matchedOpt && !buyers.some(b => b.name.toLowerCase() === matchedOpt.name.toLowerCase())) {
          const newBuyerObj = { id: matchedOpt.id, name: matchedOpt.name, createdAt: new Date().toISOString() };
          saveBuyers([...buyers, newBuyerObj]);
        }
      } catch (err) {
        console.error("Failed to auto-save sheet buyer", err);
      }
    }
  };

  // Status filter for Sheet Library: current (incomplete), completed, or all
  const [sheetStatusFilter, setSheetStatusFilter] = useState<"current" | "completed" | "all">("current");

  // Handler to toggle completed status for a sheet and auto-save
  const handleToggleSheetCompleted = async (sheetId: string, currentCompleted: boolean) => {
    const newCompletedState = !currentCompleted;
    const updatedSheets = sheets.map(s =>
      s.id === sheetId ? { ...s, isCompleted: newCompletedState, updatedAt: new Date().toISOString() } : s
    );
    setSheets(updatedSheets);

    const targetSheet = updatedSheets.find(s => s.id === sheetId);
    if (targetSheet) {
      try {
        await fetch("/api/gem-sync?action=save_sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: targetSheet.id,
            fileName: targetSheet.fileName,
            uploadedRows: targetSheet.uploadedRows,
            originalExcelData: targetSheet.originalExcelData,
            selectedBuyerId: targetSheet.selectedBuyerId,
            isCompleted: newCompletedState
          })
        });
      } catch (err) {
        console.error("Failed to auto-save sheet completion status", err);
      }
    }
  };

  // Debounced auto-save active sheet state to MongoDB
  useEffect(() => {
    if (!activeSheetId || !fileName) return;

    const delayDebounceFn = setTimeout(() => {
      fetch("/api/gem-sync?action=save_sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeSheetId,
          fileName,
          uploadedRows,
          originalExcelData,
          selectedBuyerId
        })
      })
        .then(() => {
          // Refresh sheet list
          fetch("/api/gem-sync")
            .then(res => res.json())
            .then(state => {
              if (state && Array.isArray(state.sheets)) {
                setSheets(state.sheets);
              }
            });
        })
        .catch(err => console.error("Failed to sync sheet to MongoDB", err));
    }, 1000);

    return () => clearTimeout(delayDebounceFn);
  }, [activeSheetId, fileName, uploadedRows, originalExcelData, selectedBuyerId]);

  // Sync state helpers (updates both LocalState, LocalStorage fallback, and MongoDB)
  const saveBuyers = (updatedBuyers: Buyer[]) => {
    setBuyers(updatedBuyers);
    localStorage.setItem("oms_buyers", JSON.stringify(updatedBuyers));
    fetch("/api/gem-sync?action=save_buyers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedBuyers)
    }).catch(err => console.error("Failed to sync buyers to MongoDB", err));
  };

  const saveListings = (updatedListings: FirmItemListing[]) => {
    // Deduplicate listings array by (itemId/itemName + firmCode + buyerId)
    const seen = new Map<string, FirmItemListing>();
    for (const lst of updatedListings) {
      if (!lst) continue;
      const itemKey = (lst.itemId || lst.itemName || "").toString().trim().toLowerCase();
      const firmKey = (lst.firmCode || "").toString().trim().toLowerCase();
      const buyerKey = (lst.buyerId || "").toString().trim().toLowerCase();
      const key = `${itemKey}::${firmKey}::${buyerKey}`;

      if (!seen.has(key)) {
        seen.set(key, lst);
      } else {
        const existing = seen.get(key)!;
        const hasMoreInfo = !existing.gemLink && lst.gemLink;
        const isNewer = new Date(lst.date || 0).getTime() > new Date(existing.date || 0).getTime();
        if (hasMoreInfo || isNewer) {
          seen.set(key, lst);
        }
      }
    }
    const deduplicated = Array.from(seen.values());
    setListings(deduplicated);
    localStorage.setItem("oms_firm_listings", JSON.stringify(deduplicated));
    fetch("/api/gem-sync?action=save_listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deduplicated)
    }).catch(err => console.error("Failed to sync listings to MongoDB", err));
  };

  const saveRateHistory = (updatedHistory: RateHistory[]) => {
    setRateHistory(updatedHistory);
    localStorage.setItem("oms_rate_history", JSON.stringify(updatedHistory));
    fetch("/api/gem-sync?action=save_history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedHistory)
    }).catch(err => console.error("Failed to sync history to MongoDB", err));
  };

  const saveCustomItems = (updatedItems: any[]) => {
    setCustomItems(updatedItems);
    localStorage.setItem("oms_custom_items", JSON.stringify(updatedItems));
    fetch("/api/gem-sync?action=save_custom_items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedItems)
    }).catch(err => console.error("Failed to sync custom items to MongoDB", err));
  };

  // Combine fetched Stock + locally added Custom Items
  const allItemsList = useMemo(() => {
    return [...stockItems, ...customItems];
  }, [stockItems, customItems]);

  // Fuzzy Match logic
  const findFuzzyMatch = (name: string) => {
    if (!name) return "";
    const cleanName = name.trim().toLowerCase();

    // 1. Exact match
    const exact = allItemsList.find(item => item?.itemName && item.itemName.trim().toLowerCase() === cleanName);
    if (exact) return exact._id;

    // 2. Substring match (contains)
    const substring = allItemsList.find(item => {
      if (!item?.itemName) return false;
      const dbName = item.itemName.trim().toLowerCase();
      return cleanName.includes(dbName) || dbName.includes(cleanName);
    });
    if (substring) return substring._id;

    return "";
  };

  // Excel parsing
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setActiveSheetId("sheet_" + Date.now());

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        setOriginalExcelData(data);

        // Auto-extract buyer name from sheet file name
        const defaultBuyerName = file.name.replace(/\.[^/.]+$/, "");
        let buyerId = "";
        const existingBuyer = buyers.find(b => b.name.toLowerCase() === defaultBuyerName.toLowerCase());
        if (existingBuyer) {
          buyerId = existingBuyer.id;
        } else {
          const newBuyer: Buyer = {
            id: "buyer_" + Date.now(),
            name: defaultBuyerName,
            createdAt: new Date().toISOString()
          };
          saveBuyers([...buyers, newBuyer]);
          buyerId = newBuyer.id;
        }
        setSelectedBuyerId(buyerId);
        setBuyerSearchQuery(defaultBuyerName);

        // Try to parse rows and match headers
        const parsedRows: UploadedRow[] = data.map((row: any, index) => {
          // Find item name case-insensitively
          const originalName = row["Item Name"] || row["item name"] || row["Item"] || row["item"] || row["Name"] || row["name"] || row["Particulars"] || row["particulars"] || Object.values(row)[0] || "";
          // Find quantity case-insensitively
          const qty = Number(row["Item count"] || row["Quantity"] || row["quantity"] || row["Qty"] || row["qty"] || row["Qty Required"] || row["Req Qty"] || 0);
          // Find rate/price case-insensitively
          const rate = Number(row["Rate"] || row["rate"] || row["Price"] || row["price"] || row["Quote Rate"] || 0);

          const mappedItemId = findFuzzyMatch(String(originalName));

          let firmCode = "";
          let gemLink = "";
          let availGemStock = 0;
          let minQty = 1;
          let finalRate = rate;

          if (mappedItemId) {
            const matchedListing = listings.find(lst => lst.itemId === mappedItemId);
            if (matchedListing) {
              firmCode = matchedListing.firmCode;
              gemLink = matchedListing.gemLink || "";
              minQty = matchedListing.minQty || 1;
              if (!finalRate) {
                finalRate = matchedListing.rate;
              }

              // Check 30 days sync date automation
              const syncDate = new Date(matchedListing.date || new Date().toISOString());
              const daysSinceSync = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60 * 24);
              if (daysSinceSync > 30) {
                availGemStock = 0;
              } else {
                availGemStock = matchedListing.availGemStock || 0;
              }
            }
          }

          return {
            index,
            originalName: String(originalName),
            qty,
            rate: finalRate,
            mappedItemId,
            firmCode,
            gemLink,
            availGemStock,
            minQty
          };
        });

        setUploadedRows(parsedRows);
      } catch (err) {
        console.error("Error parsing excel file:", err);
        alert("Failed to parse the Excel file. Please check the console for details.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleClearSheet = () => {
    setActiveSheetId("");
    setUploadedRows([]);
    setFileName("");
    setOriginalExcelData([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteSheet = (sheetId: string) => {
    if (!confirm("Are you sure you want to delete this sheet from the library?")) return;

    fetch("/api/gem-sync?action=delete_sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sheetId })
    })
      .then(() => {
        setSheets(prev => prev.filter(s => s.id !== sheetId));
        if (activeSheetId === sheetId) {
          handleClearSheet();
        }
        alert("✓ Sheet deleted successfully from shared database.");
      })
      .catch(err => console.error("Error deleting sheet:", err));
  };

  // Add Buyer helper
  const handleAddBuyer = () => {
    if (!newBuyerName.trim()) return;
    const newBuyer: Buyer = {
      id: "buyer_" + Date.now(),
      name: newBuyerName.trim(),
      createdAt: new Date().toISOString()
    };
    saveBuyers([...buyers, newBuyer]);
    setSelectedBuyerId(newBuyer.id);
    setNewBuyerName("");
  };

  // Filtered Buyers list for Autocomplete
  const filteredBuyers = useMemo(() => {
    if (!buyerSearchQuery.trim()) return buyers;
    return buyers.filter(b => b.name.toLowerCase().includes(buyerSearchQuery.toLowerCase()));
  }, [buyers, buyerSearchQuery]);

  // Manual Cleanup Duplicates action handler
  const handleCleanupDuplicates = async () => {
    try {
      const res = await fetch("/api/gem-sync?action=cleanup_duplicates", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.listings)) {
          setListings(data.listings);
        }
        alert(`✓ Cleaned up MongoDB! Removed ${data.removedCount || 0} duplicate listings.`);
      }
    } catch (err) {
      console.error("Failed to cleanup duplicates:", err);
      alert("Failed to cleanup duplicates. Check console for details.");
    }
  };

  // Filtered Listings for Master List (Sorted by item name to group duplicates consecutively)
  const filteredMasterListings = useMemo(() => {
    // Ensure array is deduplicated by (itemId/itemName + firmCode + buyerId)
    const seen = new Map<string, FirmItemListing>();
    for (const lst of listings) {
      if (!lst) continue;
      const itemKey = (lst.itemId || lst.itemName || "").toString().trim().toLowerCase();
      const firmKey = (lst.firmCode || "").toString().trim().toLowerCase();
      const buyerKey = (lst.buyerId || "").toString().trim().toLowerCase();
      const key = `${itemKey}::${firmKey}::${buyerKey}`;

      if (!seen.has(key)) {
        seen.set(key, lst);
      } else {
        const existing = seen.get(key)!;
        const hasMoreInfo = !existing.gemLink && lst.gemLink;
        const isNewer = new Date(lst.date || 0).getTime() > new Date(existing.date || 0).getTime();
        if (hasMoreInfo || isNewer) {
          seen.set(key, lst);
        }
      }
    }
    let list = Array.from(seen.values());
    
    const itemQuery = masterItemSearch.trim().toLowerCase();
    const firmQuery = masterFirmSearch.trim().toLowerCase();
    const urlQuery = masterUrlSearch.trim().toLowerCase();

    if (itemQuery || firmQuery || urlQuery) {
      list = list.filter(lst => {
        const buyerName = buyers.find(b => b.id === lst.buyerId)?.name || "";
        const inventoryItem = allItemsList.find(i => i._id === lst.itemId);
        const firmName = companies.find(c => c.firmCode === lst.firmCode)?.firmName || "";
        
        const matchesItem = !itemQuery || 
          lst.itemName.toLowerCase().includes(itemQuery) || 
          (inventoryItem?.sku && inventoryItem.sku.toLowerCase().includes(itemQuery)) ||
          buyerName.toLowerCase().includes(itemQuery);
          
        const matchesFirm = !firmQuery || 
          lst.firmCode.toLowerCase().includes(firmQuery) || 
          firmName.toLowerCase().includes(firmQuery);
          
        const matchesUrl = !urlQuery || 
          (lst.gemLink && lst.gemLink.toLowerCase().includes(urlQuery));
          
        return matchesItem && matchesFirm && matchesUrl;
      });
    }
    return [...list].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [listings, masterItemSearch, masterFirmSearch, masterUrlSearch, buyers, allItemsList, companies]);

  // Pre-calculate rowSpan indexes for visually merging identical items
  const masterRowSpans = useMemo(() => {
    const spans: number[] = [];
    let i = 0;
    while (i < filteredMasterListings.length) {
      let span = 1;
      while (
        i + span < filteredMasterListings.length &&
        filteredMasterListings[i].itemName === filteredMasterListings[i + span].itemName
      ) {
        span++;
      }
      spans[i] = span;
      for (let j = 1; j < span; j++) {
        spans[i + j] = 0;
      }
      i += span;
    }
    return spans;
  }, [filteredMasterListings]);

  // Filtered Sheets for Sheet Library (Search query + Current/Completed filter)
  const filteredSheets = useMemo(() => {
    return sheets.filter(sheet => {
      const q = librarySearchQuery.toLowerCase().trim();
      const matchedOpt = allBuyerOptions.find(b => b.id === sheet.selectedBuyerId || b.name === sheet.selectedBuyerId);
      const buyerName = matchedOpt?.name || sheet.selectedBuyerId || "";

      const matchesQuery = !q ||
        sheet.fileName.toLowerCase().includes(q) ||
        buyerName.toLowerCase().includes(q);

      const matchesStatus =
        sheetStatusFilter === "all" ? true :
        sheetStatusFilter === "completed" ? !!sheet.isCompleted :
        !sheet.isCompleted;

      return matchesQuery && matchesStatus;
    });
  }, [sheets, librarySearchQuery, sheetStatusFilter, allBuyerOptions]);

  // Check Duplicate Rate Warnings
  const checkDuplicateRateWarning = (itemId: string, currentRate: number, currentFirmCode: string) => {
    if (!itemId || !currentRate) return null;

    // Look in current active listings or past histories for this item with a different rate
    const otherListingWithDiffRate = listings.find(lst =>
      lst.itemId === itemId &&
      lst.rate !== currentRate
    );

    if (otherListingWithDiffRate) {
      return {
        rate: otherListingWithDiffRate.rate,
        firmCode: otherListingWithDiffRate.firmCode,
        message: `Warning: This item is listed at ₹${otherListingWithDiffRate.rate} in ${otherListingWithDiffRate.firmCode}`
      };
    }
    return null;
  };

  const formatDate = (dateInput: Date | string) => {
    if (!dateInput) return "—";
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getMonth()].toLowerCase();
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  // Lookup last quote hint for returning buyer
  const getLastQuotedHint = (itemId: string, buyerId: string) => {
    if (!itemId || !buyerId) return null;

    // Find the latest history record for this buyer and item
    const matches = rateHistory
      .filter(hist => hist.buyerId === buyerId && hist.itemName === allItemsList.find(i => i._id === itemId)?.itemName)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (matches.length > 0) {
      return {
        rate: matches[0].newRate,
        minQty: matches[0].newMinQty,
        date: formatDate(matches[0].timestamp)
      };
    }

    // Fallback to listings created by this buyer
    const listingMatches = listings
      .filter(lst => lst.buyerId === buyerId && lst.itemId === itemId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (listingMatches.length > 0) {
      return {
        rate: listingMatches[0].rate,
        minQty: listingMatches[0].minQty,
        date: formatDate(listingMatches[0].date)
      };
    }

    return null;
  };

  // Resolve unmatched item inline
  const saveUnmatchedItem = (rowIndex: number) => {
    if (!newUnmatchedItem.name.trim()) {
      alert("Please enter a valid Item Name.");
      return;
    }
    if (!newUnmatchedItem.firmCode) {
      alert("Please select a Firm.");
      return;
    }

    if (newUnmatchedItem.gemLink && newUnmatchedItem.gemLink.trim() !== "") {
      const trimmedLink = newUnmatchedItem.gemLink.trim();
      const duplicateLink = listings.find(lst => 
        lst.firmCode === newUnmatchedItem.firmCode && 
        lst.gemLink && 
        lst.gemLink.trim() === trimmedLink
      );

      if (duplicateLink) {
        alert(`❌ Duplicate GeM Link! The link is already registered for this firm under item: "${duplicateLink.itemName}".`);
        return;
      }
    }

    const rateVal = parseFloat(newUnmatchedItem.rate);
    const minQtyVal = parseInt(newUnmatchedItem.minQty) || 1;

    if (isNaN(rateVal) || rateVal <= 0) {
      alert("Please enter a valid rate.");
      return;
    }

    // 1. Create dynamic/custom Item
    const nextSkuNum = 1100 + stockItems.length + customItems.length;
    const newCustomItem = {
      _id: "custom_" + Date.now(),
      sku: "S" + nextSkuNum,
      itemName: newUnmatchedItem.name.trim(),
      category: "General",
      unit: "pcs",
      currentStock: 0,
      location: "Console Upload"
    };

    const updatedCustomItems = [...customItems, newCustomItem];
    saveCustomItems(updatedCustomItems);

    // 2. Create Listing Row immediately
    const buyerObj = buyers.find(b => b.id === selectedBuyerId);
    const newListing: FirmItemListing = {
      id: "listing_" + Date.now(),
      firmCode: newUnmatchedItem.firmCode,
      itemId: newCustomItem._id,
      itemName: newCustomItem.itemName,
      gemLink: newUnmatchedItem.gemLink.trim(),
      rate: rateVal,
      availGemStock: 0,
      minQty: minQtyVal,
      status: "Pending",
      buyerId: selectedBuyerId,
      date: new Date().toISOString()
    };

    saveListings([...listings, newListing]);

    // 3. Write initial entry to RateHistory
    const newHistory: RateHistory = {
      id: "hist_" + Date.now(),
      listingId: newListing.id,
      itemName: newCustomItem.itemName,
      buyerId: selectedBuyerId,
      buyerName: buyerObj?.name || "Unknown Buyer",
      oldRate: 0,
      newRate: rateVal,
      oldMinQty: 0,
      newMinQty: minQtyVal,
      reason: "Initial quote (organically added from upload)",
      timestamp: new Date().toISOString()
    };

    saveRateHistory([...rateHistory, newHistory]);

    // 4. Update the UploadedRow mapping in state
    setUploadedRows(prev => prev.map(row => {
      if (row.index === rowIndex) {
        return {
          ...row,
          mappedItemId: newCustomItem._id,
          firmCode: newUnmatchedItem.firmCode,
          gemLink: newUnmatchedItem.gemLink.trim(),
          minQty: minQtyVal,
          rate: rateVal,
          availGemStock: 0
        };
      }
      return row;
    }));

    // Reset resolution states
    setUnmatchedIndex(null);
    setNewUnmatchedItem({
      name: "",
      firmCode: "",
      gemLink: "",
      rate: "",
      minQty: "1"
    });
  };

  // Submit standard mappings to listings
  const handleConfirmMapping = (row: UploadedRow) => {
    if (!row.mappedItemId) {
      alert("Please select or create an Item mapping first.");
      return;
    }
    if (!row.firmCode) {
      alert("Please select a Firm.");
      return;
    }
    if (!row.rate || row.rate <= 0) {
      alert("Please enter a valid rate/quote amount.");
      return;
    }

    const matchedItemObj = allItemsList.find(i => i._id === row.mappedItemId);
    const buyerObj = buyers.find(b => b.id === selectedBuyerId);

    // Validate that the GeM product link is not a duplicate within the same firm
    if (row.gemLink && row.gemLink.trim() !== "") {
      const trimmedLink = row.gemLink.trim();
      
      // Look for duplicate under same firm, excluding the currently edited listing if it exists
      const existingListingId = listings.find(lst =>
        lst.buyerId === selectedBuyerId &&
        lst.itemId === row.mappedItemId &&
        lst.firmCode === row.firmCode &&
        row.mappedItemId &&
        row.firmCode
      )?.id;

      const duplicateLink = listings.find(lst => 
        lst.firmCode === row.firmCode && 
        lst.gemLink && 
        lst.gemLink.trim() === trimmedLink &&
        (existingListingId ? lst.id !== existingListingId : true)
      );

      if (duplicateLink) {
        alert(`❌ Duplicate GeM Link! The link is already registered for this firm under item: "${duplicateLink.itemName}".`);
        return;
      }
    }

    // Check if listing already exists to toggle (UNLINK) or override (prevent duplicates)
    const existing = listings.find(lst =>
      lst.buyerId === selectedBuyerId &&
      lst.itemId === row.mappedItemId &&
      lst.firmCode === row.firmCode &&
      row.mappedItemId &&
      row.firmCode
    );

    if (existing) {
      // Check if values are identical
      const isIdentical =
        existing.rate === row.rate &&
        existing.minQty === row.minQty &&
        existing.gemLink === (row.gemLink || "") &&
        (existing.availGemStock || 0) === (row.availGemStock || 0);

      if (isIdentical) {
        // Toggle UNLINK (remove it)
        const updatedListings = listings.filter(lst => lst.id !== existing.id);
        saveListings(updatedListings);
        alert("✓ Unlinked row successfully.");
        return;
      } else {
        // Values changed -> UPDATE listing instead of creating a duplicate
        const updatedListings = listings.map(lst => {
          if (lst.id === existing.id) {
            return {
              ...lst,
              rate: row.rate,
              minQty: row.minQty,
              gemLink: row.gemLink || "",
              availGemStock: row.availGemStock || 0,
              status: "Pending" as const
            };
          }
          return lst;
        });
        saveListings(updatedListings);
        alert("✓ Updated linked values successfully.");
        return;
      }
    }

    // Otherwise, create new Listing
    const newListing: FirmItemListing = {
      id: "listing_" + Date.now() + "_" + row.index,
      firmCode: row.firmCode,
      itemId: row.mappedItemId,
      itemName: matchedItemObj?.itemName || row.originalName,
      gemLink: row.gemLink || "",
      rate: row.rate,
      availGemStock: row.availGemStock || 0,
      minQty: row.minQty || 1,
      status: "Pending",
      buyerId: selectedBuyerId,
      date: new Date().toISOString()
    };

    saveListings([...listings, newListing]);

    // Log to RateHistory
    const newHistory: RateHistory = {
      id: "hist_" + Date.now() + "_" + row.index,
      listingId: newListing.id,
      itemName: matchedItemObj?.itemName || row.originalName,
      buyerId: selectedBuyerId,
      buyerName: buyerObj?.name || "Unknown Buyer",
      oldRate: 0,
      newRate: row.rate,
      oldMinQty: 0,
      newMinQty: row.minQty || 1,
      reason: "Initial Upload Quote",
      timestamp: new Date().toISOString()
    };

    saveRateHistory([...rateHistory, newHistory]);

    alert("✓ Linked successfully and added to checklist!");
  };

  // Excel Download logic
  const handleDownloadFilledExcel = () => {
    if (uploadedRows.length === 0) {
      alert("No data available to download. Please upload a sheet first.");
      return;
    }

    const filledData = originalExcelData.map((row, index) => {
      const mappedRow = uploadedRows.find(r => r.index === index);
      const matchedListing = listings.find(lst =>
        lst.buyerId === selectedBuyerId &&
        lst.itemId === mappedRow?.mappedItemId
      );
      
      const firmCode = matchedListing?.firmCode || mappedRow?.firmCode || "";
      const company = companies.find(c => c.firmCode?.toUpperCase() === firmCode.toUpperCase());
      const sellerRegisterAddress = company?.sellerRegisterAddress || "";

      return {
        ...row,
        "Quoted Rate (₹)": matchedListing?.rate || mappedRow?.rate || "",
        "Avail gem stock": matchedListing?.availGemStock || mappedRow?.availGemStock || 0,
        "Min Qty": matchedListing?.minQty || mappedRow?.minQty || "",
        "Seller Register Address": sellerRegisterAddress,
        "Mapped Firm": firmCode,
        "GeM Link": matchedListing?.gemLink || mappedRow?.gemLink || ""
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(filledData);

    // Apply styles to Mapped Firm column for linked items
    if (filledData.length > 0) {
      const keys = Object.keys(filledData[0] || {});
      const mappedFirmColIndex = keys.indexOf("Mapped Firm");
      if (mappedFirmColIndex !== -1) {
        const colLetter = XLSX.utils.encode_col(mappedFirmColIndex);
        
        filledData.forEach((row, index) => {
          const mappedFirmVal = row["Mapped Firm"];
          const hasFirm = !!mappedFirmVal && String(mappedFirmVal).trim() !== "";
          
          if (hasFirm) {
            const cellRef = `${colLetter}${index + 2}`; // Excel rows are 1-based, header is row 1
            if (worksheet[cellRef]) {
              worksheet[cellRef].s = {
                fill: {
                  patternType: "solid",
                  fgColor: { rgb: "C6EFCE" } // Soft Excel light green background
                },
                font: {
                  color: { rgb: "006100" }, // Dark green text
                  bold: true
                }
              };
            }
          }
        });
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Quoted Requirements");
    XLSXStyle.writeFile(workbook, `Filled_${fileName || "Requirement"}.xlsx`);
  };

  // Rate Revision logic
  const handleOpenRevision = (listing: FirmItemListing) => {
    setSelectedListingForRevision(listing);
    setNewRateValue(String(listing.rate));
    setNewMinQtyValue(String(listing.minQty));
    setNewGemLinkValue(listing.gemLink || "");
    setNewAvailGemStockValue(String(listing.availGemStock || 0));
    setRevisionReason("negotiated revision");
    setIsRevisionOpen(true);
  };

  const handleSaveRevision = () => {
    if (!selectedListingForRevision) return;

    const rateVal = parseFloat(newRateValue);
    const minQtyVal = parseInt(newMinQtyValue) || 1;
    const availStockVal = parseInt(newAvailGemStockValue) || 0;

    if (isNaN(rateVal) || rateVal <= 0) {
      alert("Please enter a valid rate.");
      return;
    }

    const buyerObj = buyers.find(b => b.id === selectedListingForRevision.buyerId);

    if (newGemLinkValue && newGemLinkValue.trim() !== "") {
      const trimmedLink = newGemLinkValue.trim();
      const duplicateLink = listings.find(lst => 
        lst.firmCode === selectedListingForRevision.firmCode && 
        lst.gemLink && 
        lst.gemLink.trim() === trimmedLink &&
        lst.id !== selectedListingForRevision.id
      );

      if (duplicateLink) {
        alert(`❌ Duplicate GeM Link! The link is already registered for this firm under item: "${duplicateLink.itemName}".`);
        return;
      }
    }

    // Update listings
    const updatedListings = listings.map(lst => {
      if (lst.id === selectedListingForRevision.id) {
        return {
          ...lst,
          rate: rateVal,
          minQty: minQtyVal,
          gemLink: newGemLinkValue.trim(),
          availGemStock: availStockVal,
          status: "Pending" as const // Flag checklist as pending again
        };
      }
      return lst;
    });

    saveListings(updatedListings);

    // Log to RateHistory
    const newHistory: RateHistory = {
      id: "hist_" + Date.now(),
      listingId: selectedListingForRevision.id,
      itemName: selectedListingForRevision.itemName,
      buyerId: selectedListingForRevision.buyerId,
      buyerName: buyerObj?.name || "Unknown Buyer",
      oldRate: selectedListingForRevision.rate,
      newRate: rateVal,
      oldMinQty: selectedListingForRevision.minQty,
      newMinQty: minQtyVal,
      reason: revisionReason.trim() || "negotiated revision",
      timestamp: new Date().toISOString()
    };

    saveRateHistory([...rateHistory, newHistory]);

    setIsRevisionOpen(false);
    setSelectedListingForRevision(null);
    alert("✓ Rate revision updated and history logged!");
  };

  // Toggle synced checkmark in per-firm sync checklist
  const toggleSyncStatus = (listingId: string) => {
    const updatedListings = listings.map(lst => {
      if (lst.id === listingId) {
        return {
          ...lst,
          status: (lst.status === "Synced" ? "Pending" : "Synced") as "Synced" | "Pending"
        };
      }
      return lst;
    });
    saveListings(updatedListings);
  };

  const handleDeleteListing = (listingId: string) => {
    if (!confirm("Are you sure you want to delete this listing from the sync checklist?")) return;
    const updatedListings = listings.filter(lst => lst.id !== listingId);
    saveListings(updatedListings);
  };

  return (
    <BlockGuard permission="gemLinks">
      <div className="p-4 md:p-8 bg-slate-50/50 min-h-screen text-[var(--gem-text-primary)] font-sans">
        <div className="w-full mx-auto">

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-6 border-b border-slate-200">
            <div className="flex items-center gap-4">
              {activeTab === "dashboard" ? (
                <Link href="/dashboard" className="text-slate-500 hover:text-blue-600 transition-colors flex items-center justify-center p-2 rounded-xl bg-white border border-slate-200 shadow-sm active:scale-95">
                  <FiArrowLeft size={18} />
                </Link>
              ) : (
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className="text-slate-500 hover:text-blue-600 transition-colors flex items-center justify-center p-2 rounded-xl bg-white border border-slate-200 shadow-sm active:scale-95"
                >
                  <FiArrowLeft size={18} />
                </button>
              )}
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800">
                  {activeTab === "dashboard" && "GeM Sync Console"}
                  {activeTab === "upload" && "Upload Sheet"}
                  {activeTab === "checklist" && "Sync Checklist"}
                  {activeTab === "buyers" && "Buyer History"}
                  {activeTab === "sheets" && "Sheet Library"}
                  {activeTab === "master" && "Master List"}
                </h1>
                <p className="text-blue-600 text-[10px] font-black tracking-widest uppercase mt-1">
                  {activeTab === "dashboard" && "Portal Synchronization Control"}
                  {activeTab === "upload" && "Excel Workbook Mapping Panel"}
                  {activeTab === "checklist" && "Marketplace Sync Log"}
                  {activeTab === "buyers" && "Audit Log & Quote Timeline"}
                  {activeTab === "sheets" && "Worksheet Library Directory"}
                  {activeTab === "master" && "Consolidated directory of all matched and mapped items"}
                </p>
              </div>
            </div>
          </div>

          {/* =================== TAB: DASHBOARD MENU =================== */}
          {activeTab === "dashboard" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {/* Card 1: Upload Sheet */}
              <div
                onClick={() => setActiveTab("upload")}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all cursor-pointer min-h-[160px] relative overflow-hidden group"
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white mb-6 text-xl shadow-md bg-purple-600 shadow-purple-100">
                  <FiUploadCloud />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Upload Sheet</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Map Excel Requirements to Inventory</p>
                </div>
                <div className="absolute right-0 top-0 w-24 h-24 rounded-full bg-slate-50 -mr-6 -mt-6 group-hover:scale-110 transition-transform"></div>
              </div>

              {/* Card 2: Sync Checklist */}
              <div
                onClick={() => setActiveTab("checklist")}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all cursor-pointer min-h-[160px] relative overflow-hidden group"
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white mb-6 text-xl shadow-md bg-pink-600 shadow-pink-100">
                  <FiCheckCircle />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Sync Checklist</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Verify Sync Statuses & Rate Revisions</p>
                </div>
                <div className="absolute right-0 top-0 w-24 h-24 rounded-full bg-slate-50 -mr-6 -mt-6 group-hover:scale-110 transition-transform"></div>
              </div>

              {/* Card 3: Buyer History */}
              <div
                onClick={() => setActiveTab("buyers")}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all cursor-pointer min-h-[160px] relative overflow-hidden group"
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white mb-6 text-xl shadow-md bg-amber-500 shadow-amber-100">
                  <FiUsers />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Buyer History</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Audit Rate Logs & Quote Timelines</p>
                </div>
                <div className="absolute right-0 top-0 w-24 h-24 rounded-full bg-slate-50 -mr-6 -mt-6 group-hover:scale-110 transition-transform"></div>
              </div>

              {/* Card 4: Sheet Library */}
              <div
                onClick={() => setActiveTab("sheets")}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all cursor-pointer min-h-[160px] relative overflow-hidden group"
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white mb-6 text-xl shadow-md bg-blue-600 shadow-blue-100">
                  <FiDatabase />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Sheet Library</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Resume Mappings & Manage Worksheets</p>
                </div>
                <div className="absolute right-0 top-0 w-24 h-24 rounded-full bg-slate-50 -mr-6 -mt-6 group-hover:scale-110 transition-transform"></div>
              </div>

              {/* Card 5: Master List */}
              <div
                onClick={() => setActiveTab("master")}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all cursor-pointer min-h-[160px] relative overflow-hidden group"
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white mb-6 text-xl shadow-md bg-emerald-600 shadow-emerald-100">
                  <FiList />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Master List</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Directory of Mapped Inventory Items</p>
                </div>
                <div className="absolute right-0 top-0 w-24 h-24 rounded-full bg-slate-50 -mr-6 -mt-6 group-hover:scale-110 transition-transform"></div>
              </div>
            </div>
          )}

          {/* =================== TAB 1: UPLOAD & MAP SHEET =================== */}
          {activeTab === "upload" && (
            <div className="space-y-6">

              {/* Excel Upload Card (Full width) */}
              <div className="bg-[var(--gem-card)] p-6 rounded-2xl border border-[var(--gem-border)] shadow-xl flex flex-col justify-between gem-sync-card">
                <div>
                  <h3 className="text-xs font-black text-[var(--gem-text-secondary)] uppercase tracking-widest flex items-center gap-2 mb-4">
                    <FiUploadCloud className="text-blue-500" /> Upload Excel File
                  </h3>
                  <p className="text-[var(--gem-text-secondary)] text-xs mb-4">
                    Upload your client's Excel sheet containing their required items. The sheet should contain columns like <b>item name</b>, <b>specification</b>, <b>quantity</b>, <b>unit</b>, and <b>remark</b>.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-center">
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleExcelUpload}
                    className="hidden"
                    ref={fileInputRef}
                  />

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full sm:w-auto flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl font-black text-xs uppercase tracking-wider transition-all border bg-[var(--gem-table-header)] text-[var(--gem-text-primary)] border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] cursor-pointer"
                  >
                    <FiUploadCloud size={16} /> {fileName ? "Change Sheet" : "Choose Excel Sheet"}
                  </button>

                  {fileName && (
                    <button
                      onClick={handleClearSheet}
                      className="w-full sm:w-auto flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl font-black text-xs uppercase tracking-wider transition-all border bg-red-955/40 text-red-400 border-red-900/35 hover:bg-red-955/60 cursor-pointer"
                    >
                      Clear Sheet
                    </button>
                  )}

                  {fileName && (
                    <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 py-1.5 px-3 rounded-lg border border-emerald-500/20 truncate max-w-xs">
                      ✓ Loaded: {fileName}
                    </span>
                  )}
                </div>
              </div>

              {/* Uploaded rows matching table */}
              {uploadedRows.length > 0 && (
                <div className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">

                  {/* Table title bar */}
                  <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                    <div>
                      <h3 className="font-black text-sm uppercase tracking-wider text-[var(--gem-text-primary)]">Requirement Mapping Console</h3>
                      <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Map each uploaded requirement row to your inventory items and select which Firm handles them.</p>
                    </div>

                    <button
                      onClick={handleDownloadFilledExcel}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                      <FiDownload /> Download Filled Excel
                    </button>
                  </div>

                  {/* Excel Sheet Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-black uppercase tracking-wider border-b border-[var(--gem-border)]">
                          <th className="py-4 px-4 text-center w-12 min-w-[48px]">#</th>
                          <th className="py-4 px-4 min-w-[200px]">Uploaded Requirement</th>
                          <th className="py-4 px-4 text-center w-24 min-w-[96px]">Req. Qty</th>
                          <th className="py-4 px-4 w-[360px] min-w-[360px]">Inventory Mapping</th>
                          <th className="py-4 px-4 w-[180px] min-w-[180px]">Firm Selection</th>
                          <th className="py-4 px-4 w-[120px] min-w-[120px]">Rate (₹)</th>
                          <th className="py-4 px-4 w-[120px] min-w-[120px]">Avail gem stock</th>
                          <th className="py-4 px-4 w-[100px] min-w-[100px]">Min Qty</th>
                          <th className="py-4 px-4 w-[200px] min-w-[200px]">GeM Link</th>
                          <th className="py-4 px-4 text-center w-[120px] min-w-[120px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--gem-border)]/60">
                        {uploadedRows.map((row) => {
                          const isMatched = !!row.mappedItemId;
                          const mappedItem = allItemsList.find(i => i._id === row.mappedItemId);

                          // Extract optional original row fields
                          const origRow = originalExcelData[row.index] || {};
                          const specification = origRow["Specification"] || origRow["specification"] || origRow["Spec"] || origRow["spec"] || "";
                          const unit = origRow["Unit"] || origRow["unit"] || "";
                          const remark = origRow["Remark"] || origRow["remark"] || "";

                          // Duplicate rate warning check
                          const duplicateWarning = checkDuplicateRateWarning(row.mappedItemId, row.rate, row.firmCode);

                          // Returning buyer history hint
                          const lastQuoted = getLastQuotedHint(row.mappedItemId, selectedBuyerId);

                          return (
                            <tr key={row.index} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">

                              <td className="py-4 px-4 text-center text-[var(--gem-text-secondary)] font-mono min-w-[48px]">{row.index + 1}</td>

                              <td className="py-4 px-4 min-w-[200px]">
                                <span className="font-bold text-[var(--gem-text-primary)] block">{row.originalName}</span>
                                {specification && <span className="text-[10px] text-[var(--gem-text-secondary)] mt-1 block"><b>Spec:</b> {specification}</span>}
                                {remark && <span className="text-[10px] text-[var(--gem-text-secondary)] mt-0.5 block"><b>Remark:</b> {remark}</span>}
                                {row.rate > 0 && <span className="text-[10px] text-[var(--gem-text-secondary)] mt-0.5 block">Original Rate: ₹{row.rate}</span>}
                              </td>

                              <td className="py-4 px-4 text-center font-mono font-bold text-[var(--gem-text-primary)] w-24 min-w-[96px]">
                                <div>{row.qty || "—"}</div>
                                {unit && <div className="text-[10px] text-[var(--gem-text-secondary)] font-sans mt-0.5">{unit}</div>}
                              </td>

                              <td className="py-4 px-4 w-[360px] min-w-[360px]">
                                <div className="space-y-1.5">
                                  {!isMatched && (
                                    <span className="text-[10px] font-black tracking-wider uppercase text-amber-500 bg-amber-500/10 py-1 px-2.5 rounded-md border border-amber-500/20 inline-flex items-center gap-1">
                                      <FiAlertTriangle /> New / Unmatched
                                    </span>
                                  )}

                                  <div className="flex gap-2">
                                    <input
                                      key={row.mappedItemId}
                                      type="text"
                                      list={`stock-options-${row.index}`}
                                      placeholder="Search or select stock..."
                                      className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg p-2 focus:outline-none focus:border-blue-500 flex-1"
                                      defaultValue={mappedItem ? `${mappedItem.sku} - ${mappedItem.itemName}` : ""}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (!val) {
                                          setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, mappedItemId: "" } : r));
                                          return;
                                        }
                                        const match = allItemsList.find(item =>
                                          `${item.sku} - ${item.itemName}` === val ||
                                          item.itemName === val
                                        );
                                        if (match) {
                                          // Auto-fill from first found Master List listing
                                          const matchedListing = listings.find(lst => lst.itemId === match._id);
                                          if (matchedListing) {
                                             const syncDate = new Date(matchedListing.date || new Date().toISOString());
                                            const daysSinceSync = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60 * 24);
                                            const initialStock = daysSinceSync > 30 ? 0 : (matchedListing.availGemStock || 0);

                                            setUploadedRows(prev => prev.map(r => r.index === row.index ? { 
                                              ...r, 
                                              mappedItemId: match._id,
                                              firmCode: matchedListing.firmCode,
                                              rate: matchedListing.rate,
                                              availGemStock: initialStock,
                                              minQty: matchedListing.minQty || 1,
                                              gemLink: matchedListing.gemLink || ""
                                            } : r));
                                          } else {
                                            setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, mappedItemId: match._id } : r));
                                          }
                                        }
                                      }}
                                    />
                                    <datalist id={`stock-options-${row.index}`}>
                                      {allItemsList.map((item, idx) => (
                                        <option key={item._id || idx} value={`${item.sku} - ${item.itemName}`} />
                                      ))}
                                    </datalist>

                                    {!isMatched && (
                                      <button
                                        onClick={() => {
                                          setUnmatchedIndex(row.index);
                                          setNewUnmatchedItem({
                                            name: row.originalName,
                                            firmCode: "",
                                            gemLink: "",
                                            rate: String(row.rate || ""),
                                            minQty: "1"
                                          });
                                        }}
                                        className="bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/30 font-black p-2 rounded-lg transition-colors flex items-center justify-center"
                                        title="Create item organically"
                                      >
                                        <FiPlus />
                                      </button>
                                    )}
                                  </div>

                                  {/* Quick Fill Options from Master List */}
                                  {isMatched && (
                                    (() => {
                                      const previousListings = listings.filter(l => l.itemId === row.mappedItemId);
                                      if (previousListings.length > 0) {
                                        return (
                                          <div className="flex flex-wrap gap-1 mt-1.5 p-1.5 bg-[var(--gem-table-header)]/40 rounded-lg border border-[var(--gem-border)]">
                                            <span className="text-[9px] font-black text-amber-500/80 uppercase tracking-widest block w-full mb-1">Quick Fill from Master List:</span>
                                            {previousListings.map(prev => (
                                              <button
                                                key={prev.id}
                                                type="button"
                                                onClick={() => {
                                                  const syncDate = new Date(prev.date || new Date().toISOString());
                                                  const daysSinceSync = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60 * 24);
                                                  const initialStock = daysSinceSync > 30 ? 0 : (prev.availGemStock || 0);

                                                  setUploadedRows(prevRows => prevRows.map(r => r.index === row.index ? {
                                                    ...r,
                                                    firmCode: prev.firmCode,
                                                    rate: prev.rate,
                                                    availGemStock: initialStock,
                                                    minQty: prev.minQty || 1,
                                                    gemLink: prev.gemLink || ""
                                                  } : r));
                                                }}
                                                className="bg-[var(--gem-card)]/70 hover:bg-[var(--gem-table-row-hover)] text-blue-400 hover:text-blue-300 border border-[var(--gem-border)]/60 hover:border-blue-700/40 text-[9px] py-1 px-2 rounded-md font-bold transition-all gem-sync-inner-card"
                                              >
                                                {prev.firmCode}: ₹{prev.rate}
                                              </button>
                                            ))}
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()
                                  )}

                                  {/* Last Quoted Hint */}
                                  {isMatched && lastQuoted && (
                                    <span className="text-[10px] text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/10 display inline-block">
                                      Last Quote: ₹{lastQuoted.rate} (Min {lastQuoted.minQty}) on {lastQuoted.date}
                                    </span>
                                  )}
                                </div>

                                {/* Inline resolution Form */}
                                {unmatchedIndex === row.index && (
                                  <div className="mt-4 p-4 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl space-y-3">
                                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Organically Add New Item</h4>

                                    <div className="space-y-2">
                                      <input
                                        type="text"
                                        placeholder="Confirm Item Name..."
                                        value={newUnmatchedItem.name}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, name: e.target.value }))}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)]"
                                      />

                                      <select
                                        value={newUnmatchedItem.firmCode}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, firmCode: e.target.value }))}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)]"
                                      >
                                        <option value="">Select Firm...</option>
                                        {companies.map((c, idx) => (
                                          <option key={c._id || idx} value={c.firmCode}>{c.firmCode} - {c.firmName}</option>
                                        ))}
                                      </select>

                                      <input
                                        type="text"
                                        placeholder="Paste GeM Listing URL..."
                                        value={newUnmatchedItem.gemLink}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, gemLink: e.target.value }))}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)]"
                                      />

                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="number"
                                          placeholder="Quote Rate (₹)"
                                          value={newUnmatchedItem.rate}
                                          onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, rate: e.target.value }))}
                                          className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)] font-mono"
                                        />
                                        <input
                                          type="number"
                                          placeholder="Min Qty"
                                          value={newUnmatchedItem.minQty}
                                          onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, minQty: e.target.value }))}
                                          className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-lg p-2 text-xs text-[var(--gem-text-primary)] font-mono"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex gap-2 justify-end">
                                      <button
                                        onClick={() => setUnmatchedIndex(null)}
                                        className="px-3 py-1.5 rounded-lg border border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] text-[10px] uppercase font-bold"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => saveUnmatchedItem(row.index)}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-[10px] uppercase font-black"
                                      >
                                        Create & Map
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>

                              <td className="py-4 px-4 w-[180px] min-w-[180px]">
                                <select
                                  value={row.firmCode}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, firmCode: e.target.value } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg p-2 focus:outline-none focus:border-blue-500 w-full"
                                >
                                  <option value="">Select Firm...</option>
                                  {companies.map((c, idx) => (
                                    <option key={c._id || idx} value={c.firmCode}>{c.firmCode} - {c.firmName}</option>
                                  ))}
                                </select>
                              </td>

                              <td className="py-4 px-4 font-mono w-[120px] min-w-[120px]">
                                <div className="space-y-1">
                                  <input
                                    type="number"
                                    value={row.rate || ""}
                                    onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, rate: parseFloat(e.target.value) || 0 } : r))}
                                    className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
                                    placeholder="0.00"
                                  />

                                  {/* Duplicate rate warning */}
                                  {duplicateWarning && (
                                    <span
                                      className="text-[9px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/10 block font-sans cursor-help"
                                      title={duplicateWarning.message}
                                    >
                                      ⚠️ Diff Rate in {duplicateWarning.firmCode}: ₹{duplicateWarning.rate}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-4 px-4 font-mono w-[120px] min-w-[120px]">
                                <input
                                  type="number"
                                  value={row.availGemStock || ""}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, availGemStock: parseInt(e.target.value) || 0 } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="0"
                                />
                              </td>

                              <td className="py-4 px-4 font-mono w-[100px] min-w-[100px]">
                                <input
                                  type="number"
                                  value={row.minQty}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, minQty: parseInt(e.target.value) || 1 } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs font-bold text-[var(--gem-text-primary)] rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="1"
                                />
                              </td>

                              <td className="py-4 px-4 w-[200px] min-w-[200px]">
                                <input
                                  type="text"
                                  value={row.gemLink}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, gemLink: e.target.value } : r))}
                                  className="bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-xs text-[var(--gem-text-primary)] rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="GeM Link..."
                                />
                              </td>

                              <td className="py-4 px-4 text-center w-[120px] min-w-[120px]">
                                {listings.some(lst =>
                                  lst.buyerId === selectedBuyerId &&
                                  lst.itemId === row.mappedItemId &&
                                  lst.firmCode === row.firmCode &&
                                  row.mappedItemId &&
                                  row.firmCode
                                ) ? (
                                  <button
                                    onClick={() => handleConfirmMapping(row)}
                                    className="bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/30 font-bold text-[10px] tracking-wider uppercase py-2 px-3.5 rounded-lg w-full transition-colors"
                                  >
                                    ✓ Linked
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleConfirmMapping(row)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] tracking-wider uppercase py-2 px-3.5 rounded-lg transition-colors w-full"
                                  >
                                    Link Row
                                  </button>
                                )}
                              </td>

                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                </div>
              )}
            </div>
          )}

          {/* =================== TAB 2: PER-FIRM SYNC CHECKLIST =================== */}
          {activeTab === "checklist" && (
            <div className="space-y-6">
              {(() => {
                const firmsToShow = companies.filter(firm => {
                  const allFirmListings = listings.filter(l => l.firmCode === firm.firmCode);
                  if (showAllSynced) {
                    return allFirmListings.length > 0;
                  } else {
                    return allFirmListings.some(l => l.status === "Pending");
                  }
                });

                if (firmsToShow.length === 0) {
                  return (
                    <div className="p-12 text-center text-[var(--gem-text-secondary)] bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl gem-sync-card">
                      <FiCheckCircle size={32} className="mx-auto text-emerald-500 mb-2" />
                      <p className="text-xs font-bold text-[var(--gem-text-primary)]">✓ All items are fully synced across all firms!</p>
                    </div>
                  );
                }

                return firmsToShow.map(firm => {
                  const allFirmListings = listings.filter(l => l.firmCode === firm.firmCode);
                  const displayListings = showAllSynced 
                    ? allFirmListings 
                    : allFirmListings.filter(l => l.status === "Pending");
                  const syncedCount = allFirmListings.filter(l => l.status === "Synced").length;

                  return (
                    <div key={firm._id} className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">

                      {/* Header */}
                      <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex justify-between items-center">
                        <div>
                          <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider">
                            {firm.firmCode} — {firm.firmName}
                          </h3>
                          <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Checklist of items ready to be synced to GeM Marketplace portal.</p>
                        </div>

                        <div className="text-right flex items-center gap-3">
                          <button
                            onClick={() => setShowAllSynced(!showAllSynced)}
                            className="text-[10px] font-black uppercase tracking-wider bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-primary)] border border-[var(--gem-border)] hover:border-[var(--gem-border)] py-1.5 px-3.5 rounded-lg transition-all cursor-pointer"
                          >
                            {showAllSynced ? "Hide Synced" : "Show All"}
                          </button>
                          <span className="text-xs font-mono font-bold bg-blue-500/10 text-blue-400 py-1.5 px-3 rounded-lg border border-blue-500/20">
                            {syncedCount} / {allFirmListings.length} Synced
                          </span>
                        </div>
                      </div>

                      {/* Table list */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                              <th className="py-3 px-4 text-center w-12">Sync</th>
                              <th className="py-3 px-4">Item Name</th>
                              <th className="py-3 px-4">GeM Product URL</th>
                              <th className="py-3 px-4 text-center w-36">Rate</th>
                              <th className="py-3 px-4 text-center w-32">Avail gem stock</th>
                              <th className="py-3 px-4 text-center w-28">Min Qty</th>
                              <th className="py-3 px-4 text-center w-40">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--gem-border)]/40">
                            {displayListings.map(lst => (
                              <tr key={lst.id} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                                <td className="py-3.5 px-4 text-center">
                                  <input
                                    type="checkbox"
                                    checked={lst.status === "Synced"}
                                    onChange={() => toggleSyncStatus(lst.id)}
                                    className="w-4.5 h-4.5 rounded bg-[var(--gem-table-header)] border-[var(--gem-border)] text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                                  />
                                </td>

                                <td className="py-3.5 px-4">
                                  <span className="font-bold text-[var(--gem-text-primary)]">{lst.itemName}</span>
                                </td>

                                <td className="py-3.5 px-4">
                                  {lst.gemLink ? (
                                    <div className="flex items-center gap-2">
                                      <a
                                        href={lst.gemLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-400 hover:underline flex items-center gap-1"
                                      >
                                        GeM Listing <FiExternalLink size={12} />
                                      </a>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(lst.gemLink);
                                          alert("✓ Link copied to clipboard!");
                                        }}
                                        className="p-1 rounded bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] border border-[var(--gem-border)] transition-colors cursor-pointer"
                                        title="Copy Link"
                                      >
                                        <FiCopy size={11} />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[var(--gem-text-secondary)] italic">No link provided</span>
                                  )}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono font-bold text-[var(--gem-text-primary)]">
                                  ₹{lst.rate}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono text-[var(--gem-text-primary)]">
                                  {lst.availGemStock || 0}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono text-[var(--gem-text-primary)]">
                                  {lst.minQty}
                                </td>

                                <td className="py-3.5 px-4 text-center">
                                  <div className="flex gap-2 justify-center">
                                    <button
                                      onClick={() => handleOpenRevision(lst)}
                                      className="bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-amber-500 border border-[var(--gem-border)] hover:border-amber-500/30 text-[10px] font-black tracking-wider uppercase py-1.5 px-3.5 rounded-lg transition-all flex items-center justify-center gap-1.5"
                                    >
                                      <FiEdit size={12} /> Revise Rate
                                    </button>
                                    <button
                                      onClick={() => handleDeleteListing(lst.id)}
                                      className="bg-red-955/20 hover:bg-red-950/40 text-red-400 border border-red-900/30 hover:border-red-500/30 text-[10px] font-black tracking-wider uppercase py-1.5 px-3 rounded-lg transition-all flex items-center justify-center"
                                      title="Delete Listing"
                                    >
                                      <FiTrash2 size={12} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* =================== TAB 3: BUYER HISTORY =================== */}
          {activeTab === "buyers" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

              {/* Buyers list */}
              <div className="bg-[var(--gem-card)] p-6 rounded-2xl border border-[var(--gem-border)] shadow-xl space-y-4 gem-sync-card">
                <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                  <FiUsers className="text-blue-500" /> Buyers Directories
                </h3>

                <div className="space-y-2">
                  {buyers.length === 0 ? (
                    <p className="text-[var(--gem-text-secondary)] text-xs text-center py-4">No buyers stored yet.</p>
                  ) : (
                    buyers.map(b => (
                      <button
                        key={b.id}
                        onClick={() => setSelectedHistoryBuyerId(b.id)}
                        className={`w-full text-left py-3 px-4 rounded-xl text-xs font-bold transition-all border ${selectedHistoryBuyerId === b.id ? "bg-blue-600/10 text-blue-400 border-blue-600/30" : "text-[var(--gem-text-primary)] hover:bg-[var(--gem-table-row-hover)] border-[var(--gem-border)]"}`}
                      >
                        {b.name}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Selected buyer history timeline */}
              <div className="lg:col-span-2 bg-[var(--gem-card)] p-6 rounded-2xl border border-[var(--gem-border)] shadow-xl min-h-[400px] gem-sync-card">
                {selectedHistoryBuyerId ? (
                  <div className="space-y-6">

                    {/* Title */}
                    <div>
                      <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider">
                        Rate Log & Quote Timeline: {buyers.find(b => b.id === selectedHistoryBuyerId)?.name}
                      </h3>
                      <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Audit log of all quotes, rate updates, and negotiations for this buyer.</p>
                    </div>

                    {/* Timeline items */}
                    {rateHistory.filter(hist => hist.buyerId === selectedHistoryBuyerId).length === 0 ? (
                      <p className="text-[var(--gem-text-secondary)] text-xs py-8 text-center">No quote or rate change history exists for this buyer yet.</p>
                    ) : (
                      <div className="relative border-l-2 border-[var(--gem-border)] ml-4 pl-6 space-y-8">
                        {rateHistory
                          .filter(hist => hist.buyerId === selectedHistoryBuyerId)
                          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                          .map(hist => (
                            <div key={hist.id} className="relative">
                              {/* Circle icon marker */}
                              <div className="absolute -left-10.5 top-0.5 bg-[var(--gem-table-header)] border-2 border-blue-500 w-4.5 h-4.5 rounded-full flex items-center justify-center">
                                <div className="bg-blue-500 w-1.5 h-1.5 rounded-full" />
                              </div>

                              <div className="bg-[var(--gem-table-header)]/40 p-4 rounded-xl border border-[var(--gem-border)] space-y-2">
                                <div className="flex justify-between items-start">
                                  <h4 className="font-bold text-[var(--gem-text-primary)]">{hist.itemName}</h4>
                                  <span className="text-[10px] text-[var(--gem-text-secondary)] font-mono">
                                    {formatDate(hist.timestamp)}
                                  </span>
                                </div>

                                <div className="flex gap-6 items-baseline mt-2">
                                  {hist.oldRate > 0 ? (
                                    <div className="text-xs text-[var(--gem-text-secondary)]">
                                      Rate: <span className="line-through font-mono">₹{hist.oldRate}</span> → <span className="font-mono text-emerald-400 font-bold">₹{hist.newRate}</span>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-[var(--gem-text-primary)]">
                                      Initial Quote: <span className="font-mono text-emerald-400 font-bold">₹{hist.newRate}</span>
                                    </div>
                                  )}

                                  <div className="text-xs text-[var(--gem-text-secondary)]">
                                    Min Qty: <span className="font-mono">{hist.newMinQty}</span>
                                  </div>
                                </div>

                                <p className="text-[var(--gem-text-secondary)] text-xs italic bg-[var(--gem-table-header)] p-2 rounded-lg border border-[var(--gem-border)] mt-2">
                                  "{hist.reason}"
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center text-[var(--gem-text-secondary)] space-y-3">
                    <FiUsers size={32} />
                    <p className="text-xs">Please select a buyer from the left directory to view their history timeline.</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* =================== TAB 4: SHEET LIBRARY =================== */}
          {activeTab === "sheets" && (
            <div className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden">
              <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)]/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                    <FiDatabase className="text-blue-500" /> Uploaded Sheets Library
                  </h3>
                  <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Select and open any previously uploaded requirement sheet, or delete outdated ones.</p>
                </div>

                {/* Filter Tabs & Search Bar inside Sheet Library */}
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                  {/* Status Filter Tabs */}
                  <div className="flex bg-[var(--gem-table-header)] p-1 rounded-xl border border-[var(--gem-border)]">
                    <button
                      type="button"
                      onClick={() => setSheetStatusFilter("current")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                        sheetStatusFilter === "current"
                          ? "bg-blue-600 text-white shadow-md"
                          : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      Current ({sheets.filter(s => !s.isCompleted).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetStatusFilter("completed")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                        sheetStatusFilter === "completed"
                          ? "bg-emerald-600 text-white shadow-md"
                          : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      Completed ({sheets.filter(s => !!s.isCompleted).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetStatusFilter("all")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                        sheetStatusFilter === "all"
                          ? "bg-[var(--gem-table-header)] text-[var(--gem-text-primary)] shadow-md"
                          : "text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)]"
                      }`}
                    >
                      All ({sheets.length})
                    </button>
                  </div>

                  {/* Search bar inside Sheet Library */}
                  <div className="relative w-full sm:w-64">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-sm" />
                    <input 
                      type="text"
                      placeholder="Search sheets library..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500 font-semibold"
                      value={librarySearchQuery}
                      onChange={(e) => setLibrarySearchQuery(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {filteredSheets.length === 0 ? (
                <div className="p-12 text-center text-[var(--gem-text-secondary)] space-y-2">
                  <FiDatabase size={32} className="mx-auto text-slate-600" />
                  <p className="text-xs">No {sheetStatusFilter !== "all" ? sheetStatusFilter : ""} sheets match your criteria.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                        <th className="py-3.5 px-6">File Name</th>
                        <th className="py-3.5 px-6">Associated Buyer</th>
                        <th className="py-3.5 px-6 text-center w-36">Total Items</th>
                        <th className="py-3.5 px-6 text-center w-48">Last Saved</th>
                        <th className="py-3.5 px-6 text-center w-64">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--gem-border)]/40">
                      {filteredSheets.map(sheet => {
                        const matchedOpt = allBuyerOptions.find(b => b.id === sheet.selectedBuyerId || b.name === sheet.selectedBuyerId);
                        const displayBuyerName = matchedOpt?.name || sheet.selectedBuyerId || "Select Associated Buyer...";
                        const isSelected = !!matchedOpt || !!sheet.selectedBuyerId;
                        const isPopoverOpen = openBuyerSelectSheetId === sheet.id;

                        return (
                          <tr key={sheet.id} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                            <td className="py-4 px-6 font-bold text-[var(--gem-text-primary)]">
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSheetCompleted(sheet.id, !!sheet.isCompleted)}
                                  title={sheet.isCompleted ? "Mark as Current / Incomplete" : "Mark as Completed"}
                                  className={`p-1 rounded-lg transition-all border cursor-pointer ${
                                    sheet.isCompleted
                                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30"
                                      : "bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] border-[var(--gem-border)] hover:text-[var(--gem-text-primary)] hover:border-[var(--gem-border)]"
                                  }`}
                                >
                                  <FiCheckCircle size={17} className={sheet.isCompleted ? "text-emerald-400" : "text-slate-600"} />
                                </button>

                                <span className={sheet.isCompleted ? "line-through text-[var(--gem-text-secondary)]" : "text-[var(--gem-text-primary)]"}>
                                  {sheet.fileName}
                                </span>

                                {sheet.isCompleted && (
                                  <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    Completed
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-4 px-6 relative">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isPopoverOpen) {
                                    setOpenBuyerSelectSheetId(null);
                                  } else {
                                    setOpenBuyerSelectSheetId(sheet.id);
                                    setBuyerSearchFilter("");
                                  }
                                }}
                                className={`w-full max-w-[260px] text-left font-bold text-xs py-2 px-3.5 rounded-xl border transition-all flex items-center justify-between gap-2 shadow-sm ${
                                  isSelected
                                    ? "bg-[var(--gem-table-header)]/90 text-blue-400 border-[var(--gem-border)] hover:border-blue-500"
                                    : "bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] border-[var(--gem-border)] hover:border-[var(--gem-border)]"
                                }`}
                              >
                                <span className="truncate">{displayBuyerName}</span>
                                <FiChevronDown size={14} className={`shrink-0 transition-transform ${isPopoverOpen ? "rotate-180 text-blue-400" : "text-slate-400"}`} />
                              </button>

                              {/* Searchable Buyer Popover Dropdown */}
                              {isPopoverOpen && (
                                <>
                                  {/* Backdrop to close on click outside */}
                                  <div
                                    className="fixed inset-0 z-[90]"
                                    onClick={() => setOpenBuyerSelectSheetId(null)}
                                  />

                                  <div className="absolute left-6 top-14 z-[100] w-80 bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-2xl shadow-2xl p-3 space-y-2.5 animate-in fade-in">
                                    <div className="relative">
                                      <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gem-text-secondary)] text-xs" />
                                      <input
                                        type="text"
                                        autoFocus
                                        placeholder="Search buyer name..."
                                        value={buyerSearchFilter}
                                        onChange={(e) => setBuyerSearchFilter(e.target.value)}
                                        className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-8 pr-8 text-xs text-[var(--gem-text-primary)] outline-none focus:border-blue-500 font-semibold"
                                      />
                                      {buyerSearchFilter && (
                                        <button
                                          type="button"
                                          onClick={() => setBuyerSearchFilter("")}
                                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] p-0.5"
                                        >
                                          <FiX size={12} />
                                        </button>
                                      )}
                                    </div>

                                    <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                      {filteredBuyerOptions.length === 0 ? (
                                        <div className="p-4 text-center text-xs text-[var(--gem-text-secondary)] italic">
                                          No buyer matching "{buyerSearchFilter}"
                                        </div>
                                      ) : (
                                        filteredBuyerOptions.map(b => {
                                          const isItemActive = b.id === sheet.selectedBuyerId || b.name === displayBuyerName;
                                          return (
                                            <button
                                              key={b.id}
                                              type="button"
                                              onClick={() => {
                                                handleChangeSheetBuyer(sheet.id, b.id);
                                                setOpenBuyerSelectSheetId(null);
                                              }}
                                              className={`w-full text-left py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-2 ${
                                                isItemActive
                                                  ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                                                  : "text-[var(--gem-text-primary)] hover:bg-[var(--gem-table-row-hover)] hover:text-[var(--gem-text-primary)]"
                                              }`}
                                            >
                                              <span className="truncate">{b.name}</span>
                                              {isItemActive && (
                                                <FiCheck size={14} className="text-blue-400 shrink-0" />
                                              )}
                                            </button>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="py-4 px-6 text-center font-mono font-bold text-[var(--gem-text-primary)]">{sheet.uploadedRows?.length || 0}</td>
                            <td className="py-4 px-6 text-center font-mono text-[var(--gem-text-secondary)]">
                              {sheet.updatedAt ? formatDate(sheet.updatedAt) : "—"}
                            </td>
                            <td className="py-4 px-6 text-center">
                              <div className="flex gap-2 justify-center">
                                <button
                                  onClick={() => {
                                    setActiveSheetId(sheet.id);
                                    setFileName(sheet.fileName);
                                    setUploadedRows(sheet.uploadedRows);
                                    setOriginalExcelData(sheet.originalExcelData);
                                    setSelectedBuyerId(sheet.selectedBuyerId);
                                    setActiveTab("upload"); // Switch to mapping view
                                  }}
                                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] tracking-wider uppercase py-2 px-3.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                >
                                  Resume Mapping
                                </button>
                                <button
                                  onClick={() => handleDeleteSheet(sheet.id)}
                                  className="bg-red-955/20 hover:bg-red-950/40 text-red-400 border border-red-900/30 hover:border-red-500/30 text-[10px] font-black tracking-wider uppercase py-2 px-3 rounded-lg transition-all flex items-center justify-center"
                                  title="Delete Sheet"
                                >
                                  <FiTrash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* =================== TAB 5: MASTER LIST =================== */}
          {activeTab === "master" && (
            <div className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">
              <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 w-full sm:w-auto mb-3 sm:mb-0">
                  <div>
                    <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                      <FiList className="text-blue-500" /> Master Mapped Listings
                    </h3>
                    <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Consolidated record of all items mapped and linked to firms across all uploaded sheets.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCleanupDuplicates}
                    className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:border-amber-500/50 py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shrink-0 shadow-sm"
                    title="Clean up existing duplicate listings in MongoDB"
                  >
                    <FiTrash2 size={13} /> Clean Duplicates
                  </button>
                </div>
                
                {/* Separate Search Inputs */}
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <div className="relative w-full sm:w-48">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-xs" />
                    <input 
                      type="text"
                      placeholder="Search Item / SKU..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                      value={masterItemSearch}
                      onChange={(e) => setMasterItemSearch(e.target.value)}
                    />
                  </div>
                  <div className="relative w-full sm:w-40">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-xs" />
                    <input 
                      type="text"
                      placeholder="Search Firm..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                      value={masterFirmSearch}
                      onChange={(e) => setMasterFirmSearch(e.target.value)}
                    />
                  </div>
                  <div className="relative w-full sm:w-48">
                    <FiSearch className="absolute left-3.5 top-3 text-[var(--gem-text-secondary)] text-xs" />
                    <input 
                      type="text"
                      placeholder="Search GeM URL..."
                      className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-9 pr-4 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                      value={masterUrlSearch}
                      onChange={(e) => setMasterUrlSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {filteredMasterListings.length === 0 ? (
                <div className="p-12 text-center text-[var(--gem-text-secondary)] space-y-2">
                  <FiList size={32} className="mx-auto text-slate-600" />
                  <p className="text-xs">No mapped listings found in the master list.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                        <th className="py-3.5 px-6">SKU / Item Name</th>
                        <th className="py-3.5 px-6">Firm</th>
                        <th className="py-3.5 px-6 text-center w-32">Rate</th>
                        <th className="py-3.5 px-6 text-center w-36">Avail gem stock</th>
                        <th className="py-3.5 px-6 text-center w-28">Min Qty</th>
                        <th className="py-3.5 px-6">Linked Buyer</th>
                        <th className="py-3.5 px-6">GeM URL</th>
                        <th className="py-3.5 px-6 text-center w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--gem-border)]/40">
                      {filteredMasterListings.map((lst, idx) => {
                        const buyerName = buyers.find(b => b.id === lst.buyerId)?.name || "Unassigned";
                        const inventoryItem = allItemsList.find(i => i._id === lst.itemId);
                        const rowSpan = masterRowSpans[idx];
                        
                        return (
                          <tr key={lst.id} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                            {rowSpan > 0 && (
                              <td className="py-4 px-6 border-r border-[var(--gem-border)]/40 bg-[var(--gem-table-header)]/10 align-middle" rowSpan={rowSpan}>
                                <span className="text-[10px] font-mono text-[var(--gem-text-secondary)] block mb-0.5">{inventoryItem?.sku || "CUSTOM"}</span>
                                <span className="font-bold text-[var(--gem-text-primary)] block">{lst.itemName}</span>
                              </td>
                            )}
                            <td className="py-4 px-6">
                              <span className="bg-[var(--gem-table-header)] py-1 px-2.5 rounded-lg border border-[var(--gem-border)] text-[11px] font-bold text-[var(--gem-text-primary)]">
                                {lst.firmCode}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center font-mono font-bold text-[var(--gem-text-primary)]">₹{lst.rate}</td>
                            <td className="py-4 px-6 text-center font-mono text-[var(--gem-text-primary)]">{lst.availGemStock || 0}</td>
                            <td className="py-4 px-6 text-center font-mono text-[var(--gem-text-primary)]">{lst.minQty}</td>
                            <td className="py-4 px-6 text-[var(--gem-text-secondary)]">{buyerName}</td>
                            <td className="py-4 px-6">
                              {lst.gemLink ? (
                                <div className="flex items-center gap-2">
                                  <a 
                                    href={lst.gemLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-400 hover:underline flex items-center gap-1"
                                  >
                                    GeM Listing <FiExternalLink size={12} />
                                  </a>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(lst.gemLink);
                                      alert("✓ Link copied to clipboard!");
                                    }}
                                    className="p-1 rounded bg-[var(--gem-table-header)] hover:bg-[var(--gem-table-row-hover)] text-[var(--gem-text-secondary)] hover:text-[var(--gem-text-primary)] border border-[var(--gem-border)] transition-colors cursor-pointer"
                                    title="Copy Link"
                                  >
                                    <FiCopy size={11} />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[var(--gem-text-secondary)] italic">No link</span>
                              )}
                            </td>
                            <td className="py-4 px-6 text-center">
                              <button
                                onClick={() => handleDeleteListing(lst.id)}
                                className="bg-red-955/20 hover:bg-red-950/40 text-red-400 border border-red-900/30 hover:border-red-500/30 text-[10px] font-black tracking-wider uppercase py-1.5 px-3 rounded-lg transition-all flex items-center justify-center mx-auto"
                                title="Unlink / Delete Listing"
                              >
                                <FiTrash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* =================== REVISION DIALOG MODAL =================== */}
          {isRevisionOpen && selectedListingForRevision && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-[var(--gem-card)] border border-[var(--gem-border)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 gem-sync-card">

                {/* Header */}
                <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)]">
                  <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                    <FiClock className="text-amber-500" /> Revise Rate (Buyer Negotiated)
                  </h3>
                  <p className="text-xs text-[var(--gem-text-secondary)] mt-1">Log negotiation revision details for: {selectedListingForRevision.itemName}</p>
                </div>

                {/* Form fields */}
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">New Rate (₹)</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono"
                        value={newRateValue}
                        onChange={(e) => setNewRateValue(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">New Min Qty</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono"
                        value={newMinQtyValue}
                        onChange={(e) => setNewMinQtyValue(e.target.value)}
                        placeholder="1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">GeM Product URL</label>
                      <input
                        type="text"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)]"
                        value={newGemLinkValue}
                        onChange={(e) => setNewGemLinkValue(e.target.value)}
                        placeholder="Paste GeM Listing URL..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Avail GeM Stock</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] font-mono"
                        value={newAvailGemStockValue}
                        onChange={(e) => setNewAvailGemStockValue(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-[var(--gem-text-secondary)] uppercase tracking-widest block mb-2">Reason for Revision</label>
                    <textarea
                      rows={3}
                      className="w-full p-3 bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl text-sm text-[var(--gem-text-primary)] focus:outline-none"
                      value={revisionReason}
                      onChange={(e) => setRevisionReason(e.target.value)}
                      placeholder="e.g. buyer requested lower price for bulk order..."
                    />
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="p-6 border-t border-[var(--gem-border)] bg-[var(--gem-table-header)]/20 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setIsRevisionOpen(false);
                      setSelectedListingForRevision(null);
                    }}
                    className="px-5 py-2.5 rounded-lg border border-[var(--gem-border)] hover:bg-[var(--gem-table-row-hover)] text-xs uppercase font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveRevision}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-lg text-xs uppercase font-black"
                  >
                    Confirm Revision
                  </button>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>
    </BlockGuard>
  );
}
