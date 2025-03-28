export type S3dbDocument<T> = {
  id: string;
  order: number;
} & T;
