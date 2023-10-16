module.exports = (core, packageVersions, versionName) => {
  if (!packageVersions) {
    core.setFailed('No package versions were provided.');
    return;
  }

  const versionExists = packageVersions.find(p => p.name === versionName);
  if (versionExists) {
    core.info(`Version '${versionName}' exists which is expected.`);
  } else {
    core.setFailed(`Version '${versionName}' does not appear to exist which is NOT expected.`);
  }
};
