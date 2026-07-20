import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormField } from "./FormField";
import { Input } from "./Input";

describe("FormField", () => {
  it("associates the label with the input", () => {
    render(
      <FormField label="Email">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("associates an error message with the input via aria-describedby", () => {
    render(
      <FormField label="Email" error="Email is required">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText("Email");
    const errorMessage = screen.getByText("Email is required");
    expect(input).toHaveAttribute("aria-describedby", errorMessage.id);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not render an error element when there is no error", () => {
    render(
      <FormField label="Email">
        <Input />
      </FormField>,
    );
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
  });
});
