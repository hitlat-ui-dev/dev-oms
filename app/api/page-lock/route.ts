import { NextResponse } from "next/server";
import crypto from "crypto";
import clientPromise from "@/lib/mongodb";

// A lightweight PIN lock in front of a page (currently: Attendance, which
// carries salary and advance/loan figures). Not a real auth layer - anyone
// with DB access could clear it - just a screen-lock for a shared or
// walk-away browser, so a plain SHA-256 hash (no salt) is enough here.
const hash = (pin: string) => crypto.createHash("sha256").update(pin).digest("hex");

const PIN_RE = /^\d{4,8}$/;

// GET /api/page-lock?page=attendance - whether a PIN is currently set
export async function GET(req: Request) {
  try {
    const page = new URL(req.url).searchParams.get("page");
    if (!page) return NextResponse.json({ error: "page is required" }, { status: 400 });

    const client = await clientPromise;
    const db = client.db();
    const lock = await db.collection("page_locks").findOne({ page });
    return NextResponse.json({ isSet: !!lock?.pinHash });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to check lock" }, { status: 500 });
  }
}

// POST /api/page-lock - set, change, verify, or clear a page's PIN
// Body: { page, action: "set" | "verify" | "change" | "clear", pin, currentPin? }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const page = (body?.page || "").toString();
    const action = (body?.action || "").toString();
    if (!page) return NextResponse.json({ error: "page is required" }, { status: 400 });

    const client = await clientPromise;
    const db = client.db();
    const locks = db.collection("page_locks");
    const existing = await locks.findOne({ page });

    if (action === "verify") {
      const pin = (body?.pin || "").toString();
      if (!existing?.pinHash) return NextResponse.json({ error: "PIN set nahi hai" }, { status: 404 });
      if (hash(pin) !== existing.pinHash) return NextResponse.json({ error: "Galat PIN" }, { status: 401 });
      return NextResponse.json({ ok: true });
    }

    if (action === "set") {
      if (existing?.pinHash) {
        return NextResponse.json({ error: "PIN pehle se set hai - Change PIN use karo" }, { status: 409 });
      }
      const pin = (body?.pin || "").toString();
      if (!PIN_RE.test(pin)) return NextResponse.json({ error: "PIN 4-8 digit ka number hona chahiye" }, { status: 400 });
      await locks.updateOne({ page }, { $set: { page, pinHash: hash(pin), updatedAt: new Date() } }, { upsert: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "change") {
      const currentPin = (body?.currentPin || "").toString();
      const pin = (body?.pin || "").toString();
      if (!existing?.pinHash) return NextResponse.json({ error: "PIN set nahi hai" }, { status: 404 });
      if (hash(currentPin) !== existing.pinHash) return NextResponse.json({ error: "Current PIN galat hai" }, { status: 401 });
      if (!PIN_RE.test(pin)) return NextResponse.json({ error: "Naya PIN 4-8 digit ka number hona chahiye" }, { status: 400 });
      await locks.updateOne({ page }, { $set: { pinHash: hash(pin), updatedAt: new Date() } });
      return NextResponse.json({ ok: true });
    }

    if (action === "clear") {
      const currentPin = (body?.currentPin || "").toString();
      if (!existing?.pinHash) return NextResponse.json({ ok: true });
      if (hash(currentPin) !== existing.pinHash) return NextResponse.json({ error: "Current PIN galat hai" }, { status: 401 });
      await locks.deleteOne({ page });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update lock" }, { status: 500 });
  }
}
