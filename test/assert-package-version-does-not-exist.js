module.exports = (core, packageVersions, versionName) => {
  if (!packageVersions) {
    core.setFailed('No package versions were provided.');
    return;
  }

  console.log(packageVersions);

  const versionExists = packageVersions.find(p => p.name === versionName);
  if (versionExists) {
    core.setFailed(`Version '${versionName}' exists, which is NOT expected.`);
  } else {
    core.info(`Version '${versionName}' does not appear to exist which is expected.`);
  }
};
