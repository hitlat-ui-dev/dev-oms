const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    permissions: {
        addSeller: { type: Boolean, default: false },
        purchaseReq: { type: Boolean, default: false },
        addOrder: { type: Boolean, default: false },
        addTransporter: { type: Boolean, default: false },
        addMyCompanies: { type: Boolean, default: false },
        stock: { type: Boolean, default: false },
        editStock: { type: Boolean, default: false },
        addVendor: { type: Boolean, default: false },
        addNewItem: { type: Boolean, default: false },
        purchase: { type: Boolean, default: false },
        boss: { type: Boolean, default: false },
        users: { type: Boolean, default: false },
        dashboard: { type: Boolean, default: false },
    }
});