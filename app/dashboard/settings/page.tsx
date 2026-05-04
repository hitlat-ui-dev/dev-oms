"use client";
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";
import { useState, useEffect } from "react";

// Define the initial state so we can reuse it to clear the form
const initialState = {
    username: "",
    password: "",
    permissions: {
        addSeller: false,
        purchaseReq: false,
        addOrder: false,
        addTransporter: false,
        addMyCompanies: false,
        stock: false,
        editStock: false,
        addVendor: false,
        addNewItem: false,
        purchase: false,
        boss: false,
        users: false,
        dashboard: false,
    },
};

export default function ManageUsers() {
    const [formData, setFormData] = useState(initialState);
    const [users, setUsers] = useState([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);

    const fetchUsers = async () => {
        const res = await fetch("/api/users");
        const data = await res.json();
        if (res.ok) setUsers(data);
    };
    useEffect(() => {
        setIsMounted(true);
        fetchUsers();
    }, []);

    // If not mounted, return a shell or null to prevent mismatch
    if (!isMounted) return <div suppressHydrationWarning />;

    const handleCheckboxChange = (name: string) => {
        setFormData((prev) => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [name]: !prev.permissions[name as keyof typeof prev.permissions],
            },
        }));
    };

    // 2. Combined Create and Update logic
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const method = editingId ? "PUT" : "POST";
        const url = editingId ? `/api/users/${editingId}` : "/api/users";

        const res = await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData),
        });

        if (res.ok) {
            alert(editingId ? "User Updated" : "User Created");
            setFormData(initialState); // CLEAR DATA
            setEditingId(null);
            fetchUsers(); // REFRESH BOTTOM LIST
        } else {
            const err = await res.json();
            alert(err.error);
        }
    };

    // 3. Delete Logic
    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure?")) return;
        const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
        if (res.ok) fetchUsers();
    };

    // 4. Set form for editing
    const startEdit = (user: any) => {
        setEditingId(user._id);
        setFormData({
            username: user.username || "",
            password: user.password || "", // Ensure the existing password fills the box
            permissions: {
                addSeller: user.permissions?.addSeller || false,
                purchaseReq: user.permissions?.purchaseReq || false,
                addOrder: user.permissions?.addOrder || false,
                addTransporter: user.permissions?.addTransporter || false,
                addMyCompanies: user.permissions?.addMyCompanies || false,
                stock: user.permissions?.stock || false,
                editStock: user.permissions?.editStock || false,
                addVendor: user.permissions?.addVendor || false,
                addNewItem: user.permissions?.addNewItem || false,
                purchase: user.permissions?.purchase || false,
                boss: user.permissions?.boss || false,
                users: user.permissions?.users || false,
                dashboard: user.permissions?.dashboard || false,
            },
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <BlockGuard
            permission="users"
            fallback={
                <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
                    <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
                    <Link
                        href="/dashboard"
                        className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all"
                    >
                        Go to Dashboard
                    </Link>
                </div>
            }
        >
            <div suppressHydrationWarning className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-slate-50/50 space-y-8">
                {/* FORM SECTION */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-6">
                    <h2 className="text-2xl font-bold mb-6">
                        {editingId ? "✏️ Edit User Access" : "👤 Create New User"}
                    </h2>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input
                                type="text"
                                placeholder="Username"
                                value={formData.username}
                                className="p-3 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                required
                            />
                            <input
                                type="text"
                                placeholder="Password"
                                // The || "" prevents the "controlled/uncontrolled" warning
                                value={formData.password || ""}
                                className="p-3 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-2xl">
                            {Object.keys(formData.permissions).map((perm) => (
                                <label key={perm} className="flex items-center gap-3 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={formData.permissions[perm as keyof typeof formData.permissions]}
                                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        onChange={() => handleCheckboxChange(perm)}
                                    />
                                    <span className="text-sm font-medium text-slate-700 capitalize">
                                        {perm.replace(/([A-Z])/g, " $1").trim()}
                                    </span>
                                </label>
                            ))}
                        </div>

                        <div className="flex gap-3">
                            <button type="submit" className="flex-1 bg-blue-600 text-white p-4 rounded-xl font-bold hover:bg-blue-700 transition-colors">
                                {editingId ? "Update Access" : "Create User Access"}
                            </button>
                            {editingId && (
                                <button
                                    type="button"
                                    onClick={() => { setEditingId(null); setFormData(initialState); }}
                                    className="bg-slate-200 px-6 rounded-xl font-bold"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                </div>

                {/* DATA TABLE SECTION */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold text-slate-800">Existing Users</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 text-slate-600 uppercase text-xs font-bold">
                                <tr>
                                    <th className="p-4">Username</th>
                                    {/* <th className="p-4">Password</th> */}
                                    <th className="p-4">Permissions Blocked</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {users.map((user: any) => (
                                    <tr key={user._id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-4 font-medium text-slate-900">{user.username}</td>
                                        {/* <td className="p-4 text-slate-500 text-sm">{user.password}</td> */}
                                        <td className="p-4">
                                            <div className="flex flex-wrap gap-1">
                                                {Object.entries(user.permissions)
                                                    .filter(([_, val]) => val === true) // Show what is blocked
                                                    .map(([key]) => (
                                                        <span key={key} className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                                                            {key}
                                                        </span>
                                                    ))}
                                                {Object.values(user.permissions).every(v => v === false) &&
                                                    <span className="text-green-600 text-[10px] font-bold uppercase">Full Access</span>
                                                }
                                            </div>
                                        </td>
                                        <td className="p-4 text-right space-x-2">
                                            <button
                                                onClick={() => startEdit(user)}
                                                className="text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(user._id)}
                                                className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </BlockGuard>
    );
}