import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// Lets an invoice number that was actually issued OUTSIDE OMS (e.g. an
// offline sale billed directly in Miracle, sharing the same "SM" numbering
// series as OMS) advance OMS's own auto-increment counter to match - without
// creating any order or Bill record. Without this, OMS's next auto-generated
// number could collide with (or fall behind) what Miracle already issued.
//
// The counter only ever tracks the highest number used per financial year,
// not a set of individually-used numbers, so registering several numbers at
// once ("46, 47, 48" or "46-50") is equivalent to registering just the
// highest of them - but callers can paste a whole batch in one go instead of
// doing it one at a time.

function getCurrentFY(): string {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

/** Parses "46", "46, 47, 48", "46-50", or a mix like "46,48-50" into the
 * individual numeric values referenced, stripping any letter prefix
 * (e.g. "SM46" -> 46) so a pasted invoice number works too. */
function parseNumberList(input: string, prefix: string): number[] {
  const out: number[] = [];
  const strip = (tok: string) => {
    const cleaned = prefix ? tok.trim().replace(new RegExp(`^${prefix}`, "i"), "") : tok.trim();
    return Number(cleaned.trim());
  };
  for (const rawToken of input.split(",")) {
    const token = rawToken.trim();
    if (!token) continue;
    const rangeMatch = /^(.+?)\s*-\s*(.+)$/.exec(token);
    if (rangeMatch) {
      const start = strip(rangeMatch[1]);
      const end = strip(rangeMatch[2]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        for (let n = lo; n <= hi; n++) out.push(n);
        continue;
      }
    }
    const n = strip(token);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const firmCode = (body.firmCode || "").toString().trim().toUpperCase();
    const numbersInput = (body.numbers || "").toString().trim();
    const registeredBy = (body.registeredBy || "").toString().trim();

    if (!firmCode || !numbersInput) {
      return NextResponse.json({ error: "firmCode and numbers are required." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const company = await db.collection("companies").findOne({ firmCode });
    if (!company) {
      return NextResponse.json({ error: "Firm not found." }, { status: 404 });
    }
    const prefix = company.invoiceNumbering?.prefix || "";

    const parsed = parseNumberList(numbersInput, prefix);
    if (parsed.length === 0) {
      return NextResponse.json({ error: "Couldn't parse any numbers from that input." }, { status: 400 });
    }

    const fy = getCurrentFY();
    const entry = company.invoiceNumbering?.history?.find((h: any) => h.fy === fy);
    const currentLast = entry?.lastNumber || 0;
    const highest = Math.max(...parsed);

    if (highest <= currentLast) {
      return NextResponse.json({
        success: true,
        changed: false,
        message: `Already registered - OMS's counter is already at ${currentLast}, no update needed.`,
        currentLast,
      });
    }

    if (entry) {
      await db.collection("companies").updateOne(
        { firmCode, "invoiceNumbering.history.fy": fy },
        {
          $set: { "invoiceNumbering.history.$.lastNumber": highest },
          $push: {
            "invoiceNumbering.externalRegistrations": {
              numbers: parsed,
              fy,
              registeredAt: new Date(),
              registeredBy,
            },
          } as any,
        }
      );
    } else {
      await db.collection("companies").updateOne(
        { firmCode },
        {
          $push: {
            "invoiceNumbering.history": { fy, lastNumber: highest },
            "invoiceNumbering.externalRegistrations": {
              numbers: parsed,
              fy,
              registeredAt: new Date(),
              registeredBy,
            },
          } as any,
        }
      );
    }

    return NextResponse.json({
      success: true,
      changed: true,
      message: `OMS's counter advanced from ${currentLast} to ${highest}. Next auto-generated bill will start from ${prefix}${highest + 1}.`,
      previousLast: currentLast,
      currentLast: highest,
    });
  } catch (error: any) {
    console.error("POST register-number error:", error);
    return NextResponse.json({ error: error.message || "Failed to register number(s)" }, { status: 500 });
  }
}
