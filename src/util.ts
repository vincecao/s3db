import type { S3ClientConfig } from "@aws-sdk/client-s3";
import type { Readable } from "stream";
import invariant from "tiny-invariant";

/**
 * Retrieves the S3 database configuration based on provided AWS credentials or environment variables.
 *
 * This function allows users to specify their AWS region, access key ID, and secret access key.
 * If these values are not provided, the function will attempt to use the corresponding environment variables:
 * - S3_DB_REGION
 * - S3_DB_ACCESS_KEY_ID
 * - S3_DB_SECRET_ACCESS_KEY
 *
 * Users can opt out of providing arguments if they have the necessary environment variables set up.
 *
 * @param args - Optional object containing AWS configuration parameters.
 * @param args.awsRegion - The AWS region for the S3 database.
 * @param args.awsAccessKeyId - The AWS access key ID.
 * @param args.awsSecretAccessKey - The AWS secret access key.
 * @returns S3ClientConfig - The configuration object for the S3 client.
 * @throws Will throw an error if the required AWS credentials are missing or invalid.
 */
export function getS3dbConfig(args?: {
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}): S3ClientConfig {
  const {
    awsRegion = process.env.S3_DB_REGION,
    awsAccessKeyId = process.env.S3_DB_ACCESS_KEY_ID,
    awsSecretAccessKey = process.env.S3_DB_SECRET_ACCESS_KEY,
  } = args || {};
  invariant(
    awsRegion && awsAccessKeyId && awsSecretAccessKey,
    "AWS credentials are missing or invalid. Please ensure that awsRegion, awsAccessKeyId, and awsSecretAccessKey are provided."
  );
  return {
    region: awsRegion,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  };
}

/**
 * Converts a Readable stream into a string by collecting all data chunks.
 *
 * This function listens for 'data' events on the stream, accumulating the chunks
 * until the stream ends. Once the stream is finished, it concatenates all chunks
 * and resolves the promise with the resulting string.
 * 
 * ref: https://arunrajeevan.medium.com/read-json-file-from-s3-using-v3-aws-sdk-fb0f5994a65d
 *
 * @param stream - The Readable stream to be converted to a string.
 * @returns A promise that resolves to the string representation of the stream's data.
 */
export const streamToString = (stream: Readable) =>
  new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
