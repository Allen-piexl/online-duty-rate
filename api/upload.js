const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const DEFAULT_OWNER = "Allen-piexl";
const DEFAULT_REPO = "online-duty-rate";
const DEFAULT_BRANCH = "master";

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Only POST uploads are supported." });
    return;
  }

  try {
    const uploadPassword = process.env.UPLOAD_PASSWORD;
    const githubToken = process.env.GITHUB_UPLOAD_TOKEN;

    if (!uploadPassword || !githubToken) {
      sendJson(res, 500, { ok: false, error: "Upload service is not configured." });
      return;
    }

    const body = parseBody(req.body);
    if (body.password !== uploadPassword) {
      sendJson(res, 401, { ok: false, error: "Upload password is incorrect." });
      return;
    }

    const filename = cleanWorkbookName(body.filename);
    const contentBase64 = cleanBase64(body.contentBase64);
    const uploadBytes = Buffer.byteLength(contentBase64, "base64");

    if (uploadBytes <= 0) {
      sendJson(res, 400, { ok: false, error: "Workbook file is empty." });
      return;
    }
    if (uploadBytes > MAX_UPLOAD_BYTES) {
      sendJson(res, 413, { ok: false, error: "Workbook is too large for this upload endpoint." });
      return;
    }

    const owner = process.env.GITHUB_OWNER || DEFAULT_OWNER;
    const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
    const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
    const contentPath = `data-source/${filename}`;
    const headers = githubHeaders(githubToken);
    const sha = await getExistingSha({ owner, repo, branch, contentPath, headers });
    const uploadResult = await putWorkbook({
      owner,
      repo,
      branch,
      contentPath,
      contentBase64,
      sha,
      headers,
    });

    sendJson(res, 200, {
      ok: true,
      filename,
      commitSha: uploadResult.commit?.sha || "",
      fileUrl: uploadResult.content?.html_url || "",
      actionUrl: `https://github.com/${owner}/${repo}/actions/workflows/update-data.yml`,
    });
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { ok: false, error: error.publicMessage || "Upload failed." });
  }
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function cleanWorkbookName(filename) {
  const value = String(filename || "").trim();
  if (!value || value.length > 180) {
    throw publicError(400, "Workbook filename is invalid.");
  }
  if (/[\\/\x00-\x1f]/.test(value)) {
    throw publicError(400, "Workbook filename cannot contain path separators.");
  }
  if (!/\.xlsx$/i.test(value) || !/duty rate lookup/i.test(value)) {
    throw publicError(400, "Upload a DUTY RATE LOOKUP .xlsx workbook.");
  }
  return value;
}

function cleanBase64(contentBase64) {
  const value = String(contentBase64 || "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    throw publicError(400, "Workbook content is not valid base64.");
  }
  return value;
}

async function getExistingSha({ owner, repo, branch, contentPath, headers }) {
  const url = contentUrl(owner, repo, contentPath, `ref=${encodeURIComponent(branch)}`);
  const response = await fetch(url, { headers });
  if (response.status === 404) return "";
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw publicError(response.status, payload.message || "Could not check existing workbook.");
  }
  return payload.sha || "";
}

async function putWorkbook({ owner, repo, branch, contentPath, contentBase64, sha, headers }) {
  const response = await fetch(contentUrl(owner, repo, contentPath), {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `Upload source workbook ${contentPath.split("/").pop()}`,
      branch,
      content: contentBase64,
      ...(sha ? { sha } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw publicError(response.status, payload.message || "GitHub rejected the workbook upload.");
  }
  return payload;
}

function contentUrl(owner, repo, contentPath, query = "") {
  const encodedPath = contentPath.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${query ? `?${query}` : ""}`;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "online-duty-rate-upload",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function publicError(status, publicMessage) {
  const error = new Error(publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}
