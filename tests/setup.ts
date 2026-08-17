import { config } from "dotenv";

// Tests read the same .env the app does. Anything a test needs and the
// file does not have is set below, so a checkout without secrets still
// runs everything except the live-send tests.
config({ path: [".env.local", ".env"] });

process.env.APP_ENV ??= "development";
process.env.SMS_FORCE_SEND = "false";
