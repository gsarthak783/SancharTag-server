const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const { encode } = require('blurhash');
const crypto = require('crypto');
const config = require('../config/config');
const errorCodes = require('../config/errorCodes');

const SIGNED_URL_TTL_SECONDS = 15 * 60;
const MAX_EDGE_PX = 1600;

let client = null;
const s3 = () => {
    if (!config.r2.enabled) throw errorCodes.MEDIA_DISABLED;
    if (!client) {
        client = new S3Client({
            region: 'auto',
            endpoint: config.r2.endpoint,
            credentials: {
                accessKeyId: config.r2.accessKeyId,
                secretAccessKey: config.r2.secretAccessKey,
            },
        });
    }
    return client;
};

exports.enabled = () => config.r2.enabled;

/**
 * Normalize an uploaded photo for chat (feature 04 §images):
 *  - .rotate() applies EXIF orientation, then sharp drops ALL metadata on
 *    re-encode — GPS/EXIF never reaches storage (strangers must not learn
 *    where you live from a photo of your driveway)
 *  - longest edge capped, recompressed to JPEG
 *  - blurhash computed for instant placeholders
 */
exports.processImage = async (buffer) => {
    let pipeline;
    let meta;
    try {
        pipeline = sharp(buffer, { failOn: 'error' }).rotate();
        meta = await pipeline.metadata();
    } catch {
        throw errorCodes.MEDIA_INVALID;
    }
    if (!meta.width || !meta.height) throw errorCodes.MEDIA_INVALID;

    const out = await pipeline
        .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

    // Blurhash from a tiny raw thumbnail (32px) — cheap and good enough.
    const thumb = await sharp(out.data)
        .resize(32, 32, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const blurhash = encode(
        new Uint8ClampedArray(thumb.data),
        thumb.info.width,
        thumb.info.height,
        4, 3,
    );

    return {
        buffer: out.data,
        media: {
            mime: 'image/jpeg',
            bytes: out.info.size,
            w: out.info.width,
            h: out.info.height,
            blurhash,
        },
    };
};

exports.store = async (conversationId, buffer) => {
    const key = `chat/${conversationId}/${crypto.randomBytes(12).toString('base64url')}.jpg`;
    await s3().send(new PutObjectCommand({
        Bucket: config.r2.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
        CacheControl: 'private, max-age=86400',
    }));
    return key;
};

// Private bucket + expiring reads: possession of a URL stops being useful
// 15 minutes later.
exports.signedUrl = (key) => getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
);

exports.remove = (key) => s3().send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }));

// Attach fresh signed URLs to a message list (image messages only).
exports.withMediaUrls = async (messages) => Promise.all(messages.map(async (m) => (
    m.type === 'image' && m.media?.key
        ? { ...m, mediaUrl: await exports.signedUrl(m.media.key) }
        : m
)));
