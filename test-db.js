const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

async function testConnection() {
  try {
    console.log("Attempting to connect to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected successfully!");

    const ArticleSchema = new mongoose.Schema({
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
      title: String,
      category: String
    });

    // Check if model already exists to avoid errors if this script is run multiple times
    const Article = mongoose.models.Article || mongoose.model("Article", ArticleSchema);

    console.log("Fetching articles...");
    const articles = await Article.find().limit(1);
    console.log("Articles fetched successfully:", articles);

    process.exit(0);
  } catch (err) {
    console.error("DB Test Error:", err);
    process.exit(1);
  }
}

testConnection();
