// Live R2 round-trip: put → presigned get → delete. Proves the credentials
// and bucket before any feature code relies on them.
require('dotenv').config();
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const main = async () => {
    const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const s3 = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    const Bucket = process.env.R2_BUCKET;
    const Key = 'healthcheck/round-trip.txt';

    await s3.send(new PutObjectCommand({ Bucket, Key, Body: 'sanchartag r2 ok', ContentType: 'text/plain' }));
    console.log('PUT ok');
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 60 });
    const res = await fetch(url);
    console.log('signed GET:', res.status, '→', (await res.text()).slice(0, 20));
    await s3.send(new DeleteObjectCommand({ Bucket, Key }));
    console.log('DELETE ok — bucket is live and writable');
};
main().catch((e) => { console.error('R2 check failed:', e.name, e.message); process.exit(1); });
