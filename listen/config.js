// Settings for the Listening reader. Nothing here is secret: the sign-in ID
// only works on this website, and the server only answers your Google account.
window.LISTEN_CONFIG = {
  // Google sign-in "Client ID" (Google Cloud > Google Auth Platform > Clients)
  clientId: "488710691850-f3b4ma6isrgomdb80eskh89eqr0g59ja.apps.googleusercontent.com",
  // Your Listening server on Cloud Run (printed at the end of setup.sh)
  apiUrl: "https://listening-api-488710691850.us-east1.run.app",
};
