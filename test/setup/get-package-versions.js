module.exports = async (github, core) => {
  let versionsToReturn = [];
  await github
    .paginate(github.rest.packages.getAllPackageVersionsForPackageOwnedByOrg, {
      org: 'im-open',
      package_type: 'npm',
      package_name: 'npm-pkg-to-delete'
    })
    .then(packageVersions => {
      core.info(`There are ${packageVersions.length} versions found.`);
      versionsToReturn = packageVersions.map(p => {
        return { id: p.id, name: p.name };
      });
    })
    .catch(() => {
      core.setFailed(`An error occurred retrieving 'npm-pkg-to-delete' package versions in im-open: ${error.message}`);
    });

  core.info('The packages to return:');
  console.log(versionsToReturn);
  return versionsToReturn;
};
