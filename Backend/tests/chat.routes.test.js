import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// chat.js reads JWT_SECRET when it is imported, so set it first
process.env.JWT_SECRET = "test-secret";

const createdThreads = [];
const createdUsers = [];

jest.unstable_mockModule("../models/Threads.js", () => {
  const Thread = jest.fn(function (data) {
    Object.assign(this, data);
    this.messages = this.messages || [];
    this.save = jest.fn().mockResolvedValue(this);
    createdThreads.push(this);
  });
  Thread.find = jest.fn();
  Thread.findOne = jest.fn();
  Thread.findOneAndDelete = jest.fn();
  const User = jest.fn(function (data) {
    Object.assign(this, data);
    this.save = jest.fn().mockResolvedValue(this);
    createdUsers.push(this);
  });
  User.findOne = jest.fn();
  User.findById = jest.fn();
  return { default: Thread, Thread, User };
});
jest.unstable_mockModule("../utils/geminiai.js", () => ({ default: jest.fn() }));

// Mocks must be registered before the modules are imported
const { default: router } = await import("../routes/chat.js");
const ThreadsModule = await import("../models/Threads.js");
const Thread = ThreadsModule.default;
const { User } = ThreadsModule;
const { default: getGeminiAPIResponse } = await import("../utils/geminiai.js");

const app = express();
app.use(express.json());
app.use("/api", router);

const SECRET = "test-secret";
const tokenFor = (id = "u1", opts = {}) => jwt.sign({ id }, SECRET, opts);
const makeUser = (count = 0, lastReset = new Date()) => ({
  dailyUsage: { count, lastReset },
  save: jest.fn().mockResolvedValue(true),
});
const makeThread = (extra = {}) => ({
  threadId: "t1",
  messages: [{ role: "user", content: "old q" }],
  geminiInteractionId: "int-1",
  save: jest.fn().mockResolvedValue(true),
  ...extra,
});

beforeEach(() => {
  [Thread.find, Thread.findOne, Thread.findOneAndDelete, User.findOne, User.findById, getGeminiAPIResponse].forEach((m) => m.mockReset());
  Thread.mockClear();
  User.mockClear();
  createdThreads.length = 0;
  createdUsers.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/signup", () => {
  it("400 when email or password is missing", async () => {
    const res = await request(app).post("/api/signup").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  it("400 when user already exists", async () => {
    User.findOne.mockResolvedValue({ email: "a@b.com" });
    const res = await request(app).post("/api/signup").send({ email: "a@b.com", password: "pw123456" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("User already exists");
  });

  it("201 and stores a hashed password, never the plain one", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(app).post("/api/signup").send({ email: "a@b.com", password: "pw123456" });
    expect(res.status).toBe(201);
    const saved = createdUsers[0];
    expect(saved.password).not.toBe("pw123456");
    expect(bcrypt.compareSync("pw123456", saved.password)).toBe(true);
    expect(saved.save).toHaveBeenCalled();
  });

  it("500 when the database fails", async () => {
    User.findOne.mockRejectedValue(new Error("db down"));
    const res = await request(app).post("/api/signup").send({ email: "a@b.com", password: "pw123456" });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/login", () => {
  const hash = bcrypt.hashSync("pw123456", 4);

  it("400 for unknown email", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(app).post("/api/login").send({ email: "x@y.com", password: "pw123456" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("400 for wrong password (same message as unknown email)", async () => {
    User.findOne.mockResolvedValue({ _id: "u1", password: hash });
    const res = await request(app).post("/api/login").send({ email: "a@b.com", password: "wrong" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("200 returns a JWT with the user id that expires in 7 days", async () => {
    User.findOne.mockResolvedValue({ _id: "u1", password: hash });
    const res = await request(app).post("/api/login").send({ email: "a@b.com", password: "pw123456" });
    expect(res.status).toBe(200);
    const decoded = jwt.verify(res.body.token, SECRET);
    expect(decoded.id).toBe("u1");
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
  });

  it("500 when the database fails", async () => {
    User.findOne.mockRejectedValue(new Error("db down"));
    const res = await request(app).post("/api/login").send({ email: "a@b.com", password: "pw123456" });
    expect(res.status).toBe(500);
  });
});

describe("thread routes", () => {
  it("GET /thread returns threads sorted by newest update", async () => {
    const sort = jest.fn().mockResolvedValue([{ threadId: "t1", title: "Hi" }]);
    Thread.find.mockReturnValue({ sort });
    const res = await request(app).get("/api/thread");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ threadId: "t1", title: "Hi" }]);
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
  });

  it("GET /thread/:id returns only the messages", async () => {
    Thread.findOne.mockResolvedValue(makeThread());
    const res = await request(app).get("/api/thread/t1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ role: "user", content: "old q" }]);
  });

  it("GET /thread/:id 404 when missing, 500 on error", async () => {
    Thread.findOne.mockResolvedValue(null);
    expect((await request(app).get("/api/thread/nope")).status).toBe(404);
    Thread.findOne.mockRejectedValue(new Error("x"));
    expect((await request(app).get("/api/thread/t1")).status).toBe(500);
  });

  it("DELETE /thread/:id 200, 404 and 500", async () => {
    Thread.findOneAndDelete.mockResolvedValue({ threadId: "t1" });
    expect((await request(app).delete("/api/thread/t1")).status).toBe(200);
    Thread.findOneAndDelete.mockResolvedValue(null);
    expect((await request(app).delete("/api/thread/t1")).status).toBe(404);
    Thread.findOneAndDelete.mockRejectedValue(new Error("x"));
    expect((await request(app).delete("/api/thread/t1")).status).toBe(500);
  });

  // KNOWN GAP: these pass today because the routes have no auth.
  // After you add auth, change them to expect 401.
  it("KNOWN GAP: anyone without a token can list all threads", async () => {
    Thread.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    expect((await request(app).get("/api/thread")).status).toBe(200);
  });

  it("KNOWN GAP: anyone without a token can delete any thread", async () => {
    Thread.findOneAndDelete.mockResolvedValue({ threadId: "t1" });
    expect((await request(app).delete("/api/thread/t1")).status).toBe(200);
  });
});

describe("POST /api/chat", () => {
  it("400 when threadId or message is missing", async () => {
    expect((await request(app).post("/api/chat").send({ message: "hi" })).status).toBe(400);
    expect((await request(app).post("/api/chat").send({ threadId: "t1" })).status).toBe(400);
  });

  it("creates a new thread (title = first message) and returns the reply", async () => {
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "Hello!", interactionId: "int-9" });
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${tokenFor()}`)
      .send({ threadId: "t9", message: "hi" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: "Hello!" });
    const t = createdThreads[0];
    expect(t.title).toBe("hi");
    expect(t.messages.map((m) => m.role)).toEqual(["user", "model"]);
    expect(t.geminiInteractionId).toBe("int-9");
    expect(t.save).toHaveBeenCalled();
    expect(getGeminiAPIResponse).toHaveBeenCalledWith("hi", undefined);
  });

  it("continues an existing thread using its previous interaction id", async () => {
    const thread = makeThread();
    Thread.findOne.mockResolvedValue(thread);
    getGeminiAPIResponse.mockResolvedValue({ text: "Sure", interactionId: "int-2" });
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${tokenFor()}`)
      .send({ threadId: "t1", message: "more" });
    expect(res.status).toBe(200);
    expect(getGeminiAPIResponse).toHaveBeenCalledWith("more", "int-1");
    expect(thread.messages).toHaveLength(3);
    expect(thread.geminiInteractionId).toBe("int-2");
  });

  it("counts one use for a logged-in user", async () => {
    const user = makeUser(2);
    User.findById.mockResolvedValue(user);
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "ok", interactionId: "i" });
    await request(app).post("/api/chat").set("Authorization", `Bearer ${tokenFor()}`).send({ threadId: "t", message: "hi" });
    expect(user.dailyUsage.count).toBe(3);
    expect(user.save).toHaveBeenCalled();
  });

  it("429 once the daily limit (5) is reached and Gemini is NOT called", async () => {
    User.findById.mockResolvedValue(makeUser(5));
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${tokenFor()}`)
      .send({ threadId: "t", message: "hi" });
    expect(res.status).toBe(429);
    expect(getGeminiAPIResponse).not.toHaveBeenCalled();
  });

  it("resets the counter on a new day", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const user = makeUser(5, yesterday);
    User.findById.mockResolvedValue(user);
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "ok", interactionId: "i" });
    const res = await request(app).post("/api/chat").set("Authorization", `Bearer ${tokenFor()}`).send({ threadId: "t", message: "hi" });
    expect(res.status).toBe(200);
    expect(user.dailyUsage.count).toBe(1);
  });

  it("500 when Gemini fails", async () => {
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockRejectedValue(new Error("gemini down"));
    const res = await request(app).post("/api/chat").set("Authorization", `Bearer ${tokenFor()}`).send({ threadId: "t", message: "hi" });
    expect(res.status).toBe(500);
  });

  // KNOWN GAP: both pass today. After you fix the backend, change them
  // (no token -> 401, bad token -> 401).
  it("KNOWN GAP: no token still reaches Gemini, so the daily limit can be bypassed", async () => {
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "free answer", interactionId: "i" });
    const res = await request(app).post("/api/chat").send({ threadId: "t", message: "hi" });
    expect(res.status).toBe(200);
    expect(User.findById).not.toHaveBeenCalled();
  });

  it("KNOWN GAP: expired or invalid token returns 500 instead of 401", async () => {
    const expired = tokenFor("u1", { expiresIn: -10 });
    const r1 = await request(app).post("/api/chat").set("Authorization", `Bearer ${expired}`).send({ threadId: "t", message: "hi" });
    const r2 = await request(app).post("/api/chat").set("Authorization", "Bearer garbage").send({ threadId: "t", message: "hi" });
    expect(r1.status).toBe(500);
    expect(r2.status).toBe(500);
  });
});