export type MembershipRole = "Owner" | "Manager" | "Supervisor" | "Employee";

export type Company = {
  id: string;
  name: string;
  ownerId: string;
  status: "active" | "suspended";
};

export type Branch = {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
};

export type Membership = {
  uid: string;
  role: MembershipRole;
  branchIds: string[];
  status: "active" | "invited" | "disabled";
};

export type OnboardingResult = {
  companyId: string;
  branchId: string;
};

export type OnboardingFormState = {
  error?: string;
  success?: string;
};
