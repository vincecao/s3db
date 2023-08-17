import { GetObjectCommand, ListBucketsOutput, ListObjectsV2CommandInput, S3, S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import invariant from "tiny-invariant";
import { v4 as uuid } from "uuid";
import type { Readable } from "stream";

export function getS3dbConfigFromEnv({ awsRegion, awsAccessKeyId, awsSecretAccessKey }: { awsRegion?: string; awsAccessKeyId?: string; awsSecretAccessKey?: string }): S3ClientConfig {
  invariant(awsRegion && awsAccessKeyId && awsSecretAccessKey, "Invalid aws credentials");
  return {
    region: awsRegion,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  };
}

// https://arunrajeevan.medium.com/read-json-file-from-s3-using-v3-aws-sdk-fb0f5994a65d
const streamToString = (stream: Readable) =>
  new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

type S3dbDocument<T> = {
  id: string;
  order: number;
} & T;

export class S3db<T extends object> extends S3 {
  private bucketName: string | undefined;
  private collectionName: string | undefined;

  static async initialize({ s3ClientConfig, bucketName, collectionName }: { s3ClientConfig: S3ClientConfig; bucketName: string; collectionName: string }) {
    const db = new this(s3ClientConfig);
    const buckets = await db.getDBBuckets();
    console.info("constructor - buckets", JSON.stringify(buckets, null, 4));
    const isBucketInS3 = !!buckets.find(({ Name }) => Name === bucketName);
    invariant(isBucketInS3, "Invalid bucketName in S3");
    db.bucketName = bucketName;

    const collectionNames = await db.getDBCollectionNames();
    console.info("constructor - collectionNames", JSON.stringify(collectionNames, null, 4));
    const isCollectionInBucket = !!collectionNames.find((name) => name === collectionName);
    invariant(isCollectionInBucket, "Invalid collection in current bucket");
    db.collectionName = collectionName;
    return db;
  }

  private async getDBBuckets(): Promise<NonNullable<ListBucketsOutput["Buckets"]>> {
    const { Buckets } = await this.listBuckets({});
    return Buckets || [];
  }

  private async getDBCollectionNames(): Promise<string[]> {
    const { folderNames } = await this.getDBEntries();
    return folderNames;
  }

  async getDBDocumentIds(): Promise<string[]> {
    invariant(this.collectionName, "Invalid collectionName");
    const { folderNames: ids } = await this.getDBEntries(`${this.collectionName}/`);
    return ids;
  }

  private async getDBEntries(prefix?: ListObjectsV2CommandInput["Prefix"]): Promise<{ folderNames: string[]; objects: { name: string; lastModified: Date }[] }> {
    invariant(this.bucketName, "Invalid bucketName");
    const result = await this.listObjectsV2({
      Bucket: this.bucketName,
      Prefix: prefix,
      Delimiter: "/",
    });
    console.info("getDBEntries - listObjectsV2", JSON.stringify(result, null, 4));
    const { Contents, CommonPrefixes } = result;
    const matchObjects: { name: string; lastModified: Date }[] = [];
    if (Contents) {
      for (const { Key: name, LastModified: lastModified } of Contents) {
        if (name && lastModified) matchObjects.push({ name, lastModified });
      }
    }

    const matchFolders = new Set<string>();
    if (CommonPrefixes) {
      for (const { Prefix } of CommonPrefixes) {
        if (Prefix) matchFolders.add(Prefix.replace(prefix || "", "").split("/")[0]);
      }
    }
    return { folderNames: [...matchFolders], objects: matchObjects };
  }

  private async getDBEntry<EntryType>(Key: string): Promise<EntryType> {
    invariant(this.bucketName, "Invalid bucketName");
    const { Body } = await this.getObject({
      Bucket: this.bucketName,
      Key,
    });
    invariant(Body, "Invalid Body from getDBEntry");
    return JSON.parse((await streamToString(Body as Readable)) as string) as EntryType;
  }

  private getDBCollectionEntries(prefixInCollection: string): Promise<{ folderNames: string[]; objects: { name: string; lastModified: Date }[] }> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.getDBEntries(`${this.collectionName}/${prefixInCollection}`);
  }

  private getDBCollectionEntry<EntryType>(keyInCollection: string): Promise<EntryType> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.getDBEntry<EntryType>(`${this.collectionName}/${keyInCollection}`);
  }

  /**
  uploadEmptyDBDocumentLastModified(): Promise<void> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.uploadDBCollectionEntry(`lastModified.json`, "[]");
  }

  getDBDocumentLastModified(): Promise<{ id: string; lastModified: Date }[]> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.getDBCollectionEntry<{ id: string; lastModified: Date }[]>(`lastModified.json`);
  }
  */

  async getDBDocumentData(id: S3dbDocument<T>["id"]): Promise<S3dbDocument<T>> {
    return this.getDBCollectionEntry<S3dbDocument<T>>(`${id}/data.json`);
  }

  async getDBDocumentMedia(id: S3dbDocument<T>["id"]): Promise<{ name: string; lastModified: Date }[]> {
    return (await this.getDBCollectionEntries(`${id}`)).objects.filter(({ name }) => name !== "data.json");
  }

  getDBDocumentUrl(id: S3dbDocument<T>["id"]): Promise<string> {
    invariant(this.bucketName, "Invalid bucketName");
    return getSignedUrl(
      this,
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: `${this.collectionName}/${id}/data.json`,
      })
    );
  }

  private async uploadDBCollectionEntry(keyInCollection: string, Body?: string): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    await this.putObject({
      Bucket: this.bucketName,
      Key: `${this.collectionName}/${keyInCollection}`,
      Body,
    });
  }

  private async uploadDBCollectionMedia(keyInCollection: string, file: File): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    await this.putObject({
      Bucket: this.bucketName,
      Key: `${this.collectionName}/${keyInCollection}`,
      Body: file,
      ContentType: `image/${file.name.split(".")[1]}`,
    });
  }

  async uploadDBDocumentWithMedia(document: T | S3dbDocument<T>, media: File[]): Promise<string> {
    invariant(this.collectionName, "Invalid collectionName");
    const id = await this.uploadDBDocument(document);
    await this.uploadDBDocumentMedia(id, media);
    return id;
  }

  async uploadDBDocument(document: T | S3dbDocument<T>): Promise<string> {
    let id = uuid();
    if (!("id" in document) || !document.id) {
      await this.uploadDBCollectionEntry(`${id}/`);
    } else {
      id = document.id;
    }
    await this.uploadDBCollectionEntry(`${id}/data.json`, JSON.stringify({ ...document, id }, null, 4));
    // todo: update lastModified.json
    return id;
  }

  async uploadDBDocumentMedia(id: string, media: File[]): Promise<void> {
    await Promise.all(media.map((file) => this.uploadDBCollectionMedia(`${id}/${file.name}`, file)));
  }

  async deleteDBDocumentById(id: S3dbDocument<T>["id"]): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    const { Contents } = await this.listObjects({
      Bucket: this.bucketName,
      Prefix: `${this.collectionName}/${id}/`,
    });
    const objects = Contents?.map((obj) => ({ Key: obj.Key! }));
    invariant(objects && objects.length > 0, `No objects found in the id<${id}>. Nothing to delete.`);
    await this.deleteObjects({
      Bucket: this.bucketName,
      Delete: { Objects: objects },
    });
  }

  async deleteDBDocumentMedia(id: S3dbDocument<T>["id"], mediaNames: string[]): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    await this.deleteObjects({
      Bucket: this.bucketName,
      Delete: { Objects: mediaNames.map((mediaName) => ({ Key: `${this.collectionName}/${id}/${mediaName}` })) },
    });
  }
}
