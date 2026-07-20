export type WithId<T> = T & { id: string };

export type FirestoreTimestamp = {
  seconds: number;
  nanoseconds: number;
};
