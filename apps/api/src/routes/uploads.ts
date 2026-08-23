/**
 * Image uploads for the resume editor (spec v6, feature 2).
 *
 * POST /uploads/image      — multipart upload, returns the URL to reference it by
 * GET /uploads/image/:file — serve the bytes, owner-scoped
 *
 * There is no Prisma table behind this, deliberately. The storage key is
 * `users/<caller>/images/<file>`, and the GET rebuilds it from the *authenticated
 * caller's own* id plus the file name in the path — so a key belonging to someone
 * else is not merely rejected, it is unreachable: nothing a request can say makes
 * this route look under another user's prefix. Account deletion already cascades
 * `users/<id>/` off disk, so images go with it.
 *
 * The URL that goes into the document is this route's, not a public blob URL,
 * which keeps the promise storage.ts makes: bytes reach the browser through an
 * authenticated, ownership-checked route.
 */
import { Router } from "express";
import multer from "multer";
import { asyncHandler, badRequest, notFound, HttpError } from "../middleware/errors.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { config } from "../config.js";
import {
  IMAGE_EXTENSIONS,
  IMAGE_FILE_NAME,
  IMAGE_URL_PREFIX,
  isSupportedImageType,
  sniffImageType,
  storage,
  storageKeys,
} from "../services/storage.js";

export const uploadsRouter = Router();

uploadsRouter.use(requireAuth);

/**
 * In-memory buffer, capped by the same limit as PDF uploads.
 *
 * The filter is a courtesy — it fails a wrong file before its bytes are read
 * rather than after — not the check that matters. `mimetype` comes from the
 * request, so what is actually stored is decided by sniffing the bytes below.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isSupportedImageType(file.mimetype)) cb(null, true);
    else cb(new HttpError(415, "Only PNG, JPEG and WebP images are accepted"));
  },
});

/**
 * A name unique enough that no two uploads collide, and opaque enough that it
 * gives away nothing about the file it came from — an original filename would put
 * whatever the user named it into a URL, and "resignation-draft.png" is not ours
 * to publish.
 */
function imageFileName(extension: string): string {
  return `img_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}.${extension}`;
}

uploadsRouter.post(
  "/image",
  upload.single("file"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest("No file uploaded");

    const contentType = sniffImageType(file.buffer);
    if (!contentType) {
      throw new HttpError(415, "That file isn't a PNG, JPEG or WebP image");
    }

    const fileName = imageFileName(IMAGE_EXTENSIONS[contentType]!);
    await storage.put(storageKeys.image(req.userId, fileName), file.buffer, contentType);

    /**
     * Absolute, and built from the configured origin rather than the request's own
     * Host header — a header an attacker controls, and cached URLs get saved into
     * documents. It has to be absolute because this URL is stored in the resume and
     * then used by the editor canvas, the gallery thumbnails and the export's
     * pre-pass, none of which share a base to resolve a relative one against.
     */
    res.status(201).json({ url: `${config.apiOrigin}${IMAGE_URL_PREFIX}${fileName}` });
  }),
);

uploadsRouter.get(
  "/image/:file",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const fileName = req.params.file!;
    if (!IMAGE_FILE_NAME.test(fileName)) throw notFound("Image");

    const obj = await storage.get(storageKeys.image(req.userId, fileName));
    if (!obj) throw notFound("Image");

    res.setHeader("Content-Type", obj.contentType);
    // The name is content-addressed enough that the bytes behind one never change,
    // so it can be cached hard. Private, because the response is per-user.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    // Belt and braces with the byte sniffing on upload: even if something wrong
    // were stored, the browser won't reinterpret it as a document.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(obj.bytes);
  }),
);
