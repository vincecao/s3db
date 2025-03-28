import {
  GetObjectCommand,
  ListBucketsOutput,
  ListObjectsV2CommandInput,
  S3,
  S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";
import invariant from "tiny-invariant";
import { v4 as uuid } from "uuid";

import type { S3dbDocument } from "./type";
import { streamToString } from "./util";

/**
 * S3db is a class that extends the S3 client from the AWS SDK, providing
 * an interface for interacting with an S3 with CRUD operations.
 */
export class S3db<T extends object> extends S3 {
  private bucketName: string | undefined;
  private collectionName: string | undefined;

  static async initialize(args: {
    s3ClientConfig: S3ClientConfig;
    bucketName: string;
    collectionName: string;
  }) {
    const { s3ClientConfig, bucketName, collectionName } = args;
    const db = new this(s3ClientConfig);
    const buckets = await db.getDBBuckets();

    console.info(`S3db Initialization - Bucket: <${bucketName}>`);
    const isBucketInS3 = !!buckets.find(({ Name }) => Name === bucketName);
    if (!isBucketInS3) {
      console.info("S3db Initialization - Creating bucket");
      await db.createBucket({ Bucket: bucketName });
      console.info("S3db Initialization - Created bucket");
    } else {
      console.info("S3db Initialization - Retrieved bucket");
    }
    db.bucketName = bucketName;

    const collectionNames = await db.getDBCollectionNames();
    console.info(`S3db Initialization - Collection: <${bucketName}>`);
    const isCollectionInBucket = !!collectionNames.find(
      (name) => name === collectionName
    );
    if (!isCollectionInBucket) {
      console.info("S3db Initialization - Creating collection folder");
      await db.putObject({ Bucket: db.bucketName, Key: `${collectionName}/` });
      console.info("S3db Initialization - Created collection folder");
    }
    db.collectionName = collectionName;
    return db;
  }

  // Retrieves the list of S3 buckets.
  private async getDBBuckets(): Promise<
    NonNullable<ListBucketsOutput["Buckets"]>
  > {
    const { Buckets } = await this.listBuckets({});
    return Buckets || [];
  }

  // Retrieves the names of collections in the S3 database.
  private async getDBCollectionNames(): Promise<string[]> {
    const { folderNames } = await this.getDBEntries();
    return folderNames;
  }

  // Retrieves the document IDs from the current collection.
  async getDBDocumentIds(): Promise<string[]> {
    invariant(this.collectionName, "Invalid collectionName");
    const { folderNames: ids } = await this.getDBEntries(
      `${this.collectionName}/`
    );
    return ids;
  }

  // Retrieves entries from the S3 bucket, including folder names and object details.
  private async getDBEntries(
    prefix?: ListObjectsV2CommandInput["Prefix"]
  ): Promise<{
    folderNames: string[];
    objects: { name: string; lastModified: Date }[];
  }> {
    invariant(this.bucketName, "Invalid bucketName");
    const result = await this.listObjectsV2({
      Bucket: this.bucketName,
      Prefix: prefix,
      Delimiter: "/",
    });
    console.info(
      "getDBEntries - listObjectsV2",
      JSON.stringify(result, null, 4)
    );
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
        if (Prefix)
          matchFolders.add(Prefix.replace(prefix || "", "").split("/")[0]);
      }
    }
    return { folderNames: [...matchFolders], objects: matchObjects };
  }

  // Retrieves a single entry from the S3 bucket based on the provided key.
  private async getDBEntry<EntryType>(Key: string): Promise<EntryType> {
    invariant(this.bucketName, "Invalid bucketName");
    const { Body } = await this.getObject({
      Bucket: this.bucketName,
      Key,
    });
    invariant(Body, "Invalid Body from getDBEntry");
    return JSON.parse(
      (await streamToString(Body as Readable)) as string
    ) as EntryType;
  }

  // Retrieves collection entries from the S3 bucket based on the specified prefix.
  private getDBCollectionEntries(prefixInCollection: string): Promise<{
    folderNames: string[];
    objects: { name: string; lastModified: Date }[];
  }> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.getDBEntries(`${this.collectionName}/${prefixInCollection}`);
  }

  // Retrieves a single collection entry based on the specified key.
  private getDBCollectionEntry<EntryType>(
    keyInCollection: string
  ): Promise<EntryType> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.getDBEntry<EntryType>(
      `${this.collectionName}/${keyInCollection}`
    );
  }

  /** @todo Improve db with auto modified timestamp */
  /**
  uploadEmptyDBDocumentLastModified(): Promise<void> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.uploadDBCollectionEntry(`lastModified.json`, "[]");
  }
  */

  /** @todo Improve db with auto modified timestamp */
  /**
  getDBDocumentLastModified(): Promise<{ id: string; lastModified: Date }[]> {
    invariant(this.collectionName, "Invalid collectionName");
    return this.getDBCollectionEntry<{ id: string; lastModified: Date }[]>(
      `lastModified.json`
    );
  }
  */

  // Retrieves the document data for a given ID.
  async getDBDocumentData(id: S3dbDocument<T>["id"]): Promise<S3dbDocument<T>> {
    return this.getDBCollectionEntry<S3dbDocument<T>>(`${id}/data.json`);
  }

  // Retrieves media associated with a document for a given ID.
  async getDBDocumentMedia(
    id: S3dbDocument<T>["id"]
  ): Promise<{ name: string; lastModified: Date }[]> {
    return (await this.getDBCollectionEntries(`${id}`)).objects.filter(
      ({ name }) => name !== "data.json"
    );
  }

  // Generates a signed URL for accessing the document data for a given ID.
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

  // Uploads a collection entry to the S3 bucket.
  private async uploadDBCollectionEntry(
    keyInCollection: string,
    Body?: string
  ): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    await this.putObject({
      Bucket: this.bucketName,
      Key: `${this.collectionName}/${keyInCollection}`,
      Body,
    });
  }

  // Uploads media to the S3 bucket for a specific collection entry.
  private async uploadDBCollectionMedia(
    keyInCollection: string,
    file: File
  ): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    await this.putObject({
      Bucket: this.bucketName,
      Key: `${this.collectionName}/${keyInCollection}`,
      Body: file,
      ContentType: `image/${file.name.split(".")[1]}`,
    });
  }

  // Uploads a document along with its media files.
  async uploadDBDocumentWithMedia(
    document: T | S3dbDocument<T>,
    media: File[]
  ): Promise<string> {
    invariant(this.collectionName, "Invalid collectionName");
    const id = await this.uploadDBDocument(document);
    await this.uploadDBDocumentMedia(id, media);
    return id;
  }

  // Uploads a document to the S3 bucket and returns its ID.
  async uploadDBDocument(document: T | S3dbDocument<T>): Promise<string> {
    let id = uuid();
    if (!("id" in document) || !document.id) {
      await this.uploadDBCollectionEntry(`${id}/`);
    } else {
      id = document.id;
    }
    await this.uploadDBCollectionEntry(
      `${id}/data.json`,
      JSON.stringify({ ...document, id }, null, 4)
    );
    // todo: update lastModified.json
    return id;
  }

  // Uploads media files associated with a document.
  async uploadDBDocumentMedia(id: string, media: File[]): Promise<void> {
    await Promise.all(
      media.map((file) =>
        this.uploadDBCollectionMedia(`${id}/${file.name}`, file)
      )
    );
  }

  // Deletes a document and its associated media by ID.
  async deleteDBDocumentById(id: S3dbDocument<T>["id"]): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    const { Contents } = await this.listObjects({
      Bucket: this.bucketName,
      Prefix: `${this.collectionName}/${id}/`,
    });
    const objects = Contents?.map((obj) => ({ Key: obj.Key! }));
    invariant(
      objects && objects.length > 0,
      `No objects found in the id<${id}>. Nothing to delete.`
    );
    await this.deleteObjects({
      Bucket: this.bucketName,
      Delete: { Objects: objects },
    });
  }

  // Deletes specified media files associated with a document by ID.
  async deleteDBDocumentMedia(
    id: S3dbDocument<T>["id"],
    mediaNames: string[]
  ): Promise<void> {
    invariant(this.bucketName, "Invalid bucketName");
    invariant(this.collectionName, "Invalid collectionName");
    await this.deleteObjects({
      Bucket: this.bucketName,
      Delete: {
        Objects: mediaNames.map((mediaName) => ({
          Key: `${this.collectionName}/${id}/${mediaName}`,
        })),
      },
    });
  }
}
