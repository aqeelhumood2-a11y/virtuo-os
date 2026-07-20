export type AuthFormState = {
  error?: string;
  success?: string;
};

export type AuthSession = {
  uid: string;
  email: string | null;
};
