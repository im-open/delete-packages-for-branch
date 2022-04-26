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
const packageNames = core.getInput('package-names');
const repo = github.context.repo.repo;

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
              version
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
      id: version.id
    }))
  );
}

function filterPackagesByName(packages) {
  if (!packageNames) {
    return packages;
  }

  const packageNamesArray = packageNames.split(',').map(package => package.trim());

  return packages.filter(package => packageNamesArray.includes(package.packageName));
}

function filterPackageVersionsByBranchPattern(packages) {
  const filteredPackages = packages.filter(package => {
    const shouldDelete = package.versionName.indexOf(branchPattern) > -1;

    if (!shouldDelete) {
      core.info(`Package ${package.versionName} does not meet the pattern and will not be deleted`);
    }

    return shouldDelete;
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
  const packagesToDelete = filterPackageVersionsByBranchPattern(
    filterPackagesByName(packagesInRepo)
  );

  for (const package of packagesToDelete) {
    await deletePackage(package);
  }

  core.info('\nFinished deleting packages.');
}

run();
