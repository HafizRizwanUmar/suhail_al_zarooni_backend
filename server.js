const dotenv = require("dotenv");
const path = require("path");
dotenv.config({ path: path.join(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cloudinary = require("cloudinary").v2;
const fileUpload = require("express-fileupload");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const nodemailer = require("nodemailer");
const axios = require("axios");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload({useTempFiles: true}));

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmailToSubscribers = async (article) => {
  try {
    const subscribers = await Subscription.find();
    if (subscribers.length === 0) return;

    const emails = subscribers.map(s => s.email).join(", ");
    const mailOptions = {
      from: `"Zarooni Portal" <${process.env.EMAIL_USER}>`,
      to: emails,
      subject: `New Article: ${article.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #021264;">${article.title}</h2>
          <img src="${article.imageUrl}" style="width: 100%; border-radius: 10px;" alt="${article.title}" />
          <p style="font-size: 16px; color: #333; margin-top: 20px;">${article.metaDescription || "A new update from Suhail Al Zarooni."}</p>
          <a href="http://localhost:3000/article/${article.slug}" style="display: inline-block; background: #520000; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin-top: 20px;">Read More</a>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #999;">You are receiving this email because you subscribed to the Zarooni Legacy Program portal.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("Notification emails sent successfully");
  } catch (error) {
    console.error("Error sending emails:", error);
  }
};

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of default 30s
  })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("Error connecting to MongoDB:", err.message));

// Disable global buffering so queries fail quickly if DB is unreachable
mongoose.set('bufferCommands', false);

// Users Schema and Model (Moved up to ensure populate works)
const UserSchema = new mongoose.Schema({
  firstName: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  lastName: { type: String },
  occuption: { type: String },
  description: { type: String },
  role: { 
    type: String, 
    enum: ["super_admin", "admin", "editor", "contributor"], 
    default: "contributor" 
  },
  isAdmin: { type: Boolean, default: false },
  profileUrl: { type: String },
  isActive: { type: Boolean, default: true },
  subscribedToUpdates: { type: Boolean, default: true }, // For email updates
  gumroadLicense: { type: String }, // To track their license
  createdAt: { type: Date, default: Date.now },
});
const Users = mongoose.model("Users", UserSchema);

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' }, // Null for public notifications
  message: { type: String, required: true },
  type: { type: String, enum: ['article', 'system', 'legacy'], default: 'article' },
  link: { type: String },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
const Notifications = mongoose.model("Notifications", NotificationSchema);

// Article Schema and Model
const ArticleSchema = new mongoose.Schema({
  user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true
    },
  title: {type: String, required: true},
  slug: {type: String, unique: true}, // SEO Friendly URL
  category: {type: String, required: true},
  content: {type: String, required: true}, 
  imageUrl: {type: String, required: true},
  metaTitle: {type: String},
  metaDescription: {type: String},
  focusKeyword: {type: String},
  views: {type: Number, default: 0},
  likes: {type: Number, default: 0},
  likedBy: [{ type: String }],
  status: { 
    type: String, 
    enum: ["pending", "approved", "rejected"], 
    default: "pending" 
  },
  isApproved: {type: Boolean, default: false},
  createdAt: {type: Date, default: Date.now},
});

// Helper function to generate slug
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') + '-' + Math.random().toString(36).substring(2, 7);
};

const ArticleModel = mongoose.model("Article", ArticleSchema);

// Auth Middlewares
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token, authorization denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

const checkRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Access denied. Insufficient permissions." });
  }
  next();
};

app.post("/articles", verifyToken, async (req, res) => {
  try {
    const {title, category, content, metaTitle, focusKeyword, metaDescription } = req.body;
    const userId = req.user.userId; 
    const imageFile = req.files?.image;

    if (!title || !category || !content || !imageFile) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const uploadResponse = await cloudinary.uploader.upload(
      imageFile.tempFilePath,
      { folder: "articles" }
    );

    const newArticleDoc = new ArticleModel({
      title,
      slug: generateSlug(title),
      user: userId, 
      category,
      content,
      imageUrl: uploadResponse.secure_url,
      metaDescription,
      metaTitle,
      focusKeyword,
      isApproved: req.user.role === 'admin' || req.user.role === 'super_admin' 
    });

    await newArticleDoc.save();

    // Sync to data.json
    const userDoc = await Users.findById(userId);
    const newArticleJSON = {
      ...newArticleDoc.toObject(),
      user: userDoc ? {
        _id: userDoc._id,
        firstName: userDoc.firstName,
        lastName: userDoc.lastName,
        role: userDoc.role
      } : { _id: userId }
    };

    const dataPath = path.join(__dirname, "data.json");
    let articles = [];
    if (fs.existsSync(dataPath)) {
      articles = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    }
    articles.push(newArticleJSON);
    fs.writeFileSync(dataPath, JSON.stringify(articles, null, 2));

    res.status(201).json({message: "Article submitted successfully", data: newArticleDoc});
  } catch (err) {
    console.error("Error adding article:", err);
    res.status(500).json({message: "Server error"});
  }
});

// New Analytics Routes
app.put("/articles/:id/view", async (req, res) => {
  try {
    const article = await ArticleModel.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    
    // Sync to data.json
    const dataPath = path.join(__dirname, "data.json");
    if (fs.existsSync(dataPath)) {
      const articles = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      const index = articles.findIndex(a => a._id.toString() === req.params.id);
      if (index !== -1) {
        articles[index].views = (articles[index].views || 0) + 1;
        fs.writeFileSync(dataPath, JSON.stringify(articles, null, 2));
      }
    }
    
    res.json({ message: "View counted" });
  } catch (error) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/articles/:id/like", async (req, res) => {
  try {
    const article = await ArticleModel.findById(req.params.id);
    if (!article) return res.status(404).json({ message: "Not found" });

    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ message: "deviceId is required" });

    const index = article.likedBy.indexOf(deviceId);

    if (index === -1) {
      article.likedBy.push(deviceId);
      article.likes += 1;
    } else {
      article.likedBy.splice(index, 1);
      article.likes -= 1;
    }

    await article.save();

    // Sync to data.json
    const dataPath = path.join(__dirname, "data.json");
    if (fs.existsSync(dataPath)) {
      const articles = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      const jsonIndex = articles.findIndex(a => a._id.toString() === req.params.id);
      if (jsonIndex !== -1) {
        articles[jsonIndex].likes = article.likes;
        articles[jsonIndex].likedBy = article.likedBy;
        fs.writeFileSync(dataPath, JSON.stringify(articles, null, 2));
      }
    }

    res.json({ likes: article.likes, liked: index === -1 });
  } catch (error) {
    res.status(500).json({ message: "Error" });
  }
});

// Role-based Stats API
app.get("/admin/stats", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    const dataPath = path.join(__dirname, "data.json");
    let articles = [];
    if (fs.existsSync(dataPath)) {
      articles = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    }

    // Filter by user if not admin
    if (role === 'editor' || role === 'contributor') {
      articles = articles.filter(a => (a.user?._id || a.user) === userId);
    }

    const totalArticles = articles.length;
    const totalViews = articles.reduce((sum, art) => sum + (art.views || 0), 0);
    const totalLikes = articles.reduce((sum, art) => sum + (art.likes || 0), 0);
    const pendingApprovals = articles.filter(a => !a.isApproved).length;

    res.json({
      totalArticles,
      totalViews,
      totalLikes,
      pendingApprovals
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ message: "Error fetching stats" });
  }
});

app.get("/articles", async (req, res) => {
  console.log("Articles request received. Reading from data.json");
  try {
    const dataPath = path.join(__dirname, "data.json");
    if (!fs.existsSync(dataPath)) {
      return res.status(200).json({ data: [] });
    }
    
    const fileContent = fs.readFileSync(dataPath, "utf-8");
    let articles = JSON.parse(fileContent);

    // Admins can see everything with ?all=true
    // For the JSON file, we'll implement simple filtering
    const showAll = req.query.all === 'true';
    if (!showAll) {
      articles = articles.filter(a => a.isApproved);
    }
    
    // Sort by createdAt descending
    articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({ data: articles });
  } catch (err) {
    console.error("Error reading data.json:", err);
    res.status(500).json({ message: "Error fetching articles from file" });
  }
});

app.put("/articles/:id/approve", verifyToken, checkRole(["admin", "super_admin"]), async (req, res) => {
  const {id} = req.params;

  try {
    const article = await ArticleModel.findById(id);
    if (!article) return res.status(404).json({message: "Article not found"});
    
    article.isApproved = true;
    article.status = 'approved';
    await article.save();

    // Sync to data.json
    const dataPath = path.join(__dirname, "data.json");
    if (fs.existsSync(dataPath)) {
      const articles = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      const index = articles.findIndex(a => a._id.toString() === id);
      if (index !== -1) {
        articles[index].isApproved = true;
        articles[index].status = 'approved';
        fs.writeFileSync(dataPath, JSON.stringify(articles, null, 2));
      }
    }

    // Trigger Notifications
    await sendEmailToSubscribers(article);
    
    // Create in-app notification
    const notification = new Notifications({
      message: `New Article Published: ${article.title}`,
      type: 'article',
      link: `/article/${article.slug}`
    });
    await notification.save();
    
    res.json({message: `Article approved successfully`});
  } catch (error) {
    console.error("Approval error:", error);
    res.status(500).json({message: "Server error"});
  }
});

app.delete("/articles/:id", verifyToken, checkRole(["admin", "super_admin"]), async (req, res) => {
  try {
    const {id} = req.params;
    const deletedArticle = await ArticleModel.findByIdAndDelete(id);

    if (!deletedArticle) {
      return res.status(404).json({message: "Article not found"});
    }

    // Sync to data.json
    const dataPath = path.join(__dirname, "data.json");
    if (fs.existsSync(dataPath)) {
      let articles = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      articles = articles.filter(a => a._id.toString() !== id);
      fs.writeFileSync(dataPath, JSON.stringify(articles, null, 2));
    }

    res.status(200).json({message: "Article deleted successfully"});
  } catch (err) {
    console.error("Error deleting article:", err);
    res.status(500).json({message: "Server error"});
  }
});

const SubscriptionSchema = new mongoose.Schema({
  email: {type: String, required: true, unique: true},
  subscribedAt: {type: Date, default: Date.now},
});

const Subscription = mongoose.model("Subscription", SubscriptionSchema);

// Register Route
app.post("/register", async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    role,
    occuption,
    isAdmin,
    description,
    amount,
    paymentMethodId,
  } = req.body;

  const imageFile = req.files?.image;
  // Validate data (you can add more validation here)
  if (!email || !password) {
    return res.status(400).json({message: "All fields are required"});
  }

  try {
    // Check if user exists
    const userExists = await Users.findOne({email});
    if (userExists) {
      return res.status(400).json({message: "User already exists"});
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    const uploadResponse = await cloudinary.uploader.upload(
      imageFile.tempFilePath,
      {
        folder: "users",
      }
    );

    // Create a payment intent on Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Amount should be in cents
      currency: "usd",
      payment_method: paymentMethodId,
      confirmation_method: "manual",
      confirm: true,
    });

    // Save user to database
    const newUser = new Users({
      firstName,
      lastName,
      email,
      role,
      occuption,
      isAdmin,
      description,
      password: hashedPassword,
      profileUrl: uploadResponse.secure_url,
      amount,
      paymentStatus: paymentIntent.status,
      paymentId: paymentIntent.id,
    });
    await newUser.save();

    res.status(201).json({message: "User registered successfully"});
  } catch (err) {
    console.error(err);
    res.status(500).json({message: "Server error"});
  }
});

// Login Route
app.post("/login", async (req, res) => {
  const {email, password} = req.body;

  if (!email || !password) {
    return res.status(400).json({message: "Email and password are required"});
  }

  try {
    // Check if user exists
    const user = await Users.findOne({email});
    if (!user) {
      return res.status(400).json({message: "Invalid credentials"});
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({message: "Invalid credentials"});
    }

    // Create JWT token
    const token = jwt.sign(
      {userId: user._id, role: user.role},
      process.env.JWT_SECRET, // JWT Secret key (store in .env)
      {expiresIn: "1h"} // Token expiration time
    );

    res.status(200).json({
      message: "Login successful", 
      token, 
      user: { 
        id: user._id, 
        email: user.email, 
        role: user.role, 
        firstName: user.firstName,
        lastName: user.lastName 
      } 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({message: "Server error"});
  }
});

// Create User (Super Admin Only)
app.post("/admin/create-user", verifyToken, checkRole(["super_admin"]), async (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;
  
  if (!email || !password || !role) {
    return res.status(400).json({ message: "Email, password, and role are required" });
  }

  try {
    const userExists = await Users.findOne({ email });
    if (userExists) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new Users({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role,
      isAdmin: role === 'admin' || role === 'super_admin'
    });

    await newUser.save();
    res.status(201).json({ message: "User created successfully", user: { email, role } });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Setup Super Admin (One-time)
app.post("/setup-super-admin", async (req, res) => {
    const { secret, email, password } = req.body;
    if (secret !== "Zarooni_Init_2026") return res.status(403).json({ message: "Forbidden" });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const superAdmin = new Users({
            firstName: "Super",
            lastName: "Admin",
            email,
            password: hashedPassword,
            role: "super_admin",
            isAdmin: true
        });
        await superAdmin.save();
        res.status(201).json({ message: "Super Admin initialized" });
    } catch (err) {
        res.status(500).json({ message: "Error", error: err.message });
    }
});
app.get("/allUsers", async (req, res) => {
  try {
    const users = await Users.find().sort({createdAt: -1}); // Fetch all articles, sorted by creation date
    res.status(200).json({data: users});
  } catch (err) {
    console.error("Error fetching articles:", err);
    res.status(500).json({message: "Server error"});
  }
});
app.put("/user/:id/activate", async (req, res) => {
  const {id} = req.params;
  const {action} = req.body; // action can be 'activate' or 'deactivate'

  try {
    // Find the user by ID
    const user = await Users.findById(id);
    if (!user) {
      return res.status(404).json({message: "User not found"});
    }

    // Update user active status based on action
    if (action === "activate") {
      user.isActive = true;
    } else if (action === "deactivate") {
      user.isActive = false;
    } else {
      return res.status(400).json({message: "Invalid action"});
    }

    // Save the user
    await user.save();
    res.json({message: `User ${action}d successfully`, user});
  } catch (error) {
    res.status(500).json({message: "Server error", error: error.message});
  }
});
app.delete("/user/:id", async (req, res) => {
    try {
      const {id} = req.params;
      const deletedUser = await Users.findByIdAndDelete(id);
  
      if (!deletedUser) {
        return res.status(404).json({message: "user not found"});
      }
  
      res.status(200).json({message: "user deleted successfully"});
    } catch (err) {
      console.error("Error deleting user:", err);
      res.status(500).json({message: "Server error"});
    }
  });
  
app.post("/subscribe", async (req, res) => {
  const {email} = req.body;
  if (!email) {
    return res.status(400).json({message: "Email is required"});
  }

  try {
    const existing = await Subscription.findOne({ email });
    if (existing) return res.status(200).json({ message: "Already subscribed!" });

    const newSubscription = new Subscription({email});
    await newSubscription.save();
    res.status(201).json({message: "Subscription successful!"});
  } catch (err) {
    console.error("Error saving subscription:", err);
    res.status(500).json({message: "Server error"});
  }
});

// Gumroad License Validation
app.post("/api/legacy/validate-license", async (req, res) => {
  const { licenseKey, productPermalink } = req.body;
  
  if (!licenseKey) return res.status(400).json({ message: "License key is required" });

  try {
    // Call Gumroad API
    const response = await axios.post("https://api.gumroad.com/v2/licenses/verify", {
      product_permalink: productPermalink || "zarooni-legacy-program", // Placeholder if not provided
      license_key: licenseKey,
    });

    if (response.data.success) {
      res.json({ success: true, message: "License validated", data: response.data });
    } else {
      res.status(400).json({ success: false, message: "Invalid license key" });
    }
  } catch (error) {
    console.error("Gumroad API Error:", error.response?.data || error.message);
    res.status(400).json({ success: false, message: error.response?.data?.message || "Validation failed" });
  }
});

// Legacy Program Specific Registration
app.post("/api/legacy/register", async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    licenseKey,
    occuption,
    description
  } = req.body;

  const imageFile = req.files?.image;

  if (!email || !password || !licenseKey) {
    return res.status(400).json({ message: "Email, password, and license key are required" });
  }

  try {
    // 1. Verify License with Gumroad
    const gumroadRes = await axios.post("https://api.gumroad.com/v2/licenses/verify", {
      product_permalink: "zarooni-legacy-program", 
      license_key: licenseKey,
    }).catch(e => null);

    if (!gumroadRes || !gumroadRes.data.success) {
      return res.status(400).json({ message: "Invalid or expired Legacy Program license" });
    }

    // 2. Check if user exists
    const userExists = await Users.findOne({ email });
    if (userExists) return res.status(400).json({ message: "User already registered" });

    // 3. Upload Image
    let profileUrl = "";
    if (imageFile) {
      const uploadRes = await cloudinary.uploader.upload(imageFile.tempFilePath, { folder: "users" });
      profileUrl = uploadRes.secure_url;
    }

    // 4. Create User with Contributor Role
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new Users({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: "contributor",
      occuption,
      description,
      profileUrl,
      gumroadLicense: licenseKey,
      subscribedToUpdates: true
    });

    await newUser.save();
    
    // 5. Automatically add to Subscription list
    await Subscription.findOneAndUpdate({ email }, { email }, { upsert: true });

    res.status(201).json({ message: "Welcome to the Zarooni Legacy Program! You can now login." });
  } catch (error) {
    console.error("Legacy Register Error:", error);
    res.status(500).json({ message: "Registration failed. Please try again." });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
