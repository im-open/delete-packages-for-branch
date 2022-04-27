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

async function getAllPackageVersions(packageName) {
  const initialQuery = `
  query {
    repository(owner: "${org}", name: "${repo}") {
      packages(names: ["${packageName}"], first: 1){
        totalCount
        nodes {
          name
          id
          versions(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id,
              version
            }
          }
        }
      } 
    }
  }
  `;
  const paginatedQuery = `
  query getPackageVersions($cursor: String!) {
    repository(owner: "${org}", name: "${repo}") {
      packages(names: ["${packageName}"], first: 1){
        totalCount
        nodes {
          name
          id
          versions(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id,
              version
            }
          }
        }
      } 
    }
  }
  `;
  let packageVersions = [];
  let hasNextPage = true;
  let currentCursor = '';

  while (hasNextPage) {
    const response =
      currentCursor === ''
        ? await graphqlWithAuth(initialQuery)
        : await graphqlWithAuth(paginatedQuery, { cursor: currentCursor });
    const pageVersions = response.repository.packages.nodes[0].versions;
    hasNextPage = pageVersions.pageInfo.hasNextPage;
    currentCursor = pageVersions.pageInfo.endCursor;

    packageVersions = packageVersions.concat(pageVersions.nodes);
  }

  return packageVersions;
}

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

  let allPackageVersions = [];

  for (const package of response.repository.packages.nodes) {
    const packageVersions = (await getAllPackageVersions(package.name)).map(packageVersion => ({
      ...packageVersion,
      packageName: package.name,
      isPreRelease: checkForPreReleaseRegex.test(packageVersion.version)
    }));
    allPackageVersions = allPackageVersions.concat(packageVersions);
  }

  return allPackageVersions;
}

function filterPackages(packages) {
  const filteredPackages = packages.filter(package => {
    const versionContainsBranchPattern = package.version.indexOf(branchPattern) > -1;
    const packageWasRequestedByInput =
      !packageNames.length || packageNames.includes(package.packageName);
    const versionIsPreRelease = package.isPreRelease;

    if (!packageWasRequestedByInput) {
      core.info(
        `Package ${package.version} was not in the list of package names from the input parameters.`
      );
    } else if (!versionIsPreRelease) {
      core.info(
        `Package ${package.version} is not a prerelease package so it will not be deleted.`
      );
    } else if (!versionContainsBranchPattern) {
      core.info(`Package ${package.version} does not meet the pattern and will not be deleted.`);
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
      `\nDeleting package ${package.version} (${package.id}) (org: ${org} type: ${packageType})...`
    );

    const query = `
    mutation {
      deletePackageVersion(input: {packageVersionId: "${package.id}"}) {
        success
      }
    }
    `;

    await graphqlWithAuth(query, { mediaType: { previews: ['package-deletes'] } });

    core.info(`Finished deleting package: ${package.version} (${package.id}).`);
  } catch (error) {
    core.warning(
      `There was an error deleting the package ${package.version} (${package.id}): ${error.message}`
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
