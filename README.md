# S3DB - Simple S3 Database

[![npm version](https://badge.fury.io/js/@vincecao%2Fs3db.svg)](https://badge.fury.io/js/@vincecao%2Fs3db)
[![npm checks](https://badgen.net/github/checks/vincecao/s3db)](https://github.com/vincecao/s3db/actions)

Transform AWS S3 into a simple document database that offers scalable storage for JSON-like documents.

While S3 is suitable for certain use cases, it's important to consider whether it meets the needs of your application compared to traditional document databases. This library can be beneficial for scenarios like content management systems and web applications, but keep in mind that S3 is primarily an object storage service, which may not provide the same level of querying capabilities and performance as a dedicated document database.

Use this library for managing collections of documents with CRUD operations efficiently, but evaluate your requirements carefully to ensure S3 is the right choice for your data storage needs.

## Installation
This package is automatically published in both [NPMJS](https://www.npmjs.com/package/@vincecao/s3db) and [GITHUB](https://github.com/vincecao/s3db/pkgs/npm/s3db) npm registry.

```bash
# Install latest package from npm.js
pnpm i @vincecao/s3db
# or npm i ...
# or yarn add ...


# Install beta package
pnpm i @vincecao/s3db@beta
# or npm i ...
# or yarn add ...
```

_To install package from Github npm registry, add below file in your repo before run `npm i` or `yarn add`_.

```bash
# .npmrc
@vincecao:registry=https://npm.pkg.github.com
```

You can also install directly from current repo master

```bash
pnpm i vincecao/s3db
# or pnpm i github:vincecao/s3db
# or npm i ...
# or yarn add ...
```

## Basic Usage

1. Initialize the database with your AWS credentials and bucket/collection names. Ensure that you have the correct permissions set in your S3 bucket to allow read and write operations. The following permissions should be enabled at the bucket level:
   - `s3:ListBucket` for listing objects in the bucket.
   - `s3:GetObject` for reading objects from the bucket.
   - `s3:PutObject` for writing objects to the bucket.

```typescript
import S3db, { getS3dbConfig } from "@vincecao/s3db";

// Option 1: Use environment variables
// Ensure these are set in your environment:
// S3_DB_REGION = "your-region"
// S3_DB_ACCESS_KEY_ID = "your-access-key"
// S3_DB_SECRET_ACCESS_KEY = "your-secret-key"

// Option 2: Pass config directly
const config = {
  awsRegion: "your-region",
  awsAccessKeyId: "your-access-key",
  awsSecretAccessKey: "your-secret-key",
};

// Initialize the database
const db = await S3db.initialize({
  s3ClientConfig: getS3dbConfig(config), // or getS3dbConfig() for env vars
  bucketName: "your-bucket-name",
  collectionName: "your-collection-name",
});
```

2. Perform CRUD operations:

```typescript
// Create/Update document
const id = await db.uploadDBDocument({
  title: "Example",
  content: "This is a test document",
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
pnpm run build

# Publish new version
npm login
npm publish
```

## License

MIT License
