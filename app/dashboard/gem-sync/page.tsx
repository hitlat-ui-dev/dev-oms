"use client";
import * as XLSX from "xlsx";
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
  FiList
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

  // Local state (persisted in localStorage)
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [listings, setListings] = useState<FirmItemListing[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);
  const [customItems, setCustomItems] = useState<any[]>([]);

  // Page active tabs/modes
  const [activeTab, setActiveTab] = useState<"upload" | "checklist" | "buyers" | "sheets" | "master">("master");

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
  const [masterSearchQuery, setMasterSearchQuery] = useState<string>("");
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

    // 3. Fetch Shared GeM Sync State from MongoDB
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
    setListings(updatedListings);
    localStorage.setItem("oms_firm_listings", JSON.stringify(updatedListings));
    fetch("/api/gem-sync?action=save_listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedListings)
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
          // Try finding item name in columns
          const originalName = row["Item Name"] || row["Item"] || row["Name"] || row["Particulars"] || Object.values(row)[0] || "";
          const qty = Number(row["Item count"] || row["Quantity"] || row["Qty"] || row["Qty Required"] || row["Req Qty"] || 0);
          const rate = Number(row["Rate"] || row["Price"] || row["Quote Rate"] || 0);

          const mappedItemId = findFuzzyMatch(String(originalName));

          return {
            index,
            originalName: String(originalName),
            qty,
            rate,
            mappedItemId,
            firmCode: "",
            gemLink: "",
            availGemStock: 0,
            minQty: 1
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

  // Filtered Listings for Master List (Sorted by item name to group duplicates consecutively)
  const filteredMasterListings = useMemo(() => {
    let list = listings;
    if (masterSearchQuery.trim()) {
      const query = masterSearchQuery.toLowerCase();
      list = listings.filter(lst => {
        const buyerName = buyers.find(b => b.id === lst.buyerId)?.name || "";
        const inventoryItem = allItemsList.find(i => i._id === lst.itemId);
        return (
          lst.itemName.toLowerCase().includes(query) ||
          (inventoryItem?.sku && inventoryItem.sku.toLowerCase().includes(query)) ||
          lst.firmCode.toLowerCase().includes(query) ||
          buyerName.toLowerCase().includes(query)
        );
      });
    }
    return [...list].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [listings, masterSearchQuery, buyers, allItemsList]);

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

  // Filtered Sheets for Sheet Library
  const filteredSheets = useMemo(() => {
    if (!librarySearchQuery.trim()) return sheets;
    const query = librarySearchQuery.toLowerCase();
    return sheets.filter(sheet => {
      const buyerName = buyers.find(b => b.id === sheet.selectedBuyerId)?.name || "";
      return (
        sheet.fileName.toLowerCase().includes(query) ||
        buyerName.toLowerCase().includes(query)
      );
    });
  }, [sheets, librarySearchQuery, buyers]);

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

      return {
        ...row,
        "Quoted Rate (₹)": matchedListing?.rate || mappedRow?.rate || "",
        "Avail gem stock": matchedListing?.availGemStock || mappedRow?.availGemStock || 0,
        "Min Qty": matchedListing?.minQty || mappedRow?.minQty || "",
        "GeM Link": matchedListing?.gemLink || mappedRow?.gemLink || "",
        "Mapped Firm": matchedListing?.firmCode || mappedRow?.firmCode || ""
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(filledData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Quoted Requirements");
    XLSX.writeFile(workbook, `Filled_${fileName || "Requirement"}.xlsx`);
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
      <div className="p-4 md:p-8 bg-[#0b0f19] min-h-screen text-slate-100 font-sans">
        <div className="w-full mx-auto">

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-6 border-b border-slate-800">
            <div>
              <Link href="/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white text-xs mb-2 transition-colors">
                <FiArrowLeft /> Back to Dashboard
              </Link>
              <h1 className="text-3xl font-black tracking-tight text-white uppercase flex items-center gap-3">
                GeM Links Console
              </h1>
              <p className="text-slate-400 text-xs mt-1">Manage buyer requirements, upload quotes, revise rates, and checklist sync logs.</p>
            </div>

            {/* Action Tabs */}
            <div className="flex gap-1 bg-slate-900/60 p-1.5 rounded-xl border border-slate-800 self-stretch md:self-auto">
              <button
                onClick={() => setActiveTab("sheets")}
                className={`flex-1 md:flex-initial py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === "sheets" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}
              >
                <FiDatabase /> Sheet Library
              </button>
              <button
                onClick={() => setActiveTab("upload")}
                className={`flex-1 md:flex-initial py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === "upload" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}
              >
                <FiUploadCloud /> Upload Sheet
              </button>
              <button
                onClick={() => setActiveTab("checklist")}
                className={`flex-1 md:flex-initial py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === "checklist" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}
              >
                <FiCheckCircle /> Sync Checklist
              </button>
              <button
                onClick={() => setActiveTab("buyers")}
                className={`flex-1 md:flex-initial py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === "buyers" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}
              >
                <FiUsers /> Buyer History
              </button>
              <button
                onClick={() => setActiveTab("master")}
                className={`flex-1 md:flex-initial py-2.5 px-5 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === "master" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}
              >
                <FiList /> Master List
              </button>
            </div>
          </div>

          {/* =================== TAB 1: UPLOAD & MAP SHEET =================== */}
          {activeTab === "upload" && (
            <div className="space-y-6">

              {/* Buyer Selector + File upload Card */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Buyer selection */}
                <div className="bg-[#131a26] p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FiUsers className="text-blue-500" /> 1. Select / Add Buyer
                  </h3>

                  {/* Select Buyer Auto-complete list */}
                  <div className="space-y-2">
                    <div className="relative">
                      <FiSearch className="absolute left-4 top-3.5 text-slate-400 text-sm" />
                      <input
                        type="text"
                        placeholder="Search buyer..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                        value={buyerSearchQuery}
                        onChange={(e) => setBuyerSearchQuery(e.target.value)}
                      />
                    </div>

                    {/* Autocomplete list */}
                    <div className="max-h-40 overflow-y-auto bg-slate-950/80 rounded-xl border border-slate-900 p-2 space-y-1">
                      {filteredBuyers.length === 0 ? (
                        <p className="text-slate-500 text-xs p-2">No matching buyers.</p>
                      ) : (
                        filteredBuyers.map(b => (
                          <button
                            key={b.id}
                            onClick={() => {
                              setSelectedBuyerId(b.id);
                              setBuyerSearchQuery(b.name);
                            }}
                            className={`w-full text-left py-2 px-3 rounded-lg text-xs font-bold transition-all ${selectedBuyerId === b.id ? "bg-blue-600/20 text-blue-400 border border-blue-600/30" : "text-slate-300 hover:bg-slate-900"}`}
                          >
                            {b.name}
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Selected Buyer Name - Editable */}
                  {selectedBuyerId && (
                    <div className="pt-2 border-t border-slate-805/60 space-y-1.5">
                      <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest block">Selected Buyer (Rename if wrong)</label>
                      <input
                        type="text"
                        value={buyers.find(b => b.id === selectedBuyerId)?.name || ""}
                        onChange={(e) => {
                          const newName = e.target.value;
                          if (!newName.trim()) return;
                          saveBuyers(buyers.map(b => b.id === selectedBuyerId ? { ...b, name: newName } : b));
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white font-bold focus:outline-none focus:border-blue-500"
                        placeholder="Buyer Name..."
                      />
                    </div>
                  )}

                  {/* Add New Buyer */}
                  <div className="pt-2 border-t border-slate-800/60 flex gap-2">
                    <input
                      type="text"
                      placeholder="New buyer name..."
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                      value={newBuyerName}
                      onChange={(e) => setNewBuyerName(e.target.value)}
                    />
                    <button
                      onClick={handleAddBuyer}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <FiPlus /> Add
                    </button>
                  </div>
                </div>

                {/* Excel Upload Area */}
                <div className="lg:col-span-2 bg-[#131a26] p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                      <FiUploadCloud className="text-blue-500" /> 2. Upload Excel File
                    </h3>
                    <p className="text-slate-400 text-xs mb-4">
                      Upload your client's Excel sheet containing their required items. The sheet should ideally contain columns for <b>Item Name</b> and <b>Quantity</b>.
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
                      className="w-full sm:w-auto flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl font-black text-xs uppercase tracking-wider transition-all border bg-slate-950 text-slate-200 border-slate-800 hover:bg-slate-900 cursor-pointer"
                    >
                      <FiUploadCloud size={16} /> {fileName ? "Change Sheet" : "Choose Excel Sheet"}
                    </button>

                    {fileName && (
                      <button
                        onClick={handleClearSheet}
                        className="w-full sm:w-auto flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl font-black text-xs uppercase tracking-wider transition-all border bg-red-950/40 text-red-400 border-red-900/35 hover:bg-red-950/60 cursor-pointer"
                      >
                        Clear Sheet
                      </button>
                    )}

                    {fileName && (
                      <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 py-1.5 px-3 rounded-lg border border-emerald-500/20 truncate max-w-xs">
                        ✓ Loaded: {fileName}
                      </span>
                    )}

                    {!selectedBuyerId && (
                      <span className="text-xs text-slate-400 font-bold bg-slate-900 py-1.5 px-3 rounded-lg border border-slate-800">
                        Optional: Select a buyer on the left to track history.
                      </span>
                    )}
                  </div>
                </div>

              </div>

              {/* Uploaded rows matching table */}
              {uploadedRows.length > 0 && (
                <div className="bg-[#131a26] rounded-2xl border border-slate-800 shadow-xl overflow-hidden">

                  {/* Table title bar */}
                  <div className="p-6 border-b border-slate-800 bg-slate-900/40 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                    <div>
                      <h3 className="font-black text-sm uppercase tracking-wider text-white">Requirement Mapping Console</h3>
                      <p className="text-xs text-slate-400 mt-1">Map each uploaded requirement row to your inventory items and select which Firm handles them.</p>
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
                        <tr className="bg-slate-950 text-slate-400 font-black uppercase tracking-wider border-b border-slate-800">
                          <th className="py-4 px-4 text-center w-12 min-w-[48px]">#</th>
                          <th className="py-4 px-4 min-w-[200px]">Uploaded Requirement</th>
                          <th className="py-4 px-4 text-center w-24 min-w-[96px]">Req. Qty</th>
                          <th className="py-4 px-4 min-w-[240px]">Inventory Mapping</th>
                          <th className="py-4 px-4 w-[180px] min-w-[180px]">Firm Selection</th>
                          <th className="py-4 px-4 w-[120px] min-w-[120px]">Rate (₹)</th>
                          <th className="py-4 px-4 w-[120px] min-w-[120px]">Avail gem stock</th>
                          <th className="py-4 px-4 w-[100px] min-w-[100px]">Min Qty</th>
                          <th className="py-4 px-4 w-[200px] min-w-[200px]">GeM Link</th>
                          <th className="py-4 px-4 text-center w-[120px] min-w-[120px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {uploadedRows.map((row) => {
                          const isMatched = !!row.mappedItemId;
                          const mappedItem = allItemsList.find(i => i._id === row.mappedItemId);

                          // Duplicate rate warning check
                          const duplicateWarning = checkDuplicateRateWarning(row.mappedItemId, row.rate, row.firmCode);

                          // Returning buyer history hint
                          const lastQuoted = getLastQuotedHint(row.mappedItemId, selectedBuyerId);

                          return (
                            <tr key={row.index} className="hover:bg-slate-900/20 transition-colors">

                              <td className="py-4 px-4 text-center text-slate-500 font-mono min-w-[48px]">{row.index + 1}</td>

                              <td className="py-4 px-4 min-w-[200px]">
                                <span className="font-bold text-slate-200 block">{row.originalName}</span>
                                {row.rate > 0 && <span className="text-[10px] text-slate-500 mt-0.5 block">Original Rate: ₹{row.rate}</span>}
                              </td>

                              <td className="py-4 px-4 text-center font-mono font-bold text-slate-300 w-24 min-w-[96px]">{row.qty || "—"}</td>

                              <td className="py-4 px-4 min-w-[240px]">
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
                                      className="bg-slate-950 border border-slate-800 text-xs font-bold text-white rounded-lg p-2 focus:outline-none focus:border-blue-500 flex-1"
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
                                            setUploadedRows(prev => prev.map(r => r.index === row.index ? { 
                                              ...r, 
                                              mappedItemId: match._id,
                                              firmCode: matchedListing.firmCode,
                                              rate: matchedListing.rate,
                                              availGemStock: matchedListing.availGemStock || 0,
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
                                      {allItemsList.map(item => (
                                        <option key={item._id} value={`${item.sku} - ${item.itemName}`} />
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
                                          <div className="flex flex-wrap gap-1 mt-1.5 p-1.5 bg-slate-950/40 rounded-lg border border-slate-900">
                                            <span className="text-[9px] font-black text-amber-500/80 uppercase tracking-widest block w-full mb-1">Quick Fill from Master List:</span>
                                            {previousListings.map(prev => (
                                              <button
                                                key={prev.id}
                                                type="button"
                                                onClick={() => {
                                                  setUploadedRows(prevRows => prevRows.map(r => r.index === row.index ? {
                                                    ...r,
                                                    firmCode: prev.firmCode,
                                                    rate: prev.rate,
                                                    availGemStock: prev.availGemStock || 0,
                                                    minQty: prev.minQty || 1,
                                                    gemLink: prev.gemLink || ""
                                                  } : r));
                                                }}
                                                className="bg-[#1a2333]/70 hover:bg-blue-950/80 text-blue-400 hover:text-blue-300 border border-slate-800/60 hover:border-blue-700/40 text-[9px] py-1 px-2 rounded-md font-bold transition-all"
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
                                  <div className="mt-4 p-4 bg-slate-950 border border-blue-600/30 rounded-xl space-y-3">
                                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Organically Add New Item</h4>

                                    <div className="space-y-2">
                                      <input
                                        type="text"
                                        placeholder="Confirm Item Name..."
                                        value={newUnmatchedItem.name}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, name: e.target.value }))}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                                      />

                                      <select
                                        value={newUnmatchedItem.firmCode}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, firmCode: e.target.value }))}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-300"
                                      >
                                        <option value="">Select Firm...</option>
                                        {companies.map(c => (
                                          <option key={c._id} value={c.firmCode}>{c.firmCode} - {c.firmName}</option>
                                        ))}
                                      </select>

                                      <input
                                        type="text"
                                        placeholder="Paste GeM Listing URL..."
                                        value={newUnmatchedItem.gemLink}
                                        onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, gemLink: e.target.value }))}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                                      />

                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="number"
                                          placeholder="Quote Rate (₹)"
                                          value={newUnmatchedItem.rate}
                                          onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, rate: e.target.value }))}
                                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                                        />
                                        <input
                                          type="number"
                                          placeholder="Min Qty"
                                          value={newUnmatchedItem.minQty}
                                          onChange={(e) => setNewUnmatchedItem(prev => ({ ...prev, minQty: e.target.value }))}
                                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex gap-2 justify-end">
                                      <button
                                        onClick={() => setUnmatchedIndex(null)}
                                        className="px-3 py-1.5 rounded-lg border border-slate-850 hover:bg-slate-900 text-[10px] uppercase font-bold"
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
                                  className="bg-slate-950 border border-slate-800 text-xs font-bold text-slate-300 rounded-lg p-2 focus:outline-none focus:border-blue-500 w-full"
                                >
                                  <option value="">Select Firm...</option>
                                  {companies.map(c => (
                                    <option key={c._id} value={c.firmCode}>{c.firmCode} - {c.firmName}</option>
                                  ))}
                                </select>
                              </td>

                              <td className="py-4 px-4 font-mono w-[120px] min-w-[120px]">
                                <div className="space-y-1">
                                  <input
                                    type="number"
                                    value={row.rate || ""}
                                    onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, rate: parseFloat(e.target.value) || 0 } : r))}
                                    className="bg-slate-950 border border-slate-800 text-xs font-bold text-white rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
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
                                  className="bg-slate-950 border border-slate-800 text-xs font-bold text-white rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="0"
                                />
                              </td>

                              <td className="py-4 px-4 font-mono w-[100px] min-w-[100px]">
                                <input
                                  type="number"
                                  value={row.minQty}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, minQty: parseInt(e.target.value) || 1 } : r))}
                                  className="bg-slate-950 border border-slate-800 text-xs font-bold text-white rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
                                  placeholder="1"
                                />
                              </td>

                              <td className="py-4 px-4 w-[200px] min-w-[200px]">
                                <input
                                  type="text"
                                  value={row.gemLink}
                                  onChange={(e) => setUploadedRows(prev => prev.map(r => r.index === row.index ? { ...r, gemLink: e.target.value } : r))}
                                  className="bg-slate-950 border border-slate-800 text-xs text-white rounded-lg p-2 w-full focus:outline-none focus:border-blue-500"
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
              {companies.map(firm => {
                const firmListings = listings.filter(l => l.firmCode === firm.firmCode);
                const syncedCount = firmListings.filter(l => l.status === "Synced").length;

                return (
                  <div key={firm._id} className="bg-[#131a26] rounded-2xl border border-slate-800 shadow-xl overflow-hidden">

                    {/* Header */}
                    <div className="p-6 border-b border-slate-800 bg-slate-900/40 flex justify-between items-center">
                      <div>
                        <h3 className="font-black text-sm text-white uppercase tracking-wider">
                          {firm.firmCode} — {firm.firmName}
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">Checklist of items ready to be synced to GeM Marketplace portal.</p>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-mono font-bold bg-blue-500/10 text-blue-400 py-1.5 px-3 rounded-lg border border-blue-500/20">
                          {syncedCount} / {firmListings.length} Synced
                        </span>
                      </div>
                    </div>

                    {/* Table list */}
                    {firmListings.length === 0 ? (
                      <p className="text-slate-500 text-xs p-6 text-center">No catalog items linked to this firm yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-950/40 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
                              <th className="py-3 px-4 text-center w-12">Sync</th>
                              <th className="py-3 px-4">Item Name</th>
                              <th className="py-3 px-4">GeM Product URL</th>
                              <th className="py-3 px-4 text-center w-36">Rate</th>
                              <th className="py-3 px-4 text-center w-32">Avail gem stock</th>
                              <th className="py-3 px-4 text-center w-28">Min Qty</th>
                              <th className="py-3 px-4 text-center w-40">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/40">
                            {firmListings.map(lst => (
                              <tr key={lst.id} className="hover:bg-slate-900/10 transition-colors">
                                <td className="py-3.5 px-4 text-center">
                                  <input
                                    type="checkbox"
                                    checked={lst.status === "Synced"}
                                    onChange={() => toggleSyncStatus(lst.id)}
                                    className="w-4.5 h-4.5 rounded bg-slate-950 border-slate-800 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                                  />
                                </td>

                                <td className="py-3.5 px-4">
                                  <span className="font-bold text-slate-200">{lst.itemName}</span>
                                </td>

                                <td className="py-3.5 px-4">
                                  {lst.gemLink ? (
                                    <a
                                      href={lst.gemLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-400 hover:underline flex items-center gap-1"
                                    >
                                      GeM Listing <FiExternalLink size={12} />
                                    </a>
                                  ) : (
                                    <span className="text-slate-500 italic">No link provided</span>
                                  )}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-200">
                                  ₹{lst.rate}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                                  {lst.availGemStock || 0}
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                                  {lst.minQty}
                                </td>

                                <td className="py-3.5 px-4 text-center">
                                  <div className="flex gap-2 justify-center">
                                    <button
                                      onClick={() => handleOpenRevision(lst)}
                                      className="bg-slate-900 hover:bg-slate-800 text-amber-500 border border-slate-800 hover:border-amber-500/30 text-[10px] font-black tracking-wider uppercase py-1.5 px-3.5 rounded-lg transition-all flex items-center justify-center gap-1.5"
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
                    )}

                  </div>
                );
              })}
            </div>
          )}

          {/* =================== TAB 3: BUYER HISTORY =================== */}
          {activeTab === "buyers" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

              {/* Buyers list */}
              <div className="bg-[#131a26] p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
                <h3 className="font-black text-sm text-white uppercase tracking-wider flex items-center gap-2">
                  <FiUsers className="text-blue-500" /> Buyers Directories
                </h3>

                <div className="space-y-2">
                  {buyers.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-4">No buyers stored yet.</p>
                  ) : (
                    buyers.map(b => (
                      <button
                        key={b.id}
                        onClick={() => setSelectedHistoryBuyerId(b.id)}
                        className={`w-full text-left py-3 px-4 rounded-xl text-xs font-bold transition-all border ${selectedHistoryBuyerId === b.id ? "bg-blue-600/10 text-blue-400 border-blue-600/30" : "text-slate-300 hover:bg-slate-900/60 border-slate-850"}`}
                      >
                        {b.name}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Selected buyer history timeline */}
              <div className="lg:col-span-2 bg-[#131a26] p-6 rounded-2xl border border-slate-800 shadow-xl min-h-[400px]">
                {selectedHistoryBuyerId ? (
                  <div className="space-y-6">

                    {/* Title */}
                    <div>
                      <h3 className="font-black text-sm text-white uppercase tracking-wider">
                        Rate Log & Quote Timeline: {buyers.find(b => b.id === selectedHistoryBuyerId)?.name}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">Audit log of all quotes, rate updates, and negotiations for this buyer.</p>
                    </div>

                    {/* Timeline items */}
                    {rateHistory.filter(hist => hist.buyerId === selectedHistoryBuyerId).length === 0 ? (
                      <p className="text-slate-500 text-xs py-8 text-center">No quote or rate change history exists for this buyer yet.</p>
                    ) : (
                      <div className="relative border-l-2 border-slate-800 ml-4 pl-6 space-y-8">
                        {rateHistory
                          .filter(hist => hist.buyerId === selectedHistoryBuyerId)
                          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                          .map(hist => (
                            <div key={hist.id} className="relative">
                              {/* Circle icon marker */}
                              <div className="absolute -left-10.5 top-0.5 bg-slate-900 border-2 border-blue-500 w-4.5 h-4.5 rounded-full flex items-center justify-center">
                                <div className="bg-blue-500 w-1.5 h-1.5 rounded-full" />
                              </div>

                              <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-855 space-y-2">
                                <div className="flex justify-between items-start">
                                  <h4 className="font-bold text-slate-200">{hist.itemName}</h4>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {formatDate(hist.timestamp)}
                                  </span>
                                </div>

                                <div className="flex gap-6 items-baseline mt-2">
                                  {hist.oldRate > 0 ? (
                                    <div className="text-xs text-slate-500">
                                      Rate: <span className="line-through font-mono">₹{hist.oldRate}</span> → <span className="font-mono text-emerald-400 font-bold">₹{hist.newRate}</span>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-300">
                                      Initial Quote: <span className="font-mono text-emerald-400 font-bold">₹{hist.newRate}</span>
                                    </div>
                                  )}

                                  <div className="text-xs text-slate-400">
                                    Min Qty: <span className="font-mono">{hist.newMinQty}</span>
                                  </div>
                                </div>

                                <p className="text-slate-400 text-xs italic bg-slate-950 p-2 rounded-lg border border-slate-900 mt-2">
                                  "{hist.reason}"
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 space-y-3">
                    <FiUsers size={32} />
                    <p className="text-xs">Please select a buyer from the left directory to view their history timeline.</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* =================== TAB 4: SHEET LIBRARY =================== */}
          {activeTab === "sheets" && (
            <div className="bg-[#131a26] rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 bg-slate-900/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="font-black text-sm text-white uppercase tracking-wider flex items-center gap-2">
                    <FiDatabase className="text-blue-500" /> Uploaded Sheets Library
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Select and open any previously uploaded requirement sheet, or delete outdated ones.</p>
                </div>

                {/* Search bar inside Sheet Library */}
                <div className="relative w-full sm:w-72">
                  <FiSearch className="absolute left-3.5 top-3 text-slate-400 text-sm" />
                  <input 
                    type="text"
                    placeholder="Search sheets library..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-blue-500"
                    value={librarySearchQuery}
                    onChange={(e) => setLibrarySearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {filteredSheets.length === 0 ? (
                <div className="p-12 text-center text-slate-500 space-y-2">
                  <FiDatabase size={32} className="mx-auto text-slate-600" />
                  <p className="text-xs">No saved sheets match your search query.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-950/40 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
                        <th className="py-3.5 px-6">File Name</th>
                        <th className="py-3.5 px-6">Associated Buyer</th>
                        <th className="py-3.5 px-6 text-center w-36">Total Items</th>
                        <th className="py-3.5 px-6 text-center w-48">Last Saved</th>
                        <th className="py-3.5 px-6 text-center w-64">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {filteredSheets.map(sheet => {
                        const buyerName = buyers.find(b => b.id === sheet.selectedBuyerId)?.name || "Unassigned";
                        return (
                          <tr key={sheet.id} className="hover:bg-slate-900/10 transition-colors">
                            <td className="py-4 px-6 font-bold text-slate-200">{sheet.fileName}</td>
                            <td className="py-4 px-6">
                              <span className="bg-slate-900 py-1 px-2.5 rounded-lg border border-slate-800 text-[11px] font-semibold text-slate-300">
                                {buyerName}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center font-mono font-bold text-slate-300">{sheet.uploadedRows?.length || 0}</td>
                            <td className="py-4 px-6 text-center font-mono text-slate-400">
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
            <div className="bg-[#131a26] rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 bg-slate-900/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="font-black text-sm text-white uppercase tracking-wider flex items-center gap-2">
                    <FiList className="text-blue-500" /> Master Mapped Listings
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Consolidated record of all items mapped and linked to firms across all uploaded sheets.</p>
                </div>
                
                {/* Search bar inside Master List */}
                <div className="relative w-full sm:w-72">
                  <FiSearch className="absolute left-3.5 top-3 text-slate-400 text-sm" />
                  <input 
                    type="text"
                    placeholder="Search master list..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-blue-500"
                    value={masterSearchQuery}
                    onChange={(e) => setMasterSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {filteredMasterListings.length === 0 ? (
                <div className="p-12 text-center text-slate-500 space-y-2">
                  <FiList size={32} className="mx-auto text-slate-600" />
                  <p className="text-xs">No mapped listings found in the master list.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-950/40 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
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
                    <tbody className="divide-y divide-slate-800/40">
                      {filteredMasterListings.map((lst, idx) => {
                        const buyerName = buyers.find(b => b.id === lst.buyerId)?.name || "Unassigned";
                        const inventoryItem = allItemsList.find(i => i._id === lst.itemId);
                        const rowSpan = masterRowSpans[idx];
                        
                        return (
                          <tr key={lst.id} className="hover:bg-slate-900/10 transition-colors">
                            {rowSpan > 0 && (
                              <td className="py-4 px-6 border-r border-slate-800/40 bg-slate-900/10 align-middle" rowSpan={rowSpan}>
                                <span className="text-[10px] font-mono text-slate-500 block mb-0.5">{inventoryItem?.sku || "CUSTOM"}</span>
                                <span className="font-bold text-slate-200 block">{lst.itemName}</span>
                              </td>
                            )}
                            <td className="py-4 px-6">
                              <span className="bg-slate-900 py-1 px-2.5 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-300">
                                {lst.firmCode}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center font-mono font-bold text-slate-200">₹{lst.rate}</td>
                            <td className="py-4 px-6 text-center font-mono text-slate-300">{lst.availGemStock || 0}</td>
                            <td className="py-4 px-6 text-center font-mono text-slate-300">{lst.minQty}</td>
                            <td className="py-4 px-6 text-slate-400">{buyerName}</td>
                            <td className="py-4 px-6">
                              {lst.gemLink ? (
                                <a 
                                  href={lst.gemLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-400 hover:underline flex items-center gap-1"
                                >
                                  GeM Listing <FiExternalLink size={12} />
                                </a>
                              ) : (
                                <span className="text-slate-500 italic">No link</span>
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
              <div className="bg-[#131a26] border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95">

                {/* Header */}
                <div className="p-6 border-b border-slate-800 bg-slate-900/40">
                  <h3 className="font-black text-sm text-white uppercase tracking-wider flex items-center gap-2">
                    <FiClock className="text-amber-500" /> Revise Rate (Buyer Negotiated)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Log negotiation revision details for: {selectedListingForRevision.itemName}</p>
                </div>

                {/* Form fields */}
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">New Rate (₹)</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono"
                        value={newRateValue}
                        onChange={(e) => setNewRateValue(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">New Min Qty</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono"
                        value={newMinQtyValue}
                        onChange={(e) => setNewMinQtyValue(e.target.value)}
                        placeholder="1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">GeM Product URL</label>
                      <input
                        type="text"
                        className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                        value={newGemLinkValue}
                        onChange={(e) => setNewGemLinkValue(e.target.value)}
                        placeholder="Paste GeM Listing URL..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Avail GeM Stock</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono"
                        value={newAvailGemStockValue}
                        onChange={(e) => setNewAvailGemStockValue(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Reason for Revision</label>
                    <textarea
                      rows={3}
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none"
                      value={revisionReason}
                      onChange={(e) => setRevisionReason(e.target.value)}
                      placeholder="e.g. buyer requested lower price for bulk order..."
                    />
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="p-6 border-t border-slate-800 bg-slate-900/20 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setIsRevisionOpen(false);
                      setSelectedListingForRevision(null);
                    }}
                    className="px-5 py-2.5 rounded-lg border border-slate-850 hover:bg-slate-900 text-xs uppercase font-bold"
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
