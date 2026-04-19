"use client";
import { useState, useEffect } from "react";
import { FiPlus, FiSave, FiTruck, FiPhone, FiUser, FiMapPin, FiList } from "react-icons/fi";

export default function AddTransporterPage() {
    const [list, setList] = useState<any[]>([]);
    const [formData, setFormData] = useState({
        name: "",
        address: "",
        deliveryArea: "",
        contacts: [{ person: "", mobile: "" }]
    });

    useEffect(() => { fetchTransporters(); }, []);

    const fetchTransporters = async () => {
        try {
            const res = await fetch("/api/transporters");
            const data = await res.json();
            setList(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Fetch error", err);
        }
    };

    const addContactField = () => {
        setFormData({ ...formData, contacts: [...formData.contacts, { person: "", mobile: "" }] });
    };

    const handleContactChange = (index: number, field: string, value: string) => {
        const newContacts = [...formData.contacts];
        newContacts[index] = { ...newContacts[index], [field]: value };
        setFormData({ ...formData, contacts: newContacts });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch("/api/transporters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData)
        });
        if (res.ok) {
            setFormData({ name: "", address: "", deliveryArea: "", contacts: [{ person: "", mobile: "" }] });
            fetchTransporters();
        }
    };
    const handleContactEdit = (transporterIndex: number, contactIndex: number, field: string, value: string) => {
        const updatedList = [...list];
        updatedList[transporterIndex].contacts[contactIndex][field] = value;
        setList(updatedList);
    };
    const handleInlineUpdate = async (id: string, item: any) => {
        // 1. Ask for confirmation
        const confirmUpdate = window.confirm(
            `Are you sure you want to update the details for "${item.name}"?`
        );

        if (!confirmUpdate) return; // Exit if user clicks "Cancel"

        try {
            const res = await fetch("/api/transporters", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id,
                    address: item.address,
                    deliveryArea: item.deliveryArea,
                    contacts: item.contacts
                })
            });

            if (res.ok) {
                alert("✅ Transporter details updated successfully!");
                fetchTransporters(); // Refresh the list
            } else {
                const errorData = await res.json();
                alert(`❌ Error: ${errorData.error || "Failed to update"}`);
            }
        } catch (err) {
            console.error("Update error:", err);
            alert("❌ A network error occurred while updating.");
        }
    };
    return (
        <div className="p-4 md:p-12 max-w-7xl mx-auto space-y-10 bg-slate-50 min-h-screen">

            {/* 1. ENTRY FORM */}
            <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-3 mb-8">
                    <div className="p-3 bg-fuchsia-600 text-white rounded-2xl shadow-lg shadow-fuchsia-200">
                        <FiTruck size={20} />
                    </div>
                    Add Transporter
                </h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Transporter Name *</label>
                            <input required className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-fuchsia-500 outline-none"
                                placeholder="Company Name"
                                value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Office Address</label>
                            <input className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none"
                                placeholder="Full Office Address"
                                value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Route Areas (List all areas here)</label>
                        <textarea
                            className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold outline-none min-h-[100px]"
                            placeholder="Ex: Ahmedabad, Mehsana, Palanpur, Unjha..."
                            value={formData.deliveryArea} onChange={e => setFormData({ ...formData, deliveryArea: e.target.value })}
                        />
                    </div>

                    <div className="bg-slate-50 p-6 rounded-[1.5rem] space-y-4 border border-slate-100">
                        <p className="text-[11px] font-black uppercase text-fuchsia-600 tracking-widest">Contact Persons</p>
                        {formData.contacts.map((c, i) => (
                            <div key={i} className="flex flex-col md:flex-row gap-4">
                                <input placeholder="Name" className="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-sm"
                                    value={c.person} onChange={e => handleContactChange(i, "person", e.target.value)} />
                                <input placeholder="Mobile Number" className="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-sm"
                                    value={c.mobile} onChange={e => handleContactChange(i, "mobile", e.target.value)} />
                            </div>
                        ))}
                        <button type="button" onClick={addContactField} className="flex items-center gap-2 text-blue-600 font-black text-[10px] uppercase bg-white px-4 py-2 rounded-lg border border-blue-100 hover:bg-blue-50 transition-colors">
                            <FiPlus /> Add Another Contact
                        </button>
                    </div>

                    <button className="w-full bg-slate-900 text-white p-5 rounded-2xl font-black uppercase tracking-[0.2em] hover:bg-fuchsia-600 transition-all shadow-xl shadow-slate-200">
                        Save Transporter
                    </button>
                </form>
            </div>

            {/* 2. ALL DATA LIST */}
            <div className="space-y-6">
                <h3 className="text-xl font-black uppercase tracking-tight text-slate-800 px-2 flex items-center gap-2">
                    <FiList className="text-blue-600" /> All Transporters
                </h3>

                <div className="grid grid-cols-1 gap-6">
  {list.map((item, index) => (
    <div key={item._id} className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm hover:border-fuchsia-200 transition-colors">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">

        {/* 1. Name Section (Span 2) */}
        <div className="lg:col-span-2">
          <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Company</p>
          <div className="font-black text-slate-800 text-xs leading-tight uppercase border-l-4 border-fuchsia-600 pl-3 truncate">
            {item.name}
          </div>
        </div>

        {/* 2. Editable Address (Span 3) */}
        <div className="lg:col-span-3 space-y-1">
          <p className="text-[9px] font-black text-slate-400 uppercase">Address</p>
          <textarea
            className="w-full p-2 bg-slate-50 rounded-xl text-[11px] font-bold border-none focus:ring-1 focus:ring-fuchsia-300 min-h-[60px] resize-none"
            defaultValue={item.address}
            onBlur={(e) => (item.address = e.target.value)}
          />
        </div>

        {/* 3. Editable Route Area (Span 3) */}
        <div className="lg:col-span-3 space-y-1">
          <p className="text-[9px] font-black text-fuchsia-600 uppercase flex items-center gap-1">
            <FiMapPin size={10} /> Route Areas
          </p>
          <textarea
            className="w-full p-2 bg-slate-50 rounded-xl text-[11px] font-bold border-none focus:ring-1 focus:ring-fuchsia-300 min-h-[60px] resize-none"
            defaultValue={item.deliveryArea}
            onBlur={(e) => (item.deliveryArea = e.target.value)}
          />
        </div>

        {/* 4. Contacts (Span 3) - One Row Layout */}
        <div className="lg:col-span-3 space-y-1">
          <p className="text-[9px] font-black text-slate-400 uppercase">Contact List</p>
          <div className="space-y-1 max-h-[80px] overflow-y-auto pr-1 custom-scrollbar">
            {item.contacts.map((c: any, ci: number) => (
              <div key={ci} className="flex gap-2 items-center bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-100">
                <div className="flex items-center gap-1 flex-1 border-r border-slate-200">
                  <FiUser className="text-slate-300" size={10} />
                  <input
                    className="bg-transparent text-[10px] font-bold w-full outline-none focus:text-fuchsia-600"
                    value={c.person}
                    placeholder="Name"
                    onChange={(e) => handleContactEdit(index, ci, "person", e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1 flex-1">
                  <FiPhone className="text-slate-300" size={10} />
                  <input
                    className="bg-transparent text-[10px] font-bold w-full outline-none focus:text-fuchsia-600"
                    value={c.mobile}
                    placeholder="Mobile"
                    onChange={(e) => handleContactEdit(index, ci, "mobile", e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Save Action (Span 1) - Only Icon */}
        <div className="lg:col-span-1 flex justify-center">
          <button
            onClick={() => handleInlineUpdate(item._id, item)}
            className="p-4 bg-emerald-500 text-white rounded-2xl hover:bg-emerald-600 transition-all shadow-md shadow-emerald-100 active:scale-90"
            title="Save Changes"
          >
            <FiSave size={20} />
          </button>
        </div>

      </div>
    </div>
  ))}
</div>
            </div>
        </div>
    );
}