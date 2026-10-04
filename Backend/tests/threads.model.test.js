import { describe, it, expect } from "@jest/globals";
import mongoose from "mongoose";
import { Thread, User } from "../models/Threads.js";

const oid = () => new mongoose.Types.ObjectId();

const check = async (doc) => {
  try {
    await doc.validate();
    return undefined;
  } catch (e) {
    return e;
  }
};

describe("Thread schema", () => {
  it("requires threadId", async () => {
    const err = await check(new Thread({ userId: oid() }));
    expect(err.errors.threadId).toBeDefined();
  });

  it("applies defaults", async () => {
    const t = new Thread({ threadId: "t1", userId: oid() });
    expect(await check(t)).toBeUndefined();
    expect(t.title).toBe("New Chat");
    expect(t.geminiInteractionId).toBeNull();
    expect(t.messages).toHaveLength(0);
    expect(t.createdAt).toBeInstanceOf(Date);
  });

  it("accepts user and model roles", async () => {
    const t = new Thread({ threadId: "t1", userId: oid(), messages: [{ role: "user", content: "a" }, { role: "model", content: "b" }] });
    expect(await check(t)).toBeUndefined();
  });

  it("rejects the role 'assistant' and empty message content", async () => {
    const t = new Thread({ threadId: "t1", userId: oid(), messages: [{ role: "assistant", content: "x" }, { role: "user" }] });
    const err = await check(t);
    expect(err.errors["messages.0.role"]).toBeDefined();
    expect(err.errors["messages.1.content"]).toBeDefined();
  });
});

describe("Thread ownership", () => {
  it("requires a userId so every thread belongs to a user", async () => {
    const err = await check(new Thread({ threadId: "t1" }));
    expect(err.errors.userId).toBeDefined();
  });

  it("rejects a userId that is not a valid id", async () => {
    const err = await check(new Thread({ threadId: "t1", userId: "not-an-id" }));
    expect(err.errors.userId).toBeDefined();
  });
});

describe("User schema", () => {
  it("requires email and password", async () => {
    const err = await check(new User({}));
    expect(err.errors.email).toBeDefined();
    expect(err.errors.password).toBeDefined();
  });

  it("lowercases and trims the email", async () => {
    const u = new User({ email: "  Abhay@Example.COM ", password: "x" });
    expect(u.email).toBe("abhay@example.com");
  });

  it("starts the daily usage counter at 0", async () => {
    const u = new User({ email: "a@b.com", password: "x" });
    expect(u.dailyUsage.count).toBe(0);
    expect(u.dailyUsage.lastReset).toBeInstanceOf(Date);
  });
});