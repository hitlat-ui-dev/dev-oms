// lib/triggerGemSubmit.ts
//
// Call this from the OMS webapp when the "Submit to GeM" button is pressed
// (e.g. from the Generate Bill success state). The extension's
// "externally_connectable" manifest entry already whitelists this OMS
// origin. The extension's manifest.json has a fixed "key" field, so this ID
// stays the same on every computer that loads the extension unpacked —
// no per-computer update needed here.

const GEM_EXTENSION_ID = "lcadakplnhlmmkgajnojaaiimojnhbap"; // fixed via manifest.json "key" (22-Aug-2026)

export interface SubmitBillToGemParams {
  firmCode: string;
  billType: "TAX_INVOICE" | "BILL_OF_SUPPLY";
  contractNo: string;
  contractDate?: string; // dd/mm/yyyy - GeM's Invoice Date + Dispatch Date both use this
  buyerState?: string; // for the Place of Supply (State/UT Code) dropdown
  billId: string; // Mongo _id of the Bill doc - used to upload GeM's own e-signed invoice back to OMS
  billNo: string;
  billPdfUrl: string;
  firmName: string;
  gmailAccountEmail?: string;
  items: { qty: number; hsnSac?: string; gstPercent?: number }[]; // one per Product Details row, same order as the contract
}

export function submitBillToGem(params: SubmitBillToGemParams): Promise<any> {
  return new Promise((resolve, reject) => {
    const chromeRuntime = (window as any).chrome?.runtime;
    if (!chromeRuntime?.sendMessage) {
      reject(new Error("Extension detect nahi hua — install hai ya nahi check karo."));
      return;
    }

    chromeRuntime.sendMessage(
      GEM_EXTENSION_ID,
      { type: "SUBMIT_BILL_TO_GEM", payload: params },
      (response: any) => {
        if (chromeRuntime.lastError) {
          reject(new Error(chromeRuntime.lastError.message));
        } else if (response?.success) {
          resolve(response.result);
        } else {
          reject(new Error(response?.error || "Unknown error"));
        }
      }
    );
  });
}

// USAGE example (e.g. in app/dashboard/account/bills/page.tsx after a bill is generated):
//
// import { submitBillToGem } from "@/lib/triggerGemSubmit";
//
// async function handleSubmitToGem() {
//   try {
//     await submitBillToGem({
//       firmCode: company.firmCode,
//       billType: billTypeFor(company),
//       contractNo: selectedContract.contractNo,
//       contractDate: selectedContract.contractDate,
//       buyerState: selectedContract.buyerState,
//       billId: result.billId,
//       billNo: result.invoiceNumber,
//       billPdfUrl: `${window.location.origin}/api/bills/${result.billId}/pdf`,
//       firmName: company.firmName,
//       gmailAccountEmail: company.gmailAccountEmail,
//       items: selectedContract.orders.map((o) => ({
//         qty: o.reQty, hsnSac: overrides[o._id]?.hsnSac, gstPercent: overrides[o._id]?.gstPercent,
//       })),
//     });
//     alert("GeM tab khul gaya, automation shuru ho gayi.");
//   } catch (err: any) {
//     // Agar error "Gmail account link nahi hai" wala aaye, to user ko batao
//     // extension popup se pehle us firm ka Gmail account link karna hoga.
//     alert("Extension trigger nahi hua: " + err.message);
//   }
// }
