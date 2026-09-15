import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { PDFDocument } from "pdf-lib";
import { loadChallanPdf } from "@/lib/deliveryChallan";

const COLLECTION = "delivery_challans";

// A whole batch of challans is normally printed in one go, and browsers cap
// how much a single response can stream comfortably - this is the point where
// the user should split the selection rather than the server quietly stalling.
const MAX_CHALLANS = 100;

// POST /api/delivery-challans/merge-pdf
//   body: { ids: ["<challanId>", ...] }
//
// Concatenates the selected challans into ONE PDF, in the order the ids were
// given - the client sends them in the order they appear on screen, so the
// merged file reads the same way the list does rather than in some order the
// server picked.
//
// POST rather than GET because the id list is unbounded: fifty selected
// challans would blow past what a query string can safely carry.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawIds: unknown = body?.ids;

    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: "Select at least one challan to merge." }, { status: 400 });
    }
    if (rawIds.length > MAX_CHALLANS) {
      return NextResponse.json(
        { error: `Too many challans selected (${rawIds.length}). Merge up to ${MAX_CHALLANS} at a time.` },
        { status: 400 }
      );
    }

    // De-duplicate while preserving the requested order, and drop anything
    // that isn't a real id rather than throwing on it.
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const raw of rawIds) {
      const id = String(raw);
      if (!ObjectId.isValid(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: "None of the selected challans look valid." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const found = await db
      .collection(COLLECTION)
      .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
      .toArray();

    // One fetch, then re-ordered in memory to match the request - a $in query
    // returns documents in whatever order the index gives, not the caller's.
    const byId = new Map(found.map((c) => [String(c._id), c]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as any[];

    // An item-less challan has nothing to print (the single download refuses
    // one too), so it is skipped rather than contributing a blank sheet.
    const printable = ordered.filter((c) => Array.isArray(c.items) && c.items.length > 0);
    if (printable.length === 0) {
      return NextResponse.json({ error: "None of the selected challans have any items to print." }, { status: 400 });
    }

    const merged = await PDFDocument.create();
    for (const challan of printable) {
      const bytes = await loadChallanPdf(challan);
      const src = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    }

    const mergedBytes = await merged.save();
    const stamp = new Date();
    const fileName =
      `Delivery-Challans-${printable.length}-merged-` +
      `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}.pdf`;

    return new NextResponse(Buffer.from(mergedBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        // Lets the screen report "merged 12 of 14 - 2 had no items" without
        // needing a second round trip or a JSON response it can't download.
        "X-Merged-Count": String(printable.length),
        "X-Requested-Count": String(ids.length),
      },
    });
  } catch (error: any) {
    console.error("DC merge-pdf error:", error);
    return NextResponse.json({ error: error.message || "Failed to merge the challan PDFs" }, { status: 500 });
  }
}
