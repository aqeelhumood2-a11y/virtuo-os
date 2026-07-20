import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card } from "./Card";

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Hello</Card>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("merges a caller-provided className instead of dropping it", () => {
    render(<Card className="custom-class">Hello</Card>);
    expect(screen.getByText("Hello")).toHaveClass("custom-class");
  });
});
