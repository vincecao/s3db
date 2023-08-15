import { GetObjectCommand, ListBucketsOutput, ListObjectsV2CommandInput, S3, S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import invariant from "tiny-invariant";
import { v4 as uuid } from "uuid";

const awsRegion = process.env.S3_DB_REGION;
const awsAccessKeyId = process.env.S3_DB_ACCESS_KEY_ID;
const awsSecretAccessKey = process.env.S3_DB_SECRET_ACCESS_KEY;

function getS3dbConfig(): S3ClientConfig {
  invariant(awsRegion && awsAccessKeyId && awsSecretAccessKey, "Invalid aws credentials");
  return {
    region: awsRegion,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  };
}

type S3dbDocument<T> = {
  id: string;
} & T;

export class S3db<T extends object> extends S3 {
  private bucketName: string | undefined;
  private collectionName: string | undefined;

  constructor(bucketName: string, collectionName: string) {
    super(getS3dbConfig());

    (async () => {
      const buckets = await this.getDBBuckets();
      const isBucketInS3 = !!buckets.find(({ Name }) => Name === bucketName);
      invariant(isBucketInS3, "Invalid bucketName in S3");
      this.bucketName = bucketName;

      const collectionNames = await this.getDBCollectionNames();
      const isCollectionInBucket = !!collectionNames.find((name) => name === collectionName);
      invariant(isCollectionInBucket, "Invalid collection in current bucket");
      this.collectionName = collectionName;
    })();
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
    const { Contents, CommonPrefixes } = await this.listObjectsV2({
      Bucket: this.bucketName,
      Prefix: prefix,
      Delimiter: "/",
    });
    invariant(Contents, "Invalid listObjectsV2 contents");
    const matchObjects: { name: string; lastModified: Date }[] = [];
    for (const { Key: name, LastModified: lastModified } of Contents) {
      if (name && lastModified) matchObjects.push({ name, lastModified });
    }
    invariant(CommonPrefixes, "Invalid listObjectsV2 commonPrefix");
    const matchFolders: string[] = [];
    for (const { Prefix } of CommonPrefixes) {
      if (Prefix) matchFolders.push(Prefix);
    }
    return { folderNames: matchFolders, objects: matchObjects };
  }

  private async getDBEntry<EntryType>(Key: string): Promise<EntryType> {
    invariant(this.bucketName, "Invalid bucketName");
    const { Body, ...leftOutput } = await this.getObject({
      Bucket: this.bucketName,
      Key,
    });
    console.info(leftOutput);
    return JSON.parse(Body as any as string) as any as EntryType;
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

  getDBDocumentData(id: S3dbDocument<T>["id"]): Promise<S3dbDocument<T>> {
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

  async uploadDBDocumentWithMedia(document: T | S3dbDocument<T>, media?: File[]): Promise<string> {
    invariant(this.collectionName, "Invalid collectionName");
    const id = await this.uploadDBDocument(document);
    if (media) await this.uploadDBDocumentMedia(id, media);
    return id;
  }

  async uploadDBDocument(document: T | S3dbDocument<T>): Promise<string> {
    let id = uuid();
    if (!("id" in document)) {
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
