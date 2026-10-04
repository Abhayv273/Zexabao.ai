import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const create = jest.fn();
jest.unstable_mockModule("@google/genai", () => ({
  GoogleGenAI: jest.fn(function () {
    this.interactions = { create };
  }),
}));

const { default: getGeminiAPIResponse } = await import("../utils/geminiai.js");

beforeEach(() => {
  create.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

describe("getGeminiAPIResponse", () => {
  it("returns the text and interaction id", async () => {
    create.mockResolvedValue({ output_text: "Hello", id: "int-1" });
    const out = await getGeminiAPIResponse("hi");
    expect(out).toEqual({ text: "Hello", interactionId: "int-1" });
  });

  it("does not send previous_interaction_id for a first message", async () => {
    create.mockResolvedValue({ output_text: "x", id: "i" });
    await getGeminiAPIResponse("hi");
    const options = create.mock.calls[0][0];
    expect(options.input).toBe("hi");
    expect(options).not.toHaveProperty("previous_interaction_id");
  });

  it("sends previous_interaction_id to keep the conversation context", async () => {
    create.mockResolvedValue({ output_text: "x", id: "i" });
    await getGeminiAPIResponse("more", "int-0");
    expect(create.mock.calls[0][0].previous_interaction_id).toBe("int-0");
  });

  it("rethrows API errors so the route can return 500", async () => {
    create.mockRejectedValue(new Error("quota"));
    await expect(getGeminiAPIResponse("hi")).rejects.toThrow("quota");
  });
});