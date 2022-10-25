const core = require('@actions/core');
const github = require('@actions/github');
const { graphql } = require('@octokit/graphql');

const requiredArgOptions = {
  required: true,
  trimWhitespace: true
};

let org = core.getInput('organization');
if (!org && org.length === 0) {
  org = github.context.repo.owner;
}
let repo = core.getInput('repository');
if (!repo && repo.length === 0) {
  repo = github.context.repo.repo;
}

const packageType = core.getInput('package-type', requiredArgOptions);
const packageNamesInput = core.getInput('package-names');
const packagesWithVersionsToDelete = !!packageNamesInput ? packageNamesInput.split(',').map(package => package.trim()) : [];

const branchNameInput = core.getInput('branch-name', requiredArgOptions);
const branchName = branchNameInput.replace('refs/heads/', '').replace(/[^a-zA-Z0-9-]/g, '-');
const branchPattern = `-${branchName}.`;
const checkForPreReleaseRegex = /^.*\d+\.\d+\.\d+-.+$/;

const token = core.getInput('github-token', requiredArgOptions);
const octokit = github.getOctokit(token);
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${token}`
  }
});

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
    .filter(v => checkForPreReleaseRegex.test(v.version) && v.version.indexOf(branchPattern) > -1);
}

async function getPackagesInRepoToReview(org, repo, packageType, packagesWithVersionsToDelete) {
  //If nothing was sent in for this arg, default to gathering info for all packages.
  if (packagesWithVersionsToDelete.length !== 0) {
    core.info(
      `\nThe action was provided with package names and will look for versions to delete in the following packages:`
    );
    packagesWithVersionsToDelete.forEach(p => core.info(`\t${p}`));
    return packagesWithVersionsToDelete;
  } else {
    core.info('Querying for all of the packages in the repo.\n');

    const query = `
    query {
      repository(owner: "${org}", name: "${repo}") {
        packages(packageType: ${packageType.toUpperCase()}, first: 100){
          nodes {
            name
          }
        } 
      }
    }`;

    // The rest api does not provide a good way to gather the packages that are
    // associated with a single repository.  You can only get them based on the
    // org or user.  Those results don't include the repo, so use graph api here.
    const response = await graphqlWithAuth(query);
    core.info(`Successfully retrieved ${response.repository.packages.nodes.length} packages.`);

    response.repository.packages.nodes.forEach(p => {
      packagesWithVersionsToDelete.push(p.name);
    });

    core.info(`\nThe action will look for versions to delete in the following packages:`);
    packagesWithVersionsToDelete.forEach(p => core.info(`\t${p}`));
    return packagesWithVersionsToDelete;
  }
}

async function run() {
  core.info(`Begin deleting '${branchName}' package versions for ${org}/${repo}...`);

  const packagesToReview = await getPackagesInRepoToReview(org, repo, packageType, packagesWithVersionsToDelete);

  for (const pkgName of packagesToReview) {
    const pkgVersionsToDelete = await getVersionsToDeleteForPackage(org, pkgName, packageType);
    await deletePackageVersions(org, pkgName, packageType, pkgVersionsToDelete);
  }

  core.info(`\nFinished deleting '${branchName}' package versions from ${org}/${repo}.`);
}

run();
