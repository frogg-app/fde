import { describe, expect, it } from "vitest";
import { extractOfferLink, setPendingOfferUrl, takePendingOfferUrl } from "./pending-offer";

describe("extractOfferLink", () => {
  it("accepts fragment, query, and deep-link forms", () => {
    expect(extractOfferLink("https://frogg.app/pair#offer=abc")).toBe(
      "https://frogg.app/pair#offer=abc",
    );
    expect(extractOfferLink("paseo://pair#offer=abc")).toBe("paseo://pair#offer=abc");
    expect(extractOfferLink("http://192.168.1.5:8081/?offer=abc&x=1")).toBe("#offer=abc");
    expect(extractOfferLink("http://192.168.1.5:8081/?offer=abc#/welcome")).toBe("#offer=abc");
  });

  it("returns null without an offer", () => {
    expect(extractOfferLink("https://frogg.app/pair")).toBeNull();
    expect(extractOfferLink("https://frogg.app/pair#offer=")).toBeNull();
    expect(extractOfferLink("http://localhost:8081/?other=1")).toBeNull();
    expect(extractOfferLink(null)).toBeNull();
  });
});

describe("pending offer", () => {
  it("is taken once", () => {
    setPendingOfferUrl("paseo://pair#offer=abc");
    expect(takePendingOfferUrl()).toBe("paseo://pair#offer=abc");
    expect(takePendingOfferUrl()).toBeNull();
  });
});
