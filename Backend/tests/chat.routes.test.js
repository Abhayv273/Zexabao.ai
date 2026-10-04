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
const auth = (req, id = "u1") => req.set("Authorization", `Bearer ${tokenFor(id)}`);

const makeUser = (id, count = 0, lastReset = new Date()) => ({
  _id: id,
  dailyUsage: { count, lastReset },
  save: jest.fn().mockResolvedValue(true),
});
const makeThread = (extra = {}) => ({
  threadId: "t1",
  userId: "u1",
  messages: [{ role: "user", content: "old q" }],
  geminiInteractionId: "int-1",
  save: jest.fn().mockResolvedValue(true),
  ...extra,
});

let users;

beforeEach(() => {
  [Thread.find, Thread.findOne, Thread.findOneAndDelete, User.findOne, User.findById, getGeminiAPIResponse].forEach((m) => m.mockReset());
  Thread.mockClear();
  User.mockClear();
  createdThreads.length = 0;
  createdUsers.length = 0;
  users = { u1: makeUser("u1"), u2: makeUser("u2") };
  User.findById.mockImplementation(async (id) => users[id] ?? null);
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

describe("auth guard on every protected route", () => {
  const routes = [
    ["get", "/api/thread"],
    ["get", "/api/thread/t1"],
    ["delete", "/api/thread/t1"],
    ["post", "/api/chat"],
  ];

  it.each(routes)("%s %s -> 401 without a token", async (method, url) => {
    const res = await request(app)[method](url).send({ threadId: "t1", message: "hi" });
    expect(res.status).toBe(401);
  });

  it.each(routes)("%s %s -> 401 for a garbage token", async (method, url) => {
    const res = await request(app)[method](url).set("Authorization", "Bearer garbage").send({ threadId: "t1", message: "hi" });
    expect(res.status).toBe(401);
  });

  it.each(routes)("%s %s -> 401 for an expired token", async (method, url) => {
    const expired = tokenFor("u1", { expiresIn: -10 });
    const res = await request(app)[method](url).set("Authorization", `Bearer ${expired}`).send({ threadId: "t1", message: "hi" });
    expect(res.status).toBe(401);
  });

  it("401 when the token is valid but the user no longer exists", async () => {
    const res = await request(app).get("/api/thread").set("Authorization", `Bearer ${tokenFor("ghost")}`);
    expect(res.status).toBe(401);
  });

  it("500 (not 401) when the database fails while loading the user", async () => {
    User.findById.mockRejectedValue(new Error("db down"));
    const res = await auth(request(app).get("/api/thread"));
    expect(res.status).toBe(500);
  });
});

describe("thread routes are private to each user", () => {
  it("GET /thread lists only the logged-in user's threads, newest first, light fields only", async () => {
    const sort = jest.fn().mockResolvedValue([{ threadId: "t1", title: "Hi" }]);
    const select = jest.fn().mockReturnValue({ sort });
    Thread.find.mockReturnValue({ select });
    const res = await auth(request(app).get("/api/thread"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ threadId: "t1", title: "Hi" }]);
    expect(Thread.find).toHaveBeenCalledWith({ userId: "u1" });
    expect(select).toHaveBeenCalledWith("threadId title updatedAt");
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
  });

  it("a different user's list is queried with their own id", async () => {
    const sort = jest.fn().mockResolvedValue([]);
    Thread.find.mockReturnValue({ select: jest.fn().mockReturnValue({ sort }) });
    await auth(request(app).get("/api/thread"), "u2");
    expect(Thread.find).toHaveBeenCalledWith({ userId: "u2" });
  });

  it("GET /thread/:id looks the thread up by id AND owner, returns only messages", async () => {
    Thread.findOne.mockResolvedValue(makeThread());
    const res = await auth(request(app).get("/api/thread/t1"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ role: "user", content: "old q" }]);
    expect(Thread.findOne).toHaveBeenCalledWith({ threadId: "t1", userId: "u1" });
  });

  it("GET /thread/:id 404 when not found (including another user's thread), 500 on error", async () => {
    Thread.findOne.mockResolvedValue(null);
    expect((await auth(request(app).get("/api/thread/nope"))).status).toBe(404);
    Thread.findOne.mockRejectedValue(new Error("x"));
    expect((await auth(request(app).get("/api/thread/t1"))).status).toBe(500);
  });

  it("DELETE /thread/:id deletes by id AND owner", async () => {
    Thread.findOneAndDelete.mockResolvedValue({ threadId: "t1" });
    const res = await auth(request(app).delete("/api/thread/t1"));
    expect(res.status).toBe(200);
    expect(Thread.findOneAndDelete).toHaveBeenCalledWith({ threadId: "t1", userId: "u1" });
  });

  it("DELETE /thread/:id 404 when it is not this user's thread, 500 on error", async () => {
    Thread.findOneAndDelete.mockResolvedValue(null);
    expect((await auth(request(app).delete("/api/thread/t1"), "u2")).status).toBe(404);
    Thread.findOneAndDelete.mockRejectedValue(new Error("x"));
    expect((await auth(request(app).delete("/api/thread/t1"))).status).toBe(500);
  });
});

describe("POST /api/chat", () => {
  it("400 when threadId or message is missing", async () => {
    expect((await auth(request(app).post("/api/chat")).send({ message: "hi" })).status).toBe(400);
    expect((await auth(request(app).post("/api/chat")).send({ threadId: "t1" })).status).toBe(400);
  });

  it("creates a new thread owned by the user (title = first message) and returns the reply", async () => {
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "Hello!", interactionId: "int-9" });
    const res = await auth(request(app).post("/api/chat")).send({ threadId: "t9", message: "hi" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: "Hello!" });
    const t = createdThreads[0];
    expect(t.userId).toBe("u1");
    expect(t.title).toBe("hi");
    expect(t.messages.map((m) => m.role)).toEqual(["user", "model"]);
    expect(t.geminiInteractionId).toBe("int-9");
    expect(t.save).toHaveBeenCalled();
    expect(getGeminiAPIResponse).toHaveBeenCalledWith("hi", undefined);
  });

  it("continues the user's own thread using its previous interaction id", async () => {
    const thread = makeThread();
    Thread.findOne.mockResolvedValue(thread);
    getGeminiAPIResponse.mockResolvedValue({ text: "Sure", interactionId: "int-2" });
    const res = await auth(request(app).post("/api/chat")).send({ threadId: "t1", message: "more" });
    expect(res.status).toBe(200);
    expect(getGeminiAPIResponse).toHaveBeenCalledWith("more", "int-1");
    expect(thread.messages).toHaveLength(3);
    expect(thread.geminiInteractionId).toBe("int-2");
  });

  it("404 when the thread id belongs to another user: no Gemini call, no usage counted", async () => {
    Thread.findOne.mockResolvedValue(makeThread({ userId: "u1" }));
    const res = await auth(request(app).post("/api/chat"), "u2").send({ threadId: "t1", message: "hi" });
    expect(res.status).toBe(404);
    expect(getGeminiAPIResponse).not.toHaveBeenCalled();
    expect(users.u2.dailyUsage.count).toBe(0);
  });

  it("counts one use for the logged-in user only", async () => {
    users.u1 = makeUser("u1", 2);
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "ok", interactionId: "i" });
    await auth(request(app).post("/api/chat")).send({ threadId: "t", message: "hi" });
    expect(users.u1.dailyUsage.count).toBe(3);
    expect(users.u1.save).toHaveBeenCalled();
    expect(users.u2.dailyUsage.count).toBe(0);
  });

  it("429 once the daily limit (5) is reached and Gemini is NOT called", async () => {
    users.u1 = makeUser("u1", 5);
    const res = await auth(request(app).post("/api/chat")).send({ threadId: "t", message: "hi" });
    expect(res.status).toBe(429);
    expect(getGeminiAPIResponse).not.toHaveBeenCalled();
  });

  it("the daily limit is per user: user 1 at the limit, user 2 still allowed", async () => {
    users.u1 = makeUser("u1", 5);
    users.u2 = makeUser("u2", 0);
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "ok", interactionId: "i" });
    const r1 = await auth(request(app).post("/api/chat"), "u1").send({ threadId: "a", message: "hi" });
    const r2 = await auth(request(app).post("/api/chat"), "u2").send({ threadId: "b", message: "hi" });
    expect(r1.status).toBe(429);
    expect(r2.status).toBe(200);
    expect(users.u1.dailyUsage.count).toBe(5);
    expect(users.u2.dailyUsage.count).toBe(1);
  });

  it("resets the counter on a new day", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    users.u1 = makeUser("u1", 5, yesterday);
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockResolvedValue({ text: "ok", interactionId: "i" });
    const res = await auth(request(app).post("/api/chat")).send({ threadId: "t", message: "hi" });
    expect(res.status).toBe(200);
    expect(users.u1.dailyUsage.count).toBe(1);
  });

  it("500 when Gemini fails", async () => {
    Thread.findOne.mockResolvedValue(null);
    getGeminiAPIResponse.mockRejectedValue(new Error("gemini down"));
    const res = await auth(request(app).post("/api/chat")).send({ threadId: "t", message: "hi" });
    expect(res.status).toBe(500);
  });
});