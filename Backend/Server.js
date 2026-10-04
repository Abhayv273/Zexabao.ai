import express from "express";
import "dotenv/config";
import cors from "cors";
import mongoose from "mongoose";

import chatRoutes from "./routes/chat.js";

const app = express();
const PORT = process.env.PORT;

app.use(express.json());
app.use(cors());
app.use("/api", chatRoutes);

app.listen(PORT, () => {
  console.log(`Server is listing on ${PORT}`);
  connectDB();
});
// database connectivity 
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to Database!");
  } catch (err) {
    console.log("Failed to connect with DB", err);
  }
};