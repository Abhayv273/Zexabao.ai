import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Thread, { User } from "../models/Threads.js";
import getGeminiAPIResponse from "../utils/geminiai.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const DAILY_LIMIT = 5;

// AUTH ROUTES 

// 1. SIGNUP: /api/signup
router.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      email,
      password: hashedPassword,
    });

    await newUser.save();
    res.status(201).json({ message: "Account created successfully" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Failed to signup" });
  }
});

// 2. LOGIN: /api/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, message: "Login successful" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Failed to login" });
  }
});

// CHAT & THREAD ROUTES 

// test route
router.post("/test", async (req, res) => {
  try {
    const thread = new Thread({
      threadId: "qwerty12345",
      title: "New Thread",
    });

    const response = await thread.save();
    res.send(response);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to save in db" });
  }
});

// Get all threads
router.get("/thread", async (req, res) => {
  try {
    const threads = await Thread.find({}).sort({ updatedAt: -1 });
    res.json(threads);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

// specific thread message
router.get("/thread/:threadId", async (req, res) => {
  const { threadId } = req.params;

  try {
    const thread = await Thread.findOne({ threadId });
    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }
    res.json(thread.messages);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to fetch chat" });
  }
});

// delete chat/chat history
router.delete("/thread/:threadId", async (req, res) => {
  const { threadId } = req.params;

  try {
    const deletedThread = await Thread.findOneAndDelete({ threadId });
    if (!deletedThread) {
      return res.status(404).json({ error: "Thread not found" });
    }
    res.status(200).json({ success: "Thread deleted successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

// new chat+reply post route (DAILY LIMIT 429 CHECK INCLUDED)
router.post("/chat", async (req, res) => {
  const { threadId, message } = req.body;
  const authHeader = req.headers.authorization;

  if (!threadId || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // limit check first then token send to header
    if (authHeader) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (user) {
        const now = new Date();
        const lastReset = new Date(user.dailyUsage.lastReset);
        const isSameDay = now.toDateString() === lastReset.toDateString();

        if (!isSameDay) {
          user.dailyUsage.count = 0;
          user.dailyUsage.lastReset = now;
        }

        // Limit Accessed -> Status 429 
        if (user.dailyUsage.count >= DAILY_LIMIT) {
          return res.status(429).json({ error: "Limit over today" });
        }

        user.dailyUsage.count += 1;
        await user.save();
      }
    }

    let thread = await Thread.findOne({ threadId });

    if (!thread) {
      thread = new Thread({
        threadId,
        title: message,
        messages: [{ role: "user", content: message }],
      });
    } else {
      thread.messages.push({ role: "user", content: message });
    }

    const { text, interactionId } = await getGeminiAPIResponse(
      message,
      thread.geminiInteractionId
    );

    thread.messages.push({ role: "model", content: text });
    thread.geminiInteractionId = interactionId;
    thread.updatedAt = Date.now();

    await thread.save();
    res.json({ reply: text });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

export default router;