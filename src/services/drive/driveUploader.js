import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { ENV } from "../../config/env.js";
import { log, debug, warn } from "../../utils/logger.js";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ROOT_FOLDER_NAME = "Nubo Invoices";

function loadCredentials() {
  if (!fs.existsSync(ENV.GMAIL_CREDENTIALS_PATH)) {
    throw new Error(`credentials.json not found at ${ENV.GMAIL_CREDENTIALS_PATH}`);
  }
  const raw   = JSON.parse(fs.readFileSync(ENV.GMAIL_CREDENTIALS_PATH, "utf8"));
  const creds = raw.installed || raw.web;
  if (!creds) throw new Error("credentials.json format unrecognised");
  return { client_id: creds.client_id, client_secret: creds.client_secret, redirect_uri: creds.redirect_uris[0] };
}

async function getDriveAuth() {
  const { client_id, client_secret, redirect_uri } = loadCredentials();
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  if (!fs.existsSync(ENV.DRIVE_TOKEN_PATH)) {
    throw new Error(`token-drive.json not found — run: node scripts/driveAuth.js`);
  }

  const token = JSON.parse(fs.readFileSync(ENV.DRIVE_TOKEN_PATH, "utf8"));
  oAuth2Client.setCredentials(token);

  oAuth2Client.on("tokens", (newTokens) => {
    const existing = JSON.parse(fs.readFileSync(ENV.DRIVE_TOKEN_PATH, "utf8"));
    fs.writeFileSync(ENV.DRIVE_TOKEN_PATH, JSON.stringify({ ...existing, ...newTokens }, null, 2));
    log("Drive token auto-refreshed and saved");
  });

  return oAuth2Client;
}

async function findOrCreateFolder(drive, name, parentId = "root") {
  const parentQ = parentId === "root" ? `'root' in parents` : `'${parentId}' in parents`;
  const list = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and ${parentQ} and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
  });

  if (list.data.files.length > 0) {
    debug(`Drive folder "${name}" already exists (${list.data.files[0].id})`);
    return list.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  log(`Created Drive folder: "${name}" (${folder.data.id})`);
  return folder.data.id;
}

export async function uploadToDrive(files, { month, year }) {
  const auth  = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  // Structure: Nubo Invoices / Jan'26 / files...
  const monthFolderName = `${MONTH_ABBR[month - 1]}'${String(year).slice(2)}`;
  log(`Uploading ${files.length} file(s) to Drive: ${ROOT_FOLDER_NAME} / ${monthFolderName}`);

  const rootFolderId  = await findOrCreateFolder(drive, ROOT_FOLDER_NAME, "root");
  const folderId      = await findOrCreateFolder(drive, monthFolderName, rootFolderId);
  const uploaded  = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      warn(`Drive: file not found — ${filePath}`);
      continue;
    }
    const fileName = path.basename(filePath);
    log(`Uploading to Drive: ${fileName}`);

    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: "application/pdf", body: fs.createReadStream(filePath) },
      fields: "id,name,webViewLink",
    });
    debug(`Uploaded: ${fileName} → ${res.data.webViewLink}`);
    uploaded.push({ name: fileName, id: res.data.id, link: res.data.webViewLink });
  }

  log(`Drive upload complete — ${uploaded.length}/${files.length} file(s) in "${ROOT_FOLDER_NAME} / ${monthFolderName}"`);
  return { folderName: monthFolderName, folderId, uploaded };
}

export function isDriveConfigured() {
  return fs.existsSync(ENV.DRIVE_TOKEN_PATH);
}
