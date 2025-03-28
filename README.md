

# S3DB - Simple S3 Database

Transform AWS S3 into a simple document database that offers scalable storage for JSON-like documents. 

While S3 is suitable for certain use cases, it's important to consider whether it meets the needs of your application compared to traditional document databases. This library can be beneficial for scenarios like content management systems and web applications, but keep in mind that S3 is primarily an object storage service, which may not provide the same level of querying capabilities and performance as a dedicated document database. 

Use this library for managing collections of documents with CRUD operations efficiently, but evaluate your requirements carefully to ensure S3 is the right choice for your data storage needs.

## Installation

```bash
npm install @vincecao/s3db
```

## Basic Usage

1. Initialize the database with your AWS credentials and bucket/collection names. Ensure that you have the correct permissions set in your S3 bucket to allow read and write operations. The following permissions should be enabled at the bucket level:
   - `s3:ListBucket` for listing objects in the bucket.
   - `s3:GetObject` for reading objects from the bucket.
   - `s3:PutObject` for writing objects to the bucket.

```typescript
import S3db, { getS3dbConfigFromEnv } from "@vincecao/s3db";

const db = await S3db.initialize({
  s3ClientConfig: getS3dbConfigFromEnv({
    awsRegion: "your-region",
    awsAccessKeyId: "your-access-key",
    awsSecretAccessKey: "your-secret-key"
  }),
  bucketName: "your-bucket-name",
  collectionName: "your-collection-name"
});
```

2. Perform CRUD operations:

```typescript
// Create/Update document
const id = await db.uploadDBDocument({
  title: "Example",
  content: "This is a test document"
});

// Read document
const document = await db.getDBDocumentData(id);

// Get all document IDs
const ids = await db.getDBDocumentIds();

// Delete document
await db.deleteDBDocumentById(id);
```

## Development Commands

```bash
# Build the project
npm run build

# Publish new version
npm publish
```

## License

MIT License