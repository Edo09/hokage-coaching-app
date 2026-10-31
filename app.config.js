// app.json holds the config; this only picks where Firebase's file comes from.
// On EAS it is the GOOGLE_SERVICES_JSON file variable (uploaded to the project,
// kept out of git): the variable holds the path of the file in the build job.
// Locally (prebuild, run:android) it is the git-ignored ./google-services.json.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
