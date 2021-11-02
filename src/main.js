const core = require('@actions/core');
const github = require('@actions/github');

const requiredArgOptions = {
  required: true,
  trimWhitespace: true
};

const token = core.getInput('github-token', requiredArgOptions);
const branchNameInput = core.getInput('branch-name', requiredArgOptions);
const packageType = core.getInput('package-type', requiredArgOptions);
const packageName = core.getInput('package-name', requiredArgOptions);

let org = core.getInput('organization');
if (!org && org.length === 0) {
  org = github.context.repo.owner;
}

const branchName = branchNameInput.replace('refs/heads/', '').replace(/[^a-zA-Z0-9-]/g, '-');
const branchPattern = `-${branchName}.`;
const octokit = github.getOctokit(token);

async function getListOfPackages() {
  let hasMorePackages = true;
  let packagesToDelete = [];
  let page = 1;
  const maxResultsPerPage = 50;
  core.info(`Gathering list of packages with '${branchPattern}' in the name or tag to delete...`);

  while (hasMorePackages) {
    const response = await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
      org: org,
      package_type: packageType,
      package_name: packageName,
      per_page: maxResultsPerPage,
      page: page
    });

    if (response.status == 200) {
      if (response.data) {
        if (response.data.length < maxResultsPerPage) {
          hasMorePackages = false;
        } else {
          page += 1;
        }

        for (let index = 0; index < response.data.length; index++) {
          const package = response.data[index];
          if (package.name.indexOf(branchPattern) > -1) {
            packagesToDelete.push({
              name: package.name,
              id: package.id
            });
          } else {
            core.info(`Package ${package.name} does not meet the pattern and will not be deleted`);
          }
        }
      } else {
        core.info('Finished getting packages for the repository.');
      }
    } else {
      core.setFailed(`An error occurred retrieving page ${page} of packages.`);
    }
  }

  if (packagesToDelete.length === 0) {
    core.info('Finished gathering packages, there were no items to removed.');
  } else {
    core.info('Finished gathering packages, the following items will be removed:');
    console.log(packagesToDelete); //Normally I'd make this core.info but it doesn't print right with JSON.stringify()
  }

  return packagesToDelete;
}

async function deletePackage(package) {
  try {
    core.info(`\nDeleting package ${package.name} (${package.id})...`);
    await octokit.rest.packages.deletePackageVersionForOrg({
      package_type: packageType,
      package_name: packageName,
      org: org,
      package_version_id: package.id
    });

    core.info(`Finished deleting package: ${package.name} (${package.id}).`);
  } catch (error) {
    core.warning(
      `There was an error deleting the package ${package.name} (${package.id}): ${error.message}`
    );
  }
}

async function run() {
  let packagesToDelete = await getListOfPackages();

  for (let index = 0; index < packagesToDelete.length; index++) {
    await deletePackage(packagesToDelete[index]);
  }
}

run();
