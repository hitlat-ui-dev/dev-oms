// lib/triggerGemSubmit.ts
//
// Call this from the OMS webapp when the "Submit to GeM" button is pressed
// (e.g. from the Generate Bill success state). The extension's
// "externally_connectable" manifest entry already whitelists this OMS
// origin. The extension's manifest.json has a fixed "key" field, so this ID
// stays the same on every computer that loads the extension unpacked —
// no per-computer update needed here.

const GEM_EXTENSION_ID = "lcadakplnhlmmkgajnojaaiimojnhbap"; // fixed via manifest.json "key" (22-Aug-2026)

// Fire-and-forget: lets the extension's own popup ("Gmail Accounts") know
// who's currently logged into OMS in this browser, so it can list THIS
// user's own GeM Login Setup credentials (not a shared per-firm list) when
// offering to link/re-link a Gmail account. Safe to call on every dashboard
// page load - silently does nothing if the extension isn't installed.
export function syncCurrentUserToExtension(username: string): void {
  if (!username) return;
  const chromeRuntime = (window as any).chrome?.runtime;
  if (!chromeRuntime?.sendMessage) return;
  chromeRuntime.sendMessage(GEM_EXTENSION_ID, { type: "SYNC_CURRENT_USER", payload: { username } }, () => {
    void chromeRuntime.lastError; // swallow "receiving end does not exist" etc - this call is best-effort
  });
}

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

export interface RetryGemDocumentParams {
  firmCode: string;
  contractNo: string;
  billId: string;
  billNo: string;
  billPdfUrl: string;
}

// Re-fetches just GeM's own e-signed invoice PDF for a bill that's already
// submitted/verified on GeM but whose OMS copy is missing (Bill History's
// "GeM Invoice" column shows "-" - the original submit run's document step
// is non-fatal, so this can happen without the bill itself needing redoing).
// Skips the whole submit flow - the extension only opens the order and grabs
// the already-generated invoice's download link, no re-invoicing risk.
export function retryGemDocumentFetch(params: RetryGemDocumentParams): Promise<any> {
  return new Promise((resolve, reject) => {
    const chromeRuntime = (window as any).chrome?.runtime;
    if (!chromeRuntime?.sendMessage) {
      reject(new Error("Extension detect nahi hua — install hai ya nahi check karo."));
      return;
    }

    chromeRuntime.sendMessage(
      GEM_EXTENSION_ID,
      { type: "RETRY_GEM_DOCUMENT", payload: params },
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

export interface GemLoginParams {
  gemUserId: string;
  gemPassword: string;
  gemMailId?: string; // used to auto-fetch the login OTP, same as the bill-submission Gmail flow
}

// Opens/focuses a GeM tab and asks content-gem.js to fill in the saved
// Username/Password on the login form - Captcha (and OTP, if GeM prompts for
// one) still need a human, this only saves the typing. See content-gem.js's
// fillGemLoginForm() for the actual field-filling logic and its caveats.
export function triggerGemLogin(params: GemLoginParams): Promise<any> {
  return new Promise((resolve, reject) => {
    const chromeRuntime = (window as any).chrome?.runtime;
    if (!chromeRuntime?.sendMessage) {
      reject(new Error("Extension detect nahi hua — install hai ya nahi check karo."));
      return;
    }

    chromeRuntime.sendMessage(
      GEM_EXTENSION_ID,
      { type: "GEM_LOGIN", payload: params },
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
