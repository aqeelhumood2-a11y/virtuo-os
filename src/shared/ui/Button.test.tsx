import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("merges a caller-provided className instead of dropping it", () => {
    render(<Button className="custom-class">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("custom-class");
  });

  it("defaults to type=button so it never submits a surrounding form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("forwards click handlers", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    screen.getByRole("button", { name: "Save" }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("respects the disabled prop", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
