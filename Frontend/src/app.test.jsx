import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App.jsx";

// All jsx file tested together using react test library
afterEach(cleanup);

const json = (data, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) });
let threads, chatHandler, calls;

beforeEach(() => {
  localStorage.clear();
  calls = []; threads = [];
  chatHandler = () => json({ reply: "Hello there" });
  globalThis.fetch = vi.fn((url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith("/api/chat")) return chatHandler();
    if (url.endsWith("/api/login")) return json({ token: "newtoken" });
    if (url.includes("/api/thread/") && opts.method === "DELETE") return json({ ok: true });
    if (url.includes("/api/thread/")) return json([{ role: "user", content: "old question" }, { role: "assistant", content: "old answer" }]);
    if (url.endsWith("/api/thread")) return json(threads);
    return json({});
  });
});

const send = (text) => {
  const input = screen.getByPlaceholderText("Ask anything");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};
const modal = () => document.querySelector(".auth-overlay");
const chatCall = () => calls.find((c) => c.url.endsWith("/api/chat"));

it("renders welcome screen and sidebar", () => {
  render(<App />);
  expect(screen.getByText("Hey! How can I help you today?")).toBeTruthy();
  expect(screen.getByText(/New Chat/)).toBeTruthy();
  expect(document.querySelector(".index-panel")).toBeNull(); // Outline hidden on empty chat
});

it("logged out: sending opens login modal, no chat API call", async () => {
  render(<App />);
  send("hi");
  await waitFor(() => expect(modal()).not.toBeNull());
  expect(chatCall()).toBeUndefined();
});

it("logged in: sends Bearer token, shows reply and Outline", async () => {
  localStorage.setItem("token", "abc");
  render(<App />);
  send("hi");
  expect(await screen.findByText("Hello there", {}, { timeout: 4000 })).toBeTruthy();
  expect(chatCall().opts.headers.Authorization).toBe("Bearer abc");
  expect(screen.getAllByText("hi").length).toBeGreaterThan(0);
  expect(screen.getByText("Chat Log")).toBeTruthy();
});

it("401: clears token and opens login modal", async () => {
  localStorage.setItem("token", "bad");
  chatHandler = () => json({}, 401);
  render(<App />);
  send("hi");
  await waitFor(() => expect(modal()).not.toBeNull());
  expect(localStorage.getItem("token")).toBeNull();
});

it("500: shows error message", async () => {
  localStorage.setItem("token", "abc");
  chatHandler = () => json({}, 500);
  render(<App />);
  send("hi");
  expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
});

it("network failure: shows cannot-reach message", async () => {
  localStorage.setItem("token", "abc");
  chatHandler = () => Promise.reject(new Error("offline"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  render(<App />);
  send("hi");
  expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
});

it("429: shows daily limit banner", async () => {
  localStorage.setItem("token", "abc");
  chatHandler = () => json({}, 429);
  render(<App />);
  send("hi");
  expect(await screen.findByText(/Limit over today/)).toBeTruthy();
});

it("user dropdown: toggles on icon, closes on outside click and Esc", async () => {
  render(<App />);
  const icon = document.querySelector(".userIconDiv");
  fireEvent.click(icon);
  expect(screen.queryByText("Sign up")).not.toBeNull();
  fireEvent.click(icon);
  expect(screen.queryByText("Sign up")).toBeNull();
  fireEvent.click(icon);
  fireEvent.mouseDown(document.body);
  await waitFor(() => expect(screen.queryByText("Sign up")).toBeNull());
  fireEvent.click(icon);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("Sign up")).toBeNull());
});

it("login flow: dropdown -> modal -> token saved -> modal closed", async () => {
  render(<App />);
  fireEvent.click(document.querySelector(".userIconDiv"));
  fireEvent.click(screen.getByText("Log in"));
  expect(modal()).not.toBeNull();
  fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "a@b.com" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "pw" } });
  fireEvent.click(document.querySelector(".auth-submit"));
  await waitFor(() => expect(localStorage.getItem("token")).toBe("newtoken"));
  await waitFor(() => expect(modal()).toBeNull());
});

it("mobile drawer: menu button opens sidebar, backdrop closes it", () => {
  render(<App />);
  const sidebar = document.querySelector(".sidebar");
  expect(sidebar.classList.contains("open")).toBe(false);
  fireEvent.click(document.querySelector(".mobile-menu-btn"));
  expect(sidebar.classList.contains("open")).toBe(true);
  fireEvent.click(document.querySelector(".sidebar-backdrop"));
  expect(sidebar.classList.contains("open")).toBe(false);
  expect(document.querySelector(".sidebar-backdrop")).toBeNull();
});

it("sidebar: lists threads, opens one with token, closes drawer", async () => {
  localStorage.setItem("token", "abc");
  threads = [{ threadId: "t1", title: "My first chat" }];
  render(<App />);
  fireEvent.click(document.querySelector(".mobile-menu-btn"));
  fireEvent.click(await screen.findByText("My first chat"));
  expect(await screen.findByText("old answer")).toBeTruthy();
  const call = calls.find((c) => c.url.endsWith("/api/thread/t1"));
  expect(call.opts.headers.Authorization).toBe("Bearer abc");
  expect(document.querySelector(".sidebar").classList.contains("open")).toBe(false);
});

it("sidebar: delete sends DELETE with token and removes thread", async () => {
  localStorage.setItem("token", "abc");
  threads = [{ threadId: "t1", title: "My first chat" }];
  render(<App />);
  await screen.findByText("My first chat");
  fireEvent.click(document.querySelector(".fa-trash"));
  await waitFor(() => expect(screen.queryByText("My first chat")).toBeNull());
  const del = calls.find((c) => c.opts.method === "DELETE");
  expect(del.opts.headers.Authorization).toBe("Bearer abc");
});

it("logout: clears token and resets to welcome screen", async () => {
  localStorage.setItem("token", "abc");
  render(<App />);
  send("hi");
  await screen.findByText("Hello there", {}, { timeout: 4000 });
  expect(screen.queryByText("Hey! How can I help you today?")).toBeNull();
  fireEvent.click(document.querySelector(".userIconDiv"));
  fireEvent.click(screen.getByText("Log out"));
  expect(localStorage.getItem("token")).toBeNull();
  await waitFor(() => expect(screen.queryByText("Hey! How can I help you today?")).not.toBeNull());
  expect(document.querySelector(".index-panel")).toBeNull();
});