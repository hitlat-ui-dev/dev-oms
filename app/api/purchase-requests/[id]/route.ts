import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// --- PATCH: Handles Updates (Order Placement & Receiving) ---
// export async function PATCH(
//   req: Request, 
//   { params }: { params: Promise<{ id: string }> } 
// ) {
//   try {
//     const { id } = await params;

//     if (!ObjectId.isValid(id)) {
//       return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
//     }

//     const body = await req.json();
//     const { 
//       status, 
//       receivedQty, 
//       orderQty, 
//       rate, 
//       vendor 
//     } = body;

//     const client = await clientPromise;
//     const db = client.db();
//     const collection = db.collection("purchase_requests");

//     // 1. Fetch the original document
//     const originalRequest = await collection.findOne({ _id: new ObjectId(id) });

//     if (!originalRequest) {
//       return NextResponse.json({ error: "Request not found" }, { status: 404 });
//     }

//     // --- CASE A: MOVING FROM REQUEST TO ORDER PLACE ---
//     if (status === "Order Place") {
//       await collection.updateOne(
//         { _id: new ObjectId(id) },
//         { 
//           $set: { 
//             status: "Order Place",
//             qty: Number(orderQty) || originalRequest.qty,
//             rate: Number(rate),
//             vendor: vendor,
//             updatedAt: new Date()
//           } 
//         }
//       );
//       return NextResponse.json({ success: true, message: "Order placed successfully" });
//     }

//     // --- CASE B: RECEIVING ITEMS (SPLIT LOGIC) ---
//     if (status === "Received Purchase") {
//       const requestedQty = Number(originalRequest.qty);
//       const incomingQty = Number(receivedQty);

//       if (incomingQty < requestedQty && incomingQty > 0) {
//         // Step 1: Update original with remaining balance (stays in Order Place)
//         await collection.updateOne(
//           { _id: new ObjectId(id) },
//           { $set: { qty: requestedQty - incomingQty, updatedAt: new Date() } }
//         );

//         // Step 2: Create new record for received portion
//         const { _id, ...rest } = originalRequest;
//         await collection.insertOne({
//           ...rest,
//           qty: incomingQty,
//           receivedQty: incomingQty,
//           status: "Received Purchase",
//           createdAt: new Date(),
//           splitFrom: new ObjectId(id)
//         });

//         return NextResponse.json({ success: true, message: "Partial receipt split" });
//       } 
      
//       // Full Receipt Update
//       await collection.updateOne(
//         { _id: new ObjectId(id) },
//         { 
//           $set: { 
//             status: "Received Purchase", 
//             receivedQty: incomingQty,
//             qty: incomingQty,
//             updatedAt: new Date()
//           } 
//         }
//       );
//       return NextResponse.json({ success: true });
//     }

//     // --- CASE C: GENERAL STATUS UPDATE (e.g., Return) ---
//     if (status) {
//         await collection.updateOne(
//             { _id: new ObjectId(id) },
//             { $set: { status, updatedAt: new Date() } }
//         );
//         return NextResponse.json({ success: true });
//     }

//     return NextResponse.json({ error: "No valid status provided" }, { status: 400 });

//   } catch (error: any) {
//     console.error("PATCH Error:", error);
//     return NextResponse.json({ error: error.message }, { status: 500 });
//   }
// }

// --- DELETE: Removes a Request ---
export async function DELETE(
  req: Request, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const result = await db.collection("purchase_requests").deleteOne({ 
      _id: new ObjectId(id) 
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}