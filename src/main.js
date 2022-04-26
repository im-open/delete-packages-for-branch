const core = require('@actions/core');
const github = require('@actions/github');
const { graphql } = require('@octokit/graphql');

const requiredArgOptions = {
  required: true,
  trimWhitespace: true
};

const token = core.getInput('github-token', requiredArgOptions);
const branchNameInput = core.getInput('branch-name', requiredArgOptions);
const packageType = core.getInput('package-type', requiredArgOptions);
const packageNamesInput = core.getInput('package-names');
const packageNames = !!packageNamesInput
  ? packageNamesInput.split(',').map(package => package.trim())
  : [];
const repo = github.context.repo.repo;
const checkForPreReleaseRegex = /^.*\d+\.\d+\.\d+-.+$/;

let org = core.getInput('organization');
if (!org && org.length === 0) {
  org = github.context.repo.owner;
}

const branchName = branchNameInput.replace('refs/heads/', '').replace(/[^a-zA-Z0-9-]/g, '-');
const branchPattern = `-${branchName}.`;
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${token}`
  }
});

async function getAllPackagesForRepo() {
  core.info('Querying for all of the packages in the repo.\n');
  const query = `
  query {
    repository(owner: "${org}", name: "${repo}") {
      packages(packageType: ${packageType.toUpperCase()}, first: 100){
        totalCount
        nodes {
          name
          id
          versions(last: 100) {
            nodes {
              id,
              version,
              preRelease
            }
          }
        }
      } 
    }
  }
  `;

  const response = await graphqlWithAuth(query);
  core.info(`Successfully recieved ${response.repository.packages.totalCount} packages.`);
  response.repository.packages.nodes.forEach(node => {
    core.info(node.name);
  });
  // Add some space between the list of packages and the following logs.
  core.info(' ');

  return response.repository.packages.nodes.flatMap(package =>
    package.versions.nodes.map(version => ({
      packageName: package.name,
      versionName: version.version,
      id: version.id,
      isPreRelease: checkForPreReleaseRegex.test(version.version)
    }))
  );
}

function filterPackages(packages) {
  const filteredPackages = packages.filter(package => {
    const versionContainsBranchPattern = package.versionName.indexOf(branchPattern) > -1;
    const packageWasRequestedByInput =
      !packageNames.length || packageNames.includes(package.packageName);
    const versionIsPreRelease = package.isPreRelease;

    if (!packageWasRequestedByInput) {
      core.info(
        `Package ${package.versionName} was not in the list of package names from the input parameters.`
      );
    } else if (!versionIsPreRelease) {
      core.info(
        `Package ${package.versionName} is not a prerelease package so it will not be deleted.`
      );
    } else if (!versionContainsBranchPattern) {
      core.info(
        `Package ${package.versionName} does not meet the pattern and will not be deleted.`
      );
    }

    return packageWasRequestedByInput && versionIsPreRelease && versionContainsBranchPattern;
  });

  core.info('Finished gathering packages, the following items will be removed:');
  console.log(filteredPackages); //Normally I'd make this core.info but it doesn't print right with JSON.stringify()

  return filteredPackages;
}

async function deletePackage(package) {
  try {
    core.info(
      `\nDeleting package ${package.versionName} (${package.id}) (org: ${org} type: ${packageType})...`
    );

    const query = `
    mutation {
      deletePackageVersion(input: {packageVersionId: "${package.id}"}) {
        success
      }
    }
    `;

    await graphqlWithAuth(query, { mediaType: { previews: ['package-deletes'] } });

    core.info(`Finished deleting package: ${package.versionName} (${package.id}).`);
  } catch (error) {
    core.warning(
      `There was an error deleting the package ${package.versionName} (${package.id}): ${error.message}`
    );
  }
}

async function run() {
  const packagesInRepo = await getAllPackagesForRepo();
  const packagesToDelete = filterPackages(packagesInRepo);

  for (const package of packagesToDelete) {
    await deletePackage(package);
  }

  core.info('\nFinished deleting packages.');
}

run();
