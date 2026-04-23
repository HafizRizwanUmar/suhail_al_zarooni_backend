const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

async function seed() {
  try {
    console.log("Connecting to local MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected successfully.");

    // Define Shcemas based on server.js
    const UserSchema = new mongoose.Schema({
      firstName: String,
      email: { type: String, unique: true },
      password: { type: String, required: true },
    });
    const Users = mongoose.models.Users || mongoose.model("Users", UserSchema);

    const ArticleSchema = new mongoose.Schema({
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', required: true },
      title: { type: String, required: true },
      category: { type: String, required: true },
      content: { type: String, required: true },
      imageUrl: { type: String, required: true },
      metaTitle: String,
      metaDescription: String,
      focusKeyword: String,
      isApproved: { type: Boolean, default: true },
      createdAt: { type: Date, default: Date.now }
    });
    const Article = mongoose.models.Article || mongoose.model("Article", ArticleSchema);

    // 1. Clear existing articles
    console.log("Clearing existing articles...");
    await Article.deleteMany({});

    // 2. Ensure a default user exists
    let adminUser = await Users.findOne({ email: "admin@alzarooni.com" });
    if (!adminUser) {
      console.log("Creating default Admin user...");
      adminUser = new Users({
        firstName: "Suhail",
        email: "admin@alzarooni.com",
        password: "password123" // In real app, this should be hashed
      });
      await adminUser.save();
    }

    // 3. Generate 3 articles per category
    const categories = ["foundation", "event", "media", "museum", "collection", "meetup"];
    const albumImages = ["/album1.jpg", "/album2.jpg", "/album3.jpg", "/album4.png"];
    
    const articlesToInsert = [];

    categories.forEach((cat) => {
      for (let i = 1; i <= 3; i++) {
        articlesToInsert.push({
          user: adminUser._id,
          title: `${cat.charAt(0).toUpperCase() + cat.slice(1)} Innovation - Volume ${i}`,
          category: cat,
          content: `This is a detailed article about the latest achievements in the ${cat} sector of Al Zarooni World. Article #${i} coverage.`,
          imageUrl: albumImages[i % albumImages.length],
          metaTitle: `${cat} meta title ${i}`,
          metaDescription: `Meta description for ${cat} article ${i}`,
          focusKeyword: cat,
          isApproved: true
        });
      }
    });

    console.log(`Inserting ${articlesToInsert.length} articles...`);
    await Article.insertMany(articlesToInsert);

    console.log("Seeding completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Seeding Error:", err);
    process.exit(1);
  }
}

seed();
