// SDA Sabbath cloud (Supabase): sign-in, install & usage statistics, feedback, Google Slides download.
// Leave `url` empty and the app works exactly as before, fully offline, with no sign-in.
// Fill in from Supabase → Project Settings → API (the "anon public" key is meant to be public: what each
// person may read or write is decided by the rules in supabase/schema.sql). See supabase/SETUP.md.
export const CLOUD = {
  url: '',            // e.g. 'https://abcdefghijkl.supabase.co'
  anonKey: '',        // the "anon public" key
  google: false,      // true once Google sign-in is turned on in Supabase → Authentication → Providers
  requireSignIn: true, // first start asks to sign in (never blocks the app without internet)
};
