"use client";
import PricelistShell from "@/components/purchase/pricelist/PricelistShell";
import ReceivedPurchaseReadOnly from "@/components/purchase/pricelist/ReceivedPurchaseReadOnly";

export default function PricelistReceivedPage() {
  return <PricelistShell active="received">{(user) => <ReceivedPurchaseReadOnly user={user} />}</PricelistShell>;
}
