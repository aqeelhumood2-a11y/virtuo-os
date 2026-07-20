import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "./Input";

describe("Input", () => {
  it("renders and accepts typed props", () => {
    render(<Input placeholder="Email" />);
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
  });

  it("sets aria-invalid when invalid is true", () => {
    render(<Input placeholder="Email" invalid />);
    expect(screen.getByPlaceholderText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-invalid by default", () => {
    render(<Input placeholder="Email" />);
    expect(screen.getByPlaceholderText("Email")).not.toHaveAttribute("aria-invalid");
  });
});
