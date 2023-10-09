const core = require('@actions/core');
const github = require('@actions/github');

const requiredArgOptions = {
  required: true,
  trimWhitespace: true
};
const trimOptions = {
  trimWhitespace: true
};

const org = core.getInput('organization', trimOptions) || github.context.repo.owner;
const repo = core.getInput('repository', trimOptions) || github.context.repo.repo;

const packageType = core.getInput('package-type', requiredArgOptions);
const packageNamesInput = core.getInput('package-names', trimOptions);
const strictMatchMode = core.getBooleanInput('strict-match-mode', requiredArgOptions);
const branchNameInput = core.getInput('branch-name', requiredArgOptions);

const packagesWithVersionsToDelete = !!packageNamesInput ? packageNamesInput.split(',').map(package => package.trim()) : [];
const branchName = branchNameInput.replace('refs/heads/', '').replace(/[^a-zA-Z0-9-]/g, '-');
const branchPattern = strictMatchMode ? `-${branchName}.` : branchName;
const checkForPreReleaseRegex = /^.*\d+\.\d+\.\d+-.+$/;

const token = core.getInput('github-token', requiredArgOptions);
const octokit = github.getOctokit(token);

async function deletePackageVersions(org, packageName, packageType, pkgVersionsToDelete) {
  if (pkgVersionsToDelete.length <= 0) {
    core.info(`\nThere are no ${packageName} package versions to delete for branch '${branchName}'`);
    return;
  }

  core.info(`\nBegin Deleting ${packageName} package versions for branch '${branchName}'`);
  for (const pkgVersion of pkgVersionsToDelete) {
    core.info(`\t${pkgVersion.version}, id: '${pkgVersion.id}' - Starting Delete.`);

    // Using the rest api provides the most reliable results for deleting the packages.
    await octokit.rest.packages
      .deletePackageVersionForOrg({
        package_type: packageType,
        package_name: packageName,
        org: org,
        package_version_id: pkgVersion.id
      })
      .then(() => {
        core.info(`\t${pkgVersion.version}, id: '${pkgVersion.id}' - Deleted.\n`);
      })
      .catch(error => {
        core.warning(`\t${pkgVersion.version}, id: '${pkgVersion.id}' - Error: ${error.message}.\n`);
      });
  }
}

async function getVersionsToDeleteForPackage(org, packageName, packageType) {
  let rawVersions = [];
  await octokit
    // The octokit version of the api call (octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg)
    // doesn't seem to be working currently.  So using a custom request until it is fixed.
    .paginate(`GET /orgs/{owner}/packages/{packageType}/{packageName}/versions`, {
      owner: org,
      packageType: packageType,
      packageName: packageName
    })
    .then(packageVersions => {
      rawVersions = packageVersions.map(pv => {
        return {
          version: pv.name,
          id: pv.id
        };
      });
    })
    .catch(error => {
      core.info(`An error occurred retrieving ${packageName} package versions: ${error.message}`);
    });

  return rawVersions
    .sort((a, b) => (a.version > b.version ? 1 : b.version > a.version ? -1 : 0))
    .filter(v => checkForPreReleaseRegex.test(v.version) && v.version.includes(branchPattern));
}

async function getPackagesInRepoToReview(org, repo, packageType, packagesWithVersionsToDelete) {
  //If nothing was sent in for this arg, default to gathering info for all packages.
  if (packagesWithVersionsToDelete.length !== 0) {
    const packageString = packagesWithVersionsToDelete.join('\n\t$');
    const message = `\nThe action was provided with package names and will look for versions to delete in the following packages:\n\t${packageString}`;
    core.info(message);
    return packagesWithVersionsToDelete;
  }

  const orgAndRepo = `${org}/${repo}`;
  core.info('Querying for all of the packages in the repo.\n');
  await octokit
    .paginate(octokit.rest.packages.listPackagesForOrganization, { package_type: packageType, org: org })
    .then(packages => {
      let repoPackages = [];
      if (packages && packages.length > 0) {
        repoPackages = packages.filter(p => p.repository.name.toLowerCase() === repo.toLowerCase());
      }

      if (repoPackages && repoPackages.length > 0) {
        packagesWithVersionsToDelete = repoPackages.map(p => p.name);
        const packageString = packagesWithVersionsToDelete.join('\n\t$');
        core.info(`\nThe action will look for versions to delete in the following packages:\n\t${packageString}`);
      } else {
        packagesWithVersionsToDelete = [];
        core.info(`No packages were found in the ${orgAndRepo} repository.`);
      }
    })
    .catch(error => {
      core.setFailed(`An error occurred retrieving packages in ${orgAndRepo}: ${error.message}`);
    });

  return packagesWithVersionsToDelete;
}

async function run() {
  core.info(`Begin deleting package versions...`);
  core.info(`Repo: ${org}/${repo}`);
  core.info('Package Names: ${packagesWithVersionsToDelete.join(', ')}');
  core.info(`Strict match mode: ${strictMatchMode}`);
  core.info(`Branch name input: '${branchNameInput}'`);
  core.info(`Sanitized Branch name: '${branchName}'`);
  core.info(`Pattern to match: '${branchPattern}'`);

  const packagesToReview = await getPackagesInRepoToReview(org, repo, packageType, packagesWithVersionsToDelete);

  for (const pkgName of packagesToReview) {
    const pkgVersionsToDelete = await getVersionsToDeleteForPackage(org, pkgName, packageType);
    await deletePackageVersions(org, pkgName, packageType, pkgVersionsToDelete);
  }

  core.info(`\nFinished deleting '${branchName}' package versions from ${org}/${repo}.`);
}

run();
