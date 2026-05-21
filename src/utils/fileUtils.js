import fs from "fs";
import path from "path";

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function generateFileName({ platform, invoiceId }) {
  return `${platform}_${invoiceId}.pdf`;
}

export function getFilePath(basePath, fileName) {
  return path.join(basePath, fileName);
}