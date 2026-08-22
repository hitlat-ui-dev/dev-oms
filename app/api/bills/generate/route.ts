import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { generateBillPdf, BillPdfData } from "@/lib/generateBillPdf";
import { uploadFileToR2Bills } from "@/lib/r2Bills";

function decideBillType(company: any): "TAX_INVOICE" | "BILL_OF_SUPPLY" {
  if (!company.gstin) return "BILL_OF_SUPPLY";
  if (company.isCompositionDealer) return "BILL_OF_SUPPLY";
  return "TAX_INVOICE";
}

function decideGstSplit(firmState?: string, buyerState?: string): "CGST_SGST" | "IGST" | "UNKNOWN" {
  if (!firmState || !buyerState) return "UNKNOWN";
  return firmState.trim().toLowerCase() === buyerState.trim().toLowerCase() ? "CGST_SGST" : "IGST";
}

function formatDateDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Joins address parts, skipping any part already present in what's been
 * joined so far (sellers commonly type place/state directly into the free-text
 * `address` field, so a naive join would repeat "SHAHERA ... SHAHERA"). */
function joinAddressParts(parts: (string | undefined)[]): string {
  let result = "";
  for (const part of parts) {
    if (!part) continue;
    if (result.toLowerCase().includes(part.toLowerCase())) continue;
    result = result ? `${result}, ${part}` : part;
  }
  return result;
}

function getCurrentFY(): string {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

/** Atomically advances (or creates) this firm's invoice counter for the
 * current FY and returns the next auto number. */
async function getNextInvoiceNumber(db: any, firmCode: string, prefix: string): Promise<string> {
  const fy = getCurrentFY();

  const incremented = await db.collection("companies").findOneAndUpdate(
    { firmCode, "invoiceNumbering.history.fy": fy },
    { $inc: { "invoiceNumbering.history.$.lastNumber": 1 } },
    { returnDocument: "after" }
  );
  if (incremented?.value || incremented) {
    const doc = incremented.value || incremented;
    const entry = doc.invoiceNumbering.history.find((h: any) => h.fy === fy);
    return `${prefix}${entry.lastNumber}`;
  }

  // No history entry for this FY yet - create it starting at 1.
  await db.collection("companies").updateOne(
    { firmCode },
    { $push: { "invoiceNumbering.history": { fy, lastNumber: 1 } } }
  );
  return `${prefix}1`;
}

/** Validates + registers a manually-entered invoice number, advancing the
 * internal counter past it so the next AUTO bill continues from there. */
async function registerManualInvoiceNumber(db: any, firmCode: string, prefix: string, manualNumber: string): Promise<string> {
  const fy = getCurrentFY();
  const numericPart = Number(String(manualNumber).replace(prefix, "").trim());
  if (isNaN(numericPart)) {
    throw new Error("Manual invoice number's numeric part could not be parsed - check the format.");
  }

  const company = await db.collection("companies").findOne({ firmCode });
  const entry = company?.invoiceNumbering?.history?.find((h: any) => h.fy === fy);
  const currentLast = entry?.lastNumber || 0;

  if (numericPart <= currentLast) {
    throw new Error(`This number (${manualNumber}) is already used or behind the counter. Current last number: ${currentLast}`);
  }

  if (entry) {
    await db.collection("companies").updateOne(
      { firmCode, "invoiceNumbering.history.fy": fy },
      { $set: { "invoiceNumbering.history.$.lastNumber": numericPart } }
    );
  } else {
    await db.collection("companies").updateOne(
      { firmCode },
      { $push: { "invoiceNumbering.history": { fy, lastNumber: numericPart } } }
    );
  }

  return `${prefix}${numericPart}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firmCode: rawFirmCode, contractNo, numberMode, manualNumber, lineOverrides, createdBy } = body;
    const firmCode = (rawFirmCode || "").trim().toUpperCase();

    if (!firmCode || !contractNo || !numberMode) {
      return NextResponse.json({ error: "firmCode, contractNo and numberMode are required." }, { status: 400 });
    }
    if (numberMode === "manual" && !manualNumber) {
      return NextResponse.json({ error: "manualNumber is required when numberMode is manual." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const company = await db.collection("companies").findOne({ firmCode });
    if (!company) {
      return NextResponse.json({ error: "Firm not found." }, { status: 404 });
    }
    if (!company.gstin && !company.pan) {
      return NextResponse.json({ error: "This firm has no GSTIN or PAN on file - complete Firm details first." }, { status: 400 });
    }

    const orders = await db
      .collection("sellerorders")
      .find({ firmCode, contractNo, billId: null })
      .toArray();
    if (orders.length === 0) {
      return NextResponse.json({ error: "No un-billed orders found for this contract (already billed, or none exist)." }, { status: 404 });
    }

    // Some historical/imported orders never got linked to a Seller record
    // (sellerId: null) - fall back to an exact instituteName match so the
    // buyer address on the bill doesn't come out blank.
    const seller = orders[0].sellerId
      ? await db.collection("sellers").findOne({ _id: new ObjectId(orders[0].sellerId) })
      : await db.collection("sellers").findOne({
          instituteName: { $regex: `^${String(orders[0].instituteName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        });

    const billType = decideBillType(company);
    const isTaxInvoice = billType === "TAX_INVOICE";
    const gstSplit = decideGstSplit(company.state, seller?.state);

    const itemIds = orders.map((o) => o.itemId).filter(Boolean);
    const itemDocs = itemIds.length
      ? await db.collection("items").find({ _id: { $in: itemIds.map((id: any) => new ObjectId(id)) } }).toArray()
      : [];
    const itemById = new Map(itemDocs.map((it) => [String(it._id), it]));

    // A hidden/retired item can't be billed even if this order was placed
    // before it got hidden - the contract needs correcting to its active
    // replacement item first (see the same hidden-item guard on Ready to
    // Ship/Delivery transitions in app/api/seller-orders/[id]/route.ts).
    const hiddenLine = orders.find((o) => o.itemId && itemById.get(String(o.itemId))?.hidden === true);
    if (hiddenLine) {
      const hiddenItemDoc = itemById.get(String(hiddenLine.itemId));
      return NextResponse.json(
        {
          error: `"${hiddenLine.itemName}" (SKU ${hiddenItemDoc?.sku || hiddenLine.sku}) is hidden/retired — this contract can't be billed until the order is corrected to use its active replacement item.`,
        },
        { status: 400 }
      );
    }

    const overridesByOrderId = new Map(
      (Array.isArray(lineOverrides) ? lineOverrides : []).map((o: any) => [String(o.sellerOrderId), o])
    );

    let subTotal = 0;
    let totalDiscount = 0;
    let totalGst = 0;

    const items = orders.map((o, idx) => {
      const itemDoc = o.itemId ? itemById.get(String(o.itemId)) : null;
      const override: any = overridesByOrderId.get(String(o._id)) || {};

      const qty = Number(o.reQty || 0);
      const rate = Number(o.rate || 0);
      const discount = Number(override.discount || 0);
      const gross = qty * rate;
      const taxableAmount = gross - discount;
      const hsnSac = override.hsnSac !== undefined ? override.hsnSac : (itemDoc?.hsnSac || "");
      const gstPercent = override.gstPercent !== undefined ? Number(override.gstPercent) : Number(itemDoc?.gstPercent || 0);
      const gstAmount = isTaxInvoice ? (taxableAmount * gstPercent) / 100 : 0;
      const amount = taxableAmount + gstAmount;

      subTotal += taxableAmount;
      totalDiscount += discount;
      totalGst += gstAmount;

      return {
        srNo: idx + 1,
        sellerOrderId: o._id,
        itemName: o.itemName,
        hsnSac,
        qty,
        unit: o.unit || "",
        rate,
        discount,
        gstPercent,
        taxableAmount,
        gstAmount,
        amount,
      };
    });
    const grandTotal = subTotal + totalGst;

    const prefix = company.invoiceNumbering?.prefix || "";
    let invoiceNumber: string;
    try {
      invoiceNumber =
        numberMode === "manual"
          ? await registerManualInvoiceNumber(db, firmCode, prefix, manualNumber)
          : await getNextInvoiceNumber(db, firmCode, prefix);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const firmAddressParts = [company.sellerRegisterAddress, company.state].filter(Boolean);
    const buyerAddress = joinAddressParts([seller?.address, seller?.place, seller?.state]);

    const invoiceDate = new Date();
    const billDoc = {
      firmCode,
      invoiceNumber,
      numberMode,
      billType,
      gstSplit,
      invoiceDate,
      placeOfSupply: seller?.state || "",
      contractNo,
      firmSnapshot: {
        name: company.firmName,
        address: firmAddressParts.join(", "),
        state: company.state || "",
        gstin: company.gstin || null,
        pan: company.pan || null,
        mobile: company.mobile || "",
        contactEmail: company.contactEmail || "",
        bank: {
          bankName: company.bank?.bankName || "",
          accountNo: company.bank?.accountNo || "",
          ifsc: company.bank?.ifsc || "",
          branch: company.bank?.branch || "",
        },
      },
      buyerSnapshot: {
        instituteName: seller?.instituteName || orders[0].instituteName,
        sellerBillName: seller?.sellerBillName || "",
        buyerName: seller?.buyerName || "",
        address: buyerAddress,
        place: seller?.place || "",
        state: seller?.state || "",
      },
      items,
      subTotal,
      totalDiscount,
      totalGst,
      cgstAmount: isTaxInvoice && gstSplit === "CGST_SGST" ? totalGst / 2 : 0,
      sgstAmount: isTaxInvoice && gstSplit === "CGST_SGST" ? totalGst / 2 : 0,
      igstAmount: isTaxInvoice && gstSplit === "IGST" ? totalGst : 0,
      grandTotal,
      fileUrl: "",
      createdBy: createdBy || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertResult = await db.collection("bills").insertOne(billDoc);

    await db.collection("sellerorders").updateMany(
      { _id: { $in: orders.map((o) => o._id) } },
      { $set: { billId: insertResult.insertedId, invoiceNumber } }
    );

    const pdfData: BillPdfData = {
      billType,
      gstSplit,
      invoiceNumber,
      invoiceDate: formatDateDDMMYYYY(invoiceDate),
      placeOfSupply: billDoc.placeOfSupply,
      firm: {
        name: billDoc.firmSnapshot.name,
        address: billDoc.firmSnapshot.address,
        mobile: billDoc.firmSnapshot.mobile,
        email: billDoc.firmSnapshot.contactEmail,
        gstin: billDoc.firmSnapshot.gstin,
        pan: billDoc.firmSnapshot.pan,
        bank: billDoc.firmSnapshot.bank,
      },
      buyer: {
        instituteName: billDoc.buyerSnapshot.instituteName,
        sellerBillName: billDoc.buyerSnapshot.sellerBillName,
        address: billDoc.buyerSnapshot.address,
      },
      items: items.map((it) => ({
        srNo: it.srNo,
        productName: it.itemName,
        qty: it.qty,
        rate: it.rate,
        discount: it.discount,
        hsnSac: it.hsnSac,
        gstPercent: it.gstPercent,
        amount: it.amount,
      })),
      subTotal,
      totalDiscount,
      totalGst,
      grandTotal,
    };

    const pdfBytes = await generateBillPdf(pdfData);
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // Store the PDF in R2 so it can be re-served instantly later (and so the
    // GeM extension has a stable URL to download from) - best-effort, since
    // the bill itself is already saved even if this upload fails.
    const r2Key = `bills/${firmCode}/${invoiceNumber}.pdf`;
    try {
      await uploadFileToR2Bills(Buffer.from(pdfBytes), r2Key, "application/pdf");
      await db.collection("bills").updateOne({ _id: insertResult.insertedId }, { $set: { r2Key } });
    } catch (err: any) {
      console.error("R2 bills upload failed (bill still saved, PDF will be re-rendered on demand):", err.message);
    }

    return NextResponse.json(
      {
        success: true,
        billId: insertResult.insertedId,
        invoiceNumber,
        billType,
        gstSplit,
        grandTotal,
        pdfBase64,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Bill generate error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate bill" }, { status: 500 });
  }
}
