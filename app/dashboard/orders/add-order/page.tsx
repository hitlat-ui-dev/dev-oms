import SellerOrderForm from "@/components/SellerOrderForm";

export default function AddSellerOrderPage() {
  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto">
      <SellerOrderForm isModal={false} />
    </div>
  );
}