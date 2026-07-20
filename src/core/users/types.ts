export type UserProfile = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  status: "active" | "disabled";
};

export type ProfileFormState = {
  error?: string;
  success?: string;
};
