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
const octokit = github.getOctokit(token);
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
    // core.info('Versions');
    // node.versions.nodes.forEach(version => core.info(`${version.version} (${version.id})`));
    // Add some space between the list of package versions and the following logs.
    // core.info(' ');
  });
  // Add some space between the list of packages and the following logs.
  core.info(' ');

  // return response.repository.packages.nodes.map(node => node.name);

  // if (!response.repository.packages.nodes.versions) {
  //   return [];
  // }

  // return response.repository.packages.nodes.versions.nodes.map(version => ({
  //   name: version.version,
  //   id: version.id
  // }));
  return response.repository.packages.nodes.flatMap(package =>
    package.versions.nodes.map(version => ({ name: version.version, id: version.id }))
  );
}

function filterPackages(packages) {
  const filteredPackages = packages.filter(package => {
    const shouldDelete = package.name.indexOf(branchPattern) > -1;

    if (!shouldDelete) {
      core.info(`Package ${package.name} does not meet the pattern and will not be deleted`);
    }

    return shouldDelete;
  });

  core.info('Finished gathering packages, the following items will be removed:');
  console.log(filteredPackages); //Normally I'd make this core.info but it doesn't print right with JSON.stringify()

  return filteredPackages;
}

async function getListOfPackageVersions(packages) {
  // let hasMorePackages = true;
  let packagesToDelete = [];
  // let page = 1;
  // const maxResultsPerPage = 50;
  core.info(`Gathering list of packages with '${branchPattern}' in the name or tag to delete...`);

  // while (hasMorePackages) {
  for (packageName of packages) {
    try {
      const packageVersions = await octokit.paginate(
        octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg,
        {
          org: org,
          package_type: packageType,
          package_name: packageName
        }
      );

      // if (response.status == 200) {
      //   if (response.data) {
      //     if (response.data.length < maxResultsPerPage) {
      //       hasMorePackages = false;
      //     } else {
      //       page += 1;
      //     }

      for (let index = 0; index < packageVersions.length; index++) {
        const package = packageVersions[index];
        if (package.name.indexOf(branchPattern) > -1) {
          packagesToDelete.push({
            name: package.name,
            id: package.id
          });
        } else {
          core.info(`Package ${package.name} does not meet the pattern and will not be deleted`);
        }
      }
    } catch (error) {
      core.warning(
        `There was an error getting the versions of the package ${packageName}: ${error.message}`
      );
    }
    //   } else {
    //     core.info('Finished getting packages for the repository.');
    //   }
    // } else {
    //   core.setFailed(`An error occurred retrieving page ${page} of packages.`);
    // }
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
  // let retryCount = 1;
  // while (retryCount < 6) {
  try {
    core.info(
      `\nDeleting package ${package.name} (${package.id}) (org: ${org} type: ${packageType})...`
    );
    await octokit.rest.packages.deletePackageVersionForOrg({
      package_type: packageType,
      package_name: package.name,
      org: org,
      package_version_id: package.id
    });

    core.info(`Finished deleting package: ${package.name} (${package.id}).`);
    // break;
  } catch (error) {
    // retryCount++;
    core.warning(
      `There was an error deleting the package ${package.name} (${package.id}): ${error.message}`
    );
  }
  // }
}

async function deletePackageViaGraphql(package) {
  try {
    core.info(
      `\nDeleting package ${package.name} (${package.id}) (org: ${org} type: ${packageType})...`
    );

    const query = `
    mutation {
      deletePackageVersion(input: {packageVersionId: "${package.id}"}) {
        success
      }
    }
    `;

    const response = await graphqlWithAuth(query, { mediaType: { previews: ['package-deletes'] } });

    core.info(`Response:`);
    console.log(repsonse);

    // if (!response.success) {
    //   throw new Error('The delete operation did not succeed. No further information is available.');
    // }

    core.info(`Finished deleting package: ${package.name} (${package.id}).`);
    // break;
  } catch (error) {
    // retryCount++;
    core.warning(
      `There was an error deleting the package ${package.name} (${package.id}): ${error.message}`
    );
  }
}

async function run() {
  let packagesToDelete = !!packageNames
    ? packageNames.split(',').map(package => package.trim())
    : filterPackages(await getAllPackagesForRepo());
  // const sleep = ms => new Promise(r => setTimeout(r, ms));

  // for (package of packagesToDelete) {
  //   const packageVersionsToDelete = await getListOfPackageVersions([package]);

  //   // sleep(5000);

  //   for (const packageVersion of packageVersionsToDelete) {
  //     await deletePackage(packageVersion);
  //   }
  // }
  for (const package of packagesToDelete) {
    // await deletePackage(package);
    await deletePackageViaGraphql(package);
  }

  // const packageVersionsToDelete = await getListOfPackageVersions(packagesToDelete);

  // for (const packageVersion of packageVersionsToDelete) {
  //   await deletePackage(packageVersion);
  // }
  core.info('\nFinished deleting packages.');
}

run();
