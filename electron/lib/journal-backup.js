const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

function formatDateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isSameOrInside(parentPath, candidatePath) {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function getAvailableBackupDirectory(backupParentDirectory, dateStamp) {
  const baseName = `billbook-backup-${dateStamp}`;
  let suffix = 1;

  while (true) {
    const candidateName = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    const candidatePath = path.join(backupParentDirectory, candidateName);

    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }

    suffix += 1;
  }
}

async function createJournalBackup({ sourceDirectory, backupParentDirectory, now = new Date() }) {
  const resolvedSourceDirectory = path.resolve(sourceDirectory);
  const resolvedBackupParentDirectory = path.resolve(backupParentDirectory);

  if (!(await pathExists(resolvedSourceDirectory))) {
    throw new Error("The current journal folder could not be found.");
  }

  if (isSameOrInside(resolvedSourceDirectory, resolvedBackupParentDirectory)) {
    throw new Error("Choose a backup destination outside the current journal folder.");
  }

  await fsp.mkdir(resolvedBackupParentDirectory, { recursive: true });

  const backupDirectory = await getAvailableBackupDirectory(
    resolvedBackupParentDirectory,
    formatDateStamp(now)
  );

  await fsp.cp(resolvedSourceDirectory, backupDirectory, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true
  });

  return backupDirectory;
}

module.exports = {
  createJournalBackup
};
