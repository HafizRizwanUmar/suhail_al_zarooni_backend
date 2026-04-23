const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

// Define User Schema (Simplified for script)
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'contributor' },
    firstName: String,
    lastName: String,
    isAdmin: Boolean
});

const User = mongoose.model('Users', UserSchema);

async function initAdmin() {
    try {
        const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/SuhailDB';
        await mongoose.connect(uri);
        console.log('Connected to DB');

        const existing = await User.findOne({ email: 'admin@zarooni.com' });
        if (existing) {
            console.log('User already exists. Updating password...');
            existing.password = await bcrypt.hash('Admin@123', 10);
            existing.role = 'super_admin';
            existing.isAdmin = true;
            await existing.save();
        } else {
            const hashedPassword = await bcrypt.hash('Admin@123', 10);
            const admin = new User({
                firstName: 'Suhail',
                lastName: 'Admin',
                email: 'admin@zarooni.com',
                password: hashedPassword,
                role: 'super_admin',
                isAdmin: true
            });
            await admin.save();
            console.log('Super Admin created successfully!');
        }
        
        console.log('Email: admin@zarooni.com');
        console.log('Password: Admin@123');
        mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

initAdmin();
