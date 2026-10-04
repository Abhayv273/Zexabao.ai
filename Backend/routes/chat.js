import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Thread, { User } from "../models/Threads.js";
import getGeminiAPIResponse from "../utils/geminiai.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const DAILY_LIMIT = 10;

// Auth guard: checks the Bearer token and loads the logged-in user into req.user
const requireAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Please log in" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: "Please log in" });
    }

    req.user = user;
    next();
  } catch (err) {
    // Bad, tampered or expired token -> 401 so the frontend asks the user to log in again
    if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(err.name)) {
      return res.status(401).json({ error: "Please log in" });
    }
    console.log(err);
    res.status(500).json({ error: "Authentication failed" });
  }
};

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

// Get all threads
router.get("/thread", requireAuth, async (req, res) => {
  try {
    // Only this user's threads, and only the fields the sidebar needs
    const threads = await Thread.find({ userId: req.user._id })
      .select("threadId title updatedAt")
      .sort({ updatedAt: -1 });
    res.json(threads);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

// specific thread message
router.get("/thread/:threadId", requireAuth, async (req, res) => {
  const { threadId } = req.params;

  try {
    const thread = await Thread.findOne({ threadId, userId: req.user._id });
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
router.delete("/thread/:threadId", requireAuth, async (req, res) => {
  const { threadId } = req.params;

  try {
    const deletedThread = await Thread.findOneAndDelete({
      threadId,
      userId: req.user._id,
    });
    if (!deletedThread) {
      return res.status(404).json({ error: "Thread not found" });
    }
    res.status(200).json({ success: "Thread deleted successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

// new chat+reply post route (login required: thread + daily limit belong to this user only)
router.post("/chat", requireAuth, async (req, res) => {
  const { threadId, message } = req.body;
  const user = req.user;

  if (!threadId || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    let thread = await Thread.findOne({ threadId });

    // Someone else's thread id -> act as if it does not exist
    if (thread && String(thread.userId) !== String(user._id)) {
      return res.status(404).json({ error: "Thread not found" });
    }

    // Daily limit is stored on this user only
    const now = new Date();
    const lastReset = new Date(user.dailyUsage.lastReset);
    const isSameDay = now.toDateString() === lastReset.toDateString();

    if (!isSameDay) {
      user.dailyUsage.count = 0;
      user.dailyUsage.lastReset = now;
    }

    // Limit end  -> Status 429 bhejega
    if (user.dailyUsage.count >= DAILY_LIMIT) {
      return res.status(429).json({ error: "Limit over today" });
    }


    user.dailyUsage.count += 1;
    await user.save();

    if (!thread) {
      thread = new Thread({
        threadId,
        userId: user._id,
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